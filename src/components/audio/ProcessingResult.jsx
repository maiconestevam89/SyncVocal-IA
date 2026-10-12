import React, { useEffect, useState } from "react";
import { Download, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import WaveformPlayer from "@/components/audio/WaveformPlayer";
import { decodeAudioFile } from "@/lib/decodeAudio";
import { audioBufferToWavBlob } from "@/lib/wavEncoder";
import { audioBufferToMp3Blob } from "@/lib/mp3Encoder";

export default function ProcessingResult({ resultUrl, sourceName, onReset }) {
  const [buffer, setBuffer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!resultUrl) return;
    let alive = true;
    setLoading(true);
    fetch(resultUrl)
      .then((res) => res.blob())
      .then((blob) => decodeAudioFile(new File([blob], "result.wav", { type: "audio/wav" })))
      .then((buf) => { if (alive) setBuffer(buf); })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [resultUrl]);

  const downloadBlob = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const baseName = (sourceName || "syncvocal").replace(/\.[^.]+$/, "");

  const doExport = async (format) => {
    if (!buffer) return;
    setBusy(format);
    try {
      let blob, name;
      if (format === "wav") {
        blob = audioBufferToWavBlob(buffer);
        name = `${baseName}.wav`;
      } else {
        blob = await audioBufferToMp3Blob(buffer, 192);
        name = `${baseName}.mp3`;
      }
      downloadBlob(blob, name);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando resultado…
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">Resultado final</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sua voz sincronizada com o instrumental. A prévia já foi enviada
            automaticamente no WhatsApp do cliente.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onReset}>
          <RotateCcw className="mr-1 h-4 w-4" /> Novo projeto
        </Button>
      </div>

      {buffer && (
        <div className="rounded-2xl border bg-card p-5">
          <WaveformPlayer buffer={buffer} label="Voz sincronizada + instrumental" accent />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button size="lg" variant="outline" onClick={() => doExport("wav")} disabled={!!busy} className="h-12 flex-1">
          {busy === "wav" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
          Baixar WAV
        </Button>
        <Button size="lg" onClick={() => doExport("mp3")} disabled={!!busy} className="h-12 flex-1">
          {busy === "mp3" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
          Baixar MP3
        </Button>
      </div>
    </div>
  );
}