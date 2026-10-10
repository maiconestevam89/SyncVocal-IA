import React, { useState } from "react";
import { Wrench, Loader2, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

// Sends an isolated-vocal AudioBuffer to the Kits.ai AI Vocal Repair backend
// function and returns the decoded repaired AudioBuffer.
export async function repairVocal(buffer, onStatus) {
  // 1. Encode the buffer to WAV so Kits can ingest it.
  onStatus?.("encoding");
  const wavBlob = await encodeWav(buffer);
  const file = new File([wavBlob], "isolated.wav", { type: "audio/wav" });

  // 2. Upload to private storage and get a signed URL for the backend.
  onStatus?.("uploading");
  const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
  const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({ file_uri });

  // 3. Run the repair job on the backend.
  onStatus?.("processing");
  const res = await base44.functions.invoke("repairVocal", { file_url: signed_url });
  if (res.status >= 400) {
    const msg = res.data?.error || "Falha no reparo de voz.";
    throw new Error(msg);
  }

  // 4. Decode the repaired audio bytes back into an AudioBuffer.
  onStatus?.("decoding");
  const outBlob = new Blob([res.data], { type: res.headers?.["content-type"] || "audio/mpeg" });
  const arrayBuffer = await outBlob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    ctx.close();
  }
}

// Minimal 16-bit PCM WAV encoder for the buffer's first channel.
async function encodeWav(buffer) {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.getChannelData(0);
  const length = samples.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * bytesPerSample;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([ab], { type: "audio/wav" });
}

export default function VocalRepair({ buffer, onRepaired, repaired }) {
  const [status, setStatus] = useState("idle"); // idle | working | error
  const [message, setMessage] = useState("");

  const run = async () => {
    if (!buffer) return;
    setStatus("working");
    setMessage("Preparando vocal isolado…");
    try {
      const out = await repairVocal(buffer, (s) => {
        if (s === "uploading") setMessage("Enviando para o kits.ai…");
        else if (s === "processing") setMessage("Reparando voz no kits.ai…");
        else if (s === "decoding") setMessage("Decodificando vocal reparado…");
      });
      onRepaired(out);
      setStatus("idle");
      setMessage("");
    } catch (e) {
      setStatus("error");
      setMessage(e.message || "Erro ao reparar voz.");
    }
  };

  if (!buffer) return null;

  if (repaired) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        <Check className="h-4 w-4 shrink-0" />
        <span className="truncate">Vocal reparado pelo kits.ai pronto para uso.</span>
        <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={run}>
          Refazer
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={run}
        disabled={status === "working"}
        className="w-full"
      >
        {status === "working" ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Wrench className="mr-2 h-4 w-4" />
        )}
        {status === "working" ? "Reparando voz…" : "Reparar voz com kits.ai"}
      </Button>
      {status === "error" && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}