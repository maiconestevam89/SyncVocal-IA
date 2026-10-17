import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Music, ArrowRight, Sparkles, Upload, Mic, ShieldAlert,
  RotateCcw, Headphones, CheckCircle2, FileMusic, Loader2,
  Trash2, Sliders, Layers, Wand2, AlertTriangle, KeyRound, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import AudioRecorder from "@/components/audio/AudioRecorder";
import { base44 } from "@/api/base44Client";

const STYLE_OPTIONS = [
  "Sertanejo", "Pop Rock", "MPB", "Trap", "Funk", "Gospel",
  "Samba", "Forró", "Bossa Nova", "Pagode", "Axé", "Romântica",
  "Eletrônica", "Acústico",
];

export default function Landing() {
  const navigate = useNavigate();

  const [phone, setPhone] = useState("");
  const [customerName, setCustomerName] = useState("");

  const [clientAudioFile, setClientAudioFile] = useState(null);
  const [clientAudioUrl, setClientAudioUrl] = useState(null);
  const [clientAudioUri, setClientAudioUri] = useState(null);
  const [uploadingClientAudio, setUploadingClientAudio] = useState(false);

  const [arrangementMode, setArrangementMode] = useState("generate_suno");
  const [selectedStyle, setSelectedStyle] = useState("Sertanejo");
  const [customStyle, setCustomStyle] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [generatingPrompt, setGeneratingPrompt] = useState(false);

  // Estados para os 4 arquivos (Versão 1 e 2: Voz + Playback)
  const [v1VocalFile, setV1VocalFile] = useState(null);
  const [v1VocalUri, setV1VocalUri] = useState(null);

  const [v1InstFile, setV1InstFile] = useState(null);
  const [v1InstUri, setV1InstUri] = useState(null);

  const [v2VocalFile, setV2VocalFile] = useState(null);
  const [v2VocalUri, setV2VocalUri] = useState(null);

  const [v2InstFile, setV2InstFile] = useState(null);
  const [v2InstUri, setV2InstUri] = useState(null);

  const [uploadingPreGen, setUploadingPreGen] = useState(false);

  const [flowStage, setFlowStage] = useState("initial");
  const [copyrightData, setCopyrightData] = useState(null);
  const [pipelineStep, setPipelineStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(4);
  const [pipelineMessage, setPipelineMessage] = useState("");
  const [jobResults, setJobResults] = useState(null);
  const [formError, setFormError] = useState("");
  const [detailedError, setDetailedError] = useState(null);

  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsData, setDiagnosticsData] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const phoneParam = params.get("phone");
    if (phoneParam) {
      const clean = phoneParam.replace(/\D/g, "");
      setPhone(formatPhone(clean));
    }
  }, []);

  function formatPhone(v) {
    const digits = v.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
  }

  const handlePhoneChange = (e) => {
    setPhone(formatPhone(e.target.value));
  };

  const handleClientAudioSelected = async (file) => {
    if (!file) return;
    setFormError("");
    setDetailedError(null);
    setClientAudioFile(file);
    setClientAudioUrl(URL.createObjectURL(file));
    setUploadingClientAudio(true);

    try {
      const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
      setClientAudioUri(file_uri);
    } catch (err) {
      console.error("Erro no upload da voz:", err);
      setFormError("Falha ao salvar áudio da voz. Tente novamente.");
    } finally {
      setUploadingClientAudio(false);
    }
  };

  const handleRemoveClientAudio = () => {
    setClientAudioFile(null);
    setClientAudioUrl(null);
    setClientAudioUri(null);
  };

  const handleUploadFile = async (file, setUriFn) => {
    if (!file) return;
    setUploadingPreGen(true);
    try {
      const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
      setUriFn(file_uri);
    } catch (err) {
      console.error("Erro no upload:", err);
      setFormError("Falha ao enviar arquivo.");
    } finally {
      setUploadingPreGen(false);
    }
  };

  const handleGenerateMusicPrompt = async () => {
    const inputStyle = customStyle.trim() || selectedStyle;
    if (!inputStyle) return;

    setGeneratingPrompt(true);
    setFormError("");
    setDetailedError(null);
    try {
      const res = await base44.functions.invoke("generateMusicPrompt", {
        styleSelection: inputStyle,
      });

      if (res.data?.prompt) {
        setGeneratedPrompt(res.data.prompt);
      } else {
        throw new Error(res.data?.error || "Resposta sem prompt");
      }
    } catch (err) {
      console.error("Erro ao gerar prompt com IA:", err);
      setGeneratedPrompt(`${inputStyle}, professional music production, acoustic and modern instruments, clear mix, emotional rhythm, radio ready`);
    } finally {
      setGeneratingPrompt(false);
    }
  };

  const runDiagnostics = async () => {
    setDiagnosticsLoading(true);
    setShowDiagnostics(true);
    try {
      const res = await base44.functions.invoke("checkSystemStatus");
      if (res.data?.success) {
        setDiagnosticsData(res.data);
      } else {
        setDiagnosticsData({ error: res.data?.error || "Falha ao consultar status" });
      }
    } catch (err) {
      setDiagnosticsData({ error: err.message || "Erro na chamada de diagnóstico" });
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const handleStartProduction = async () => {
    setFormError("");
    setDetailedError(null);

    if (!phone || phone.replace(/\D/g, "").length < 10) {
      setFormError("Por favor, informe um WhatsApp válido com DDD.");
      return;
    }

    if (!clientAudioFile && !clientAudioUri) {
      setFormError("Por favor, anexe a gravação ou arquivo da sua voz no Passo 2.");
      return;
    }

    if (arrangementMode === "pre_generated") {
      if (!v1VocalUri || !v1InstUri || !v2VocalUri || !v2InstUri) {
        setFormError("Por favor, envie os vocais e playbacks das duas versões.");
        return;
      }
    }

    let activeClientUri = clientAudioUri;
    if (!activeClientUri && clientAudioFile) {
      setUploadingClientAudio(true);
      try {
        const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file: clientAudioFile });
        activeClientUri = file_uri;
        setClientAudioUri(file_uri);
      } catch (err) {
        setFormError("Erro ao enviar arquivo da voz para o servidor. Tente novamente.");
        setUploadingClientAudio(false);
        return;
      }
      setUploadingClientAudio(false);
    }

    if (arrangementMode === "generate_suno") {
      setFlowStage("checking_copyright");
      setCopyrightData(null);

      try {
        const res = await base44.functions.invoke("checkCopyright", {
          file_uri: activeClientUri,
          phone,
        });

        if (res.data?.copyright_detected) {
          setFlowStage("copyright_blocked");
          setCopyrightData(res.data.details || {});
          return;
        }
      } catch (err) {
        console.warn("Aviso na verificação de direitos autorais:", err);
      }
    }

    executePipeline(activeClientUri);
  };

  const handleRetryAnotherSong = () => {
    setClientAudioFile(null);
    setClientAudioUrl(null);
    setClientAudioUri(null);
    setCopyrightData(null);
    setDetailedError(null);
    setFlowStage("initial");
  };

  const executePipeline = async (clientUri) => {
    setFlowStage("processing");
    const isPreGen = arrangementMode === "pre_generated";
    setTotalSteps(isPreGen ? 4 : 6);

    const styleToUse = generatedPrompt.trim() || customStyle.trim() || selectedStyle;

    setPipelineStep(1);
    setPipelineMessage("Iniciando esteira musical...");

    const t1 = setTimeout(() => {
      setPipelineStep(2);
      setPipelineMessage(isPreGen ? "Carregando vocais e playbacks diretos..." : "Gerando prompt no Suno...");
    }, 3000);

    const t2 = setTimeout(() => {
      setPipelineStep(3);
      setPipelineMessage("Limpando e masterizando a voz do cliente no Music.ai...");
    }, 12000);

    const t3 = setTimeout(() => {
      setPipelineStep(4);
      setPipelineMessage("Sincronizando e mixando a voz masterizada nas 2 versões (DSP)...");
    }, 24000);

    try {
      const payload = {
        client_audio_uri: clientUri,
        phone,
        customer_name: customerName,
        style_choice: styleToUse,
      };

      if (isPreGen) {
        payload.pre_generated_v1_vocal_uri = v1VocalUri;
        payload.pre_generated_v1_instrumental_uri = v1InstUri;
        payload.pre_generated_v2_vocal_uri = v2VocalUri;
        payload.pre_generated_v2_instrumental_uri = v2InstUri;
      }

      const res = await base44.functions.invoke("runPipeline", payload);

      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);

      if (res.data?.success) {
        setJobResults(res.data);
        setPipelineStep(isPreGen ? 4 : 6);
        setPipelineMessage("Produção finalizada com sucesso!");
        setFlowStage("ready");
      } else {
        const errorMsg = res.data?.error || "Falha na produção do áudio";
        throw new Error(errorMsg);
      }
    } catch (err) {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);

      console.error("Erro no pipeline:", err);
      setDetailedError({
        message: err.message || "Erro de processamento",
        step: pipelineMessage,
      });
      setFlowStage("error");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Music className="w-6 h-6 text-white" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-purple-300 bg-clip-text text-transparent">
                SyncVocal IA
              </span>
              <span className="block text-xs text-slate-400 font-medium">MM Music Studio</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={runDiagnostics}
              className="border-slate-700 bg-slate-900/80 text-xs text-slate-300 hover:text-white gap-1.5"
            >
              <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
              Diagnóstico de Chaves
            </Button>
            <Badge variant="outline" className="hidden sm:inline-flex border-indigo-500/30 text-indigo-400 bg-indigo-500/10 gap-1.5 py-1 px-3">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              Produção Musical Profissional
            </Badge>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8">
        {flowStage === "initial" && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div className="text-center space-y-3">
              <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white">
                Transforme sua voz em uma{" "}
                <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-amber-300 bg-clip-text text-transparent">
                  Música Completa
                </span>
              </h1>
              <p className="text-slate-400 text-sm md:text-base max-w-2xl mx-auto">
                Cante ou anexe sua voz. O sistema masteriza seus vocais, sincroniza com os playbacks e entrega os arquivos prontos para lançamento.
              </p>
            </div>

            {formError && (
              <Alert variant="destructive" className="bg-red-950/60 border-red-800 text-red-200">
                <ShieldAlert className="w-4 h-4 text-red-400" />
                <AlertDescription className="text-sm font-medium">{formError}</AlertDescription>
              </Alert>
            )}

            <Card className="bg-slate-900 border-slate-800 shadow-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2 text-white">
                  <span className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 flex items-center justify-center text-xs font-bold">1</span>
                  Dados do Cliente
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Informe o WhatsApp para o envio dos áudios e prévias musicais.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone" className="text-slate-300">WhatsApp com DDD*</Label>
                    <Input
                      id="phone"
                      placeholder="(11) 98803-2049"
                      value={phone}
                      onChange={handlePhoneChange}
                      className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-600 focus:border-indigo-500 text-base"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-slate-300">Nome do Artista / Cliente</Label>
                    <Input
                      id="name"
                      placeholder="Ex: João Silva"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-600 focus:border-indigo-500 text-base"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-800 shadow-2xl ring-1 ring-indigo-500/20">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2 text-white">
                    <span className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 flex items-center justify-center text-xs font-bold">2</span>
                    Anexe sua Voz Cantando
                  </CardTitle>
                  {clientAudioFile && (
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10 gap-1 text-xs">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Voz Pronta
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-slate-400">
                  Grave agora mesmo pelo microfone ou selecione seu arquivo de voz (MP3, WAV, M4A).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!clientAudioFile ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
                    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center text-center">
                      <div className="w-12 h-12 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3">
                        <Mic className="w-6 h-6" />
                      </div>
                      <h3 className="font-semibold text-slate-200 text-sm mb-1">Gravar com Microfone</h3>
                      <p className="text-xs text-slate-400 mb-4">Cante ou fale direto no navegador</p>
                      <AudioRecorder onRecorded={handleClientAudioSelected} label="Gravar Voz" />
                    </div>

                    <div className="bg-slate-950/80 border border-slate-800 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center">
                      <div className="w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-3">
                        <Upload className="w-6 h-6" />
                      </div>
                      <h3 className="font-semibold text-slate-200 text-sm mb-1">Enviar Arquivo de Áudio</h3>
                      <p className="text-xs text-slate-500 mb-4">Suporta MP3, WAV, OGG, M4A (máx. 25MB)</p>
                      <label className="cursor-pointer">
                        <input
                          type="file"
                          accept="audio/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleClientAudioSelected(file);
                          }}
                        />
                        <span className="inline-flex items-center justify-center rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 shadow-md transition-colors">
                          Selecionar Arquivo de Voz
                        </span>
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-950 border border-indigo-500/30 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileMusic className="w-5 h-5 text-indigo-400" />
                        <div>
                          <p className="text-sm font-semibold text-white">{clientAudioFile.name || "Gravação de Voz"}</p>
                          <p className="text-xs text-slate-400">
                            {uploadingClientAudio ? "Enviando arquivo..." : "Áudio anexado com sucesso"}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRemoveClientAudio}
                        className="text-xs text-red-400 h-7 p-0 hover:bg-transparent"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Trocar áudio
                      </Button>
                    </div>
                    {clientAudioUrl && (
                      <audio controls className="w-full h-8 pt-1" src={clientAudioUrl} />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-800 shadow-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2 text-white">
                  <span className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 flex items-center justify-center text-xs font-bold">3</span>
                  Arranjos e Estilo Musical
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Escolha se deseja que a IA gere os arranjos ou se já possui os vocais e playbacks separados.
                </CardDescription>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setArrangementMode("generate_suno")}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                      arrangementMode === "generate_suno"
                        ? "bg-indigo-950/50 border-indigo-500 text-white shadow-lg shadow-indigo-600/10"
                        : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <Wand2 className={`w-5 h-5 shrink-0 mt-0.5 ${arrangementMode === "generate_suno" ? "text-indigo-400" : "text-slate-500"}`} />
                    <div>
                      <div className="text-sm font-bold">Criar Arranjos com IA (Suno)</div>
                      <div className="text-xs text-slate-400 mt-0.5">Defina o estilo e gere 2 versões automaticamente.</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setArrangementMode("pre_generated")}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                      arrangementMode === "pre_generated"
                        ? "bg-indigo-950/50 border-indigo-500 text-white shadow-lg shadow-indigo-600/10"
                        : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <Layers className={`w-5 h-5 shrink-0 mt-0.5 ${arrangementMode === "pre_generated" ? "text-indigo-400" : "text-slate-500"}`} />
                    <div>
                      <div className="text-sm font-bold">Já possuo os Stems (Voz + Playback)</div>
                      <div className="text-xs text-slate-400 mt-0.5">Envie os vocais e instrumentais diretamente.</div>
                    </div>
                  </button>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pt-2">
                {arrangementMode === "generate_suno" && (
                  <div className="space-y-5 animate-in fade-in duration-200">
                    <div className="space-y-2">