import React, { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { AudioLines, Wand2, Loader2, Sparkles } from "lucide-react";
import UploadZone from "@/components/audio/UploadZone";
import ProcessingStatus from "@/components/audio/ProcessingStatus";
import ProcessingResult from "@/components/audio/ProcessingResult";
import { base44 } from "@/api/base44Client";

export default function Studio() {
  // 3 uploads: Versão 1 IA, Versão 2 IA, e Voz do Cliente
  const [fileRef1, setFileRef1] = useState(null);
  const [fileRef2, setFileRef2] = useState(null);
  const [fileClient, setFileClient] = useState(null);

  const [stage, setStage] = useState("upload"); // upload | processing | result
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  // Estado dos jobs para as duas versões
  const [jobs, setJobs] = useState({
    v1: { id: null, status: null, resultUrl: null, playbackUrl: null, error: null },
    v2: { id: null, status: null, resultUrl: null, playbackUrl: null, error: null },
  });

  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  // Polling dos jobs em andamento
  useEffect(() => {
    if (stage !== "processing") return;
    let alive = true;

    const poll = async () => {
      const current = jobsRef.current;
      const v1Active = !!current.v1.id && current.v1.status !== "completed" && current.v1.status !== "failed";
      const v2Active = !!current.v2.id && current.v2.status !== "completed" && current.v2.status !== "failed";

      if (!v1Active && !v2Active) {
        // Se ambos terminaram (ou um terminou e o outro não existia)
        const v1Done = !current.v1.id || current.v1.status === "completed";
        const v2Done = !current.v2.id || current.v2.status === "completed";
        if (v1Done && v2Done && (current.v1.resultUrl || current.v2.resultUrl)) {
          setStage("result");
          return;
        }
      }

      let updated = false;
      const next = { ...current };

      if (v1Active) {
        try {
          const j1 = await base44.entities.ProcessingJob.get(current.v1.id);
          if (alive && j1) {
            next.v1 = {
              ...next.v1,
              status: j1.status,
              resultUrl: j1.result_url || next.v1.resultUrl,
              playbackUrl: j1.playback_url || next.v1.playbackUrl,
              error: j1.error_message || next.v1.error,
            };
            updated = true;
          }
        } catch {}
      }

      if (v2Active) {
        try {
          const j2 = await base44.entities.ProcessingJob.get(current.v2.id);
          if (alive && j2) {
            next.v2 = {
              ...next.v2,
              status: j2.status,
              resultUrl: j2.result_url || next.v2.resultUrl,
              playbackUrl: j2.playback_url || next.v2.playbackUrl,
              error: j2.error_message || next.v2.error,
            };
            updated = true;
          }
        } catch {}
      }

      if (updated && alive) {
        setJobs(next);
        const v1Completed = !next.v1.id || next.v1.status === "completed";
        const v2Completed = !next.v2.id || next.v2.status === "completed";
        if (v1Completed && v2Completed && (next.v1.resultUrl || next.v2.resultUrl)) {
          setStage("result");
          return;
        }
      }

      if (alive) {
        setTimeout(poll, 3000);
      }
    };

    const timer = setTimeout(poll, 2000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [stage, jobs.v1.id, jobs.v2.id, jobs.v1.status, jobs.v2.status]);

  const startProcessing = async () => {
    if (!fileClient || (!fileRef1 && !fileRef2)) return;

    setStage("processing");
    setError(null);
    setUploading(true);

    try {
      // 1. Upload do arquivo da voz do cliente
      const clientUpload = await base44.integrations.Core.UploadPrivateFile({ file: fileClient });

      const newJobs = {
        v1: { id: null, status: null, resultUrl: null, playbackUrl: null, error: null },
        v2: { id: null, status: null, resultUrl: null, playbackUrl: null, error: null },
      };

      // 2. Se houver Áudio Referência 1: upload e início do Job 1
      if (fileRef1) {
        const ref1Upload = await base44.integrations.Core.UploadPrivateFile({ file: fileRef1 });
        const res1 = await base44.functions.invoke("startProcessing", {
          audio1_file_uri: ref1Upload.file_uri,
          audio2_file_uri: clientUpload.file_uri,
          audio1_name: fileRef1.name,
        });
        const data1 = res1.data || res1;
        newJobs.v1.id = data1.job_id;
        newJobs.v1.status = "pending";
      }

      // Pequeno intervalo entre disparos para respeitar concorrência da API
      if (fileRef1 && fileRef2) {
        await new Promise((r) => setTimeout(r, 1500));
      }

      // 3. Se houver Áudio Referência 2: upload e início do Job 2
      if (fileRef2) {
        const ref2Upload = await base44.integrations.Core.UploadPrivateFile({ file: fileRef2 });
        const res2 = await base44.functions.invoke("startProcessing", {
          audio1_file_uri: ref2Upload.file_uri,
          audio2_file_uri: clientUpload.file_uri,
          audio1_name: fileRef2.name,
        });
        const data2 = res2.data || res2;
        newJobs.v2.id = data2.job_id;
        newJobs.v2.status = "pending";
      }

      setJobs(newJobs);
    } catch (e) {
      setError(e.message || "Falha ao iniciar processamento.");
      setStage("upload");
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    setStage("upload");
    setFileRef1(null);
    setFileRef2(null);
    setFileClient(null);
    setJobs({
      v1: { id: null, status: null, resultUrl: null, playbackUrl: null, error: null },
      v2: { id: null, status: null, resultUrl: null, playbackUrl: null, error: null },
    });
    setError(null);
  };

  const hasBothRefs = !!(fileRef1 && fileRef2);
  const canStart = !!fileClient && !!(fileRef1 || fileRef2);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <AudioLines className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-heading text-base font-semibold leading-none">VocalSync Studio</h1>
              <p className="text-xs text-muted-foreground">Sincronização automática com referências IA e masterização</p>
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
          <ProcessingResult
            results={{
              v1: jobs.v1.resultUrl
                ? { resultUrl: jobs.v1.resultUrl, playbackUrl: jobs.v1.playbackUrl, sourceName: fileRef1?.name }
                : null,
              v2: jobs.v2.resultUrl
                ? { resultUrl: jobs.v2.resultUrl, playbackUrl: jobs.v2.playbackUrl, sourceName: fileRef2?.name }
                : null,
            }}
            onReset={reset}
          />
        ) : (
          <div className="space-y-6">
            <div>
              <h2 className="font-heading text-2xl font-semibold tracking-tight">
                Sincronize a voz do cliente com as referências da IA
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Envie a <strong>Versão 1 da IA</strong> e a <strong>Versão 2 da IA</strong> (música completa: voz + instrumental)
                e a <strong>Voz do Cliente</strong>. O mesmo processo de sincronização e mixagem será executado para cada versão,
                permitindo ouvir, aplicar a masterização Kits.ai e baixar os resultados finais.
              </p>
            </div>

            {/* Três botões de upload na tela inicial */}
            <div className="grid gap-4 sm:grid-cols-3">
              <UploadZone
                label="Áudio 1 — Versão 1 IA"
                hint="Voz + Instrumental (IA Suno Versão 1)"
                file={fileRef1}
                onFile={setFileRef1}
              />
              <UploadZone
                label="Áudio 2 — Versão 2 IA"
                hint="Voz + Instrumental (IA Suno Versão 2)"
                file={fileRef2}
                onFile={setFileRef2}
              />
              <UploadZone
                label="Áudio 3 — Voz do Cliente"
                hint="Gravação da voz isolada para sincronizar"
                file={fileClient}
                onFile={setFileClient}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {/* Visualização de status durante o processamento */}
            {stage === "processing" ? (
              <div className="space-y-4">
                {jobs.v1.id && (
                  <div className="rounded-2xl border bg-card p-5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                        Versão 1 IA · Processamento
                      </span>
                      <span className="text-xs text-muted-foreground">{fileRef1?.name}</span>
                    </div>
                    <ProcessingStatus status={jobs.v1.status} error={jobs.v1.error} />
                  </div>
                )}
                {jobs.v2.id && (
                  <div className="rounded-2xl border bg-card p-5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                        Versão 2 IA · Processamento
                      </span>
                      <span className="text-xs text-muted-foreground">{fileRef2?.name}</span>
                    </div>
                    <ProcessingStatus status={jobs.v2.status} error={jobs.v2.error} />
                  </div>
                )}
              </div>
            ) : (
              <Button
                size="lg"
                onClick={startProcessing}
                disabled={!canStart || uploading}
                className="h-14 w-full text-base font-semibold shadow-sm"
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <Wand2 className="mr-2 h-5 w-5" />
                )}
                {uploading
                  ? "Enviando arquivos e iniciando pipeline…"
                  : hasBothRefs
                  ? "Processar e Sincronizar Versões 1 e 2"
                  : "Processar e Sincronizar Áudio"}
              </Button>
            )}

            {/* Informações sobre o fluxo */}
            <div className="rounded-2xl border bg-card p-5">
              <h3 className="mb-2 text-sm font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Como funciona o fluxo de sincronização e masterização
              </h3>
              <ol className="grid gap-2 sm:grid-cols-4 text-xs text-muted-foreground pt-1">
                <li className="rounded-lg border bg-background/50 p-3">
                  <strong className="block text-foreground mb-1">1. Isolamento Vocal</strong>
                  O servidor isola a voz da referência e a voz do cliente via Kits.ai.
                </li>
                <li className="rounded-lg border bg-background/50 p-3">
                  <strong className="block text-foreground mb-1">2. Sincronização e Mix</strong>
                  A voz do cliente é alinhada com precisão à métrica da IA e mixada com o instrumental.
                </li>
                <li className="rounded-lg border bg-background/50 p-3">
                  <strong className="block text-foreground mb-1">3. Masterização Kits.ai</strong>
                  Envie para o Kits.ai com o preset "Analog Warmth"; o volume é atenuado em 20%.
                </li>
                <li className="rounded-lg border bg-background/50 p-3">
                  <strong className="block text-foreground mb-1">4. Download e Prévia</strong>
                  Baixe a música na voz do cliente ou dispare a prévia no WhatsApp com um clique.
                </li>
              </ol>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
