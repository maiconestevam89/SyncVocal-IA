import React, { useRef, useState } from "react";
import { Download, ExternalLink, Check, Info, Upload, FileAudio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { audioBufferToWavBlob } from "@/lib/wavEncoder";
import { decodeAudioFile } from "@/lib/audioEngine";

// Manual AI Vocal Repair flow: download the isolated vocal, open the Kits.ai
// web repair tool, then upload the repaired file back. The repaired AudioBuffer
// is returned to the parent via onRepaired, feeding the existing sync workflow.
const KITS_REPAIR_URL = "https://app.kits.ai/ai-vocal-repair";

const fmtSize = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export default function ManualRepair({ buffer, onRepaired, repaired }) {
  const inputRef = useRef(null);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [dragging, setDragging] = useState(false);

  const downloadIsolated = () => {
    const blob = audioBufferToWavBlob(buffer);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vocal-isolado.wav";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleRepairedFile = async (file) => {
    if (!file) return;
    setError("");
    try {
      const decoded = await decodeAudioFile(file);
      setFileName(file.name);
      setFileSize(file.size);
      onRepaired(decoded);
    } catch {
      setError("Não foi possível ler o vocal reparado. Tente um WAV ou MP3.");
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleRepairedFile(f);
  };

  if (!buffer) return null;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            A API do kits.ai não expõe o reparo vocal — faça manualmente: baixe o
            vocal isolado, repare no kits.ai e envie o arquivo de volta.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={downloadIsolated}
        >
          <Download className="mr-1.5 h-4 w-4" />
          Baixar vocal isolado
        </Button>
        <Button
          asChild
          variant="default"
          size="sm"
          className="flex-1"
        >
          <a href={KITS_REPAIR_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-1.5 h-4 w-4" />
            Reparar no kits.ai
          </a>
        </Button>
      </div>

      {repaired ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <Check className="h-4 w-4 shrink-0" />
          <span className="truncate">
            Vocal reparado carregado{fileName ? `: ${fileName}` : "."}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            onClick={() => inputRef.current?.click()}
          >
            Trocar
          </Button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/40"}`}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Upload className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-medium">Enviar vocal reparado</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Arraste ou clique · MP3, WAV, M4A, OGG
            </p>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleRepairedFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}