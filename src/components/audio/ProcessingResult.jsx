import React, { useEffect, useState } from "react";
import {
  Download,
  Loader2,
  RotateCcw,
  Send,
  Check,
  AlertCircle,
  ChevronDown,
  Sparkles,
  ExternalLink,
  UploadCloud,
  CheckCircle2,
  Volume2,
} from "lucide-react";
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

// Cria um AudioBuffer com os primeiros 70 segundos (1min10s) do mix.
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

// Aplica atenuação de 20% no volume (-1.94 dB, ganho 0.80)
function applyVolumeReduction(buffer, factor = 0.80) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[i] * factor;
    }
  }
  ctx.close();
  return out;
}

// Emulação analógica direta "Analog Warmth" (-20% vol)
function applyLocalAnalogWarmth(buffer) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

  // Saturação suave (soft clipping tangente hiperbólica) com ganho 0.80 (-20%)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < src.length; i++) {
      const sample = src[i];
      // Leve calor harmônico + teto dinâmico
      const saturated = Math.tanh(sample * 1.15) / 1.15;
      // Reduz em 20% (fator 0.80)
      dst[i] = saturated * 0.80;
    }
  }
  ctx.close();
  return out;
}

// Componente para uma versão individual (com player, masterização kits.ai e ações)
function VersionCard({ versionData, versionLabel, onReset }) {
  const { resultUrl, playbackUrl, sourceName } = versionData;

  const [rawBuffer, setRawBuffer] = useState(null);
  const [masteredBuffer, setMasteredBuffer] = useState(null);
  const [playbackBuffer, setPlaybackBuffer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  // Estado do envio da prévia via Umbler / WhatsApp
  const [sendState, setSendState] = useState("idle");
  const [sendResult, setSendResult] = useState(null);
  const [sendLogs, setSendLogs] = useState(null);

  // Estado da masterização Kits.ai
  const [masteringUploading, setMasteringUploading] = useState(false);
  const [masteringSuccess, setMasteringSuccess] = useState(false);

  // Áudio ativo: prioriza a versão masterizada (já atenuada em -20%) se existir
  const activeBuffer = masteredBuffer || rawBuffer;

  useEffect(() => {
    if (!resultUrl) return;
    let alive = true;
    setLoading(true);
    fetch(resultUrl)
      .then((res) => res.blob())
      .then((blob) => decodeAudioFile(new File([blob], "result.wav", { type: "audio/wav" })))
      .then((buf) => { if (alive) setRawBuffer(buf); })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [resultUrl]);

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

  // Baixar mix atual para enviar ao Kits.ai AI Mastering
  const downloadForMastering = () => {
    if (!rawBuffer) return;
    const blob = audioBufferToWavBlob(rawBuffer);
    downloadBlob(blob, `${baseName}_para_masterizar.wav`);
  };

  // Upload do áudio masterizado retornado do Kits.ai
  const handleMasteredFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMasteringUploading(true);
    setError(null);
    try {
      const decoded = await decodeAudioFile(file);
      // Reduz o volume do áudio em 20% (-1.94 dB, ganho 0.80)
      const reduced = applyVolumeReduction(decoded, 0.80);
      setMasteredBuffer(reduced);
      setMasteringSuccess(true);
    } catch (err) {
      setError("Falha ao processar arquivo masterizado: " + err.message);
    } finally {
      setMasteringUploading(false);
      e.target.value = "";
    }
  };

  // Aplicação direta local do preset Analog Warmth (-20% vol)
  const handleApplyLocalWarmth = () => {
    if (!rawBuffer) return;
    const warmed = applyLocalAnalogWarmth(rawBuffer);
    setMasteredBuffer(warmed);
    setMasteringSuccess(true);
  };

  const handleResetMastering = () => {
    setMasteredBuffer(null);
    setMasteringSuccess(false);
  };

  const doExport = async (format) => {
    if (!activeBuffer) return;
    setBusy(format);
    try {
      let blob, name;
      const prefix = masteredBuffer ? `${baseName}_mastered_warmth` : baseName;
      if (format === "wav") {
        blob = audioBufferToWavBlob(activeBuffer);
        name = `${prefix}.wav`;
      } else if (format === "mp3") {
        blob = await audioBufferToMp3Blob(activeBuffer, 192);
        name = `${prefix}.mp3`;
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
    if (!activeBuffer) return;
    setSendState("sending");
    setSendResult(null);
    setSendLogs(null);
    let step = "preparo";
    try {
      step = "codificação MP3 da prévia";
      const preview = buildPreviewBuffer(activeBuffer);
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
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Carregando áudio da {versionLabel}…
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Player da versão */}
      {activeBuffer && (
        <div className="rounded-2xl border bg-card p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {versionLabel} · {masteredBuffer ? "Masterizado (Analog Warmth, -20% vol)" : "Mix Sincronizado"}
            </span>
            {masteredBuffer && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" /> Masterização Aplicada (-20% vol)
              </span>
            )}
          </div>
          <WaveformPlayer buffer={activeBuffer} label={`Voz sincronizada + instrumental (${versionLabel})`} accent />
        </div>
      )}

      {/* Card de Masterização IA via Kits.ai (Preset Analog Warmth) */}
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-card to-primary/5 p-5 space-y-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h3 className="text-base font-semibold">Masterização IA (Kits.ai · Analog Warmth)</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Envie a música para o <strong>Kits.ai AI Mastering</strong> no preset <strong>Analog Warmth</strong>.
              Ao carregar o resultado aqui, o volume será automaticamente atenuado em 20% antes de disponibilizar para download e envio.
            </p>
          </div>
          {masteredBuffer && (
            <Button variant="ghost" size="sm" onClick={handleResetMastering} className="text-xs text-muted-foreground">
              Restaurar Original
            </Button>
          )}
        </div>

        {masteringSuccess && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="font-medium">
              Preset "Analog Warmth" aplicado com sucesso! Volume atenuado em 20%. Os downloads e a prévia agora utilizam este áudio masterizado.
            </span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {/* Etapa 1: Baixar mix atual */}
          <Button
            variant="outline"
            size="sm"
            onClick={downloadForMastering}
            disabled={!rawBuffer}
            className="h-11 text-xs font-medium"
          >
            <Download className="mr-2 h-4 w-4 text-primary" />
            1. Baixar Mix para Masterizar
          </Button>

          {/* Etapa 2: Abrir Kits.ai AI Mastering na web */}
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-11 text-xs font-medium border-primary/40 hover:bg-primary/5"
          >
            <a href="https://app.kits.ai/ai-mastering" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4 text-primary" />
              2. Abrir Kits.ai (Analog Warmth)
            </a>
          </Button>

          {/* Etapa 3: Upload do áudio masterizado retornado */}
          <label className="relative">
            <input
              type="file"
              accept="audio/*"
              className="sr-only"
              disabled={masteringUploading}
              onChange={handleMasteredFileUpload}
            />
            <Button
              asChild
              variant={masteredBuffer ? "secondary" : "default"}
              size="sm"
              disabled={masteringUploading}
              className="h-11 w-full text-xs font-medium cursor-pointer"
            >
              <span>
                {masteringUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processando volume (-20%)…
                  </>
                ) : (
                  <>
                    <UploadCloud className="mr-2 h-4 w-4" />
                    {masteredBuffer ? "3. Trocar Masterizado" : "3. Carregar Masterizado"}
                  </>
                )}
              </span>
            </Button>
          </label>
        </div>

        {/* Alternativa rápida de emulação direta no navegador */}
        <div className="pt-1 flex items-center justify-between border-t border-border/50 text-xs text-muted-foreground">
          <span>Deseja aplicar a sonoridade analógica e os -20% de volume imediatamente?</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleApplyLocalWarmth}
            disabled={!rawBuffer}
            className="text-xs h-7 text-primary hover:text-primary"
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Aplicar Analog Warmth Local (-20% vol)
          </Button>
        </div>
      </div>

      {/* Painel de ações principais */}
      <div className="rounded-2xl border bg-card p-5 space-y-4 shadow-sm">
        <div>
          <h3 className="text-base font-semibold">Ações da Música ({versionLabel})</h3>
          <p className="text-xs text-muted-foreground">
            Baixe o arquivo final (nos formatos WAV ou MP3) ou envie a prévia de 1min10s diretamente para o WhatsApp do cliente.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Botão Baixar Música (Voz do Cliente) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="lg"
                variant="default"
                disabled={!activeBuffer || !!busy}
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
                  <span className="text-xs text-muted-foreground">
                    {masteredBuffer ? "Masterizado Analog Warmth (-20% vol)" : "Mix original sem compressão"}
                  </span>
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
            disabled={!activeBuffer || sendState === "sending"}
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
                Enviar Prévia no WhatsApp
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
              <span className="flex-1 whitespace-pre-wrap">{sendResult}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleSendPreview} className="w-full text-xs">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Tentar Novamente
            </Button>
          </div>
        )}

        {sendLogs && (
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Detalhes técnicos da integração Umbler</p>
            <pre className="overflow-x-auto text-[11px] text-muted-foreground whitespace-pre-wrap">
              {JSON.stringify(sendLogs, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Playback (instrumental) isolado */}
      {playbackUrl && (
        <div className="space-y-2 pt-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Playback (somente instrumental da {versionLabel})</h3>
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

export default function ProcessingResult({ results, resultUrl, playbackUrl, sourceName, onReset }) {
  // Suporte a múltiplas versões (Versão 1 e Versão 2) ou modo legado de versão única
  const v1 = results?.v1 || (resultUrl ? { resultUrl, playbackUrl, sourceName } : null);
  const v2 = results?.v2 || null;

  const hasBoth = !!(v1 && v2);
  const [selectedTab, setSelectedTab] = useState("v1");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">Resultado final</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sua voz sincronizada com as referências da IA. Ouça, aplique a masterização Kits.ai, baixe a música ou envie a prévia no WhatsApp.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onReset}>
          <RotateCcw className="mr-1 h-4 w-4" /> Novo projeto
        </Button>
      </div>

      {/* Seletor de Abas quando houver duas versões */}
      {hasBoth && (
        <div className="flex items-center gap-2 border-b pb-3">
          <Button
            variant={selectedTab === "v1" ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedTab("v1")}
            className="h-10 px-5 text-sm font-medium"
          >
            Versão 1 (IA 1 + Voz Cliente)
          </Button>
          <Button
            variant={selectedTab === "v2" ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedTab("v2")}
            className="h-10 px-5 text-sm font-medium"
          >
            Versão 2 (IA 2 + Voz Cliente)
          </Button>
        </div>
      )}

      {/* Conteúdo da versão selecionada */}
      {selectedTab === "v1" && v1 && (
        <VersionCard versionData={v1} versionLabel="Versão 1" onReset={onReset} />
      )}
      {selectedTab === "v2" && v2 && (
        <VersionCard versionData={v2} versionLabel="Versão 2" onReset={onReset} />
      )}
      {!hasBoth && v1 && (
        <VersionCard versionData={v1} versionLabel="Versão 1" onReset={onReset} />
      )}
    </div>
  );
}
