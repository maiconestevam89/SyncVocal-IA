import React, { useCallback, useEffect, useRef, useState } from "react";
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

  // Playhead line
  ctx.strokeStyle = "hsl(var(--primary))";
  ctx.lineWidth = 2;
  const px = Math.floor(progress * width);
  ctx.beginPath();
  ctx.moveTo(px, 0);
  ctx.lineTo(px, height);
  ctx.stroke();
}

export default function WaveformPlayer({ buffer, label, accent }) {
  const canvasRef = useRef(null);
  const sourceRef = useRef(null);
  const ctxRef = useRef(null);
  const rafRef = useRef(null);
  const startOffsetRef = useRef(0); // seconds already played before current start
  const startCtxTimeRef = useRef(0); // ctx.currentTime when playback started
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    setDuration(buffer ? buffer.duration : 0);
    setProgress(0);
    setCurrentTime(0);
    startOffsetRef.current = 0;
    setPlaying(false);
    if (canvasRef.current && buffer) drawWaveform(canvasRef.current, buffer, 0);
  }, [buffer]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch { /* already stopped */ }
      sourceRef.current = null;
    }
    if (ctxRef.current) { ctxRef.current.close(); ctxRef.current = null; }
    setPlaying(false);
  }, []);

  const drawAt = (p) => {
    if (canvasRef.current && buffer) drawWaveform(canvasRef.current, buffer, p);
  };

  const startPlayback = useCallback(async (fromSec = 0) => {
    if (!buffer) return;
    stop();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    ctxRef.current = ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const offset = Math.max(0, Math.min(fromSec, buffer.duration - 0.01));
    src.start(0, offset);
    sourceRef.current = src;
    startOffsetRef.current = offset;
    startCtxTimeRef.current = ctx.currentTime;
    setPlaying(true);
    const tick = () => {
      const elapsed = startOffsetRef.current + (ctx.currentTime - startCtxTimeRef.current);
      const p = Math.min(1, elapsed / buffer.duration);
      setProgress(p);
      setCurrentTime(elapsed);
      drawAt(p);
      if (p < 1 && sourceRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        stop();
        setProgress(0);
        setCurrentTime(0);
        startOffsetRef.current = 0;
        drawAt(0);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [buffer, stop]);

  const toggle = async () => {
    if (playing) {
      stop();
      return;
    }
    await startPlayback(currentTime || 0);
  };

  // Seek by clicking/dragging on the waveform.
  const seekFromEvent = (clientX) => {
    if (!buffer) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const target = ratio * buffer.duration;
    if (playing) {
      startPlayback(target);
    } else {
      setProgress(ratio);
      setCurrentTime(target);
      startOffsetRef.current = target;
      drawAt(ratio);
    }
  };

  const handleCanvasClick = (e) => seekFromEvent(e.clientX);

  const handleCanvasDrag = (e) => {
    if (e.buttons !== 1) return;
    seekFromEvent(e.clientX);
  };

  useEffect(() => () => stop(), [stop]);

  const fmt = (s) => {
    if (!s) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const skip = (delta) => {
    if (!buffer) return;
    const target = Math.max(0, Math.min(buffer.duration, (currentTime || 0) + delta));
    if (playing) {
      startPlayback(target);
    } else {
      const ratio = target / buffer.duration;
      setProgress(ratio);
      setCurrentTime(target);
      startOffsetRef.current = target;
      drawAt(ratio);
    }
  };

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">{label}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {fmt(currentTime)} / {fmt(duration)}
          </span>
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
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasDrag}
          className="h-12 w-full cursor-pointer rounded-lg"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => skip(-10)}
            disabled={!buffer}
            className="rounded-md border bg-card px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-40"
            title="Voltar 10s"
          >
            -10s
          </button>
          <button
            onClick={() => skip(-3)}
            disabled={!buffer}
            className="rounded-md border bg-card px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-40"
            title="Voltar 3s"
          >
            -3s
          </button>
          <button
            onClick={() => skip(3)}
            disabled={!buffer}
            className="rounded-md border bg-card px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-40"
            title="Avançar 3s"
          >
            +3s
          </button>
          <button
            onClick={() => skip(10)}
            disabled={!buffer}
            className="rounded-md border bg-card px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-40"
            title="Avançar 10s"
          >
            +10s
          </button>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {fmt(currentTime)} / {fmt(duration)}
        </span>
      </div>
    </div>
  );
}