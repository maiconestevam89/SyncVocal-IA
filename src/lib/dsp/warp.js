// Turns a DTW path into a smooth, monotonic time map:
// warp(tRef) = the time in the vocal recording that should play at tRef.
// tq(i): vocal frame -> seconds, tr(j): reference frame -> seconds.
export function buildWarp(path, tq, tr, hop) {
  const j0 = path[0][1];
  const j1 = path[path.length - 1][1];
  const K = j1 - j0 + 1;

  const sum = new Float64Array(K);
  const cnt = new Uint16Array(K);
  for (const [i, j] of path) {
    sum[j - j0] += tq(i);
    cnt[j - j0] += 1;
  }
  const V = new Float64Array(K);
  for (let k = 0; k < K; k++) V[k] = cnt[k] ? sum[k] / cnt[k] : k > 0 ? V[k - 1] : 0;

  // Smooth out frame-level jitter of the path (about +-0.2 s).
  const W = Math.max(2, Math.round(0.2 / hop));
  const S = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const w = Math.min(W, k, K - 1 - k);
    let s = 0;
    for (let m = k - w; m <= k + w; m++) s += V[m];
    S[k] = s / (2 * w + 1);
  }
  for (let k = 1; k < K; k++) if (S[k] < S[k - 1]) S[k] = S[k - 1];

  const R0 = tr(j0);
  const R1 = tr(j1);
  return (t) => {
    const x = (t - R0) / hop;
    if (x <= 0) return S[0] + (t - R0); // before the match: play at normal speed
    if (x >= K - 1) return S[K - 1] + (t - R1); // after the match: normal speed
    const k = Math.floor(x);
    const f = x - k;
    return S[k] * (1 - f) + S[k + 1] * f;
  };
}