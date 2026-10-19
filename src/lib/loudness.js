// RMS-based loudness measurement and auto-matching for multitrack mixing.

// Compute the RMS level (0..1) of an AudioBuffer, ignoring leading/trailing
// digital silence so the measurement reflects actual content loudness.
export function computeRms(buffer) {
  if (!buffer || !buffer.length) return 0;
  const channels = buffer.numberOfChannels;
  let sumSq = 0;
  let count = 0;
  // Sample every Nth frame for speed on long buffers.
  const step = Math.max(1, Math.floor(buffer.length / 200000));
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i += step) {
      const v = data[i];
      if (Math.abs(v) > 0.0001) {
        sumSq += v * v;
        count++;
      }
    }
  }
  if (!count) return 0;
  return Math.sqrt(sumSq / count);
}

// Given a list of tracks with .buffer and .gain, compute a target RMS
// (the average of all track RMS values) and return new gain values that
// bring every track to that target, clamped to a safe range.
// Tracks without a buffer are skipped (gain unchanged).
export function autoMatchGains(tracks) {
  const measurable = tracks.filter((t) => t.buffer && computeRms(t.buffer) > 0);
  if (measurable.length === 0) return tracks.map(() => 1);

  // Target = average RMS across all measurable tracks.
  const rmsValues = measurable.map((t) => computeRms(t.buffer));
  const targetRms = rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length;

  return tracks.map((t) => {
    const rms = computeRms(t.buffer);
    if (rms <= 0 || targetRms <= 0) return t.gain ?? 1;
    // Gain needed to reach target RMS, applied on top of the user's current gain.
    const needed = (targetRms / rms) * (t.gain ?? 1);
    // Clamp to 0.1x..3x to avoid extreme boosts on very quiet tracks.
    return Math.max(0.1, Math.min(3, needed));
  });
}