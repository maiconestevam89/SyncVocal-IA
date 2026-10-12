import React from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "decode", label: "Carregando áudios" },
  { key: "sync", label: "Sincronização de tempo" },
  { key: "tune", label: "Afinação automática" },
  { key: "effects", label: "Aplicação de efeitos" },
  { key: "render", label: "Renderização final" },
];

export default function ProcessingOverlay({ activeStep }) {
  const order = STEPS.findIndex((s) => s.key === activeStep);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-xl">
        <h3 className="mb-1 text-lg font-semibold">Processando áudio</h3>
        <p className="mb-6 text-sm text-muted-foreground">
          Sincronizando e aplicando a cadeia de efeitos no navegador.
        </p>
        <div className="space-y-4">
          {STEPS.map((step, i) => {
            const done = i < order;
            const active = i === order;
            return (
              <div key={step.key} className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                    done && "border-primary bg-primary text-primary-foreground",
                    active && "border-primary text-primary",
                    !done && !active && "border-border text-muted-foreground"
                  )}
                >
                  {done ? (
                    <Check className="h-4 w-4" />
                  ) : active ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="text-xs">{i + 1}</span>
                  )}
                </div>
                <span
                  className={cn(
                    "text-sm transition-colors",
                    active ? "font-medium text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/60"
                  )}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}