// Multi-track mixdown using an OfflineAudioContext.
// Each track = { buffer, gain, pan, muted, solo, startAt }.
// Renders to a stereo AudioBuffer for export.

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export async function renderMultiTrack(tracks) {
  if (!tracks.length) throw new Error("Nenhuma pista para mixar.");

  const sampleRate = tracks[0].buffer.sampleRate;
  // Total length = furthest track end (start + duration).
  const totalSec = tracks.reduce((max, t) => {
    if (!t.buffer) return max;
    return Math.max(max, (t.startAt || 0) + t.buffer.duration);
  }, 0);
  const length = Math.ceil(totalSec * sampleRate);
  if (length <= 0) throw new Error("Pistas vazias.");

  const offline = new OfflineAudioContext(2, length, sampleRate);
  const anySolo = tracks.some((t) => t.solo && !t.muted);

  for (const t of tracks) {
    if (!t.buffer || t.muted) continue;
    if (anySolo && !t.solo) continue;

    const src = offline.createBufferSource();
    src.buffer = t.buffer;
    src.playbackRate.value = clamp(t.playbackRate || 1, 0.25, 4);

    const gain = offline.createGain();
    gain.gain.value = clamp(t.gain ?? 1, 0, 2);

    // Stereo panner (falls back to mono position on older browsers).
    let panner;
    if (offline.createStereoPanner) {
      panner = offline.createStereoPanner();
      panner.pan.value = clamp(t.pan ?? 0, -1, 1);
    } else {
      panner = offline.createGain();
      panner.gain.value = 1;
    }

    src.connect(gain).connect(panner).connect(offline.destination);
    src.start(Math.max(0, t.startAt || 0));
  }

  return offline.startRendering();
}