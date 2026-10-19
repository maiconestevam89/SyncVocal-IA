import { secrets } from "base44:runtime";
import { pollSeparationJobOnce, extractResultUrls } from "../../shared/kitsai.ts";

// Checks a Kits.ai separation job ONCE. If completed, returns the download URLs.
// Does NOT download or upload — that's done by storeKitsResult to keep each
// function call within the worker's memory ceiling.
//
// Receives: { kits_job_id, with_instrumental }
// Returns: { done: true, vocal_url, instrumental_url? } | { done: false, retry_count }
export default async function(req) {
  try {
    const body = await req.json();
    const { kits_job_id, with_instrumental, retry_count } = body;
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

    // Job completed — extract URLs only, no download
    const { vocalUrl, instrumentalUrl } = extractResultUrls(result, with_instrumental);
    return Response.json({ done: true, vocal_url: vocalUrl, instrumental_url: instrumentalUrl });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}