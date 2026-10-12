import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { decodeWavMonoAtRate, encodeWav } from "../../shared/wavCodec.ts";
import { encodeMp3 } from "../../shared/mp3Encoder.ts";
import {
  computeFeatures,
  subsequenceDTW,
  buildWarp,
  warpStretch,
  toMono16kRaw,
  computeSilenceGateRaw,
  applyGate,
  autoMatchGainsRaw,
} from "../../shared/dsp.ts";

// Downloads the isolated vocals and instrumental from storage, aligns the
// client vocal to the reference, applies a silence gate, auto-matches gains,
// and mixes into a final track. Also creates a 70-second MP3 preview for the
// WhatsApp flow. Both files are uploaded to private storage.
//
// Memory strategy:
// - Decode directly to mono at 22050 Hz (via decodeWavMonoAtRate), avoiding
//   the ~104 MB per-file Float32Array that a full-rate stereo decode would
//   produce. Each decoded file is ~26 MB instead.
// - Load and free each file incrementally — never hold all three at once.
// - Process vocals as mono; the instrumental is also mono (averaged during
//   decode). The final WAV is mono at 22050 Hz, which is fine for WhatsApp.
//
// Receives: { job_id?, vocal1_uri, vocal2_uri, instrumental_uri }
// Returns: { result_url, preview_url }

const PROCESS_RATE = 22050;

