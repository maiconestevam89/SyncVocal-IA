// Client-side audio engine using the Web Audio API.
// Decodes uploaded files, renders a time-aligned + effected mix offline.

// Decode an uploaded audio File into an AudioBuffer.
export async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return audioBuffer;
  } finally {
    ctx.close();
  }
}

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

// Isolate the vocal from an AudioBuffer entirely in the browser.
//
// Two-stage strategy:
//   1. Center extraction (mid/side). For stereo input, keep `mid` and
//      suppress `side`: the lead vocal is usually panned dead center (so it
//      lives in `mid`), while widely-panned instruments (guitars, keys,
//      cymbals, stereo reverb) live in `side`. Mono input has no side, so we
//      skip straight to the EQ stage.
//   2. Vocal-band EQ: high-pass ~110 Hz (cut bass/kick), low-pass ~9 kHz (cut
//      cymbals/air), notches around the snare/body region (~200 Hz and
//      ~5 kHz) where centered instruments share space with the voice, and a
//      presence boost around 2–4 kHz where the voice is most intelligible.
//   3. Mild compression to even out the isolated vocal level.
//
// This keeps only the vocal — instruments are removed as much as a browser
// filter chain allows. It is not as clean as a neural separator, but it runs
// instantly and fully offline (no external services, no uploads).
export async function isolateVocal(buffer) {
  const rate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const length = buffer.length;

  // --- Stage 1: center extraction -> mono ---
  let center;
  if (channels >= 2) {
    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);
    center = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      // Keep mid, remove side entirely (strength = 1).
      center[i] = (L[i] + R[i]) * 0.5;
    }
  } else {
    center = buffer.getChannelData(0).slice();
  }

  // --- Stage 2 + 3: vocal-band EQ + compression, offline render ---
  const offline = new OfflineAudioContext(1, length, rate);
  const centerBuffer = offline.createBuffer(1, length, rate);
  centerBuffer.copyToChannel(center, 0);

  const src = offline.createBufferSource();
  src.buffer = centerBuffer;

  // High-pass: cut bass / kick / rumble.
  const hp = offline.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 110;
  hp.Q.value = 0.7;

  // Low-pass: cut cymbals, hi-hats, air.
  const lp = offline.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 9000;
  lp.Q.value = 0.7;

  // Notch out snare/body region that centered instruments share.
  const notchLow = offline.createBiquadFilter();
  notchLow.type = "peaking";
  notchLow.frequency.value = 200;
  notchLow.Q.value = 1.0;
  notchLow.gain.value = -6;

  // Notch out the "boxy" mid area where guitars/keys often sit.
  const notchMid = offline.createBiquadFilter();
  notchMid.type = "peaking";
  notchMid.frequency.value = 500;
  notchMid.Q.value = 1.2;
  notchMid.gain.value = -5;

  // Notch out cymbal presence region.
  const notchHigh = offline.createBiquadFilter();
  notchHigh.type = "peaking";
  notchHigh.frequency.value = 5000;
  notchHigh.Q.value = 1.0;
  notchHigh.gain.value = -5;

  // Presence boost where the voice is most intelligible.
  const presence = offline.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3000;
  presence.Q.value = 0.9;
  presence.gain.value = 3;

  // Gentle compression to even out the isolated vocal.
  const comp = offline.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.knee.value = 30;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.25;

  src.connect(hp);
  hp.connect(lp);
  lp.connect(notchLow);
  notchLow.connect(notchMid);
  notchMid.connect(notchHigh);
  notchHigh.connect(presence);
  presence.connect(comp);
  comp.connect(offline.destination);
  src.start(0);

  const isolated = await offline.startRendering();

  // Up-mix back to the original channel count for downstream consistency.
  if (channels <= 1) return isolated;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const out = ctx.createBuffer(channels, isolated.length, rate);
  const data = isolated.getChannelData(0);
  for (let ch = 0; ch < channels; ch++) out.copyToChannel(data, ch);
  ctx.close();
  return out;
}

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
// `referenceBuffer` = AI/reference track, `vocalBuffer` = user's raw vocal.
export async function renderMix(
  referenceBuffer,
  vocalBuffer,
  settings,
  { playbackRate = 1, startAt = 0 } = {}
) {
  const {
    mix = { reference: 0.8, vocal: 1 },
    eq = {},
    reverb = {},
    delay = {},
    compressor = {},
  } = settings;

  // The vocal arrives already placed on the reference's timeline (see align.js).
  const sampleRate = referenceBuffer.sampleRate;
  const refDur = referenceBuffer.duration;
  const vocalDur = vocalBuffer.duration / playbackRate;
  const duration = Math.max(refDur, vocalDur + startAt) + 0.5;
  const length = Math.ceil(duration * sampleRate);

  const offline = new OfflineAudioContext(2, length, sampleRate);

  // --- Reference track (straight through, level only) ---
  const refSrc = offline.createBufferSource();
  refSrc.buffer = referenceBuffer;
  const refGain = offline.createGain();
  refGain.gain.value = clamp(mix.reference, 0, 1.5);
  refSrc.connect(refGain).connect(offline.destination);
  refSrc.start(0);

  // --- Vocal track: time-stretch + effects chain ---
  const vocalSrc = offline.createBufferSource();
  vocalSrc.buffer = vocalBuffer;
  vocalSrc.playbackRate.value = playbackRate;

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

  // Routing: src -> EQ -> compressor -> vocalGain -> out
  // parallel sends: compressor -> reverb -> out, compressor -> delay -> out
  vocalSrc.connect(low);
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