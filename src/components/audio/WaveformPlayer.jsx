import React, { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

// Draw a downsampled waveform from an AudioBuffer onto a canvas.
function drawWaveform(canvas, buffer, progress) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const data = buffer.getChannelData(0);
  const samples = data.length;
  const step = Math.max(1, Math.floor(samples / width));
  const mid = height / 2;

  ctx.fillStyle = "hsl(var(--muted))";
  ctx.strokeStyle = "hsl(var(--primary))";
  ctx.lineWidth = 1;

  for (let x = 0; x < width; x++) {
    let min = 1, max = -1;
    const start = x * step;
    for (let i = 0; i < step; i++) {
      const v = data[start + i] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const played = x / width <= progress;
    ctx.fillStyle = played ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.35)";
    const y1 = mid + min * mid * 0.92;
    const y2 = mid + max * mid * 0.92;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}

export default function WaveformPlayer({ buffer, label, accent }) {
  const canvasRef = useRef(null);
  const sourceRef = useRef(null);
  const ctxRef = useRef(null);
  const rafRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setDuration(buffer ? buffer.duration : 0);
    setProgress(0);
    setPlaying(false);
    if (canvasRef.current && buffer) drawWaveform(canvasRef.current, buffer, 0);
  }, [buffer]);

  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        /* already stopped */
      }
      sourceRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close();
      ctxRef.current = null;
    }
    setPlaying(false);
  };

  const toggle = async () => {
    if (playing) {
      stop();
      setProgress(0);
      if (canvasRef.current && buffer) drawWaveform(canvasRef.current, buffer, 0);
      return;
    }
    if (!buffer) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    ctxRef.current = ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
    sourceRef.current = src;
    setPlaying(true);
    const startTime = ctx.currentTime;
    const tick = () => {
      const elapsed = ctx.currentTime - startTime;
      const p = Math.min(1, elapsed / buffer.duration);
      setProgress(p);
      if (canvasRef.current) drawWaveform(canvasRef.current, buffer, p);
      if (p < 1 && sourceRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        stop();
        setProgress(0);
        if (canvasRef.current) drawWaveform(canvasRef.current, buffer, 0);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => stop(), []);

  const fmt = (s) => {
    if (!s) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">{label}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{fmt(duration)}</span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          disabled={!buffer}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-transform active:scale-95 disabled:opacity-40",
            accent ? "bg-primary" : "bg-foreground"
          )}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
        </button>
        <canvas ref={canvasRef} className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}