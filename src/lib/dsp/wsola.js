const tick = () => new Promise((r) => setTimeout(r, 0));

// Pitch-preserving, time-varying stretch (WSOLA).
// Builds an output on the reference timeline: output second t plays the input
// at second warp(t). channels: Float32Array[] of the source. Returns Float32Array[].
export async function warpStretch(channels, sampleRate, warp, outDuration) {
  const sr = sampleRate;
  const nCh = channels.length;
  const n = channels[0].length;
  const D = 4; // decimation used only for the similarity search
  const Hs = Math.round(0.02 * sr); // synthesis hop (20 ms)
  const N = Hs * 2; // frame length (40 ms), 50% overlap
  const tol = Math.round(0.012 * sr); // search range around the nominal position
  const nd = Math.floor(n / D);
  const L = Math.floor(Hs / D);

  const mono = new Float32Array(nd);
  for (let i = 0; i < nd; i++) {
    let s = 0;
    for (let c = 0; c < nCh; c++) {
      const ch = channels[c];
      for (let k = 0; k < D; k++) s += ch[i * D + k];
    }
    mono[i] = s / (D * nCh);
  }

  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  const outLen = Math.ceil(outDuration * sr);
  const outs = channels.map(() => new Float32Array(outLen + 3 * N));
  const lastFrame = Math.ceil(outLen / Hs);

  let prevStart = 0;
  let havePrev = false;

  for (let k = -1; k <= lastFrame; k++) {
    const p = k * Hs;
    const target = Math.round(warp((p + Hs) / sr) * sr) - Hs;
    let start = target;

    if (havePrev) {
      // The natural continuation of the previous frame is our template.
      const tpl = Math.round((prevStart + Hs) / D);
      if (tpl >= 0 && tpl + L <= nd) {
        let tplE = 1e-9;
        for (let m = 0; m < L; m++) tplE += mono[tpl + m] * mono[tpl + m];
        const lo = Math.max(0, Math.round((target - tol) / D));
        const hi = Math.min(nd - L, Math.round((target + tol) / D));
        let bestScore = -Infinity;
        let bestSd = -1;
        for (let sd = lo; sd <= hi; sd++) {
          let dot = 0;
          let e = 1e-9;
          for (let m = 0; m < L; m++) {
            const b = mono[sd + m];
            dot += mono[tpl + m] * b;
            e += b * b;
          }
          const score = dot / Math.sqrt(e * tplE) - (0.02 * Math.abs(sd * D - target)) / tol;
          if (score > bestScore) {
            bestScore = score;
            bestSd = sd;
          }
        }
        if (bestSd >= 0) start = bestSd * D;
      }
    }

    for (let c = 0; c < nCh; c++) {
      const src = channels[c];
      const dst = outs[c];
      for (let m = 0; m < N; m++) {
        const o = p + m;
        const idx = start + m;
        if (o >= 0 && idx >= 0 && idx < n) dst[o] += win[m] * src[idx];
      }
    }
    prevStart = start;
    havePrev = true;
    if ((k & 127) === 0) await tick();
  }

  return outs.map((o) => o.slice(0, outLen));
}