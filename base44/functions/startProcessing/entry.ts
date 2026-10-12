import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// Creates a ProcessingJob entity. The entity-triggered workflow
// (ProcessAudioPipeline) picks it up and runs the full pipeline
// server-side: isolate → align → mix → send via WhatsApp.
//
// Receives: { audio1_file_uri, audio2_file_uri, audio1_name }
// Returns: { job_id }
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { audio1_file_uri, audio2_file_uri, audio1_name } = body;
    if (!audio1_file_uri || !audio2_file_uri || !audio1_name) {
      return Response.json({ error: "Parâmetros ausentes: audio1_file_uri, audio2_file_uri, audio1_name são obrigatórios." }, { status: 400 });
    }

    const job = await base44.entities.ProcessingJob.create({
      audio1_name,
      audio1_file_uri,
      audio2_file_uri,
      status: "pending",
    });

    return Response.json({ job_id: job.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}