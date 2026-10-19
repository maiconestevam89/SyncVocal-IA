import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from "base44:runtime";
import {
  detectAudioFormat,
  createSeparationJob,
  downloadAudio,
} from "../../shared/kitsai.ts";

// Starts a Kits.ai vocal separation job and returns immediately.
// Does NOT poll — the workflow handles polling via checkKitsIsolation
// with wait steps between calls, keeping each function invocation short.
//
// Receives: { file_uri, with_instrumental, job_id }
// Returns: { kits_job_id }
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { file_uri, with_instrumental, job_id } = body;
    if (!file_uri) return Response.json({ error: "file_uri ausente." }, { status: 400 });

    const apiKey = secrets.get("KITS_API_KEY");
    if (!apiKey) return Response.json({ error: "KITS_API_KEY não configurada." }, { status: 500 });

    // Update job status
    if (job_id) {
      await base44.asServiceRole.entities.ProcessingJob.update(job_id, {
        status: with_instrumental ? "isolating_1" : "isolating_2",
      });
    }

    // Download input file, detect format, create Kits.ai job
    const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri });
    const audioBlob = await downloadAudio(signed_url);
    const { ext, type: fileContentType, supported } = await detectAudioFormat(audioBlob);
    if (!supported) {
      throw new Error(`Formato .${ext} não suportado pelo kits.ai. Use WAV, MP3, FLAC ou WebM.`);
    }

    const kitsJobId = await createSeparationJob(apiKey, audioBlob, fileContentType, `input.${ext}`);

    return Response.json({ kits_job_id: kitsJobId });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}