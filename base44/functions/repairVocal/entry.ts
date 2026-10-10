import { secrets } from "base44:runtime";

// Applies AI Vocal Repair (Kits.ai) to an isolated vocal. The Kits API doesn't
// expose a dedicated "repair" endpoint, but its Voice Conversion API accepts
// pre-processing effects (NoiseGate, HighPassFilter, Compressor) that perform
// the same cleanup the web Vocal Repair tool does: noise removal, low-cut, and
// dynamics control. We send the isolated vocal with those effects and no voice
// model change, so the output is the same voice — cleaned up.
//
// Kits API reference:
//   POST https://arpeggi.io/api/kits/v1/voice-conversions  (multipart)
//   GET  https://arpeggi.io/api/kits/v1/voice-conversions/:id
// The output URL (lossyOutputFileUrl / outputFileUrl) is signed and expires in 4h.

const KITS_BASE = "https://arpeggi.io/api/kits/v1";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 180000; // 3 min ceiling for the repair job

export default async function(req) {
  try {
    const apiKey = secrets.get("KITS_API_KEY");
    if (!apiKey) {
      return Response.json({ error: "Chave KITS_API_KEY não configurada." }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const fileUrl = body?.file_url;
    if (!fileUrl || typeof fileUrl !== "string") {
      return Response.json({ error: "Parâmetro file_url ausente." }, { status: 400 });
    }

    // Download the isolated vocal bytes.
    const fileRes = await fetch(fileUrl, { signal: AbortSignal.timeout(60000) });
    if (!fileRes.ok) {
      return Response.json(
        { error: `Falha ao ler vocal isolado: ${fileRes.status}` },
        { status: 502 }
      );
    }
    const fileBytes = await fileRes.arrayBuffer();
    const fileContentType = fileRes.headers.get("content-type") || "audio/mpeg";
    const ext = (fileUrl.split(".").pop() || "mp3").split("?")[0].toLowerCase();
    const filename = `input.${ext}`;

    // Pre-processing effects = the "repair": noise gate + high-pass + gentle
    // compression. We pass the JSON as a form field (Kits expects stringified).
    const pre = JSON.stringify({
      NoiseGate: { threshold_db: -50, ratio: 4, attack_ms: 5, release_ms: 100 },
      HighPassFilter: { cutoff_frequency_hz: 80 },
      Compressor: { threshold_db: -24, ratio: 3, attack_ms: 10, release_ms: 100 },
    });

    const form = new FormData();
    form.append("soundFile", new Blob([fileBytes], { type: fileContentType }), filename);
    form.append("pre", pre);

    // Create the voice-conversion job. No voiceModelId → Kits returns the same
    // voice with only the pre/post processing applied (identity conversion).
    const createRes = await fetch(`${KITS_BASE}/voice-conversions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });

    if (!createRes.ok) {
      const detail = await createRes.text().catch(() => "");
      return Response.json(
        { error: `Kits (criar repair): ${createRes.status}`, detail },
        { status: 502 }
      );
    }

    const job = await createRes.json();
    const jobId = job?.id;
    if (!jobId) {
      return Response.json({ error: "Resposta do Kits sem id de job." }, { status: 502 });
    }

    // Poll until terminal state.
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let result = job;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pollRes = await fetch(`${KITS_BASE}/voice-conversions/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!pollRes.ok) {
        const detail = await pollRes.text().catch(() => "");
        return Response.json(
          { error: `Kits (consultar repair): ${pollRes.status}`, detail },
          { status: 502 }
        );
      }
      result = await pollRes.json();
      if (result?.status === "success" || result?.status === "error" || result?.status === "cancelled") {
        break;
      }
    }

    if (result?.status !== "success") {
      return Response.json(
        { error: `Repair não concluído (status: ${result?.status ?? "timeout"}).` },
        { status: 502 }
      );
    }

    const outputUrl = result?.lossyOutputFileUrl || result?.outputFileUrl;
    if (!outputUrl) {
      return Response.json({ error: "Repair concluído sem URL de saída." }, { status: 502 });
    }

    // Stream the repaired vocal bytes back to the client.
    const audioRes = await fetch(outputUrl, { signal: AbortSignal.timeout(60000) });
    if (!audioRes.ok) {
      return Response.json(
        { error: `Falha ao baixar vocal reparado: ${audioRes.status}` },
        { status: 502 }
      );
    }
    const audioBytes = await audioRes.arrayBuffer();
    const audioType = audioRes.headers.get("content-type") || "audio/mpeg";

    return new Response(audioBytes, {
      status: 200,
      headers: {
        "Content-Type": audioType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}