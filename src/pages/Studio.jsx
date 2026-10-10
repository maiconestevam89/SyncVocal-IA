import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AudioLines, Sparkles, Clock, Wand2 } from "lucide-react";
import UploadZone from "@/components/audio/UploadZone";
import WaveformPlayer from "@/components/audio/WaveformPlayer";
import EffectControls from "@/components/audio/EffectControls";
import ProcessingOverlay from "@/components/audio/ProcessingOverlay";
import MixEditor from "@/components/audio/MixEditor";
import VocalIsolator from "@/components/audio/VocalIsolator";
import ManualRepair from "@/components/audio/ManualRepair";
import { decodeAudioFile, renderMix } from "@/lib/audioEngine";
import { alignVocal } from "@/lib/align";

const DEFAULT_SETTINGS = {
  tempoRatio: 1,
  offsetSec: 0,
  autoAlign: true,
  autoSync: true,
  preservePitch: true,
  mix: { reference: 0.7, vocal: 1 },
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
  const [isolatedBuffer1, setIsolatedBuffer1] = useState(null);
  const [instrumentalBuffer1, setInstrumentalBuffer1] = useState(null);
  const [isolatedBuffer2, setIsolatedBuffer2] = useState(null);
  const [repairedBuffer2, setRepairedBuffer2] = useState(null);
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

  // Reset the isolated vocal whenever the uploaded file changes.
  useEffect(() => {
    setIsolatedBuffer1(null);
    setInstrumentalBuffer1(null);
  }, [file1]);

  useEffect(() => {
    setIsolatedBuffer2(null);
    setRepairedBuffer2(null);
  }, [file2]);

  // Reset the repaired vocal whenever the isolated vocal changes.
  useEffect(() => {
    setRepairedBuffer2(null);
  }, [isolatedBuffer2]);

  const autoSync = () => {
    const vocal = repairedBuffer2 || isolatedBuffer2 || buffer2;
    const reference = isolatedBuffer1 || buffer1;
    if (!reference || !vocal) return;
    const ratio = vocal.duration / reference.duration;
    const clamped = Math.max(0.5, Math.min(2, ratio));
    setSettings((s) => ({ ...s, tempoRatio: clamped, autoSync: false }));
  };

  const process = async () => {
    const vocal = repairedBuffer2 || isolatedBuffer2 || buffer2;
    // Use the isolated vocal from Audio 1 as the sync reference; fall back
    // to the raw Audio 1 if isolation hasn't completed (user may have uploaded
    // an already-isolated vocal).
    const reference = isolatedBuffer1 || buffer1;
    if (!reference || !vocal) return;
    setError(null);
    setStage("processing");
    try {
      setActiveStep("decode");
      await new Promise((r) => setTimeout(r, 500));

      setActiveStep("sync");
      const aligned = await alignVocal(reference, vocal, settings);
      setActiveStep("effects");
      await new Promise((r) => setTimeout(r, 400));
      setActiveStep("render");
      // renderMix outputs ONLY the aligned vocal; the instrumental is mixed
      // later in the MixEditor. We never pass buffer1 (full Audio 1) as the
      // instrumental, because that would leak the original voice into the
      // result. If isolation hasn't finished, we still render the vocal —
      // the MixEditor will add whatever instrumental is available.
      const rendered = await renderMix(reference, aligned.buffer, settings, {
        ...aligned,
        instrumentalBuffer: null,
      });
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
    setIsolatedBuffer1(null);
    setInstrumentalBuffer1(null);
    setIsolatedBuffer2(null);
    setRepairedBuffer2(null);
  };

  // Ready when the isolated reference AND the real instrumental are available
  // (both come from isolating Audio 1), plus a vocal to sync.
  const ready = isolatedBuffer1 && instrumentalBuffer1 && (buffer2 || isolatedBuffer2) && stage === "upload";

  // The vocal that's currently "active" for preview / processing.
  const activeVocal2 = repairedBuffer2 || isolatedBuffer2 || buffer2;

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
          <MixEditor
            initialBuffer={rendered}
            initialLabel="Voz sincronizada"
            instrumentalBuffer={instrumentalBuffer1 || buffer1}
          />
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
            {/* Left: upload + preview */}
            <div className="space-y-6">
              <div>
                <h2 className="font-heading text-2xl font-semibold tracking-tight">
                  Sincronize seu vocal com uma referência de IA
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Envie a faixa completa (voz + instrumental) no Áudio 1 e a sua voz humana no
                  Áudio 2. O kits.ai isola automaticamente a voz de ambos — a voz isolada do
                  Áudio 1 vira a referência de sincronização. O resultado final junta a sua
                  voz sincronizada com o instrumental original do Áudio 1 em um único áudio.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <UploadZone
                  label="Áudio 1 — Voz + Instrumental"
                  hint="Arraste ou clique · MP3, WAV, M4A, OGG"
                  file={file1}
                  onFile={setFile1}
                />
                <UploadZone
                  label="Áudio 2 — Voz cliente"
                  hint="Arraste ou clique · MP3, WAV, M4A, OGG"
                  file={file2}
                  onFile={setFile2}
                />
              </div>

              {file1 && (
                <div className="space-y-3">
                  <VocalIsolator
                    file={file1}
                    isolated={isolatedBuffer1}
                    onIsolated={setIsolatedBuffer1}
                    onInstrumental={setInstrumentalBuffer1}
                    withInstrumental
                  />
                </div>
              )}
              {buffer1 && (
                <div className="rounded-2xl border bg-card p-5">
                  <WaveformPlayer
                    buffer={isolatedBuffer1 || buffer1}
                    label={isolatedBuffer1 ? "Voz isolada do Áudio 1 (referência)" : "Áudio 1 (aguardando isolamento)"}
                  />
                </div>
              )}
              {file2 && (
                <div className="space-y-3">
                  <VocalIsolator
                    file={file2}
                    isolated={isolatedBuffer2}
                    onIsolated={setIsolatedBuffer2}
                  />
                  {isolatedBuffer2 && (
                    <ManualRepair
                      buffer={isolatedBuffer2}
                      repaired={repairedBuffer2}
                      onRepaired={setRepairedBuffer2}
                    />
                  )}
                </div>
              )}
              {buffer2 && (
                <div className="rounded-2xl border bg-card p-5">
                  <WaveformPlayer
                    buffer={activeVocal2}
                    label={
                      repairedBuffer2
                        ? "Vocal reparado"
                        : isolatedBuffer2
                        ? "Vocal isolado"
                        : "Vocal"
                    }
                    accent
                  />
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
                  title="Igualar a duração da voz à referência"
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