import { useState, useRef, useEffect } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AudioRecorder({ onRecorded, label = "Gravar Voz" }) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);

  const startRecording = async () => {
    try {
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `recording_${Date.now()}.webm`, { type: "audio/webm" });
        onRecorded(file);
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (err) {
      setError("Não foi possível acessar o microfone. Verifique as permissões do navegador.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const formatTime = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-col items-center gap-4">
      {error && <p className="text-sm text-destructive text-center">{error}</p>}
      {isRecording && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <span className="font-mono text-lg">{formatTime(elapsed)}</span>
        </div>
      )}
      <Button
        type="button"
        size="lg"
        variant={isRecording ? "destructive" : "default"}
        className="rounded-full w-20 h-20 p-0"
        onClick={isRecording ? stopRecording : startRecording}
      >
        {isRecording ? <Square className="w-6 h-6" /> : <Mic className="w-8 h-8" />}
      </Button>
      <span className="text-sm text-muted-foreground">
        {isRecording ? "Toque para parar" : label}
      </span>
    </div>
  );
}