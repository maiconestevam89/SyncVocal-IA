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
const RATE_LIMIT_WAIT_MS = 65000; // wait just over 1 min between 429 retries
const MAX_CREATE_ATTEMPTS = 2; // retry once on rate-limit (first try + 1 retry)

export default async function(req) {
  try {
    const apiKey = secrets.get("KITS_API_KEY");
    if (!apiKey) {
      return Response.json({ error: "Chave KITS_API_KEY não configurada." }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const fileUrl = body?.file_url;
    const withInstrumental = body?.with_instrumental === true;
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

    // Create the separation job. Kits.ai allows 1 request per minute, so when
    // the user uploads both audios back-to-back the second call hits a 429. We
    // retry here automatically instead of failing, waiting ~1 min between tries.
    let createRes;
    let job;
    let jobId;
    for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
      createRes = await fetch(`${KITS_BASE}/vocal-separations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(60000),
      });

      if (createRes.status === 429 && attempt < MAX_CREATE_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RATE_LIMIT_WAIT_MS));
        continue;
      }
      break;
    }

    if (createRes.status === 429) {
      return Response.json(
        { error: "Limite do kits.ai: 1 envio por minuto. Aguarde cerca de 1 minuto e tente novamente." },
        { status: 429 }
      );
    }

    if (!createRes.ok) {
      const detail = await createRes.text().catch(() => "");
      return Response.json(
        { error: `Kits (criar job): ${createRes.status}`, detail },
        { status: 502 }
      );
    }

    job = await createRes.json();
    jobId = job?.id;
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

    // Kits returns separate URLs for the isolated vocal and the instrumental
    // (the original track with the vocal removed). The frontend uses the vocal
    // of Audio 1 as the sync reference and the instrumental as the final bed,
    // so the original voice of Audio 1 never appears in the output.
    const vocalUrl = result?.lossyVocalAudioFileUrl || result?.vocalAudioFileUrl;
    // Kits exposes the instrumental as the "backing" stem (also available as
    // the deprecated backingAudioFileUrl field).
    const findBacking = (stems) =>
      Array.isArray(stems) ? stems.find((s) => s?.instrument === "backing")?.url : undefined;
    const instrumentalUrl =
      findBacking(result?.lossyStemFileUrls) ||
      findBacking(result?.stemFileUrls) ||
      result?.backingAudioFileUrl;
    if (!vocalUrl) {
      return Response.json({ error: "Isolamento concluído sem URL de saída." }, { status: 502 });
    }

    // Download the isolated vocal audio bytes.
    const audioRes = await fetch(vocalUrl, { signal: AbortSignal.timeout(60000) });
    if (!audioRes.ok) {
      return Response.json(
        { error: `Falha ao baixar vocal isolado: ${audioRes.status}` },
        { status: 502 }
      );
    }
    const audioBytes = await audioRes.arrayBuffer();

    // When the instrumental URL is available, concatenate the instrumental
    // (prefixed with a 4-byte length marker) after the vocal so the frontend
    // can split the two without an extra round-trip. The marker is a single
    // 32-bit big-endian unsigned int holding the vocal byte length.
    // Only merged when the caller asks for it (Audio 1). If it was requested
    // but can't be delivered, fail loudly instead of silently returning only
    // the vocal — the app needs the instrumental for the final mix.
    if (withInstrumental) {
      if (!instrumentalUrl) {
        return Response.json({ error: "O kits.ai não retornou o instrumental do Áudio 1." }, { status: 502 });
      }
      const instRes = await fetch(instrumentalUrl, { signal: AbortSignal.timeout(60000) });
      if (!instRes.ok) {
        return Response.json(
          { error: `Falha ao baixar instrumental isolado: ${instRes.status}` },
          { status: 502 }
        );
      }
      const instBytes = await instRes.arrayBuffer();
      const merged = new Uint8Array(audioBytes.byteLength + instBytes.byteLength + 4);
      const view = new DataView(merged.buffer);
      view.setUint32(0, audioBytes.byteLength, false); // big-endian
      merged.set(new Uint8Array(audioBytes), 4);
      merged.set(new Uint8Array(instBytes), 4 + audioBytes.byteLength);
      return new Response(merged.buffer, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-store",
        },
      });
    }

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