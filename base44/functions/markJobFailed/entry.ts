import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// Marks a ProcessingJob as failed. Called by the workflow when a step
// exhausts its retries or encounters an unrecoverable error.
//
// Receives: { job_id, error_message }
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { job_id, error_message } = body;
    if (!job_id) return Response.json({ error: "job_id ausente." }, { status: 400 });

    await base44.asServiceRole.entities.ProcessingJob.update(job_id, {
      status: "failed",
      error_message: error_message || "Falha no processamento.",
    });

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}