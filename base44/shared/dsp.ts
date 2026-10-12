// Pure-JS DSP module for server-side audio alignment and mixing.
// Ported from src/lib/dsp/* with all browser APIs (OfflineAudioContext,
// AudioBuffer) replaced by raw Float32Array operations.

const tick = () => new Promise((r) => setTimeout(r, 0));

// ===================== FFT (from dsp/fft.js) =====================
export function createFFT(n) {
  const levels = Math.round(Math.log2(n));
  if (1 << levels !== n) throw new Error("FFT size must be a power of two");

  const cosT = new Float32Array(n / 2);
  const sinT = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cosT[i] = Math.cos((2 * Math.PI * i) / n);
    sinT[i] = Math.sin((2 * Math.PI * i) / n);
  }

  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i;
    let r = 0;
    for (let b = 0; b < levels; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = r;
  }

  return function transform(re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tr = re[l] * cosT[k] + im[l] * sinT[k];
          const ti = -re[l] * sinT[k] + im[l] * cosT[k];
          re[l] = re[j] - tr;
          im[l] = im[j] - ti;
          re[j] += tr;
          im[j] += ti;
        }
      }
    }
  };
}

// ===================== Features (from dsp/features.js) =====================
export const FEATURE_SR = 16000;
const FRAME = 2048;
const N_BINS = FRAME / 2 + 1;
const N_MEL = 24;
const N_MFCC = 12;
const N_CHROMA = 12;
const DIM = N_CHROMA + N_MFCC;
const W_CHROMA = 0.6;
const W_MFCC = 0.4;

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
    const l = edges[m], c = edges[m + 1], r = edges[m + 2];
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

  let peak = 0;
  for (let f = 0; f < nFrames; f++) if (rms[f] > peak) peak = rms[f];
  const thr = Math.max(1e-4, peak * 0.04);
  const active = new Uint8Array(nFrames);
  let count = 0;
  for (let f = 0; f < nFrames; f++) {
    if (rms[f] > thr) { active[f] = 1; count++; }
  }

  if (count > 0) {
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
    feats, dim: DIM, nFrames, active,
    hop: hopS / FEATURE_SR,
    offset: FRAME / 2 / FEATURE_SR,
  };
}

// ===================== DTW (from dsp/dtw.js) =====================
const INF = 1e30;
const STEP_PENALTY = 0.15;

export async function subsequenceDTW(q, r) {
  const N = q.nFrames;
  const M = r.nFrames;
  const dim = q.dim;
  const bp = new Uint8Array(N * M);

  const fillCost = (i, out) => {
    const qa = q.active[i];
    const qo = i * dim;
    for (let j = 0; j < M; j++) {
      const ra = r.active[j];
      if (!qa || !ra) { out[j] = !qa && !ra ? 0.4 : 1; continue; }
      const ro = j * dim;
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += q.feats[qo + d] * r.feats[ro + d];
      out[j] = 1 - dot;
    }
  };

  let Dm2 = new Float32Array(M).fill(INF);
  let Dm1 = new Float32Array(M);
  let D = new Float32Array(M);
  let cPrev = new Float32Array(M);
  let cCur = new Float32Array(M);

  fillCost(0, cPrev);
  for (let j = 0; j < M; j++) { Dm1[j] = cPrev[j]; bp[j] = 255; }

  for (let i = 1; i < N; i++) {
    fillCost(i, cCur);
    const base = i * M;
    for (let j = 0; j < M; j++) {
      let best = INF;
      let step = 3;
      if (j >= 1 && Dm1[j - 1] < INF) { best = Dm1[j - 1] + cCur[j]; step = 0; }
      if (j >= 2 && Dm1[j - 2] < INF) {
        const v = Dm1[j - 2] + 0.5 * (cCur[j - 1] + cCur[j]) + STEP_PENALTY;
        if (v < best) { best = v; step = 1; }
      }
      if (i >= 2 && j >= 1 && Dm2[j - 1] < INF) {
        const v = Dm2[j - 1] + cPrev[j] + cCur[j] + STEP_PENALTY;
        if (v < best) { best = v; step = 2; }
      }
      D[j] = best;
      bp[base + j] = step;
    }
    const tmp = Dm2; Dm2 = Dm1; Dm1 = D; D = tmp;
    const ct = cPrev; cPrev = cCur; cCur = ct;
    if (i % 64 === 0) await tick();
  }

  let bestJ = -1, bestCost = INF;
  for (let j = 0; j < M; j++) {
    if (Dm1[j] < bestCost) { bestCost = Dm1[j]; bestJ = j; }
  }
  if (bestJ < 0) return null;

  const rev = [];
  let i = N - 1, j = bestJ;
  for (;;) {
    rev.push([i, j]);
    const s = bp[i * M + j];
    if (s === 255 || s === 3) break;
    if (s === 0) { i -= 1; j -= 1; }
    else if (s === 1) { rev.push([i, j - 1]); i -= 1; j -= 2; }
    else { rev.push([i - 1, j]); i -= 2; j -= 1; }
  }
  return { path: rev.reverse(), cost: bestCost / N };
}