// Fetch directly as ArrayBuffer — avoids the Blob intermediate that doubles memory.
async function fetchArrayBuffer(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Falha ao baixar áudio: ${res.status}`);
  return res.arrayBuffer();
}

// Linear-interpolation resample between arbitrary sample rates (mono).
function resampleMono(channels, fromRate, toRate) {
  if (fromRate === toRate) return channels;
  const ratio = fromRate / toRate;
  const srcLen = channels[0].length;
  const dstLen = Math.max(1, Math.round(srcLen / ratio));
  const out = new Float32Array(dstLen);
  const src = channels[0];
  for (let i = 0; i < dstLen; i++) {
    const srcIdx = i * ratio;
    const idx0 = Math.floor(srcIdx);
    const frac = srcIdx - idx0;
    const s0 = idx0 < srcLen ? src[idx0] : 0;
    const s1 = idx0 + 1 < srcLen ? src[idx0 + 1] : s0;
    out[i] = s0 * (1 - frac) + s1 * frac;
  }
  return [out];
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { job_id, vocal1_uri, vocal2_uri, instrumental_uri } = body;
    if (!vocal1_uri || !vocal2_uri || !instrumental_uri) {
      return Response.json({ error: "URIs ausentes." }, { status: 400 });
    }

    try {
      if (job_id) {
        await base44.asServiceRole.entities.ProcessingJob.update(job_id, { status: "processing" });
      }

      // Create signed URLs for all three files at once (cheap, no data transferred)
      const [v1Signed, v2Signed, instSigned] = await Promise.all([
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: vocal1_uri }),
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: vocal2_uri }),
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: instrumental_uri }),
      ]);

      // ── STEP 1: Load vocal1 (reference) → extract features + silence gate → free ──
      const vocal1 = decodeWavMonoAtRate(await fetchArrayBuffer(v1Signed.signed_url), PROCESS_RATE);
      const refDur = vocal1.channels[0].length / vocal1.sampleRate;
      const hop = Math.max(0.04, refDur / 5000);

      const refMono = toMono16kRaw(vocal1.channels, vocal1.sampleRate);
      const refFeatures = await computeFeatures(refMono, hop);

      const gateCurve = computeSilenceGateRaw(
        vocal1.channels, vocal1.channels[0].length, vocal1.sampleRate
      );
      // Free vocal1 — only features + gate curve needed downstream
      vocal1.channels = null;
      refMono.fill(0);

      // ── STEP 2: Load vocal2 (client) → align to reference → free ──
      const vocal2 = decodeWavMonoAtRate(await fetchArrayBuffer(v2Signed.signed_url), PROCESS_RATE);
      const vocalDur = vocal2.channels[0].length / vocal2.sampleRate;
      const vocalHop = Math.max(0.04, Math.max(refDur, vocalDur) / 5000);

      const vocalMono = toMono16kRaw(vocal2.channels, vocal2.sampleRate);
      const vocalFeatures = await computeFeatures(vocalMono, vocalHop);

      // Find active region in vocal2 features
      const first = vocalFeatures.active.indexOf(1);
      const last = vocalFeatures.active.lastIndexOf(1);
      if (first < 0 || refFeatures.active.indexOf(1) < 0) {
        throw new Error("não encontrei voz suficiente nos áudios para alinhar");
      }

      const q = {
        feats: vocalFeatures.feats.subarray(first * vocalFeatures.dim, (last + 1) * vocalFeatures.dim),
        dim: vocalFeatures.dim,
        nFrames: last - first + 1,
        active: vocalFeatures.active.subarray(first, last + 1),
      };
      const dtw = await subsequenceDTW(q, refFeatures);
      if (!dtw) throw new Error("não encontrei voz suficiente nos áudios para alinhar");

      const tq = (i) => (i + first) * vocalFeatures.hop + vocalFeatures.offset;
      const tr = (j) => j * refFeatures.hop + refFeatures.offset;
      const warp = buildWarp(dtw.path, tq, tr, refFeatures.hop);

      // WSOLA time-stretch on vocal2 channels → aligned output
      const aligned = await warpStretch(vocal2.channels, vocal2.sampleRate, warp, refDur);
      // Free vocal2 + features
      vocal2.channels = null;
      vocalFeatures.feats = null;
      refFeatures.feats = null;
      vocalMono.fill(0);

      // ── STEP 3: Load instrumental → gate → mix → free ──
      const instrumental = decodeWavMonoAtRate(await fetchArrayBuffer(instSigned.signed_url), PROCESS_RATE);

      // Resample aligned to instrumental's sample rate (same rate, so no-op)
      const alignedResampled = resampleMono(aligned, vocal2.sampleRate, instrumental.sampleRate);

      // Apply silence gate
      const gated = applyGate(alignedResampled, gateCurve, instrumental.sampleRate);

      // Auto-match gains
      const tracks = [
        { channels: gated, length: gated[0].length, gain: 1 },
        { channels: instrumental.channels, length: instrumental.channels[0].length, gain: 0.8 },
      ];
      const gains = autoMatchGainsRaw(tracks);

      // Mix to mono
      const maxLen = Math.max(gated[0].length, instrumental.channels[0].length);
      const mixed = new Float32Array(maxLen);

      for (let i = 0; i < maxLen; i++) {
        let v = 0;
        if (i < gated[0].length) v += gated[0][i] * gains[0];
        if (i < instrumental.channels[0].length) v += instrumental.channels[0][i] * gains[1];
        mixed[i] = v;
      }

      // Free intermediates
      instrumental.channels = null;
      gated[0].fill(0);
      alignedResampled[0].fill(0);

      // ── STEP 4: Encode full mix as WAV and upload ──
      const wavBytes = encodeWav([mixed], instrumental.sampleRate);
      const resultFile = new File([new Blob([wavBytes])], "result.wav", { type: "audio/wav" });
      const { file_uri: result_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: resultFile });
      const { signed_url: result_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: result_uri, expires_in: 3600 });

      // ── STEP 5: Create 70-second MP3 preview and upload ──
      const previewSeconds = 70;
      const previewLen = Math.min(mixed.length, Math.floor(previewSeconds * instrumental.sampleRate));
      const previewChannels = [mixed.subarray(0, previewLen)];
      const mp3Bytes = encodeMp3(previewChannels, instrumental.sampleRate, 192);
      const previewFile = new File([new Blob([mp3Bytes])], "preview.mp3", { type: "audio/mpeg" });
      const { file_uri: preview_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: previewFile });
      const { signed_url: preview_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: preview_uri, expires_in: 3600 });

      // Free mixed
      mixed.fill(0);

      // Create signed URL for the instrumental (playback) — original quality from Kits.ai
      const { signed_url: playback_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: instrumental_uri, expires_in: 3600 });

      if (job_id) {
        await base44.asServiceRole.entities.ProcessingJob.update(job_id, { result_url, playback_url });
      }

      return Response.json({ result_url, preview_url, playback_url });
    } catch (error) {
      if (job_id) {
        try {
          await base44.asServiceRole.entities.ProcessingJob.update(job_id, {
            status: "failed",
            error_message: error.message,
          });
        } catch {}
      }
      throw error;
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}