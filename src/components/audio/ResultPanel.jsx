import React, { useState } from "react";
import { Download, RotateCcw, FileAudio, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import WaveformPlayer from "@/components/audio/WaveformPlayer";
import { audioBufferToWavBlob } from "@/lib/wavEncoder";
import { audioBufferToMp3Blob } from "@/lib/mp3Encoder";

export default function ResultPanel({ renderedBuffer, onReset }) {
  const [busy, setBusy] = useState(null);

  const download = async (format) => {
    setBusy(format);
    try {
      let blob;
      let name;
      if (format === "wav") {
        blob = audioBufferToWavBlob(renderedBuffer);
        name = "vocal-sincronizado.wav";
      } else {
        blob = await audioBufferToMp3Blob(renderedBuffer, 192);
        name = "vocal-sincronizado.mp3";
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 rounded-xl border bg-emerald-50 p-4 text-emerald-700">
        <FileAudio className="h-5 w-5" />
        <p className="text-sm font-medium">Faixa final pronta para download</p>
      </div>

      <div className="rounded-2xl border bg-card p-5">
        <WaveformPlayer buffer={renderedBuffer} label="Resultado sincronizado" accent />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Button
          size="lg"
          variant="outline"
          onClick={() => download("wav")}
          disabled={!!busy}
          className="h-14 text-base"
        >
          {busy === "wav" ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <Download className="mr-2 h-5 w-5" />
          )}
          Baixar WAV
          <span className="ml-1 text-xs text-muted-foreground">alta qualidade</span>
        </Button>
        <Button
          size="lg"
          onClick={() => download("mp3")}
          disabled={!!busy}
          className="h-14 text-base"
        >
          {busy === "mp3" ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <Download className="mr-2 h-5 w-5" />
          )}
          Baixar MP3
          <span className="ml-1 text-xs opacity-80">leve</span>
        </Button>
      </div>

      <Button variant="ghost" onClick={onReset} className="w-full">
        <RotateCcw className="mr-2 h-4 w-4" />
        Enviar novos arquivos
      </Button>
    </div>
  );
}