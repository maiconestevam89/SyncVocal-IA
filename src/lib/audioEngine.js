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

// Isolate the vocal from a (possibly stereo) AudioBuffer.
//
// Strategy:
//   1. Center extraction (mid/side). For stereo input we compute
//        mid  = (L + R) / 2
//        side = (L - R) / 2
//      The lead vocal is usually panned dead center, so it lives almost
//      entirely in `mid`, while widely-panned instruments (guitars, keys,
//      cymbals, stereo reverb) live in `side`. We KEEP `mid` and attenuate
//      `side` — the opposite of karaoke-style cancellation — so the vocal
//      survives and the hard-panned instruments drop out.
//      For mono input there is no side channel, so we fall back to a vocal-
//      band filter chain.
//   2. Vocal-band EQ: high-pass ~120 Hz to cut bass/kick, low-pass ~8 kHz to
//      cut cymbals/air, gentle presence boost around 2–3 kHz where the voice
//      sits. This shaves off centered instruments (kick, snare, bass) that
//      survived the mid/side step because they were also panned center.
//   3. `strength` (0..1) crossfades between the original and the isolated
//      result, so the user can dial in how aggressive the isolation is.
export async function isolateVocal(buffer, strength = 0.7) {
  const s = clamp(strength, 0, 1);
  if (s <= 0) return buffer;

  const rate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const length = buffer.length;

  // Step 1 — center extraction into a mono buffer.
  let center;
  if (channels >= 2) {
    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);
    center = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      // Keep mid, suppress side. strength scales how much side we remove.
      center[i] = (L[i] + R[i]) * 0.5 - (L[i] - R[i]) * 0.5 * s;
    }
  } else {
    center = buffer.getChannelData(0).slice();
  }

  // Wrap `center` in an AudioBuffer and run the vocal-band EQ offline.
  const offline = new OfflineAudioContext(1, length, rate);
  const centerBuffer = offline.createBuffer(1, length, rate);
  centerBuffer.copyToChannel(center, 0);

  const src = offline.createBufferSource();
  src.buffer = centerBuffer;

  // High-pass: cut bass / kick / rumble.
  const hp = offline.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 120;
  hp.Q.value = 0.7;

  // Low-pass: cut cymbals, hi-hats, air.
  const lp = offline.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 8000;
  lp.Q.value = 0.7;

  // Notch out a bit of the snare/body region that centered instruments share.
  const notch = offline.createBiquadFilter();
  notch.type = "peaking";
  notch.frequency.value = 200;
  notch.Q.value = 1.0;
  notch.gain.value = -4 * s;

  // Presence boost where the voice is most intelligible.
  const presence = offline.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 2800;
  presence.Q.value = 0.9;
  presence.gain.value = 2.5;

  src.connect(hp);
  hp.connect(lp);
  lp.connect(notch);
  notch.connect(presence);
  presence.connect(offline.destination);
  src.start(0);

  const isolated = await offline.startRendering();

  if (s >= 0.999) {
    // Up-mix back to the original channel count for downstream consistency.
    return upmixToChannels(isolated, channels, rate);
  }

  // Blend wet/dry.
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const outChannels = Math.max(1, channels);
  const mix = ctx.createBuffer(outChannels, length, rate);
  const isoData = isolated.getChannelData(0);
  for (let ch = 0; ch < outChannels; ch++) {
    const orig = buffer.getChannelData(Math.min(ch, channels - 1));
    const out = mix.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      out[i] = orig[i] * (1 - s) + isoData[i] * s;
    }
  }
  ctx.close();
  return mix;
}

function upmixToChannels(monoBuffer, channels, rate) {
  if (channels <= 1) return monoBuffer;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const out = ctx.createBuffer(channels, monoBuffer.length, rate);
  const data = monoBuffer.getChannelData(0);
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
export async function renderMix(referenceBuffer, vocalBuffer, settings) {
  const {
    tempoRatio = 1,
    offsetSec = 0,
    autoAlign = true,
    preservePitch = true,
    mix = { reference: 0.8, vocal: 1 },
    eq = {},
    reverb = {},
    delay = {},
    compressor = {},
  } = settings;

  const ratio = clamp(tempoRatio, 0.5, 2);
  // When auto-align is on, the vocal waits for the reference's first non-silent
  // onset so the singer enters exactly when the backing track starts.
  const refStart = autoAlign ? detectAudioStart(referenceBuffer) : 0;
  const offset = clamp(Math.max(refStart, offsetSec), 0, 8);
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