// Shared Kits.ai vocal separation logic.
// Extracted from isolateVocal/entry.ts so both the streaming function
// and the storage-saving function can use the same code.
// Uses Blob throughout to avoid memory-hungry ArrayBuffer copies (the
// Deno worker has a tight memory ceiling — downloading a large audio
// file as ArrayBuffer and then wrapping it in a new Blob doubles the
// footprint and triggers "exceededMemory" crashes).

const KITS_BASE = "https://arpeggi.io/api/kits/v1";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 180000; // 3 min ceiling for the separation job
const RATE_LIMIT_WAIT_MS = 65000; // wait just over 1 min between 429 retries
const MAX_CREATE_ATTEMPTS = 2;

// Detect audio format from the first 12 bytes of a Blob.
// Only slices the header — does NOT load the entire file into memory.
// Kits supports wav, webm, mp3, flac.
export async function detectAudioFormat(blob) {
  const v = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (v.length < 12) return { ext: "mp3", type: "audio/mpeg", supported: true };
  if (v[0] === 0x52 && v[1] === 0x49 && v[2] === 0x46 && v[3] === 0x46 &&
      v[8] === 0x57 && v[9] === 0x41 && v[10] === 0x56 && v[11] === 0x45)
    return { ext: "wav", type: "audio/wav", supported: true };
  if (v[0] === 0x66 && v[1] === 0x4C && v[2] === 0x61 && v[3] === 0x43)
    return { ext: "flac", type: "audio/flac", supported: true };
  if (v[0] === 0x49 && v[1] === 0x44 && v[2] === 0x33)
    return { ext: "mp3", type: "audio/mpeg", supported: true };
  if (v[0] === 0xFF && (v[1] === 0xFB || v[1] === 0xF3 || v[1] === 0xF2))
    return { ext: "mp3", type: "audio/mpeg", supported: true };
  if (v[0] === 0x4F && v[1] === 0x67 && v[2] === 0x67 && v[3] === 0x53)
    return { ext: "ogg", type: "audio/ogg", supported: false };
  if (v[0] === 0x1A && v[1] === 0x45 && v[2] === 0xDF && v[3] === 0xA3)
    return { ext: "webm", type: "audio/webm", supported: true };
  if (v.length >= 8 && v[4] === 0x66 && v[5] === 0x74 && v[6] === 0x79 && v[7] === 0x70)
    return { ext: "m4a", type: "audio/mp4", supported: false };
  return { ext: "mp3", type: "audio/mpeg", supported: true };
}

// Create a Kits.ai separation job, retrying once on rate-limit (429).
// Accepts a Blob so the file data is streamed without extra copies.
export async function createSeparationJob(apiKey, audioBlob, contentType, filename) {
  const form = new FormData();
  // slice() references the same underlying data without copying; new Blob([blob]) may copy
  form.append("inputFile", audioBlob.slice(0, audioBlob.size, contentType), filename);

  let createRes;
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
    throw new Error("Limite do kits.ai: 1 envio por minuto. Aguarde cerca de 1 minuto e tente novamente.");
  }
  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => "");
    throw new Error(`Kits (criar job): ${createRes.status} ${detail}`);
  }

  const job = await createRes.json();
  if (!job?.id) throw new Error("Resposta do Kits sem id de job.");
  return job.id;
}

// Poll a Kits.ai separation job ONCE (no loop). Returns the current job state.
// Used by checkKitsIsolation so each function call is short-lived — the workflow
// handles retries via wait steps instead of a long-running poll loop.
export async function pollSeparationJobOnce(apiKey, jobId) {
  const pollRes = await fetch(`${KITS_BASE}/vocal-separations/${jobId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!pollRes.ok) {
    const detail = await pollRes.text().catch(() => "");
    throw new Error(`Kits (consultar job): ${pollRes.status} ${detail}`);
  }
  return await pollRes.json();
}

// Poll a Kits.ai separation job until it reaches a terminal state.
export async function pollSeparationJob(apiKey, jobId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let result;
  let pollCount = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    pollCount++;
    console.log(`[pollSeparationJob] poll #${pollCount} for job ${jobId}`);
    const pollRes = await fetch(`${KITS_BASE}/vocal-separations/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!pollRes.ok) {
      const detail = await pollRes.text().catch(() => "");
      throw new Error(`Kits (consultar job): ${pollRes.status} ${detail}`);
    }
    result = await pollRes.json();
    console.log(`[pollSeparationJob] poll #${pollCount} status: ${result?.status}`);
    if (["success", "error", "cancelled"].includes(result?.status)) break;
  }
  if (result?.status !== "success") {
    throw new Error(`Isolamento não concluído (status: ${result?.status ?? "timeout"}).`);
  }
  return result;
}

// Extract vocal and instrumental URLs from a completed Kits.ai result.
// Prefers lossless (WAV) over lossy (MP3) for server-side processing.
export function extractResultUrls(result, withInstrumental) {
  const vocalUrl = result?.vocalAudioFileUrl || result?.lossyVocalAudioFileUrl;
  if (!vocalUrl) throw new Error("Isolamento concluído sem URL de saída.");

  let instrumentalUrl = null;
  if (withInstrumental) {
    const findBacking = (stems) =>
      Array.isArray(stems) ? stems.find((s) => s?.instrument === "backing")?.url : undefined;
    instrumentalUrl =
      findBacking(result?.stemFileUrls) ||
      findBacking(result?.lossyStemFileUrls) ||
      result?.backingAudioFileUrl;
    if (!instrumentalUrl) throw new Error("O kits.ai não retornou o instrumental do Áudio 1.");
  }

  return { vocalUrl, instrumentalUrl };
}

// Download audio as a Blob (streamed, not buffered into an ArrayBuffer).
export async function downloadAudio(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Falha ao baixar áudio: ${res.status}`);
  return res.blob();
}