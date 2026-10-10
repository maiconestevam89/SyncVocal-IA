import React from "react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

function Field({ label, value, suffix, min, max, step, onChange, disabled }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <Label className="text-muted-foreground">{label}</Label>
        <span className="tabular-nums font-medium text-foreground">
          {value}
          {suffix}
        </span>
      </div>
      <Slider
        value={[Number(value)]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}

export default function EffectControls({ settings, onChange }) {
  const set = (patch) => onChange({ ...settings, ...patch });
  const setMix = (patch) => set({ mix: { ...settings.mix, ...patch } });
  const setEq = (patch) => set({ eq: { ...settings.eq, ...patch } });
  const setReverb = (patch) => set({ reverb: { ...settings.reverb, ...patch } });
  const setDelay = (patch) => set({ delay: { ...settings.delay, ...patch } });
  const setComp = (patch) => set({ compressor: { ...settings.compressor, ...patch } });
  const setIsolate = (patch) =>
    set({ isolate: { ...settings.isolate, method: "local", ...patch } });

  return (
    <div className="space-y-6">
      {/* Voice isolation */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold">Isolamento de voz</h4>
        <p className="text-xs text-muted-foreground -mt-2">
          O filtro local é aproximado: não separa instrumentos que estão no centro junto com a
          voz. Para uma separação real, use a IA (Demucs).
        </p>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Ativar filtro</Label>
          <Switch
            checked={settings.isolate.enabled}
            onCheckedChange={(v) => setIsolate({ enabled: v })}
          />
        </div>
        {settings.isolate.enabled && (
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
            <Label className="text-xs text-muted-foreground">Método de separação</Label>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Filtro local (instantâneo)</Label>
              <Switch
                checked={settings.isolate.method !== "ai"}
                onCheckedChange={(v) => setIsolate({ method: v ? "local" : "ai" })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">IA · Demucs no fal.ai</Label>
              <Switch
                checked={settings.isolate.method === "ai"}
                onCheckedChange={(v) => setIsolate({ method: v ? "ai" : "local" })}
              />
            </div>
            {settings.isolate.method === "ai" && (
              <p className="text-xs text-muted-foreground">
                Envia o Áudio 2 ao fal.ai para separar a voz dos instrumentos. Consome créditos do fal.ai e pode levar alguns minutos.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* Alignment */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold">Alinhamento de Tempo</h4>
        <p className="text-xs text-muted-foreground -mt-2">
          Acompanha a melodia e o ritmo do Áudio 1 frase por frase, esticando ou
          encurtando o Áudio 2 sem mudar o tom da voz.
        </p>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Sincronizar automaticamente</Label>
          <Switch checked={settings.autoSync} onCheckedChange={(v) => set({ autoSync: v })} />
        </div>
        <Field
          label="Andamento manual (tempo)"
          value={settings.tempoRatio.toFixed(2)}
          suffix="x"
          min={0.5}
          max={2}
          step={0.01}
          disabled={settings.autoSync}
          onChange={(v) => set({ tempoRatio: v })}
        />
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Preservar tom da voz</Label>
          <Switch checked={settings.preservePitch} onCheckedChange={(v) => set({ preservePitch: v })} />
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Mix */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold">Mixagem</h4>
        <Field
          label="Volume da referência"
          value={settings.mix.reference.toFixed(2)}
          min={0}
          max={1.5}
          step={0.01}
          onChange={(v) => setMix({ reference: v })}
        />
        <Field
          label="Volume do vocal"
          value={settings.mix.vocal.toFixed(2)}
          min={0}
          max={1.5}
          step={0.01}
          onChange={(v) => setMix({ vocal: v })}
        />
      </div>

      <div className="h-px bg-border" />

      {/* EQ */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold">Equalização</h4>
        <Field label="Graves" value={settings.eq.low} suffix=" dB" min={-15} max={15} step={0.5} onChange={(v) => setEq({ low: v })} />
        <Field label="Médios" value={settings.eq.mid} suffix=" dB" min={-15} max={15} step={0.5} onChange={(v) => setEq({ mid: v })} />
        <Field label="Agudos" value={settings.eq.high} suffix=" dB" min={-15} max={15} step={0.5} onChange={(v) => setEq({ high: v })} />
      </div>

      <div className="h-px bg-border" />

      {/* Reverb */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold">Reverb</h4>
        <Field label="Quantidade" value={settings.reverb.amount.toFixed(2)} min={0} max={1} step={0.01} onChange={(v) => setReverb({ amount: v })} />
        <Field label="Tamanho" value={settings.reverb.duration.toFixed(1)} suffix="s" min={0.2} max={5} step={0.1} onChange={(v) => setReverb({ duration: v })} />
        <Field label="Decaimento" value={settings.reverb.decay.toFixed(1)} min={0.5} max={6} step={0.1} onChange={(v) => setReverb({ decay: v })} />
      </div>

      <div className="h-px bg-border" />

      {/* Delay */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold">Delay</h4>
        <Field label="Tempo" value={settings.delay.time.toFixed(2)} suffix="s" min={0} max={2} step={0.01} onChange={(v) => setDelay({ time: v })} />
        <Field label="Feedback" value={settings.delay.feedback.toFixed(2)} min={0} max={0.9} step={0.01} onChange={(v) => setDelay({ feedback: v })} />
        <Field label="Quantidade" value={settings.delay.amount.toFixed(2)} min={0} max={1} step={0.01} onChange={(v) => setDelay({ amount: v })} />
      </div>

      <div className="h-px bg-border" />

      {/* Compressor */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold">Compressão</h4>
        <Field label="Threshold" value={settings.compressor.threshold} suffix=" dB" min={-60} max={0} step={1} onChange={(v) => setComp({ threshold: v })} />
        <Field label="Ratio" value={settings.compressor.ratio.toFixed(1)} suffix=":1" min={1} max={20} step={0.5} onChange={(v) => setComp({ ratio: v })} />
      </div>
    </div>
  );
}