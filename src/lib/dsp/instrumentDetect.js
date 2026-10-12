import { createFFT } from "./fft";

// Detect whether an audio buffer likely contains instrumental accompaniment
// (drums, bass, guitars) alongside the vocal, by analyzing the spectral
// energy distribution across frequency bands.
//
// Vocals concentrate energy in the 100-5000 Hz range with very little below
// 80 Hz or above 7 kHz. Instruments add sustained energy in sub-bass (kick
// drum, bass guitar) and high frequencies (cymbals, hi-hats).
//
// Returns true if instruments are likely present.
export function detectInstruments(buffer, { fftSize = 4096, numFrames = 60 } = {}) {
  if (!buffer || buffer.length < fftSize) return false;

  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const transform = createFFT(fftSize);
  const binWidth = sampleRate / fftSize;

  // Frequency band boundaries (Hz)
  const subBassBins = Math.max(1, Math.floor(80 / binWidth));   // 0-80 Hz: kick, bass
  const midStart = Math.floor(100 / binWidth);                  // 100-5000 Hz: vocals
  const midEnd = Math.floor(5000 / binWidth);
  const highStart = Math.floor(7000 / binWidth);                // 7+ kHz: cymbals, hats
  const nyquistBin = Math.floor(fftSize / 2);

  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);

  let totalSubBass = 0, totalMid = 0, totalHigh = 0, frames = 0;
  const usableLength = data.length - fftSize;
  const step = Math.max(1, Math.floor(usableLength / numFrames));

  for (let i = 0; i < usableLength && frames < numFrames; i += step) {
    // Hann window
    for (let j = 0; j < fftSize; j++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * j) / (fftSize - 1)));
      re[j] = data[i + j] * w;
      im[j] = 0;
    }
    transform(re, im);

    let subBass = 0, mid = 0, high = 0;
    for (let k = 1; k < nyquistBin; k++) {
      const mag = re[k] * re[k] + im[k] * im[k];
      if (k < subBassBins) subBass += mag;
      else if (k >= midStart && k < midEnd) mid += mag;
      else if (k >= highStart) high += mag;
    }

    totalSubBass += subBass;
    totalMid += mid;
    totalHigh += high;
    frames++;
  }

  if (frames === 0 || totalMid < 1e-10) return false;

  const subBassRatio = totalSubBass / totalMid;
  const highRatio = totalHigh / totalMid;

  // Vocals: subBassRatio ~ 0-0.02, highRatio ~ 0.001-0.03
  // Instruments: subBassRatio > 0.05 (kick/bass), highRatio > 0.04 (cymbals/hats)
  return subBassRatio > 0.05 || highRatio > 0.04;
}