import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from "base44:runtime";
import {
  detectAudioFormat,
  createSeparationJob,
  pollSeparationJob,
  extractResultUrls,
  downloadAudio,
} from "../../shared/kitsai.ts";

// Isolates the vocal from an uploaded audio file using Kits.ai and saves
// the result to private storage (instead of streaming it back to the client).
// This allows the workflow to run independently of the browser.
//
// Receives: { file_uri, with_instrumental, job_id? }
// Returns: { vocal_uri, instrumental_uri? }
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { file_uri, with_instrumental, job_id } = body;
    if (!file_uri) return Response.json({ error: "file_uri ausente." }, { status: 400 });

    const apiKey = secrets.get("KITS_API_KEY");
    if (!apiKey) return Response.json({ error: "KITS_API_KEY não configurada." }, { status: 500 });

    try {
      // Update job status
      if (job_id) {
        await base44.asServiceRole.entities.ProcessingJob.update(job_id, {
          status: with_instrumental ? "isolating_1" : "isolating_2",
        });
      }

      // Create signed URL and download input file
      const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri });
      const fileBytes = await downloadAudio(signed_url);
      const { ext, type: fileContentType, supported } = detectAudioFormat(fileBytes);
      if (!supported) {
        throw new Error(`Formato .${ext} não suportado pelo kits.ai. Use WAV, MP3, FLAC ou WebM.`);
      }

      // Create + poll Kits.ai separation job
      const kitsJobId = await createSeparationJob(apiKey, fileBytes, fileContentType, `input.${ext}`);
      const result = await pollSeparationJob(apiKey, kitsJobId);
      const { vocalUrl, instrumentalUrl } = extractResultUrls(result, with_instrumental);

      // Download + upload isolated vocal (prefer lossless WAV from Kits)
      const vocalBytes = await downloadAudio(vocalUrl);
      const vocalFile = new File([new Blob([vocalBytes])], "vocal.wav", { type: "audio/wav" });
      const { file_uri: vocal_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: vocalFile });

      // Download + upload instrumental if requested
      let instrumental_uri = null;
      if (with_instrumental && instrumentalUrl) {
        const instBytes = await downloadAudio(instrumentalUrl);
        const instFile = new File([new Blob([instBytes])], "instrumental.wav", { type: "audio/wav" });
        const { file_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: instFile });
        instrumental_uri = file_uri;
      }

      // Update job with URIs
      if (job_id) {
        const updateData = {};
        if (with_instrumental) {
          updateData.vocal1_uri = vocal_uri;
          updateData.instrumental_uri = instrumental_uri;
        } else {
          updateData.vocal2_uri = vocal_uri;
        }
        await base44.asServiceRole.entities.ProcessingJob.update(job_id, updateData);
      }

      return Response.json({ vocal_uri, instrumental_uri });
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