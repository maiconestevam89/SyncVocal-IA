import React, { useState } from "react";
import { Send, Loader2, Check, AlertCircle, RotateCcw, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { audioBufferToMp3Blob } from "@/lib/mp3Encoder";

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

export default function UmblerTalkSender({ mixed, sourceName }) {
  const [state, setState] = useState("idle"); // idle | sending | success | error
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState(null);

  const extractErr = (e) => {
    const d = e?.response?.data ?? e?.data;
    return d?.error?.message || d?.error || (typeof d?.message === "string" ? d.message : null) ||
      d?.detail || e?.message || "Erro inesperado.";
  };

  const send = async () => {
    if (!mixed) return;
    setState("sending");
    setResult(null);
    setLogs(null);
    let step = "preparo";
    try {
      // 1. Construir a prévia (70s) e codificar em MP3
      step = "codificação MP3";
      const preview = buildPreviewBuffer(mixed);
      const blob = await audioBufferToMp3Blob(preview, 192);
      const file = new File([blob], "preview.mp3", { type: "audio/mpeg" });

      // 2. Upload para storage privado (stored privately)
      step = "upload do arquivo";
      const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
      const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({ file_uri });

      // 3. Chamar a função backend para o fluxo de 2 etapas do Umbler Talk
      step = "disparo no WhatsApp";
      const res = await base44.functions.invoke("sendUmblerPreview", {
        file_url: signed_url,
        audio1_name: sourceName || "",
      });

      const data = res.data || res;
      setLogs(data.logs || null);

      if (data.success) {
        setState("success");
        setResult(data.status || "Chatbot Iniciado e Prévia Enviada");
      } else {
        setState("error");
        setResult(data.error || "Falha no envio.");
      }
    } catch (e) {
      setState("error");
      const detail = extractErr(e);
      setResult(`Etapa "${step}": ${detail}`);
      // Expõe o objeto completo do erro para diagnóstico
      setLogs(e?.response?.data?.logs || { step, status: e?.status, data: e?.response?.data ?? e?.data, message: e?.message });
    }
  };

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Disparo no WhatsApp (Umbler Talk)</h3>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Inicia o chatbot "Música pronta", envia a prévia de 1min10s em anexo e, por fim,
        dispara o bot "Pendente de pagamento" no WhatsApp do cliente. O telefone é extraído
        do nome do Áudio 1 (apenas dígitos, formato E.164).
      </p>

      {state === "idle" && (
        <Button size="lg" onClick={send} disabled={!mixed} className="h-12 w-full">
          <Send className="mr-2 h-5 w-5" />
          Enviar Prévia no WhatsApp
        </Button>
      )}

      {state === "sending" && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Iniciando chatbot, enviando prévia e disparando pagamento…</span>
        </div>
      )}

      {state === "success" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
            <Check className="h-4 w-4 shrink-0" />
            <span className="flex-1">{result}</span>
          </div>
          <Button variant="outline" size="sm" onClick={send} className="w-full">
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Reenviar Processo
          </Button>
        </div>
      )}

      {state === "error" && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{result}</span>
          </div>
          <Button variant="outline" size="sm" onClick={send} className="w-full">
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Reenviar Processo
          </Button>
        </div>
      )}

      {logs && (
        <div className="mt-3 rounded-lg border bg-muted/20 p-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Logs do processo</p>
          <pre className="overflow-x-auto text-xs text-muted-foreground whitespace-pre-wrap">
            {JSON.stringify(logs, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}