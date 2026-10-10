import React, { useEffect, useRef, useState } from "react";
import { Play, Pause, Plus, Download, Loader2, Volume2, Headphones, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { decodeAudioFile } from "@/lib/audioEngine";
import { renderMultiTrack } from "@/lib/mixEngine";
import { audioBufferToWavBlob } from "@/lib/wavEncoder";
import { audioBufferToMp3Blob } from "@/lib/mp3Encoder";

// Mini waveform preview for a single track lane.
function TrackWaveform({ buffer, progress }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / width));
    const mid = height / 2;
    for (let x = 0; x < width; x++) {
      let min = 1, max = -1;
      const start = x * step;
      for (let i = 0; i < step; i++) {
        const v = data[start + i] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const played = x / width <= (progress || 0);
      ctx.fillStyle = played ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.4)";
      const y1 = mid + min * mid * 0.9;
      const y2 = mid + max * mid * 0.9;
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
  }, [buffer, progress]);

  return <canvas ref={canvasRef} className="h-10 w-full rounded" />;
}

// Playhead position across all tracks, driven by a shared AudioContext.
function usePlayback(tracks) {
  const ctxRef = useRef(null);
  const sourcesRef = useRef([]);
  const rafRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const maxDur = () =>
    tracks.reduce((m, t) => (t.buffer ? Math.max(m, (t.startAt || 0) + t.buffer.duration) : m), 0);

  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    sourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
    sourcesRef.current = [];
    if (ctxRef.current) { ctxRef.current.close(); ctxRef.current = null; }
    setPlaying(false);
    setProgress(0);
  };

  const toggle = async () => {
    if (playing) { stop(); return; }
    const total = maxDur();
    if (!total) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    ctxRef.current = ctx;
    const anySolo = tracks.some((t) => t.solo && !t.muted);
    sourcesRef.current = [];
    for (const t of tracks) {
      if (!t.buffer || t.muted) continue;
      if (anySolo && !t.solo) continue;
      const src = ctx.createBufferSource();
      src.buffer = t.buffer;
      src.playbackRate.value = t.playbackRate || 1;
      const gain = ctx.createGain();
      gain.gain.value = t.gain ?? 1;
      let panner;
      if (ctx.createStereoPanner) { panner = ctx.createStereoPanner(); panner.pan.value = t.pan ?? 0; }
      else { panner = ctx.createGain(); panner.gain.value = 1; }
      src.connect(gain).connect(panner).connect(ctx.destination);
      src.start(Math.max(0, t.startAt || 0));
      sourcesRef.current.push(src);
    }
    setPlaying(true);
    setDuration(total);
    const start = ctx.currentTime;
    const tick = () => {
      const p = Math.min(1, (ctx.currentTime - start) / total);
      setProgress(p);
      if (p < 1 && sourcesRef.current.length) rafRef.current = requestAnimationFrame(tick);
      else stop();
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => stop(), []);
  return { playing, progress, duration, toggle, stop, maxDur };
}

export default function MixEditor({ initialBuffer, initialLabel }) {
  const [tracks, setTracks] = useState(
    initialBuffer
      ? [{ id: "sync", name: initialLabel || "Vocal sincronizado", buffer: initialBuffer, gain: 1, pan: 0, muted: false, solo: false, startAt: 0 }]
      : []
  );
  const [busy, setBusy] = useState(null);
  const [exportResult, setExportResult] = useState(null);
  const fileInputRef = useRef(null);

  const { playing, progress, duration, toggle } = usePlayback(tracks);

  const addFiles = async (fileList) => {
    const newTracks = [];
    for (const file of Array.from(fileList)) {
      try {
        const buffer = await decodeAudioFile(file);
        newTracks.push({
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          name: file.name,
          buffer,
          gain: 1,
          pan: 0,
          muted: false,
          solo: false,
          startAt: 0,
        });
      } catch { /* skip unreadable */ }
    }
    setTracks((t) => [...t, ...newTracks]);
  };

  const update = (id, patch) =>
    setTracks((t) => t.map((tr) => (tr.id === id ? { ...tr, ...patch } : tr)));
  const remove = (id) => setTracks((t) => t.filter((tr) => tr.id !== id));

  const doExport = async (format) => {
    setBusy(format);
    try {
      const mixed = await renderMultiTrack(tracks);
      let blob, name;
      if (format === "wav") { blob = audioBufferToWavBlob(mixed); name = "mixagem.wav"; }
      else { blob = audioBufferToMp3Blob(mixed, 192); name = "mixagem.mp3"; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportResult(`${name} pronto (${mixed.duration.toFixed(1)}s)`);
    } catch (e) {
      setExportResult(e.message || "Erro ao exportar.");
    } finally {
      setBusy(null);
    }
  };

  const fmt = (s) => {
    if (!s) return "0:00";
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">Editor de Mixagem</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            O vocal sincronizado já está na primeira pista. Adicione mais pistas, ajuste volume e
            paneamento, e exporte a mixagem final.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
          {fmt(duration)}
        </div>
      </div>

      {/* Transport */}
      <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
        <button
          onClick={toggle}
          disabled={!tracks.length}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
        >
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
        </button>
        <div className="flex-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          <Plus className="mr-1 h-4 w-4" /> Adicionar pista
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {/* Track list */}
      <div className="space-y-2">
        {tracks.map((t) => (
          <div key={t.id} className="rounded-xl border bg-card p-3">
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => update(t.id, { muted: !t.muted })}
                  className={`flex h-8 w-8 items-center justify-center rounded-md border ${t.muted ? "bg-muted text-muted-foreground" : "text-foreground"}`}
                  title="Mudo"
                >
                  <Volume2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => update(t.id, { solo: !t.solo })}
                  className={`flex h-8 w-8 items-center justify-center rounded-md border ${t.solo ? "bg-primary text-primary-foreground" : "text-foreground"}`}
                  title="Solo"
                >
                  <Headphones className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{t.name}</span>
                  {t.id !== "sync" && (
                    <button onClick={() => remove(t.id)} className="text-muted-foreground hover:text-destructive" title="Remover">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <TrackWaveform buffer={t.buffer} progress={progress} />
                <div className="mt-2 flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <Slider
                      value={[Math.round((t.gain ?? 1) * 100)]}
                      min={0}
                      max={200}
                      onValueChange={(v) => update(t.id, { gain: v[0] / 100 })}
                      className="w-28"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">L</span>
                    <Slider
                      value={[Math.round((t.pan ?? 0) * 100)]}
                      min={-100}
                      max={100}
                      onValueChange={(v) => update(t.id, { pan: v[0] / 100 })}
                      className="w-28"
                    />
                    <span className="text-xs text-muted-foreground">R</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Export */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button size="lg" variant="outline" onClick={() => doExport("wav")} disabled={!!busy || !tracks.length} className="h-12 flex-1">
          {busy === "wav" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
          Exportar WAV
        </Button>
        <Button size="lg" onClick={() => doExport("mp3")} disabled={!!busy || !tracks.length} className="h-12 flex-1">
          {busy === "mp3" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
          Exportar MP3
        </Button>
      </div>
      {exportResult && <p className="text-sm text-muted-foreground">{exportResult}</p>}
    </div>
  );
}