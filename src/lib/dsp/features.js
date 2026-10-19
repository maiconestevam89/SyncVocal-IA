import { createFFT } from "@/lib/dsp/fft";

// Frame-level features used to line two recordings up in time:
// chroma (which notes are sung) + MFCC (which sounds are sung).
export const FEATURE_SR = 16000;
const FRAME = 2048;
const N_BINS = FRAME / 2 + 1;
const N_MEL = 24;
const N_MFCC = 12;
const N_CHROMA = 12;
const DIM = N_CHROMA + N_MFCC;
const W_CHROMA = 0.6;
const W_MFCC = 0.4;

const tick = () => new Promise((r) => setTimeout(r, 0));
const hz2mel = (f) => 2595 * Math.log10(1 + f / 700);
const mel2hz = (m) => 700 * (Math.pow(10, m / 2595) - 1);

function buildMelFilters() {
  const lo = hz2mel(80);
  const hi = hz2mel(7000);
  const edges = [];
  for (let i = 0; i < N_MEL + 2; i++) {
    const hz = mel2hz(lo + ((hi - lo) * i) / (N_MEL + 1));
    edges.push((hz * FRAME) / FEATURE_SR);
  }
  const filters = [];
  for (let m = 0; m < N_MEL; m++) {
    const l = edges[m];
    const c = edges[m + 1];
    const r = edges[m + 2];
    const w = new Float32Array(N_BINS);
    for (let b = Math.floor(l); b <= Math.ceil(r) && b < N_BINS; b++) {
      const v = b <= c ? (b - l) / (c - l || 1) : (r - b) / (r - c || 1);
      w[b] = Math.max(0, v);
    }
    filters.push(w);
  }
  return filters;
}

function buildChromaMap() {
  const map = new Int8Array(N_BINS).fill(-1);
  for (let b = 0; b < N_BINS; b++) {
    const f = (b * FEATURE_SR) / FRAME;
    if (f < 120 || f > 2000) continue;
    const pc = Math.round(12 * Math.log2(f / 440) + 69) % 12;
    map[b] = (pc + 12) % 12;
  }
  return map;
}

function l2normalize(arr, from, to, scale) {
  let s = 0;
  for (let d = from; d < to; d++) s += arr[d] * arr[d];
  const k = scale / (Math.sqrt(s) + 1e-9);
  for (let d = from; d < to; d++) arr[d] *= k;
}

// x: mono Float32Array at FEATURE_SR. hop: seconds between frames.
export async function computeFeatures(x, hop) {
  const hopS = Math.max(1, Math.round(hop * FEATURE_SR));
  const nFrames = Math.max(1, Math.floor((x.length - FRAME) / hopS) + 1);
  const fft = createFFT(FRAME);
  const filters = buildMelFilters();
  const cmap = buildChromaMap();

  const win = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
  const dct = new Float32Array(N_MFCC * N_MEL);
  for (let k = 0; k < N_MFCC; k++) {
    for (let m = 0; m < N_MEL; m++) {
      dct[k * N_MEL + m] = Math.cos((Math.PI * (k + 1) * (m + 0.5)) / N_MEL);
    }
  }

  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const pow = new Float32Array(N_BINS);
  const logMel = new Float32Array(N_MEL);
  const feats = new Float32Array(nFrames * DIM);
  const rms = new Float32Array(nFrames);

  for (let f = 0; f < nFrames; f++) {
    const off = f * hopS;
    let energy = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = off + i < x.length ? x[off + i] : 0;
      re[i] = v * win[i];
      im[i] = 0;
      energy += v * v;
    }
    rms[f] = Math.sqrt(energy / FRAME);
    fft(re, im);
    for (let b = 0; b < N_BINS; b++) pow[b] = re[b] * re[b] + im[b] * im[b];

    const base = f * DIM;
    for (let b = 0; b < N_BINS; b++) {
      const pc = cmap[b];
      if (pc >= 0) feats[base + pc] += Math.pow(pow[b], 0.25);
    }
    for (let m = 0; m < N_MEL; m++) {
      const w = filters[m];
      let s = 0;
      for (let b = 0; b < N_BINS; b++) if (w[b] !== 0) s += w[b] * pow[b];
      logMel[m] = Math.log(s + 1e-8);
    }
    for (let k = 0; k < N_MFCC; k++) {
      let s = 0;
      for (let m = 0; m < N_MEL; m++) s += logMel[m] * dct[k * N_MEL + m];
      feats[base + N_CHROMA + k] = s;
    }
    if (f % 100 === 0) await tick();
  }

  // Which frames actually contain sound.
  let peak = 0;
  for (let f = 0; f < nFrames; f++) if (rms[f] > peak) peak = rms[f];
  const thr = Math.max(1e-4, peak * 0.04);
  const active = new Uint8Array(nFrames);
  let count = 0;
  for (let f = 0; f < nFrames; f++) {
    if (rms[f] > thr) {
      active[f] = 1;
      count++;
    }
  }

  if (count > 0) {
    // Per-recording mean/variance normalisation: removes level and timbre bias.
    const mean = new Float32Array(DIM);
    const std = new Float32Array(DIM).fill(1);
    for (let f = 0; f < nFrames; f++) {
      if (!active[f]) continue;
      for (let d = 0; d < DIM; d++) mean[d] += feats[f * DIM + d] / count;
    }
    for (let d = N_CHROMA; d < DIM; d++) {
      let v = 0;
      for (let f = 0; f < nFrames; f++) {
        if (!active[f]) continue;
        const diff = feats[f * DIM + d] - mean[d];
        v += (diff * diff) / count;
      }
      std[d] = Math.sqrt(v) + 1e-6;
    }
    for (let f = 0; f < nFrames; f++) {
      const base = f * DIM;
      if (!active[f]) {
        for (let d = 0; d < DIM; d++) feats[base + d] = 0;
        continue;
      }
      for (let d = 0; d < DIM; d++) feats[base + d] = (feats[base + d] - mean[d]) / std[d];
      l2normalize(feats, base, base + N_CHROMA, Math.sqrt(W_CHROMA));
      l2normalize(feats, base + N_CHROMA, base + DIM, Math.sqrt(W_MFCC));
    }
  } else {
    feats.fill(0);
  }

  return {
    feats,
    dim: DIM,
    nFrames,
    active,
    hop: hopS / FEATURE_SR,
    offset: FRAME / 2 / FEATURE_SR, // centre of the first frame, in seconds
  };
}