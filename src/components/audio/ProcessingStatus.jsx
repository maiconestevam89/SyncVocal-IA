import React from "react";
import { Loader2, Check, AlertCircle } from "lucide-react";

const STEPS = [
  { key: "isolating_1", label: "Isolando voz do Áudio 1 no kits.ai…" },
  { key: "isolating_2", label: "Isolando voz do Áudio 2 no kits.ai…" },
  { key: "processing", label: "Sincronizando e mixando áudio…" },
  { key: "sending", label: "Enviando prévia no WhatsApp…" },
];

export default function ProcessingStatus({ status, error }) {
  if (status === "failed") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="flex-1">{error || "Falha no processamento."}</span>
      </div>
    );
  }

  const currentStep = STEPS.findIndex((s) => s.key === status);
  const pending = status === "pending";

  return (
    <div className="space-y-3">
      {pending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>Iniciando processamento…</span>
        </div>
      )}
      {STEPS.map((step, i) => {
        const done = !pending && i < currentStep;
        const active = !pending && i === currentStep;
        return (
          <div key={step.key} className="flex items-center gap-2 text-sm">
            {done ? (
              <Check className="h-4 w-4 text-emerald-500" />
            ) : active ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <div className="h-4 w-4 rounded-full border-2 border-muted" />
            )}
            <span className={done ? "text-muted-foreground line-through" : active ? "text-foreground" : "text-muted-foreground"}>
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}