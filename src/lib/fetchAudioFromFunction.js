import { base44 } from "@/api/base44Client";
import { decodeAudioFile } from "@/lib/decodeAudio";

// Calls a backend function that answers with raw audio bytes and returns the
// decoded AudioBuffer. functions.invoke() would turn the binary body into text
// and corrupt it, so we use the raw fetch Response and read it as bytes.
//
// When the function returns the merged format (vocal + instrumental prefixed
// with a 4-byte big-endian length marker), this helper splits the two and
// returns both decoded buffers via the `withInstrumental` option.
export async function fetchAudioFromFunction(name, payload, { errorMessage, onDecoding, withInstrumental = false } = {}) {
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

  // Detect the merged payload (application/octet-stream with a 4-byte marker).
  // A standalone audio file never starts with a plausible 32-bit length that
  // exactly matches the remaining bytes, so this heuristic is safe.
  if (withInstrumental && type.includes("octet-stream") && bytes.byteLength > 4) {
    const view = new DataView(bytes);
    const vocalLen = view.getUint32(0, false); // big-endian
    if (vocalLen > 0 && vocalLen + 4 <= bytes.byteLength) {
      const vocalBytes = bytes.slice(4, 4 + vocalLen);
      const instBytes = bytes.slice(4 + vocalLen);
      onDecoding?.();
      const vocal = await decodeAudioFile(new File([vocalBytes], "vocal.mp3", { type: "audio/mpeg" }));
      const instrumental = await decodeAudioFile(new File([instBytes], "instrumental.mp3", { type: "audio/mpeg" }));
      return { vocal, instrumental };
    }
    throw new Error("O kits.ai não retornou o instrumental do Áudio 1.");
  }

  onDecoding?.();
  return decodeAudioFile(new File([bytes], "audio", { type }));
}