// ===================== Warp (from dsp/warp.js) =====================
export function buildWarp(path, tq, tr, hop) {
  const j0 = path[0][1];
  const j1 = path[path.length - 1][1];
  const K = j1 - j0 + 1;

  const sum = new Float64Array(K);
  const cnt = new Uint16Array(K);
  for (const [i, j] of path) {
    sum[j - j0] += tq(i);
    cnt[j - j0] += 1;
  }
  const V = new Float64Array(K);
  for (let k = 0; k < K; k++) V[k] = cnt[k] ? sum[k] / cnt[k] : k > 0 ? V[k - 1] : 0;

  const W = Math.max(2, Math.round(0.2 / hop));
  const S = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const w = Math.min(W, k, K - 1 - k);
    let s = 0;
    for (let m = k - w; m <= k + w; m++) s += V[m];
    S[k] = s / (2 * w + 1);
  }
  for (let k = 1; k < K; k++) if (S[k] < S[k - 1]) S[k] = S[k - 1];

  const R0 = tr(j0);
  const R1 = tr(j1);
  return (t) => {
    const x = (t - R0) / hop;
    if (x <= 0) return S[0] + (t - R0);
    if (x >= K - 1) return S[K - 1] + (t - R1);
    const k = Math.floor(x);
    const f = x - k;
    return S[k] * (1 - f) + S[k + 1] * f;
  };
}

// ===================== WSOLA (from dsp/wsola.js) =====================
export async function warpStretch(channels, sampleRate, warp, outDuration) {
  const sr = sampleRate;
  const nCh = channels.length;
  const n = channels[0].length;
  const D = 4;
  const Hs = Math.round(0.02 * sr);
  const N = Hs * 2;
  const tol = Math.round(0.012 * sr);
  const nd = Math.floor(n / D);
  const L = Math.floor(Hs / D);

  const mono = new Float32Array(nd);
  for (let i = 0; i < nd; i++) {
    let s = 0;
    for (let c = 0; c < nCh; c++) {
      const ch = channels[c];
      for (let k = 0; k < D; k++) s += ch[i * D + k];
    }
    mono[i] = s / (D * nCh);
  }

  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  const outLen = Math.ceil(outDuration * sr);
  const outs = channels.map(() => new Float32Array(outLen + 3 * N));
  const lastFrame = Math.ceil(outLen / Hs);

  let prevStart = 0;
  let havePrev = false;

  for (let k = -1; k <= lastFrame; k++) {
    const p = k * Hs;
    const target = Math.round(warp((p + Hs) / sr) * sr) - Hs;
    let start = target;

    if (havePrev) {
      const tpl = Math.round((prevStart + Hs) / D);
      if (tpl >= 0 && tpl + L <= nd) {
        let tplE = 1e-9;
        for (let m = 0; m < L; m++) tplE += mono[tpl + m] * mono[tpl + m];
        const lo = Math.max(0, Math.round((target - tol) / D));
        const hi = Math.min(nd - L, Math.round((target + tol) / D));
        let bestScore = -Infinity;
        let bestSd = -1;
        for (let sd = lo; sd <= hi; sd++) {
          let dot = 0, e = 1e-9;
          for (let m = 0; m < L; m++) {
            const b = mono[sd + m];
            dot += mono[tpl + m] * b;
            e += b * b;
          }
          const score = dot / Math.sqrt(e * tplE) - (0.02 * Math.abs(sd * D - target)) / tol;
          if (score > bestScore) { bestScore = score; bestSd = sd; }
        }
        if (bestSd >= 0) start = bestSd * D;
      }
    }

    for (let c = 0; c < nCh; c++) {
      const src = channels[c];
      const dst = outs[c];
      for (let m = 0; m < N; m++) {
        const o = p + m;
        const idx = start + m;
        if (o >= 0 && idx >= 0 && idx < n) dst[o] += win[m] * src[idx];
      }
    }
    prevStart = start;
    havePrev = true;
    if ((k & 127) === 0) await tick();
  }

  return outs.map((o) => o.slice(0, outLen));
}

// ===================== Silence Gate (from dsp/silenceGate.js) =====================
export const GATE_RATE = 100;
const MIN_GAP_SEC = 0.15;
const PAD_SEC = 0.06;
const GATE_THRESHOLD = 0.02;
const GATE_SMOOTH = 5;

