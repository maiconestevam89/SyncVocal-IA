// Where the reference (Audio 1) is silent, the human vocal must be silent too.
// Builds a smooth 0..1 gain curve (GATE_RATE points per second) that follows
// the reference's own sound / silence pattern.
export const GATE_RATE = 100;

// Ignore dips shorter than this: they are breaths / gaps between syllables.
const MIN_GAP_SEC = 0.15;
// Keep the vocal open a little around each sung phrase so a slightly early or
// late entrance is not clipped.
const PAD_SEC = 0.06;
// A frame counts as sound when it is above this fraction of the loudest frame.
const THRESHOLD = 0.02;
// Width (in curve points) of the smoothing that turns on/off into short fades.
const SMOOTH = 5;

export function computeSilenceGate(refBuffer) {
  const sr = refBuffer.sampleRate;
  const win = Math.max(1, Math.round(sr / GATE_RATE));
  const nWin = Math.max(2, Math.ceil(refBuffer.length / win));
  const nCh = refBuffer.numberOfChannels;

  const rms = new Float32Array(nWin);
  let peak = 0;
  for (let w = 0; w < nWin; w++) {
    const from = w * win;
    const to = Math.min(refBuffer.length, from + win);
    let s = 0;
    for (let c = 0; c < nCh; c++) {
      const d = refBuffer.getChannelData(c);
      for (let i = from; i < to; i++) s += d[i] * d[i];
    }
    rms[w] = Math.sqrt(s / Math.max(1, (to - from) * nCh));
    if (rms[w] > peak) peak = rms[w];
  }
  // A reference with no sound at all gives nothing to follow: leave the vocal alone.
  if (peak < 1e-4) return null;

  const active = new Uint8Array(nWin);
  for (let w = 0; w < nWin; w++) active[w] = rms[w] > peak * THRESHOLD ? 1 : 0;

  // Close short gaps that sit between two sounds.
  const minGap = Math.round(MIN_GAP_SEC * GATE_RATE);
  let w = 0;
  while (w < nWin) {
    if (active[w]) {
      w++;
      continue;
    }
    let e = w;
    while (e < nWin && !active[e]) e++;
    if (w > 0 && e < nWin && e - w < minGap) active.fill(1, w, e);
    w = e;
  }

  // Open a little around every sound.
  const padW = Math.round(PAD_SEC * GATE_RATE);
  const open = new Float32Array(nWin);
  for (let i = 0; i < nWin; i++) {
    if (!active[i]) continue;
    for (let k = Math.max(0, i - padW); k <= Math.min(nWin - 1, i + padW); k++) open[k] = 1;
  }

  // Smooth into short fades so the cuts never click.
  const half = Math.floor(SMOOTH / 2);
  const curve = new Float32Array(nWin);
  for (let i = 0; i < nWin; i++) {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(nWin - 1, i + half); k++) {
      s += open[k];
      n++;
    }
    curve[i] = s / n;
  }
  return curve;
}