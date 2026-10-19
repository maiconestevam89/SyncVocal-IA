import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { decodeWavMonoAtRate, encodeWav } from "../../shared/wavCodec.ts";
import { decodeAudioMono } from "../../shared/audioProcessor.ts";
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
// and mixes one version at a time. It stores final WAV/MP3, playback WAV/MP3,
// and 70-second previews in private storage for the async production workflow.
//
// Memory strategy:
// - Decode WAV files directly to mono at 22050 Hz, avoiding the ~104 MB
//   full-rate stereo Float32Array. For compressed formats, fall back to the
//   existing multi-format decoder before entering the DSP pipeline.
// - Load and free each file incrementally — never hold all three at once.
// - Process vocals as mono; the instrumental is also mono (averaged during
//   decode). The final WAV is mono at 22050 Hz, which is fine for WhatsApp.
//
// Receives: { job_id?, vocal1_uri, vocal2_uri, instrumental_uri }
// Returns: { result_url, preview_url }

const PROCESS_RATE = 22050;

async function resolveAudioUrl(base44: any, source: string): Promise<string> {
  if (/^https?:\/\//i.test(source)) return source;
  const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
    file_uri: source,
    expires_in: 3600,
  });
  return signed.signed_url;
}

// Fetch directly as ArrayBuffer — avoids the Blob intermediate that doubles memory.
async function fetchArrayBuffer(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Falha ao baixar áudio: ${res.status}`);
  const buf = await res.arrayBuffer();
  // Ensure we return a proper ArrayBuffer (Deno can return Uint8Array in some cases)
  return buf instanceof ArrayBuffer ? buf : new Uint8Array(buf).buffer;
}

// Keep the memory-efficient WAV path, but accept MP3/WebM/OGG/M4A through the existing multi-format decoder.
async function decodeAudioAtRate(url: string) {
  const audioBuffer = await fetchArrayBuffer(url);
  try {
    return decodeWavMonoAtRate(audioBuffer, PROCESS_RATE);
  } catch {
    return await decodeAudioMono(audioBuffer, PROCESS_RATE);
  }
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
    const { job_id, vocal1_uri, vocal2_uri, instrumental_uri, version = 1 } = body;
    if (!vocal1_uri || !vocal2_uri || !instrumental_uri) {
      return Response.json({ error: "URIs ausentes." }, { status: 400 });
    }

    try {
      if (job_id) {
        await base44.asServiceRole.entities.ProcessingJob.update(job_id, { status: "processing" });
      }

      // Accept either private Base44 file URIs or temporary provider URLs.
      const [v1Url, v2Url, instUrl] = await Promise.all([
        resolveAudioUrl(base44, vocal1_uri),
        resolveAudioUrl(base44, vocal2_uri),
        resolveAudioUrl(base44, instrumental_uri),
      ]);

      // ── STEP 1: Load vocal1 (reference) → extract features + silence gate → free ──
      const vocal1 = await decodeAudioAtRate(v1Url);
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
      const vocal2 = await decodeAudioAtRate(v2Url);
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
      const instrumental = await decodeAudioAtRate(instUrl);

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

      // Free intermediates after mixing, while retaining the instrumental for WAV/MP3 exports.
      gated[0].fill(0);
      alignedResampled[0].fill(0);

      // ── STEP 4: Persist final mix, previews, and downloadable playback formats ──
      const wavBytes = encodeWav([mixed], instrumental.sampleRate);
      const resultFile = new File([new Blob([wavBytes])], "result.wav", { type: "audio/wav" });
      const { file_uri: result_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: resultFile });

      const resultMp3Bytes = encodeMp3([mixed], instrumental.sampleRate, 192);
      const resultMp3File = new File([new Blob([resultMp3Bytes])], "result.mp3", { type: "audio/mpeg" });
      const { file_uri: result_mp3_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: resultMp3File });

      const previewLen = Math.min(mixed.length, Math.floor(70 * instrumental.sampleRate));
      const previewBytes = encodeMp3([mixed.subarray(0, previewLen)], instrumental.sampleRate, 192);
      const previewFile = new File([new Blob([previewBytes])], "preview-voice.mp3", { type: "audio/mpeg" });
      const { file_uri: preview_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: previewFile });

      const playbackWavBytes = encodeWav(instrumental.channels, instrumental.sampleRate);
      const playbackWavFile = new File([new Blob([playbackWavBytes])], "playback.wav", { type: "audio/wav" });
      const { file_uri: playback_wav_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: playbackWavFile });

      const playbackMp3Bytes = encodeMp3(instrumental.channels, instrumental.sampleRate, 192);
      const playbackMp3File = new File([new Blob([playbackMp3Bytes])], "playback.mp3", { type: "audio/mpeg" });
      const { file_uri: playback_mp3_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: playbackMp3File });

      const playbackPreviewLen = Math.min(instrumental.channels[0].length, Math.floor(70 * instrumental.sampleRate));
      const playbackPreviewBytes = encodeMp3([instrumental.channels[0].subarray(0, playbackPreviewLen)], instrumental.sampleRate, 192);
      const playbackPreviewFile = new File([new Blob([playbackPreviewBytes])], "preview-playback.mp3", { type: "audio/mpeg" });
      const { file_uri: playback_preview_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: playbackPreviewFile });

      const playback_url = instUrl;
      mixed.fill(0);
      instrumental.channels[0].fill(0);

      const [result_url, result_mp3_url, preview_url, playback_wav_url, playback_mp3_url] = await Promise.all([
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: result_uri, expires_in: 3600 }),
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: result_mp3_uri, expires_in: 3600 }),
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: preview_uri, expires_in: 3600 }),
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: playback_wav_uri, expires_in: 3600 }),
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: playback_mp3_uri, expires_in: 3600 }),
      ]).then((items: any[]) => items.map((item) => item.signed_url));

      if (job_id) {
        const versionFields = Number(version) === 2
          ? { final_v2_uri: result_uri, preview_v2_uri: playback_preview_uri, preview_voz_v2_uri: preview_uri }
          : { final_v1_uri: result_uri, preview_v1_uri: playback_preview_uri, preview_voz_v1_uri: preview_uri };
        await base44.asServiceRole.entities.ProcessingJob.update(job_id, {
          result_url,
          result_mp3_url,
          playback_url,
          playback_wav_url,
          playback_mp3_url,
          preview_url,
          status: "completed",
          ...versionFields,
        });
      }

      return Response.json({ result_url, result_mp3_url, preview_url, playback_url, playback_wav_url, playback_mp3_url });
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