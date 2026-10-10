const INF = 1e30;
const STEP_PENALTY = 0.15;
const tick = () => new Promise((r) => setTimeout(r, 0));

// Subsequence DTW: every query frame (the vocal) is matched, in order, to a
// stretch of the reference. The reference start/end are free, so an
// instrumental intro or outro on the reference is skipped naturally.
// Local slope is limited to 0.5x..2x (steps 1:1, 1:2, 2:1).
// q, r: { feats, dim, nFrames, active } -> { path: [[i, j], ...], cost } | null
export async function subsequenceDTW(q, r) {
  const N = q.nFrames;
  const M = r.nFrames;
  const dim = q.dim;
  const bp = new Uint8Array(N * M);

  const fillCost = (i, out) => {
    const qa = q.active[i];
    const qo = i * dim;
    for (let j = 0; j < M; j++) {
      const ra = r.active[j];
      if (!qa || !ra) {
        out[j] = !qa && !ra ? 0.4 : 1;
        continue;
      }
      const ro = j * dim;
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += q.feats[qo + d] * r.feats[ro + d];
      out[j] = 1 - dot;
    }
  };

  let Dm2 = new Float32Array(M).fill(INF);
  let Dm1 = new Float32Array(M);
  let D = new Float32Array(M);
  let cPrev = new Float32Array(M);
  let cCur = new Float32Array(M);

  fillCost(0, cPrev);
  for (let j = 0; j < M; j++) {
    Dm1[j] = cPrev[j];
    bp[j] = 255;
  }

  for (let i = 1; i < N; i++) {
    fillCost(i, cCur);
    const base = i * M;
    for (let j = 0; j < M; j++) {
      let best = INF;
      let step = 3;
      if (j >= 1 && Dm1[j - 1] < INF) {
        best = Dm1[j - 1] + cCur[j];
        step = 0;
      }
      if (j >= 2 && Dm1[j - 2] < INF) {
        const v = Dm1[j - 2] + 0.5 * (cCur[j - 1] + cCur[j]) + STEP_PENALTY;
        if (v < best) {
          best = v;
          step = 1;
        }
      }
      if (i >= 2 && j >= 1 && Dm2[j - 1] < INF) {
        const v = Dm2[j - 1] + cPrev[j] + cCur[j] + STEP_PENALTY;
        if (v < best) {
          best = v;
          step = 2;
        }
      }
      D[j] = best;
      bp[base + j] = step;
    }
    const tmp = Dm2;
    Dm2 = Dm1;
    Dm1 = D;
    D = tmp;
    const ct = cPrev;
    cPrev = cCur;
    cCur = ct;
    if (i % 64 === 0) await tick();
  }

  // Dm1 now holds the last query row. Free end on the reference.
  let bestJ = -1;
  let bestCost = INF;
  for (let j = 0; j < M; j++) {
    if (Dm1[j] < bestCost) {
      bestCost = Dm1[j];
      bestJ = j;
    }
  }
  if (bestJ < 0) return null;

  const rev = [];
  let i = N - 1;
  let j = bestJ;
  for (;;) {
    rev.push([i, j]);
    const s = bp[i * M + j];
    if (s === 255 || s === 3) break;
    if (s === 0) {
      i -= 1;
      j -= 1;
    } else if (s === 1) {
      rev.push([i, j - 1]);
      i -= 1;
      j -= 2;
    } else {
      rev.push([i - 1, j]);
      i -= 2;
      j -= 1;
    }
  }
  return { path: rev.reverse(), cost: bestCost / N };
}