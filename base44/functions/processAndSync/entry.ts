import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { decodeWav, encodeWav } from "../../shared/wavCodec.ts";
import { encodeMp3 } from "../../shared/mp3Encoder.ts";
import { processAndMix } from "../../shared/audioProcessor.ts";
import { downloadAudio } from "../../shared/kitsai.ts";

// Downloads the isolated vocals and instrumental from storage, aligns the
// client vocal to the reference, applies a silence gate, auto-matches gains,
// and mixes into a final stereo track. Also creates a 70-second MP3 preview
// for the WhatsApp flow. Both files are uploaded to private storage.
//
// Receives: { job_id?, vocal1_uri, vocal2_uri, instrumental_uri }
// Returns: { result_url, preview_url }
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { job_id, vocal1_uri, vocal2_uri, instrumental_uri } = body;
    if (!vocal1_uri || !vocal2_uri || !instrumental_uri) {
      return Response.json({ error: "URIs ausentes." }, { status: 400 });
    }

    try {
      // Update job status
      if (job_id) {
        await base44.asServiceRole.entities.ProcessingJob.update(job_id, { status: "processing" });
      }

      // Create signed URLs for all three files at once (cheap, no data transferred)
      const [v1Signed, v2Signed, instSigned] = await Promise.all([
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: vocal1_uri }),
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: vocal2_uri }),
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: instrumental_uri }),
      ]);

      // Download and decode ONE file at a time to stay within the worker memory
      // limit. Each WAV as ArrayBuffer + decoded Float32Array is large; loading
      // all three in parallel crashes the worker (exceededMemory).
      const vocal1 = decodeWav(await (await downloadAudio(v1Signed.signed_url)).arrayBuffer());
      const vocal2 = decodeWav(await (await downloadAudio(v2Signed.signed_url)).arrayBuffer());
      const instrumental = decodeWav(await (await downloadAudio(instSigned.signed_url)).arrayBuffer());

      // Process and mix: align → silence-gate → auto-match gains → mix to stereo
      const mixed = await processAndMix(vocal1, vocal2, instrumental);

      // Encode full mix as WAV and upload
      const wavBytes = encodeWav(mixed.channels, mixed.sampleRate);
      const resultFile = new File([new Blob([wavBytes])], "result.wav", { type: "audio/wav" });
      const { file_uri: result_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: resultFile });
      const { signed_url: result_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: result_uri, expires_in: 86400 });

      // Create 70-second preview and encode as MP3 for WhatsApp
      const previewSeconds = 70;
      const previewLen = Math.min(mixed.channels[0].length, Math.floor(previewSeconds * mixed.sampleRate));
      const previewChannels = mixed.channels.map((ch) => ch.subarray(0, previewLen));
      const mp3Bytes = encodeMp3(previewChannels, mixed.sampleRate, 192);
      const previewFile = new File([new Blob([mp3Bytes])], "preview.mp3", { type: "audio/mpeg" });
      const { file_uri: preview_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: previewFile });
      const { signed_url: preview_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: preview_uri, expires_in: 86400 });

      // Update job with result URL
      if (job_id) {
        await base44.asServiceRole.entities.ProcessingJob.update(job_id, { result_url });
      }

      return Response.json({ result_url, preview_url });
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