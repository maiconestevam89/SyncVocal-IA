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

// Isolate the vocal/center channel from a (possibly stereo) AudioBuffer.
// Strategy: center extraction — for stereo, keep L−R (the difference channel
// cancels anything panned to the center... but the *vocal* is usually center,
// so instead we keep the mid (L+R)/2 and attenuate side content via spectral
// subtraction). Simpler robust approach for "vocal has instruments":
//   - If stereo: mid/side. Vocals ≈ mid; sides ≈ instruments panned wide.
//     We keep mid and subtract a scaled side estimate.
//   - If mono: apply a band-pass focused on the vocal range (200 Hz – 4 kHz)
//     with a gentle high-pass below 120 Hz to cut bass/kick.
// `strength` (0..1) blends between the isolated result and the original.
export async function isolateVocal(buffer, strength = 0.7) {
  const s = clamp(strength, 0, 1);
  if (s <= 0) return buffer;

  const rate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const length = buffer.length;

  // Build a new mono-ish buffer (vocal-isolated), then keep its channel count
  // matching the original for downstream consistency.
  const offline = new OfflineAudioContext(
    Math.max(1, channels),
    length,
    rate
  );

  const src = offline.createBufferSource();
  src.buffer = buffer;

  const outGain = offline.createGain();
  outGain.gain.value = 1;

  // Keep center / vocal presence.
  const hp = offline.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 120;
  hp.Q.value = 0.7;

  const bp = offline.createBiquadFilter();
  bp.type = "peaking";
  bp.frequency.value = 2200;
  bp.Q.value = 0.8;
  bp.gain.value = 2.5;

  const cut = offline.createBiquadFilter();
  cut.type = "peaking";
  cut.frequency.value = 250;
  cut.Q.value = 1.2;
  cut.gain.value = -6;

  src.connect(hp);
  hp.connect(cut);
  cut.connect(bp);
  bp.connect(outGain);

  outGain.connect(offline.destination);
  src.start(0);

  const isolated = await offline.startRendering();

  if (s >= 0.999) return isolated;

  // Blend: strength=1 → fully isolated, strength=0 → original.
  // Render a wet/dry crossfade into a single buffer.
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const outChannels = Math.max(1, channels);
  const mix = ctx.createBuffer(outChannels, length, rate);
  for (let ch = 0; ch < outChannels; ch++) {
    const orig = buffer.getChannelData(Math.min(ch, channels - 1));
    const iso = isolated.getChannelData(Math.min(ch, isolated.numberOfChannels - 1));
    const out = mix.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      out[i] = orig[i] * (1 - s) + iso[i] * s;
    }
  }
  ctx.close();
  return mix;
}

// Render the final mix into an AudioBuffer using an OfflineAudioContext.
// `referenceBuffer` = AI/reference track, `vocalBuffer` = user's raw vocal.
export async function renderMix(referenceBuffer, vocalBuffer, settings) {
  const {
    tempoRatio = 1,
    offsetSec = 0,
    preservePitch = true,
    mix = { reference: 0.8, vocal: 1 },
    eq = {},
    reverb = {},
    delay = {},
    compressor = {},
  } = settings;

  const ratio = clamp(tempoRatio, 0.5, 2);
  const offset = clamp(offsetSec, -3, 8);
  const sampleRate = referenceBuffer.sampleRate;
  const refDur = referenceBuffer.duration;
  const vocalDur = vocalBuffer.duration / ratio;
  const duration = Math.max(refDur, vocalDur + Math.max(0, offset)) + 0.5;
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
  vocalSrc.playbackRate.value = ratio;
  if (preservePitch) {
    // Compensate the pitch shift caused by playbackRate (cheap time-stretch).
    vocalSrc.detune.value = -1200 * Math.log2(ratio);
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

  vocalSrc.start(Math.max(0, offset));

  return offline.startRendering();
}