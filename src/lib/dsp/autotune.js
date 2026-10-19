import { detectPitch } from "@/lib/dsp/yin";
import { tdPsola } from "@/lib/dsp/psola";

const DETECT_SR = 16000;

const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
};

const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function snapPitch(f0, semitones, root) {
  if (f0 <= 0) return 0;
  const midi = hzToMidi(f0);
  const roundedMidi = Math.round(midi);
  const pc = (((roundedMidi - root) % 12) + 12) % 12;

  let bestPc = semitones[0];
  let bestDist = Infinity;
  for (const s of semitones) {
    const dist = Math.min(Math.abs(pc - s), 12 - Math.abs(pc - s));
    if (dist < bestDist) {
      bestDist = dist;
      bestPc = s;
    }
  }
  return midiToHz(roundedMidi - pc + bestPc);
}

function blendPitch(f0Src, f0Tgt, intensity) {
  if (f0Src <= 0 || f0Tgt <= 0) return f0Src;
  const sSrc = 12 * Math.log2(f0Src / 440);
  const sTgt = 12 * Math.log2(f0Tgt / 440);
  return 440 * Math.pow(2, (sSrc + (sTgt - sSrc) * intensity) / 12);
}

function medianFilter(arr, size) {
  const half = Math.floor(size / 2);
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const vals = [];
    for (let j = -half; j <= half; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < arr.length) vals.push(arr[idx]);
    }
    vals.sort((a, b) => a - b);
    out[i] = vals[Math.floor(vals.length / 2)];
  }
  return out;
}

// Resample AudioBuffer to mono at DETECT_SR for pitch analysis.
async function toMonoDetectRate(buffer) {
  const len = Math.max(1, Math.ceil(buffer.duration * DETECT_SR));
  const offline = new OfflineAudioContext(1, len, DETECT_SR);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

// Apply automatic pitch correction to an AudioBuffer.
// settings: { amount: 0-1, scale: string, root: 0-11 }
export async function applyAutoTune(buffer, settings) {
  const { amount = 0.7, scale = "chromatic", root = 0 } = settings || {};
  if (amount <= 0 || !buffer) return buffer;

  const semitones = SCALES[scale] || SCALES.chromatic;
  const sr = buffer.sampleRate;

  // 1. Detect pitch on mono 16 kHz signal.
  const mono = await toMonoDetectRate(buffer);
  const { f0: f0Raw, hop } = await detectPitch(mono, DETECT_SR);
  const hopSec = hop / DETECT_SR;

  // Skip if nothing to tune.
  let hasVoiced = false;
  for (let i = 0; i < f0Raw.length; i++) {
    if (f0Raw[i] > 0) { hasVoiced = true; break; }
  }
  if (!hasVoiced) return buffer;

  // 2. Median filter to remove octave jumps.
  const f0Src = medianFilter(f0Raw, 5);

  // 3. Snap to scale and blend by intensity.
  const f0Tgt = new Float32Array(f0Src.length);
  for (let i = 0; i < f0Src.length; i++) {
    const snapped = snapPitch(f0Src[i], semitones, root);
    f0Tgt[i] = blendPitch(f0Src[i], snapped, amount);
  }

  // 4. Apply PSOLA to each channel at original sample rate.
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  const outChannels = await tdPsola(channels, sr, f0Src, f0Tgt, hopSec);

  // 5. Build output buffer.
  const out = new AudioBuffer({
    length: outChannels[0].length,
    numberOfChannels: outChannels.length,
    sampleRate: sr,
  });
  outChannels.forEach((data, c) => out.copyToChannel(data, c));

  return out;
}