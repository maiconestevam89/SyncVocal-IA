import { createFFT } from "@/lib/dsp/fft";

const tick = () => new Promise((r) => setTimeout(r, 0));

const F_MIN = 70;
const F_MAX = 800;
const THRESHOLD = 0.15;

// YIN fundamental-frequency detection via FFT-based autocorrelation.
// signal: mono Float32Array. sr: sample rate.
// Returns { f0: Float32Array, voiced: Uint8Array, hop, nFrames, sr }.
export async function detectPitch(signal, sr, { hopMs = 10, frameMs = 64 } = {}) {
  const frameSize = 1 << Math.round(Math.log2((sr * frameMs) / 1000));
  const fftSize = frameSize * 2;
  const hop = Math.max(1, Math.round((sr * hopMs) / 1000));
  const minTau = Math.max(2, Math.floor(sr / F_MAX));
  const maxTau = Math.min(Math.floor(frameSize / 2), Math.floor(sr / F_MIN));

  const nFrames = Math.max(1, Math.floor((signal.length - frameSize) / hop) + 1);
  const f0 = new Float32Array(nFrames);
  const voiced = new Uint8Array(nFrames);

  const fft = createFFT(fftSize);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const diff = new Float32Array(maxTau + 1);

  // Cumulative sum of squares for the energy of shifted frames.
  const padLen = signal.length + maxTau + frameSize + 1;
  const cumSq = new Float64Array(padLen);
  for (let i = 0; i < signal.length; i++) cumSq[i + 1] = cumSq[i] + signal[i] * signal[i];

  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;

    // Voicing check via RMS.
    const energy = cumSq[off + frameSize] - cumSq[off];
    const rms = Math.sqrt(energy / frameSize);
    if (rms < 1e-4) continue;

    // Copy frame + zero-pad to fftSize.
    for (let i = 0; i < frameSize; i++) re[i] = signal[off + i];
    for (let i = frameSize; i < fftSize; i++) re[i] = 0;
    im.fill(0);

    // Forward FFT → power spectrum → inverse FFT (forward FFT of real symmetric input).
    fft(re, im);
    for (let k = 0; k < fftSize; k++) {
      re[k] = re[k] * re[k] + im[k] * im[k];
      im[k] = 0;
    }
    fft(re, im);

    // Autocorrelation r(tau) = re[tau] / fftSize.
    // YIN difference: d(tau) = E_frame + E_shift(tau) - 2*r(tau).
    const Eframe = re[0] / fftSize;

    diff[0] = 0;
    for (let tau = 1; tau <= maxTau; tau++) {
      const r = re[tau] / fftSize;
      const Eshift = cumSq[off + tau + frameSize] - cumSq[off + tau];
      diff[tau] = Eframe + Eshift - 2 * r;
      if (diff[tau] < 0) diff[tau] = 0;
    }

    // Cumulative mean normalized difference.
    let cumSum = 0;
    for (let tau = 1; tau <= maxTau; tau++) {
      cumSum += diff[tau];
      diff[tau] = (diff[tau] * tau) / (cumSum || 1e-9);
    }
    diff[0] = 1;

    // Absolute threshold: first dip below THRESHOLD.
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (diff[tau] < THRESHOLD) {
        while (tau + 1 <= maxTau && diff[tau + 1] < diff[tau]) tau++;
        // Parabolic interpolation for sub-sample accuracy.
        let betterTau = tau;
        if (tau > minTau && tau < maxTau) {
          const x0 = diff[tau - 1], x1 = diff[tau], x2 = diff[tau + 1];
          const denom = 2 * (2 * x1 - x2 - x0);
          if (Math.abs(denom) > 1e-9) betterTau = tau + (x0 - x2) / denom;
        }
        f0[f] = sr / betterTau;
        voiced[f] = 1;
        break;
      }
    }

    if (f % 100 === 0) await tick();
  }

  return { f0, voiced, hop, nFrames, sr };
}