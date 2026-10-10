import { base44 } from "@/api/base44Client";
import { decodeAudioFile } from "@/lib/decodeAudio";

// Calls a backend function that answers with raw audio bytes and returns the
// decoded AudioBuffer. functions.invoke() would turn the binary body into text
// and corrupt it, so we use the raw fetch Response and read it as bytes.
export async function fetchAudioFromFunction(name, payload, { errorMessage, onDecoding } = {}) {
  const res = await base44.functions.fetch(`/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || errorMessage || `Falha na função ${name} (${res.status}).`);
  }

  const type = res.headers.get("content-type") || "audio/mpeg";
  const bytes = await res.arrayBuffer();
  onDecoding?.();
  return decodeAudioFile(new File([bytes], "audio", { type }));
}