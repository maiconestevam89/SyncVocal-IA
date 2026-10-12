// Server-side audio alignment and mixing engine.
// Uses the pure-JS DSP module (no browser APIs) to align a vocal to a
// reference, apply a silence gate, auto-match gains, and mix with the
// instrumental — replicating the client-side pipeline on the server.

import {
  computeFeatures,
  subsequenceDTW,
  buildWarp,
  warpStretch,
  toMono16kRaw,
  computeSilenceGateRaw,
  applyGate,
  autoMatchGainsRaw,
} from "./dsp.ts";

// Linear-interpolation resample between arbitrary sample rates.
function resampleRaw(channels, fromRate, toRate) {
  if (fromRate === toRate) return channels;
  const ratio = fromRate / toRate;
  const srcLen = channels[0].length;
  const dstLen = Math.max(1, Math.round(srcLen / ratio));
  return channels.map((ch) => {
    const out = new Float32Array(dstLen);
    for (let i = 0; i < dstLen; i++) {
      const srcIdx = i * ratio;
      const idx0 = Math.floor(srcIdx);
      const frac = srcIdx - idx0;
      const s0 = idx0 < srcLen ? ch[idx0] : 0;
      const s1 = idx0 + 1 < srcLen ? ch[idx0 + 1] : s0;
      out[i] = s0 * (1 - frac) + s1 * frac;
    }
    return out;
  });
}

// Align vocal2 to vocal1's timeline using DTW + WSOLA.
// Returns aligned vocal2 channels (at vocal2's sample rate) or null.
export async function alignVocalRaw(refChannels, refSampleRate, vocalChannels, vocalSampleRate) {
  const refDur = refChannels[0].length / refSampleRate;
  const vocalDur = vocalChannels[0].length / vocalSampleRate;
  const hop = Math.max(0.04, Math.max(refDur, vocalDur) / 5000);

  const refMono = toMono16kRaw(refChannels, refSampleRate);
  const vocalMono = toMono16kRaw(vocalChannels, vocalSampleRate);
  const fr = await computeFeatures(refMono, hop);
  const fv = await computeFeatures(vocalMono, hop);

  const first = fv.active.indexOf(1);
  const last = fv.active.lastIndexOf(1);
  if (first < 0 || fr.active.indexOf(1) < 0) return null;

  const q = {
    feats: fv.feats.subarray(first * fv.dim, (last + 1) * fv.dim),
    dim: fv.dim,
    nFrames: last - first + 1,
    active: fv.active.subarray(first, last + 1),
  };
  const dtw = await subsequenceDTW(q, fr);
  if (!dtw) return null;

  const tq = (i) => (i + first) * fv.hop + fv.offset;
  const tr = (j) => j * fr.hop + fr.offset;
  const warp = buildWarp(dtw.path, tq, tr, fr.hop);

  return warpStretch(vocalChannels, vocalSampleRate, warp, refDur);
}

// Full pipeline: align → silence-gate → auto-match gains → mix to stereo.
// Each input is { channels: Float32Array[], sampleRate: number }.
// Returns { channels, sampleRate } of the final mix.
export async function processAndMix(vocal1, vocal2, instrumental) {
  // 1. Align vocal2 to vocal1's timeline
  const aligned = await alignVocalRaw(
    vocal1.channels, vocal1.sampleRate,
    vocal2.channels, vocal2.sampleRate
  );
  if (!aligned) throw new Error("não encontrei voz suficiente nos áudios para alinhar");

  // 2. Resample aligned vocal to the instrumental's sample rate if needed
  const alignedResampled = resampleRaw(aligned, vocal2.sampleRate, instrumental.sampleRate);

  // 3. Apply silence gate based on vocal1 (reference)
  const gateCurve = computeSilenceGateRaw(
    vocal1.channels, vocal1.channels[0].length, vocal1.sampleRate
  );
  const gated = applyGate(alignedResampled, gateCurve, instrumental.sampleRate);

  // 4. Auto-match gains between vocal and instrumental
  const tracks = [
    { channels: gated, length: gated[0].length, gain: 1 },
    { channels: instrumental.channels, length: instrumental.channels[0].length, gain: 0.8 },
  ];
  const gains = autoMatchGainsRaw(tracks);

  // 5. Mix to stereo
  const maxLen = Math.max(gated[0].length, instrumental.channels[0].length);
  const mixed = [new Float32Array(maxLen), new Float32Array(maxLen)];

  for (let i = 0; i < maxLen; i++) {
    // Vocal → stereo
    if (i < gated[0].length) {
      const g = gains[0];
      if (gated.length === 1) {
        mixed[0][i] += gated[0][i] * g;
        mixed[1][i] += gated[0][i] * g;
      } else {
        mixed[0][i] += gated[0][i] * g;
        mixed[1][i] += gated[1][i] * g;
      }
    }
    // Instrumental → stereo
    if (i < instrumental.channels[0].length) {
      const g = gains[1];
      if (instrumental.channels.length === 1) {
        mixed[0][i] += instrumental.channels[0][i] * g;
        mixed[1][i] += instrumental.channels[0][i] * g;
      } else {
        mixed[0][i] += instrumental.channels[0][i] * g;
        mixed[1][i] += instrumental.channels[1][i] * g;
      }
    }
  }

  return { channels: mixed, sampleRate: instrumental.sampleRate };
}