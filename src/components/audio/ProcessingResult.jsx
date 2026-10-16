import React, { useEffect, useState } from "react";
import { Download, Loader2, RotateCcw, Send, Check, AlertCircle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import WaveformPlayer from "@/components/audio/WaveformPlayer";
import { decodeAudioFile } from "@/lib/decodeAudio";
import { audioBufferToWavBlob } from "@/lib/wavEncoder";
import { audioBufferToMp3Blob } from "@/lib/mp3Encoder";
import { base44 } from "@/api/base44Client";

const PREVIEW_SECONDS = 70;

// Cria um AudioBuffer com os primeiros 70 segundos (1min10s) do mix final.
function buildPreviewBuffer(source) {
  const channels = source.numberOfChannels;
  const sampleRate = source.sampleRate;
  const maxLen = source.length;
  const targetLen = Math.min(maxLen, Math.floor(PREVIEW_SECONDS * sampleRate));
  if (targetLen >= maxLen) return source;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const out = ctx.createBuffer(channels, targetLen, sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const data = source.getChannelData(ch).subarray(0, targetLen);
    out.copyToChannel(data, ch, 0);
  }
  ctx.close();
  return out;
}

export default function ProcessingResult({ resultUrl, playbackUrl, sourceName, onReset }) {
  const [buffer, setBuffer] = useState(null);
  const [playbackBuffer, setPlaybackBuffer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  // Estado do envio da prévia via Umbler / WhatsApp
  const [sendState, setSendState] = useState("idle"); // idle | sending | success | error
  const [sendResult, setSendResult] = useState(null);
  const [sendLogs, setSendLogs] = useState(null);

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

  // Load playback (instrumental) lazily on first request
  const loadPlayback = async () => {
    if (playbackBuffer || !playbackUrl) return;
    try {
      const res = await fetch(playbackUrl);
      const blob = await res.blob();
      const buf = await decodeAudioFile(new File([blob], "playback.wav", { type: "audio/wav" }));
      setPlaybackBuffer(buf);
    } catch (e) {
      setError(e.message);
    }
  };

  const downloadBlob = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
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
      } else if (format === "mp3") {
        blob = await audioBufferToMp3Blob(buffer, 192);
        name = `${baseName}.mp3`;
      } else if (format === "playback-wav") {
        if (!playbackBuffer) await loadPlayback();
        if (!playbackBuffer) return;
        blob = audioBufferToWavBlob(playbackBuffer);
        name = `${baseName}_playback.wav`;
      } else if (format === "playback-mp3") {
        if (!playbackBuffer) await loadPlayback();
        if (!playbackBuffer) return;
        blob = await audioBufferToMp3Blob(playbackBuffer, 192);
        name = `${baseName}_playback.mp3`;
      }
      downloadBlob(blob, name);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const handleSendPreview = async () => {
    if (!buffer) return;
    setSendState("sending");
    setSendResult(null);
    setSendLogs(null);
    let step = "preparo";
    try {
      step = "codificação MP3 da prévia";
      const preview = buildPreviewBuffer(buffer);
      const blob = await audioBufferToMp3Blob(preview, 192);
      const file = new File([blob], "preview.mp3", { type: "audio/mpeg" });

      step = "upload da prévia";
      const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
      const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({ file_uri });

      step = "disparo no WhatsApp (Umbler Talk)";
      const res = await base44.functions.invoke("sendUmblerPreview", {
        file_url: signed_url,
        audio1_name: sourceName || "",
      });

      const data = res.data || res;
      setSendLogs(data.logs || null);

      if (data.success) {
        setSendState("success");
        setSendResult(data.status || "Prévia enviada com sucesso no WhatsApp!");
      } else {
        setSendState("error");
        setSendResult(data.error || "Falha no envio da prévia.");
      }
    } catch (e) {
      setSendState("error");
      const d = e?.response?.data ?? e?.data;
      const detail = d?.error?.message || d?.error || (typeof d?.message === "string" ? d.message : null) || d?.detail || e?.message || "Erro inesperado.";
      setSendResult(`Etapa "${step}": ${detail}`);
      setSendLogs(e?.response?.data?.logs || { step, status: e?.status, message: e?.message });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando áudio final…
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">Resultado final</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sua voz sincronizada com o instrumental. Ouça o resultado, baixe a música ou envie a prévia quando desejar.
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

      {/* Painel de ações principais */}
      <div className="rounded-2xl border bg-card p-5 space-y-4 shadow-sm">
        <div>
          <h3 className="text-base font-semibold">Ações da Música</h3>
          <p className="text-xs text-muted-foreground">
            Baixe o arquivo final nos formatos desejados ou faça o envio manual da prévia para o WhatsApp do cliente.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Botão Baixar Música (Voz do Cliente) com opções WAV e MP3 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="lg"
                variant="default"
                disabled={!buffer || !!busy}
                className="h-12 w-full text-sm font-semibold tracking-wide"
              >
                {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
                Baixar Música (Voz do Cliente)
                <ChevronDown className="ml-2 h-4 w-4 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuItem onClick={() => doExport("wav")} className="cursor-pointer py-2.5">
                <Download className="mr-2 h-4 w-4 text-primary" />
                <div className="flex flex-col">
                  <span className="font-medium">Baixar em WAV (.wav)</span>
                  <span className="text-xs text-muted-foreground">Áudio sem compressão (estúdio)</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("mp3")} className="cursor-pointer py-2.5">
                <Download className="mr-2 h-4 w-4 text-primary" />
                <div className="flex flex-col">
                  <span className="font-medium">Baixar em MP3 (.mp3)</span>
                  <span className="text-xs text-muted-foreground">Alta fidelidade a 192 kbps</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Botão Enviar Prévia (chama Umbler Talk / WhatsApp somente ao ser clicado) */}
          <Button
            size="lg"
            variant="outline"
            onClick={handleSendPreview}
            disabled={!buffer || sendState === "sending"}
            className="h-12 w-full text-sm font-semibold tracking-wide border-primary/40 hover:bg-primary/5"
          >
            {sendState === "sending" ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" />
                Enviando prévia no WhatsApp…
              </>
            ) : (
              <>
                <Send className="mr-2 h-5 w-5 text-primary" />
                Enviar Prévia
              </>
            )}
          </Button>
        </div>

        {/* Feedback visual do disparo da prévia */}
        {sendState === "sending" && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>Processando prévia de 1min10s e disparando bot no Umbler Talk…</span>
          </div>
        )}

        {sendState === "success" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
              <span className="flex-1 font-medium">{sendResult}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleSendPreview} className="text-xs text-muted-foreground">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reenviar Prévia
            </Button>
          </div>
        )}

        {sendState === "error" && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{sendResult}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleSendPreview} className="w-full text-xs">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Tentar Novamente
            </Button>
          </div>
        )}

        {sendLogs && (
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Detalhes do Envio</p>
            <pre className="overflow-x-auto text-[11px] text-muted-foreground whitespace-pre-wrap">
              {JSON.stringify(sendLogs, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Playback (instrumental) isolado opcional */}
      {playbackUrl && (
        <div className="space-y-2 pt-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Playback (somente instrumental)</h3>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button size="lg" variant="outline" onClick={() => doExport("playback-wav")} disabled={!!busy} className="h-11 flex-1 text-xs">
              {busy === "playback-wav" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Baixar Playback WAV
            </Button>
            <Button size="lg" variant="outline" onClick={() => doExport("playback-mp3")} disabled={!!busy} className="h-11 flex-1 text-xs">
              {busy === "playback-mp3" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Baixar Playback MP3
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
