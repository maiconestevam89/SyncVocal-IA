import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from "base44:runtime";
import {
  pollSeparationJobOnce,
  extractResultUrls,
  downloadAudio,
} from "../../shared/kitsai.ts";

// Checks a Kits.ai separation job ONCE. If completed, downloads the isolated
// vocal (and instrumental if requested) and uploads them to private storage.
// If still running, returns { done: false } so the workflow can wait and retry.
//
// Receives: { kits_job_id, with_instrumental, job_id }
// Returns: { done: true, vocal_uri, instrumental_uri? } | { done: false }
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { kits_job_id, with_instrumental, job_id, retry_count } = body;
    if (!kits_job_id) return Response.json({ error: "kits_job_id ausente." }, { status: 400 });

    const retries = (retry_count || 0) + 1;
    if (retries > 20) {
      throw new Error("Tempo limite: o isolamento no kits.ai não concluiu após 5 minutos de verificações.");
    }

    const apiKey = secrets.get("KITS_API_KEY");
    if (!apiKey) return Response.json({ error: "KITS_API_KEY não configurada." }, { status: 500 });

    // Single poll — no loop, no waiting
    const result = await pollSeparationJobOnce(apiKey, kits_job_id);

    if (result?.status === "error" || result?.status === "cancelled") {
      throw new Error(`Kits.ai job ${result.status}: ${result?.errorMessage || "unknown error"}`);
    }
    if (result?.status !== "success") {
      // Still running — workflow will wait and retry
      return Response.json({ done: false, status: result?.status, retry_count: retries });
    }

    // Job completed — extract URLs, download, and upload to storage
    const { vocalUrl, instrumentalUrl } = extractResultUrls(result, with_instrumental);

    const vocalBlob = await downloadAudio(vocalUrl);
    const vocalFile = new File([vocalBlob], "vocal.wav", { type: "audio/wav" });
    const { file_uri: vocal_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: vocalFile });

    let instrumental_uri = null;
    if (with_instrumental && instrumentalUrl) {
      const instBlob = await downloadAudio(instrumentalUrl);
      const instFile = new File([instBlob], "instrumental.wav", { type: "audio/wav" });
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

    return Response.json({ done: true, vocal_uri, instrumental_uri });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}