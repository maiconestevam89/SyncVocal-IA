import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { downloadAudio } from "../../shared/kitsai.ts";

// Downloads a single audio file from a URL and uploads it to private storage.
// Kept separate from checkKitsIsolation so each function call handles only one
// file — downloading+uploading two large WAVs in a single call crashes the
// worker (exceededMemory).
//
// Receives: { audio_url, filename, job_id?, field_name? }
// Returns: { file_uri }
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { audio_url, filename, job_id, field_name } = body;
    if (!audio_url || !filename) {
      return Response.json({ error: "audio_url e filename são obrigatórios." }, { status: 400 });
    }

    console.log(`[storeKitsResult] downloading ${filename}...`);
    const blob = await downloadAudio(audio_url);
    console.log(`[storeKitsResult] downloaded ${filename}, size:`, blob.size);

    // slice() references the same data without copying
    const file = new File([blob.slice(0, blob.size, { type: "audio/wav" })], filename, { type: "audio/wav" });
    console.log(`[storeKitsResult] uploading ${filename}...`);
    const { file_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });
    console.log(`[storeKitsResult] uploaded ${filename}:`, file_uri);

    // Update job if requested
    if (job_id && field_name) {
      const update = {};
      update[field_name] = file_uri;
      await base44.asServiceRole.entities.ProcessingJob.update(job_id, update);
    }

    return Response.json({ file_uri });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}