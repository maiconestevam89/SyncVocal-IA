import { computeSilenceGate, GATE_RATE } from "@/lib/dsp/silenceGate";
// Client-side audio engine using the Web Audio API.
// Decodes uploaded files, renders a time-aligned + effected mix offline.

// Decode an uploaded audio File into an AudioBuffer.
// Re-exported from the dedicated decode module, which falls back to the
// browser's media-element pipeline for MP3s that decodeAudioData() rejects.
export { decodeAudioFile } from "@/lib/decodeAudio";

// Build a synthetic impulse response for the convolver (reverb).
function makeImpulseResponse(ctx, { duration = 2, decay = 2 } = {}) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * duration));
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Detect the first non-silent sample of a buffer (in seconds).
// Returns the time where audio content effectively starts, based on an
// RMS window over the first channel. Used to auto-align the vocal to the
// reference's entrance instead of forcing a manual offset.
export function detectAudioStart(buffer, { threshold = 0.02, windowMs = 30 } = {}) {
  const rate = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const win = Math.max(1, Math.floor((windowMs / 1000) * rate));
  let i = 0;
  while (i < data.length) {
    let sumSq = 0;
    const end = Math.min(i + win, data.length);
    for (let j = i; j < end; j++) sumSq += data[j] * data[j];
    const rms = Math.sqrt(sumSq / (end - i));
    if (rms > threshold) return i / rate;
    i = end;
  }
  return 0;
}

// Render the final mix into an AudioBuffer using an OfflineAudioContext.
// `referenceBuffer` = Audio 1 (AI voice), `vocalBuffer` = Audio 2 (human voice).
// The result always has exactly the duration of the reference, and the vocal is
// silent wherever the reference is silent.
export async function renderMix(
  referenceBuffer,
  vocalBuffer,
  settings,
  { playbackRate = 1, startAt = 0, instrumentalBuffer = null } = {}
) {
  const {
    mix = { reference: 0, vocal: 1 },
    eq = {},
    reverb = {},
    delay = {},
    compressor = {},
  } = settings;

  // The vocal arrives already placed on the reference's timeline (see align.js).
  // Use the LONGEST buffer as the output length: the instrumental (original
  // Audio 1) is typically the full track, while the isolated vocal reference
  // may be slightly shorter/longer due to the separation process.
  const sampleRate = referenceBuffer.sampleRate;
  const refDur = referenceBuffer.duration;
  const instDur = instrumentalBuffer ? instrumentalBuffer.duration : 0;
  const outDuration = Math.max(refDur, instDur);
  const length = Math.ceil(outDuration * sampleRate);

  const offline = new OfflineAudioContext(2, length, sampleRate);

  // --- Reference track (straight through, level only) ---
  // The reference is the isolated vocal from Audio 1 — used for alignment
  // and silence gating, but NOT included in the output (mix.reference = 0).
  const refSrc = offline.createBufferSource();
  refSrc.buffer = referenceBuffer;
  const refGain = offline.createGain();
  refGain.gain.value = 0; // isolated reference is for timing only, not output
  refSrc.connect(refGain).connect(offline.destination);
  refSrc.start(0);

  // --- Instrumental track (original Audio 1 with vocal removed via gain=0
  //     on the reference, but we need the FULL original mix here) ---
  if (instrumentalBuffer) {
    const instSrc = offline.createBufferSource();
    instSrc.buffer = instrumentalBuffer;
    const instGain = offline.createGain();
    instGain.gain.value = clamp(mix.reference, 0, 1.5);
    instSrc.connect(instGain).connect(offline.destination);
    instSrc.start(0);
  }

  // --- Vocal track: time-stretch + effects chain ---
  const vocalSrc = offline.createBufferSource();
  vocalSrc.buffer = vocalBuffer;
  vocalSrc.playbackRate.value = playbackRate;

  // Silence gate: mutes the vocal wherever the reference is silent.
  const gate = offline.createGain();
  const gateCurve = computeSilenceGate(referenceBuffer);
  if (gateCurve) {
    gate.gain.value = gateCurve[0];
    gate.gain.setValueCurveAtTime(
      gateCurve,
      0.5 / GATE_RATE,
      (gateCurve.length - 1) / GATE_RATE
    );
  }

  // EQ: low shelf, peaking mid, high shelf
  const low = offline.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = eq.lowFreq ?? 220;
  low.gain.value = clamp(eq.low ?? 0, -15, 15);

  const mid = offline.createBiquadFilter();
  mid.type = "peaking";
  mid.frequency.value = eq.midFreq ?? 1200;
  mid.Q.value = 1;
  mid.gain.value = clamp(eq.mid ?? 0, -15, 15);

  const high = offline.createBiquadFilter();
  high.type = "highshelf";
  high.frequency.value = eq.highFreq ?? 4500;
  high.gain.value = clamp(eq.high ?? 0, -15, 15);

  // Compressor
  const comp = offline.createDynamicsCompressor();
  comp.threshold.value = clamp(compressor.threshold ?? -24, -60, 0);
  comp.knee.value = clamp(compressor.knee ?? 30, 0, 40);
  comp.ratio.value = clamp(compressor.ratio ?? 4, 1, 20);
  comp.attack.value = clamp(compressor.attack ?? 0.003, 0, 1);
  comp.release.value = clamp(compressor.release ?? 0.25, 0, 1);

  // Reverb (convolver)
  const convolver = offline.createConvolver();
  convolver.buffer = makeImpulseResponse(offline, {
    duration: clamp(reverb.duration ?? 2, 0.2, 5),
    decay: clamp(reverb.decay ?? 2, 0.5, 6),
  });
  const reverbGain = offline.createGain();
  reverbGain.gain.value = clamp(reverb.amount ?? 0.2, 0, 1);

  // Delay (with feedback loop)
  const delayNode = offline.createDelay(2.0);
  delayNode.delayTime.value = clamp(delay.time ?? 0.25, 0, 2);
  const delayFeedback = offline.createGain();
  delayFeedback.gain.value = clamp(delay.feedback ?? 0.3, 0, 0.9);
  const delayGain = offline.createGain();
  delayGain.gain.value = clamp(delay.amount ?? 0.15, 0, 1);

  // Vocal output level
  const vocalGain = offline.createGain();
  vocalGain.gain.value = clamp(mix.vocal, 0, 1.5);

  // Routing: src -> gate -> EQ -> compressor -> vocalGain -> out
  // parallel sends: compressor -> reverb -> out, compressor -> delay -> out
  vocalSrc.connect(gate);
  gate.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(comp);
  comp.connect(vocalGain);
  vocalGain.connect(offline.destination);

  comp.connect(convolver);
  convolver.connect(reverbGain);
  reverbGain.connect(offline.destination);

  comp.connect(delayNode);
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode);
  delayNode.connect(delayGain);
  delayGain.connect(offline.destination);

  vocalSrc.start(Math.max(0, startAt));

  return offline.startRendering();
}