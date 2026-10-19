import React, { useRef, useState } from "react";
import { UploadCloud, Music, Mic } from "lucide-react";
import { cn } from "@/lib/utils";

export default function UploadZone({ label, hint, file, onFile }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (files) => {
    if (files && files[0]) onFile(files[0]);
  };

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "group relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-all cursor-pointer",
        dragging
          ? "border-primary bg-primary/5 scale-[1.01]"
          : "border-border hover:border-primary/50 hover:bg-muted/40"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/mp3,audio/wav,audio/m4a,audio/ogg,audio/x-m4a,audio/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-110">
        {label?.toLowerCase?.().includes("vocal") || label?.toLowerCase?.().includes("voz") ? (
          <Mic className="h-6 w-6" />
        ) : (
          <Music className="h-6 w-6" />
        )}
      </div>

      {file ? (
        <div className="space-y-0.5">
          <p className="font-medium text-foreground truncate max-w-[220px]">{file.name}</p>
          <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1 justify-center">
            <UploadCloud className="h-3.5 w-3.5" />
            {hint}
          </p>
        </div>
      )}
    </div>
  );
}