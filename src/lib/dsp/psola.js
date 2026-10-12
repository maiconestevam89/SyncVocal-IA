const tick = () => new Promise((r) => setTimeout(r, 0));

// TD-PSOLA pitch shifting with formant preservation.
// channels: Float32Array[] at sampleRate sr.
// f0Src/f0Tgt: Float32Array of per-frame frequencies (hopSec apart).
// Returns Float32Array[] — same length, pitch-shifted, duration preserved.
export async function tdPsola(channels, sr, f0Src, f0Tgt, hopSec) {
  const n = channels[0].length;
  const nCh = channels.length;
  const out = channels.map(() => new Float32Array(n));
  const norm = new Float32Array(n);
  const defaultPeriod = Math.round(sr / 150);

  const getF0 = (arr, pos) => {
    const frame = Math.min(Math.floor(pos / (sr * hopSec)), arr.length - 1);
    return arr[frame];
  };

  // 1. Find pitch marks at source-period intervals.
  const marks = [];
  let pos = 0;
  while (pos < n) {
    const f0 = getF0(f0Src, pos);
    const period = f0 > 0 ? Math.max(2, Math.round(sr / f0)) : defaultPeriod;
    marks.push({ pos: Math.round(pos), period });
    pos += period;
  }
  if (marks.length === 0) return out;

  // 2. Compute target periods and accumulated output length.
  const tgtPeriods = new Float32Array(marks.length);
  let qEnd = marks[0].pos;
  for (let i = 0; i < marks.length; i++) {
    const f0s = getF0(f0Src, marks[i].pos);
    const f0t = getF0(f0Tgt, marks[i].pos);
    tgtPeriods[i] = f0s > 0 && f0t > 0 ? Math.max(2, sr / f0t) : marks[i].period;
    qEnd += tgtPeriods[i];
  }

  // 3. PSOLA overlap-add at target-period intervals (no duration scaling —
  //    scaling would cancel the pitch shift). The output buffer is the same
  //    length as the input; any trailing unprocessed samples stay zero and
  //    are handled by the silence gate downstream.
  const qStart = marks[0].pos;
  let q = qStart;
  for (let i = 0; i < marks.length; i++) {
    const { pos: p, period: Ps } = marks[i];
    const halfWin = Ps;

    for (let j = -halfWin; j <= halfWin; j++) {
      const srcIdx = p + j;
      const outIdx = Math.round(q + j);
      if (srcIdx >= 0 && srcIdx < n && outIdx >= 0 && outIdx < n) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (j + halfWin)) / (2 * halfWin));
        for (let c = 0; c < nCh; c++) out[c][outIdx] += w * channels[c][srcIdx];
        norm[outIdx] += w;
      }
    }

    q += tgtPeriods[i];
    if (q >= n) break;
    if (i % 500 === 0) await tick();
  }

  // 5. Normalize by window sum (handles variable overlap).
  for (let i = 0; i < n; i++) {
    if (norm[i] > 1e-6) {
      for (let c = 0; c < nCh; c++) out[c][i] /= norm[i];
    }
  }

  return out;
}