import React, { useEffect, useMemo, useState } from "react";
import { Download, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { renderMultiTrack } from "@/lib/mixEngine";
import { autoMatchGains } from "@/lib/loudness";
import { audioBufferToWavBlob } from "@/lib/wavEncoder";
import { audioBufferToMp3Blob } from "@/lib/mp3Encoder";
import WaveformPlayer from "@/components/audio/WaveformPlayer";
import UmblerTalkSender from "@/components/audio/UmblerTalkSender";

// Renders the final mix automatically (vocal + instrumental with matched
// volumes) and exposes only a player + download buttons. No manual mixing.
export default function FinalResult({ vocalBuffer, instrumentalBuffer, sourceName, onReset }) {
  const [mixed, setMixed] = useState(null);
  const [mixing, setMixing] = useState(true);
  const [busy, setBusy] = useState(null);
  const [exportResult, setExportResult] = useState(null);

  const tracks = useMemo(() => {
    const list = [];
    if (vocalBuffer) {
      list.push({ id: "vocal", name: "Voz sincronizada", buffer: vocalBuffer, gain: 1, pan: 0, muted: false, solo: false, startAt: 0 });
    }
    if (instrumentalBuffer) {
      list.push({ id: "instrumental", name: "Instrumental", buffer: instrumentalBuffer, gain: 0.8, pan: 0, muted: false, solo: false, startAt: 0 });
    }
    // Auto-match volumes so vocal and instrumental sit at the same level.
    if (list.length >= 2) {
      const gains = autoMatchGains(list);
      list.forEach((t, i) => { t.gain = gains[i]; });
    }
    return list;
  }, [vocalBuffer, instrumentalBuffer]);

  useEffect(() => {
    let alive = true;
    setMixing(true);
    setMixed(null);
    if (!tracks.length) { setMixing(false); return; }
    renderMultiTrack(tracks)
      .then((buf) => alive && setMixed(buf))
      .catch(() => alive && setExportResult("Erro ao mixar o resultado final."))
      .finally(() => alive && setMixing(false));
    return () => { alive = false; };
  }, [tracks]);

  const downloadBlob = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Deriva os nomes de arquivo a partir do nome do Áudio 1.
  // - Resultado final: mantém o nome original (sem extensão) + nova extensão.
  // - Playback: substitui caracteres não numéricos por "- PLAYBACK".
  // - Prévia: mesmo do playback, mas com "PRÉVIA".
  const baseName = (sourceName || "syncvocal").replace(/\.[^.]+$/, "");
  const digitsOnly = baseName.replace(/[^0-9]+/g, "");
  const playbackBase = (digitsOnly || baseName) + " - PLAYBACK";
  const previewBase = (digitsOnly || baseName) + " - PRÉVIA";

  const doExport = async (format) => {
    if (!mixed) return;
    setBusy(format);
    try {
      let blob, name;
      if (format === "wav") { blob = audioBufferToWavBlob(mixed); name = `${baseName}.wav`; }
      else { blob = audioBufferToMp3Blob(mixed, 192); name = `${baseName}.mp3`; }
      downloadBlob(blob, name);
      setExportResult(`${name} pronto (${mixed.duration.toFixed(1)}s)`);
    } catch (e) {
      setExportResult(e.message || "Erro ao exportar.");
    } finally {
      setBusy(null);
    }
  };

  const doExportPlayback = async (format) => {
    if (!instrumentalBuffer) return;
    setBusy(`playback-${format}`);
    try {
      let blob, name;
      if (format === "wav") { blob = audioBufferToWavBlob(instrumentalBuffer); name = `${playbackBase}.wav`; }
      else { blob = audioBufferToMp3Blob(instrumentalBuffer, 192); name = `${playbackBase}.mp3`; }
      downloadBlob(blob, name);
      setExportResult(`${name} pronto (${instrumentalBuffer.duration.toFixed(1)}s)`);
    } catch (e) {
      setExportResult(e.message || "Erro ao exportar playback.");
    } finally {
      setBusy(null);
    }
  };

  // Cria um AudioBuffer com os primeiros 70 segundos (1min10s) do mix final.
  const buildPreviewBuffer = (source) => {
    const previewSeconds = 70;
    const channels = source.numberOfChannels;
    const sampleRate = source.sampleRate;
    const maxLen = source.length;
    const targetLen = Math.min(maxLen, Math.floor(previewSeconds * sampleRate));
    if (targetLen >= maxLen) return source; // já é mais curto que a prévia
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const out = ctx.createBuffer(channels, targetLen, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const data = source.getChannelData(ch).subarray(0, targetLen);
      out.copyToChannel(data, ch, 0);
    }
    ctx.close();
    return out;
  };

  const doExportPreview = async (format) => {
    if (!mixed) return;
    setBusy(`preview-${format}`);
    try {
      const preview = buildPreviewBuffer(mixed);
      let blob, name;
      if (format === "wav") { blob = audioBufferToWavBlob(preview); name = `${previewBase}.wav`; }
      else { blob = audioBufferToMp3Blob(preview, 192); name = `${previewBase}.mp3`; }
      downloadBlob(blob, name);
      setExportResult(`${name} pronto (${preview.duration.toFixed(1)}s)`);
    } catch (e) {
      setExportResult(e.message || "Erro ao exportar prévia.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">Resultado final</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A sua voz sincronizada já foi mixada com o instrumental original, com os volumes
            equalizados automaticamente. Ouça e baixe abaixo.
          </p>
        </div>
        {onReset && (
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="mr-1 h-4 w-4" /> Novo projeto
          </Button>
        )}
      </div>

      {mixing && (
        <div className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Mixando o resultado final…
        </div>
      )}

      {mixed && !mixing && (
        <div className="rounded-2xl border bg-card p-5">
          <WaveformPlayer buffer={mixed} label="Voz sincronizada + instrumental" accent />
        </div>
      )}

      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium">Mixagem final (voz + instrumental)</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button size="lg" variant="outline" onClick={() => doExport("wav")} disabled={!!busy || !mixed || mixing} className="h-12 flex-1">
              {busy === "wav" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
              Baixar WAV
            </Button>
            <Button size="lg" onClick={() => doExport("mp3")} disabled={!!busy || !mixed || mixing} className="h-12 flex-1">
              {busy === "mp3" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
              Baixar MP3
            </Button>
          </div>
        </div>
        {instrumentalBuffer && (
          <div>
            <p className="mb-2 text-sm font-medium">Playback (somente instrumental)</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button size="lg" variant="outline" onClick={() => doExportPlayback("wav")} disabled={!!busy || mixing} className="h-12 flex-1">
                {busy === "playback-wav" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
                Baixar WAV
              </Button>
              <Button size="lg" variant="outline" onClick={() => doExportPlayback("mp3")} disabled={!!busy || mixing} className="h-12 flex-1">
                {busy === "playback-mp3" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
                Baixar MP3
              </Button>
            </div>
          </div>
        )}
        {mixed && (
          <div>
            <p className="mb-2 text-sm font-medium">Prévia (resultado final até 1min10s)</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button size="lg" variant="outline" onClick={() => doExportPreview("wav")} disabled={!!busy || mixing} className="h-12 flex-1">
                {busy === "preview-wav" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
                Baixar WAV
              </Button>
              <Button size="lg" variant="outline" onClick={() => doExportPreview("mp3")} disabled={!!busy || mixing} className="h-12 flex-1">
                {busy === "preview-mp3" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
                Baixar MP3
              </Button>
            </div>
          </div>
        )}
      </div>
      <UmblerTalkSender mixed={mixed} sourceName={sourceName} />
      {exportResult && <p className="text-sm text-muted-foreground">{exportResult}</p>}
    </div>
  );
}