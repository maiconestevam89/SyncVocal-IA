import { secrets } from "base44:runtime";

// Isolates the vocal from an uploaded audio file using the Kits.ai vocal
// separation API. The frontend uploads the file to private storage and sends
// us the file_uri; we download the bytes, forward them to Kits as multipart,
// poll the job until it finishes, then stream the isolated vocal back.
//
// Kits API reference:
//   POST https://arpeggi.io/api/kits/v1/vocal-separations  (multipart, inputFile)
//   GET  https://arpeggi.io/api/kits/v1/vocal-separations/:id
// The vocal output URL (vocalAudioFileUrl) is a signed link that expires in 4h.

const KITS_BASE = "https://arpeggi.io/api/kits/v1";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 180000; // 3 min ceiling for the separation job

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

    // Download the uploaded audio bytes via the signed URL.
    const fileRes = await fetch(fileUrl, { signal: AbortSignal.timeout(60000) });
    if (!fileRes.ok) {
      return Response.json(
        { error: `Falha ao ler arquivo enviado: ${fileRes.status}` },
        { status: 502 }
      );
    }
    const fileBytes = await fileRes.arrayBuffer();
    const fileContentType = fileRes.headers.get("content-type") || "audio/mpeg";
    const ext = (fileUrl.split(".").pop() || "mp3").split("?")[0].toLowerCase();
    const filename = `input.${ext}`;

    // Build the multipart body Kits expects (field name "inputFile").
    const form = new FormData();
    form.append("inputFile", new Blob([fileBytes], { type: fileContentType }), filename);

    // Create the separation job.
    const createRes = await fetch(`${KITS_BASE}/vocal-separations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });

    if (!createRes.ok) {
      const detail = await createRes.text().catch(() => "");
      return Response.json(
        { error: `Kits (criar job): ${createRes.status}`, detail },
        { status: 502 }
      );
    }

    const job = await createRes.json();
    const jobId = job?.id;
    if (!jobId) {
      return Response.json({ error: "Resposta do Kits sem id de job." }, { status: 502 });
    }

    // Poll until the job reaches a terminal state.
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let result = job;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pollRes = await fetch(`${KITS_BASE}/vocal-separations/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!pollRes.ok) {
        const detail = await pollRes.text().catch(() => "");
        return Response.json(
          { error: `Kits (consultar job): ${pollRes.status}`, detail },
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
        { error: `Isolamento não concluído (status: ${result?.status ?? "timeout"}).` },
        { status: 502 }
      );
    }

    // Prefer the lossy vocal URL (smaller, faster to download) for the browser
    // decode, falling back to the full-quality vocal URL.
    const vocalUrl = result?.lossyVocalAudioFileUrl || result?.vocalAudioFileUrl;
    if (!vocalUrl) {
      return Response.json({ error: "Isolamento concluído sem URL de saída." }, { status: 502 });
    }

    // Fetch the isolated vocal audio bytes and stream them back to the client.
    const audioRes = await fetch(vocalUrl, { signal: AbortSignal.timeout(60000) });
    if (!audioRes.ok) {
      return Response.json(
        { error: `Falha ao baixar vocal isolado: ${audioRes.status}` },
        { status: 502 }
      );
    }
    const audioBytes = await audioRes.arrayBuffer();
    // Kits returns the original container (wav/mp3/etc); echo its content type.
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