// Accepts raw channels (Float32Array[]) + length + sampleRate instead of AudioBuffer.
export function computeSilenceGateRaw(refChannels, refLength, refSampleRate) {
  const sr = refSampleRate;
  const win = Math.max(1, Math.round(sr / GATE_RATE));
  const nWin = Math.max(2, Math.ceil(refLength / win));
  const nCh = refChannels.length;

  const rms = new Float32Array(nWin);
  let peak = 0;
  for (let w = 0; w < nWin; w++) {
    const from = w * win;
    const to = Math.min(refLength, from + win);
    let s = 0;
    for (let c = 0; c < nCh; c++) {
      const d = refChannels[c];
      for (let i = from; i < to; i++) s += d[i] * d[i];
    }
    rms[w] = Math.sqrt(s / Math.max(1, (to - from) * nCh));
    if (rms[w] > peak) peak = rms[w];
  }
  if (peak < 1e-4) return null;

  const active = new Uint8Array(nWin);
  for (let w = 0; w < nWin; w++) active[w] = rms[w] > peak * GATE_THRESHOLD ? 1 : 0;

  const minGap = Math.round(MIN_GAP_SEC * GATE_RATE);
  let w = 0;
  while (w < nWin) {
    if (active[w]) { w++; continue; }
    let e = w;
    while (e < nWin && !active[e]) e++;
    if (w > 0 && e < nWin && e - w < minGap) active.fill(1, w, e);
    w = e;
  }

  const padW = Math.round(PAD_SEC * GATE_RATE);
  const open = new Float32Array(nWin);
  for (let i = 0; i < nWin; i++) {
    if (!active[i]) continue;
    for (let k = Math.max(0, i - padW); k <= Math.min(nWin - 1, i + padW); k++) open[k] = 1;
  }

  const half = Math.floor(GATE_SMOOTH / 2);
  const curve = new Float32Array(nWin);
  for (let i = 0; i < nWin; i++) {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(nWin - 1, i + half); k++) { s += open[k]; n++; }
    curve[i] = s / n;
  }
  return curve;
}

// Apply a silence-gate curve to vocal channels.
export function applyGate(vocalChannels, gateCurve, sampleRate) {
  if (!gateCurve) return vocalChannels;
  const win = Math.max(1, Math.round(sampleRate / GATE_RATE));
  return vocalChannels.map((ch) => {
    const out = new Float32Array(ch.length);
    for (let w = 0; w < gateCurve.length; w++) {
      const from = w * win;
      const to = Math.min(ch.length, from + win);
      const g = gateCurve[w];
      for (let i = from; i < to; i++) out[i] = ch[i] * g;
    }
    // Copy any remaining samples beyond the gate curve
    const lastG = gateCurve[gateCurve.length - 1] || 0;
    const lastFrom = gateCurve.length * win;
    for (let i = lastFrom; i < ch.length; i++) out[i] = ch[i] * lastG;
    return out;
  });
}

// ===================== Loudness (from loudness.js) =====================
export function computeRmsRaw(channels, length) {
  if (!channels || !channels.length || !length) return 0;
  const step = Math.max(1, Math.floor(length / 200000));
  let sumSq = 0, count = 0;
  for (let ch of channels) {
    for (let i = 0; i < length; i += step) {
      const v = ch[i];
      if (Math.abs(v) > 0.0001) { sumSq += v * v; count++; }
    }
  }
  if (!count) return 0;
  return Math.sqrt(sumSq / count);
}

export function autoMatchGainsRaw(tracks) {
  const measurable = tracks.filter((t) => t.channels && computeRmsRaw(t.channels, t.length) > 0);
  if (measurable.length === 0) return tracks.map(() => 1);
  const rmsValues = measurable.map((t) => computeRmsRaw(t.channels, t.length));
  const targetRms = rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length;
  return tracks.map((t) => {
    const rms = computeRmsRaw(t.channels, t.length);
    if (rms <= 0 || targetRms <= 0) return t.gain ?? 1;
    const needed = (targetRms / rms) * (t.gain ?? 1);
    return Math.max(0.1, Math.min(3, needed));
  });
}

// ===================== Resampling (replaces OfflineAudioContext) =====================
// Linear-interpolation resample to mono at FEATURE_SR (16 kHz).
export function toMono16kRaw(channels, sampleRate) {
  const srcLen = channels[0].length;
  const targetLen = Math.max(1, Math.ceil((srcLen / sampleRate) * FEATURE_SR));
  const out = new Float32Array(targetLen);
  const ratio = sampleRate / FEATURE_SR;
  const nCh = channels.length;
  for (let i = 0; i < targetLen; i++) {
    const srcIdx = i * ratio;
    const idx0 = Math.floor(srcIdx);
    const frac = srcIdx - idx0;
    let val = 0;
    for (let c = 0; c < nCh; c++) {
      const ch = channels[c];
      const s0 = idx0 < srcLen ? ch[idx0] : 0;
      const s1 = idx0 + 1 < srcLen ? ch[idx0 + 1] : s0;
      val += s0 * (1 - frac) + s1 * frac;
    }
    out[i] = val / nCh;
  }
  return out;
}

// ===================== Audio start detection (from audioEngine.js) =====================
export function detectAudioStartRaw(channels, sampleRate, threshold = 0.02, windowMs = 30) {
  const data = channels[0];
  const win = Math.max(1, Math.floor((windowMs / 1000) * sampleRate));
  let i = 0;
  while (i < data.length) {
    let sumSq = 0;
    const end = Math.min(i + win, data.length);
    for (let j = i; j < end; j++) sumSq += data[j] * data[j];
    const rms = Math.sqrt(sumSq / (end - i));
    if (rms > threshold) return i / sampleRate;
    i = end;
  }
  return 0;
}