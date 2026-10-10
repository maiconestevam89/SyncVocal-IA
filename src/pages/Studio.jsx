import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AudioLines, Sparkles, Clock, Wand2 } from "lucide-react";
import UploadZone from "@/components/audio/UploadZone";
import WaveformPlayer from "@/components/audio/WaveformPlayer";
import EffectControls from "@/components/audio/EffectControls";
import ProcessingOverlay from "@/components/audio/ProcessingOverlay";
import ResultPanel from "@/components/audio/ResultPanel";
import { decodeAudioFile, renderMix } from "@/lib/audioEngine";
import { alignVocal } from "@/lib/align";

const DEFAULT_SETTINGS = {
  tempoRatio: 1,
  offsetSec: 0,
  autoAlign: true,
  autoSync: true,
  preservePitch: true,
  mix: { reference: 0, vocal: 1 },
  eq: { low: 0, mid: 0, high: 0, lowFreq: 220, midFreq: 1200, highFreq: 4500 },
  reverb: { amount: 0, duration: 2, decay: 2 },
  delay: { time: 0.25, feedback: 0.3, amount: 0 },
  compressor: { threshold: -24, knee: 30, ratio: 4, attack: 0.003, release: 0.25 },
};

export default function Studio() {
  const [file1, setFile1] = useState(null);
  const [file2, setFile2] = useState(null);
  const [buffer1, setBuffer1] = useState(null);
  const [buffer2, setBuffer2] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [stage, setStage] = useState("upload"); // upload | processing | result
  const [activeStep, setActiveStep] = useState(null);
  const [rendered, setRendered] = useState(null);
  const [error, setError] = useState(null);

  // Decode files as they arrive.
  useEffect(() => {
    if (!file1) return setBuffer1(null);
    let alive = true;
    decodeAudioFile(file1)
      .then((b) => alive && setBuffer1(b))
      .catch(() => alive && setError("Não foi possível ler o Áudio 1."));
    return () => {
      alive = false;
    };
  }, [file1]);

  useEffect(() => {
    if (!file2) return setBuffer2(null);
    let alive = true;
    decodeAudioFile(file2)
      .then((b) => alive && setBuffer2(b))
      .catch(() => alive && setError("Não foi possível ler o Áudio 2."));
    return () => {
      alive = false;
    };
  }, [file2]);

  const autoSync = () => {
    if (!buffer1 || !buffer2) return;
    const ratio = buffer2.duration / buffer1.duration;
    const clamped = Math.max(0.5, Math.min(2, ratio));
    setSettings((s) => ({ ...s, tempoRatio: clamped, autoSync: false }));
  };

  const process = async () => {
    if (!buffer1 || !buffer2) return;
    setError(null);
    setStage("processing");
    try {
      setActiveStep("decode");
      await new Promise((r) => setTimeout(r, 500));

      setActiveStep("sync");
      const aligned = await alignVocal(buffer1, buffer2, settings);
      setActiveStep("effects");
      await new Promise((r) => setTimeout(r, 400));
      setActiveStep("render");
      const rendered = await renderMix(buffer1, aligned.buffer, settings, aligned);
      setRendered(rendered);
      setStage("result");
    } catch (e) {
      setError(`Falha ao processar o áudio: ${e.message}`);
      setStage("upload");
    } finally {
      setActiveStep(null);
    }
  };

  const reset = () => {
    setStage("upload");
    setRendered(null);
    setSettings(DEFAULT_SETTINGS);
  };

  const ready = buffer1 && buffer2 && stage === "upload";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <AudioLines className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-heading text-base font-semibold leading-none">VocalSync Studio</h1>
              <p className="text-xs text-muted-foreground">Alinhamento e processamento de áudio</p>
            </div>
          </div>
          {stage === "result" && (
            <Button variant="ghost" size="sm" onClick={reset}>
              Novo projeto
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {stage === "result" ? (
          <ResultPanel renderedBuffer={rendered} onReset={reset} />
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
            {/* Left: upload + preview */}
            <div className="space-y-6">
              <div>
                <h2 className="font-heading text-2xl font-semibold tracking-tight">
                  Sincronize seu vocal com uma referência de IA
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Envie a voz da IA e a sua voz, ambas já isoladas. Sua voz passa a seguir o
                  andamento, os silêncios e a duração do Áudio 1. Tudo é processado no seu
                  navegador, sem custo de API.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <UploadZone
                  label="Áudio 1 — Voz da IA (isolada)"
                  hint="Arraste ou clique · MP3, WAV, M4A, OGG"
                  file={file1}
                  onFile={setFile1}
                />
                <UploadZone
                  label="Áudio 2 — Voz humana (isolada)"
                  hint="Arraste ou clique · MP3, WAV, M4A, OGG"
                  file={file2}
                  onFile={setFile2}
                />
              </div>

              {buffer1 && (
                <div className="rounded-2xl border bg-card p-5">
                  <WaveformPlayer buffer={buffer1} label="Referência" />
                </div>
              )}
              {buffer2 && (
                <div className="rounded-2xl border bg-card p-5">
                  <WaveformPlayer buffer={buffer2} label="Vocal" accent />
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  size="lg"
                  onClick={process}
                  disabled={!ready}
                  className="h-14 flex-1 text-base"
                >
                  <Wand2 className="mr-2 h-5 w-5" />
                  Processar e Sincronizar Áudio
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={autoSync}
                  disabled={!buffer1 || !buffer2}
                  className="h-14"
                >
                  <Clock className="mr-2 h-5 w-5" />
                  Sincronizar duração
                </Button>
              </div>
            </div>

            {/* Right: controls */}
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-2xl border bg-card p-5">
                <div className="mb-5 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Controles de processamento</h3>
                </div>
                <EffectControls settings={settings} onChange={setSettings} />
              </div>
            </aside>
          </div>
        )}
      </main>

      {stage === "processing" && <ProcessingOverlay activeStep={activeStep} />}
    </div>
  );
}