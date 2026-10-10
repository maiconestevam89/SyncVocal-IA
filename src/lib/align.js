import { computeFeatures, FEATURE_SR } from "@/lib/dsp/features";
import { subsequenceDTW } from "@/lib/dsp/dtw";
import { buildWarp } from "@/lib/dsp/warp";
import { warpStretch } from "@/lib/dsp/wsola";
import { detectAudioStart } from "@/lib/audioEngine";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Mono, 16 kHz copy of a buffer through the browser's own resampler.
async function toMono16k(buffer) {
  const len = Math.max(1, Math.ceil(buffer.duration * FEATURE_SR));
  const offline = new OfflineAudioContext(1, len, FEATURE_SR);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

// Finds how the vocal must be bent in time to follow the reference.
// Returns { warp(tRef) -> tVocal, cost } or null when nothing could be matched.
export async function computeAutoWarp(refBuffer, vocalBuffer) {
  const hop = Math.max(0.04, Math.max(refBuffer.duration, vocalBuffer.duration) / 5000);
  const fr = await computeFeatures(await toMono16k(refBuffer), hop);
  const fv = await computeFeatures(await toMono16k(vocalBuffer), hop);

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
  return { warp: buildWarp(dtw.path, tq, tr, fr.hop), cost: dtw.cost };
}

// Length (s) the warped vocal needs so that none of it is cut off.
function timelineLength(warp, refDur, vocalDur) {
  let t = refDur;
  while (warp(t) < vocalDur && t < refDur + 60) t += 0.25;
  return t + 0.1;
}

async function stretchToTimeline(vocalBuffer, warp, refDur) {
  const channels = [];
  for (let c = 0; c < vocalBuffer.numberOfChannels; c++) channels.push(vocalBuffer.getChannelData(c));
  const outDur = timelineLength(warp, refDur, vocalBuffer.duration);
  const out = await warpStretch(channels, vocalBuffer.sampleRate, warp, outDur);
  const buffer = new AudioBuffer({
    length: out[0].length,
    numberOfChannels: out.length,
    sampleRate: vocalBuffer.sampleRate,
  });
  out.forEach((data, c) => buffer.copyToChannel(data, c));
  return buffer;
}

// Puts the vocal on the reference's timeline.
// Returns { buffer, playbackRate, startAt } for renderMix.
export async function alignVocal(refBuffer, vocalBuffer, settings) {
  const { autoSync = true, tempoRatio = 1, preservePitch = true, autoAlign = true } = settings;

  if (autoSync) {
    const result = await computeAutoWarp(refBuffer, vocalBuffer);
    if (!result) throw new Error("não encontrei voz suficiente nos áudios para alinhar");
    const buffer = await stretchToTimeline(vocalBuffer, result.warp, refBuffer.duration);
    return { buffer, playbackRate: 1, startAt: 0 };
  }

  // Manual mode: one tempo for the whole vocal, starting with the reference.
  const ratio = clamp(tempoRatio, 0.5, 2);
  const shift = autoAlign ? detectAudioStart(refBuffer) : 0;
  if (!preservePitch) return { buffer: vocalBuffer, playbackRate: ratio, startAt: shift };
  if (ratio === 1 && shift === 0) return { buffer: vocalBuffer, playbackRate: 1, startAt: 0 };
  const buffer = await stretchToTimeline(vocalBuffer, (t) => (t - shift) * ratio, refBuffer.duration);
  return { buffer, playbackRate: 1, startAt: 0 };
}