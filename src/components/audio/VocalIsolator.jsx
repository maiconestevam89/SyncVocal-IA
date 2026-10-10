import React, { useEffect, useState } from "react";
import { Loader2, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { fetchAudioFromFunction } from "@/lib/fetchAudioFromFunction";

// Sends the uploaded audio file to the Kits.ai vocal isolation backend
// function and returns the decoded isolated-vocal AudioBuffer. When
// `withInstrumental` is true, the backend also returns the instrumental
// (original track with the vocal removed) and this helper resolves to
// { vocal, instrumental } instead of a bare AudioBuffer.
export async function isolateVocal(file, onStatus, { withInstrumental = false } = {}) {
  // 1. Upload to private storage so the backend function can fetch the bytes
  //    by file_uri — the SDK invoke() payload must be JSON-serializable.
  onStatus?.("uploading");
  const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
  // Create a signed URL so the backend function can fetch the private file.
  const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({ file_uri });

  // 2. Ask the backend function to run the Kits separation and stream back
  //    the isolated vocal audio bytes (and the instrumental when requested).
  onStatus?.("processing");
  return fetchAudioFromFunction(
    "isolateVocal",
    { file_url: signed_url, with_instrumental: withInstrumental },
    {
      errorMessage: "Falha no isolamento de voz.",
      onDecoding: () => onStatus?.("decoding"),
      withInstrumental,
    }
  );
}

export default function VocalIsolator({ file, onIsolated, onInstrumental, isolated, withInstrumental = false, canStart = true }) {
  const [status, setStatus] = useState("idle"); // idle | working | error
  const [message, setMessage] = useState("");

  const run = async () => {
    if (!file) return;
    setStatus("working");
    setMessage("Enviando para o kits.ai…");
    try {
      const result = await isolateVocal(file, (s) => {
        if (s === "processing") setMessage("Isolando voz no kits.ai… (pode levar até 2 min se o limite de envio for atingido)");
        else if (s === "decoding") setMessage("Decodificando vocal isolado…");
      }, { withInstrumental });

      // With instrumental enabled the helper returns { vocal, instrumental };
      // otherwise it returns a bare AudioBuffer.
      if (withInstrumental) {
        if (!result?.vocal || !result?.instrumental) {
          throw new Error("O kits.ai não retornou o instrumental do Áudio 1.");
        }
        onIsolated(result.vocal);
        onInstrumental?.(result.instrumental);
      } else {
        onIsolated(result);
      }
      setStatus("idle");
      setMessage("");
    } catch (e) {
      setStatus("error");
      setMessage(e.message || "Erro ao isolar voz.");
    }
  };

  // Run isolation automatically when a new file arrives.
  useEffect(() => {
    if (file && !isolated && canStart) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, canStart]);

  if (!file) return null;

  if (!canStart && !isolated) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        <span className="truncate">Aguardando o isolamento do Áudio 1 terminar…</span>
      </div>
    );
  }

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

  if (status === "working") {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        <span className="truncate">{message || "Isolando voz…"}</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{message}</span>
          <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={run}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  return null;
}