import React, { useState } from "react";
import { Sparkles, Loader2, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

// Sends the uploaded audio file to the Kits.ai vocal isolation backend
// function and returns the decoded isolated-vocal AudioBuffer.
export async function isolateVocal(file, onStatus) {
  // 1. Upload to private storage so the backend function can fetch the bytes
  //    by file_uri — the SDK invoke() payload must be JSON-serializable.
  onStatus?.("uploading");
  const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });

  // 2. Ask the backend function to run the Kits separation and stream back
  //    the isolated vocal audio bytes.
  onStatus?.("processing");
  const res = await base44.functions.invoke("isolateVocal", { file_uri });
  if (res.status >= 400) {
    const msg = res.data?.error || "Falha no isolamento de voz.";
    throw new Error(msg);
  }
  // The function returns the raw audio bytes.
  const blob = new Blob([res.data], { type: res.headers?.["content-type"] || "audio/mpeg" });
  onStatus?.("decoding");
  const arrayBuffer = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    ctx.close();
  }
}

export default function VocalIsolator({ file, onIsolated, isolated }) {
  const [status, setStatus] = useState("idle"); // idle | working | error
  const [message, setMessage] = useState("");

  const run = async () => {
    if (!file) return;
    setStatus("working");
    setMessage("Enviando para o kits.ai…");
    try {
      const buffer = await isolateVocal(file, (s) => {
        if (s === "processing") setMessage("Isolando voz no kits.ai…");
        else if (s === "decoding") setMessage("Decodificando vocal isolado…");
      });
      onIsolated(buffer);
      setStatus("idle");
      setMessage("");
    } catch (e) {
      setStatus("error");
      setMessage(e.message || "Erro ao isolar voz.");
    }
  };

  if (!file) return null;

  if (isolated) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        <Check className="h-4 w-4 shrink-0" />
        <span className="truncate">Vocal isolado pelo kits.ai pronto para uso.</span>
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
          <Sparkles className="mr-2 h-4 w-4" />
        )}
        {status === "working" ? "Isolando voz…" : "Isolar voz com kits.ai"}
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