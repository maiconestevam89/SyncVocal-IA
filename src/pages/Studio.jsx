import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AudioLines, Wand2, Loader2 } from "lucide-react";
import UploadZone from "@/components/audio/UploadZone";
import ProcessingStatus from "@/components/audio/ProcessingStatus";
import ProcessingResult from "@/components/audio/ProcessingResult";
import { base44 } from "@/api/base44Client";

export default function Studio() {
  const [file1, setFile1] = useState(null);
  const [file2, setFile2] = useState(null);
  const [stage, setStage] = useState("upload"); // upload | processing | result
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [resultUrl, setResultUrl] = useState(null);
  const [playbackUrl, setPlaybackUrl] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  // Poll job status while processing
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const poll = async () => {
      try {
        const job = await base44.entities.ProcessingJob.get(jobId);
        if (!alive) return;
        setJobStatus(job.status);
        if (job.status === "completed") {
          setResultUrl(job.result_url);
          setPlaybackUrl(job.playback_url);
          setStage("result");
          return;
        }
        if (job.status === "failed") {
          setError(job.error_message || "Falha no processamento.");
          setStage("upload");
          return;
        }
        setTimeout(poll, 3000);
      } catch {
        if (alive) setTimeout(poll, 5000);
      }
    };
    poll();
    return () => { alive = false; };
  }, [jobId]);

  const startProcessing = async () => {
    if (!file1 || !file2) return;
    setStage("processing");
    setError(null);
    setUploading(true);
    try {
      // Upload both files to private storage (stored privately)
      const [r1, r2] = await Promise.all([
        base44.integrations.Core.UploadPrivateFile({ file: file1 }),
        base44.integrations.Core.UploadPrivateFile({ file: file2 }),
      ]);

      // Start the server-side processing pipeline (triggers the workflow)
      const res = await base44.functions.invoke("startProcessing", {
        audio1_file_uri: r1.file_uri,
        audio2_file_uri: r2.file_uri,
        audio1_name: file1.name,
      });
      const data = res.data || res;
      setJobId(data.job_id);
    } catch (e) {
      setError(e.message || "Falha ao iniciar processamento.");
      setStage("upload");
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    setStage("upload");
    setFile1(null);
    setFile2(null);
    setJobId(null);
    setJobStatus(null);
    setResultUrl(null);
    setPlaybackUrl(null);
    setError(null);
  };

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
              <p className="text-xs text-muted-foreground">Sincronização automática de vocais</p>
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
          <ProcessingResult resultUrl={resultUrl} playbackUrl={playbackUrl} sourceName={file1?.name} onReset={reset} />
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
            <div className="space-y-6">
              <div>
                <h2 className="font-heading text-2xl font-semibold tracking-tight">
                  Sincronize seu vocal com uma referência
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Envie a faixa completa (voz + instrumental) no Áudio 1 e a sua voz no
                  Áudio 2. O processamento é 100% automático e acontece no servidor:
                  isolamento, sincronização e mixagem. Você poderá ouvir o resultado,
                  baixar a música na voz do cliente e enviar a prévia no WhatsApp quando desejar.
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

              {error && <p className="text-sm text-destructive">{error}</p>}

              {stage === "processing" && jobId ? (
                <div className="rounded-2xl border bg-card p-5">
                  <ProcessingStatus status={jobStatus} error={error} />
                </div>
              ) : (
                <Button
                  size="lg"
                  onClick={startProcessing}
                  disabled={!file1 || !file2 || uploading}
                  className="h-14 w-full text-base"
                >
                  {uploading ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <Wand2 className="mr-2 h-5 w-5" />
                  )}
                  {uploading ? "Enviando arquivos…" : "Processar e Sincronizar Áudio"}
                </Button>
              )}
            </div>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-2xl border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold">Como funciona</h3>
                <ol className="space-y-2 text-xs text-muted-foreground">
                  <li>1. Envie os dois áudios e clique em Processar.</li>
                  <li>2. O kits.ai isola as vozes de ambos os áudios.</li>
                  <li>3. O servidor alinha a sua voz à referência e mixa com o instrumental.</li>
                  <li>4. O resultado fica disponível para ouvir e baixar.</li>
                  <li>5. Você pode enviar a prévia no WhatsApp com um clique.</li>
                </ol>
                <p className="mt-3 text-xs text-muted-foreground">
                  O processamento acontece no servidor. Você pode fechar esta página
                  que o fluxo continua rodando e a prévia será enviada automaticamente.
                </p>
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}