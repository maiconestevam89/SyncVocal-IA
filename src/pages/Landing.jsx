import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Music, ArrowRight, Sparkles, Upload, Mic, ShieldAlert,
  RotateCcw, Headphones, CheckCircle2, FileMusic, Loader2, Send,
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
  const [pipelineMessage, setPipelineMessage] = useState("");
  const [jobResults, setJobResults] = useState(null);
  const [formError, setFormError] = useState("");
  const [detailedError, setDetailedError] = useState(null);

  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsData, setDiagnosticsData] = useState(null);
  const [dismissDriveAlert, setDismissDriveAlert] = useState(false);
  const [sendingPreview, setSendingPreview] = useState(false);
  const [previewSentMessage, setPreviewSentMessage] = useState("");

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

  
  const handleSendPreviewToClient = async () => {
    if (!phone) {
      setFormError("Informe o WhatsApp do cliente para enviar a prévia.");
      return;
    }
    setSendingPreview(true);
    setPreviewSentMessage("");
    try {
      const res = await base44.functions.invoke("sendUmblerPreview", {
        phone: phone,
        customer_name: customerName,
        job_id: jobResults?.job?.id || jobResults?.job_id,
      });
      if (res.data?.success) {
        setPreviewSentMessage("Prévia de 1:10 e cobrança enviadas com sucesso no WhatsApp!");
      } else {
        setFormError(res.data?.error || "Não foi possível enviar a prévia no WhatsApp.");
      }
    } catch (err) {
      setFormError(err.message || "Erro ao conectar com serviço de envio.");
    } finally {
      setSendingPreview(false);
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
      if (!v1VocalUri || !v1InstUri) {
        setFormError("Por favor, envie pelo menos o Vocal e o Playback da Versão 01.");
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

  const finishAsyncMix = async (startResponse) => {
    const startData = startResponse?.data || startResponse;
    const jobIds = startData?.jobIds;
    if (!startData?.success || !Array.isArray(jobIds) || jobIds.length !== 2) {
      throw new Error(startData?.error || "Não foi possível iniciar a mixagem em segundo plano.");
    }

    let completedJobs = null;
    for (let attempt = 0; attempt < 180; attempt++) {
      let currentJobs = null;
      try {
        currentJobs = await Promise.all(jobIds.map((id) => base44.entities.ProcessingJob.get(id)));
      } catch (pollError) {
        console.warn("Falha temporária ao consultar a mixagem; tentando novamente.", pollError?.message || pollError);
      }

      if (currentJobs) {
        const failedJob = currentJobs.find((job) => job?.status === "failed");
        if (failedJob) {
          throw new Error(failedJob.error_message || "Falha ao mixar uma das versões.");
        }
        if (currentJobs.every((job) => job?.status === "completed")) {
          completedJobs = currentJobs;
          break;
        }
      }

      const elapsedSeconds = (attempt + 1) * 4;
      setPipelineMessage("Passo 3/3: Mixagem em segundo plano (" + elapsedSeconds + "s)...");
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }

    if (!completedJobs) {
      throw new Error("A mixagem não concluiu dentro do tempo esperado. Consulte o status do job antes de iniciar outra produção.");
    }

    const [job1, job2] = completedJobs;
    const finalResponse = await base44.functions.invoke("runPipeline", {
      action: "finalize_mix",
      jobId: job1.id,
      otherJobId: job2.id,
      phone,
    });
    const finalData = finalResponse.data || finalResponse;
    if (!finalData?.success) {
      throw new Error(finalData?.error || "Não foi possível finalizar os downloads da produção.");
    }

    setJobResults(finalData);
    setFlowStage("ready");
  };

  const executePipeline = async (clientUri) => {
    setFlowStage("processing");
    const isPreGen = arrangementMode === "pre_generated";
    const styleToUse = customStyle.trim() || selectedStyle;

    try {
      if (isPreGen) {
        // FLUXO STEMS: inicia jobs de mixagem assíncronos para não manter a requisição aberta.
        setPipelineMessage("Mixando sua voz com os stems e gerando arquivos WAV e MP3...");
        const payload = {
          action: "start_mix",
          client_audio_uri: clientUri,
          clientAudioFileUri: clientUri,
          phone,
          customer_name: customerName,
          hasDirectStems: true,
          pre_generated_v1_vocal_uri: v1VocalUri,
          v1VocalFileUri: v1VocalUri,
          pre_generated_v1_instrumental_uri: v1InstUri,
          v1InstFileUri: v1InstUri,
          pre_generated_v2_vocal_uri: v2VocalUri || v1VocalUri,
          v2VocalFileUri: v2VocalUri || v1VocalUri,
          pre_generated_v2_instrumental_uri: v2InstUri || v1InstUri,
          v2InstFileUri: v2InstUri || v1InstUri,
        };

        console.log("Disparando runPipeline (Stems diretos):", payload);
        const res = await base44.functions.invoke("runPipeline", payload);
        await finishAsyncMix(res);
      } else {
        // FLUXO SUNO IA: Ciclo modular assíncrono para eliminar 504 por timeout
        setPipelineMessage("Passo 1/3: Criando arranjo musical com IA (Suno)...");
        const sunoInit = await base44.functions.invoke("runPipeline", {
          action: "create_suno",
          lyrics: customerLyrics || "Música personalizada",
          musicPrompt: styleToUse,
        });

        if (!sunoInit.data?.taskId) {
          throw new Error(sunoInit.data?.error || "Não foi possível iniciar a geração musical.");
        }
        const taskId = sunoInit.data.taskId;

        // Polling do Suno
        let sunoData = null;
        let attempts = 0;
        while (!sunoData && attempts < 60) {
          attempts++;
          await new Promise((r) => setTimeout(r, 4000));
          setPipelineMessage(`Passo 1/3: Aguardando arranjo musical do Suno (${attempts * 4}s)...`);
          try {
            const pollRes = await base44.functions.invoke("runPipeline", {
              action: "poll_suno",
              taskId,
            });
            if (pollRes.data?.status === "SUCCESS") {
              sunoData = pollRes.data.result;
            } else if (pollRes.data?.status === "ERROR") {
              throw new Error(pollRes.data.error || "Erro na geração do Suno.");
            }
          } catch (pollError) {
            // Um 504 ou erro de rede isolado não deve cancelar a geração.
            console.warn("Falha temporária ao consultar o Suno; tentando novamente.", pollError?.message || pollError);
          }
        }

        if (!sunoData) throw new Error("Tempo limite excedido na criação do arranjo.");

        // Passo 2: Separar stems no Suno
        setPipelineMessage("Passo 2/3: Separando faixas de voz e playback...");
        const stemTask1 = await base44.functions.invoke("runPipeline", {
          action: "create_stems",
          taskId,
          audioId: sunoData.version1.audioId,
        });
        const stemTask2 = await base44.functions.invoke("runPipeline", {
          action: "create_stems",
          taskId,
          audioId: sunoData.version2.audioId,
        });

        const id1 = stemTask1.data?.stemTaskId;
        const id2 = stemTask2.data?.stemTaskId;
        if (!id1 || !id2) throw new Error("Falha ao iniciar separação de stems.");

        // Polling das Stems
        let stems1 = null;
        let stems2 = null;
        attempts = 0;
        while ((!stems1 || !stems2) && attempts < 45) {
          attempts++;
          await new Promise((r) => setTimeout(r, 4000));
          setPipelineMessage(`Passo 2/3: Extraindo faixas isoladas (${attempts * 4}s)...`);
          if (!stems1) {
            try {
              const p1 = await base44.functions.invoke("runPipeline", { action: "poll_stems", stemTaskId: id1 });
              if (p1.data?.status === "SUCCESS") stems1 = p1.data.stems;
              else if (p1.data?.status === "ERROR") throw new Error(p1.data.error || "Erro na separação dos stems.");
            } catch (pollError) {
              console.warn("Falha temporária ao consultar os stems da versão 1; tentando novamente.", pollError?.message || pollError);
            }
          }
          if (!stems2) {
            try {
              const p2 = await base44.functions.invoke("runPipeline", { action: "poll_stems", stemTaskId: id2 });
              if (p2.data?.status === "SUCCESS") stems2 = p2.data.stems;
              else if (p2.data?.status === "ERROR") throw new Error(p2.data.error || "Erro na separação dos stems.");
            } catch (pollError) {
              console.warn("Falha temporária ao consultar os stems da versão 2; tentando novamente.", pollError?.message || pollError);
            }
          }
        }

        if (!stems1 || !stems2) throw new Error("Tempo limite excedido na extração de stems.");

        // Passo 3: Mixar e sincronizar a voz do cliente
        setPipelineMessage("Passo 3/3: Sincronizando sua voz e gerando masters...");
        const mixRes = await base44.functions.invoke("runPipeline", {
          action: "start_mix",
          client_audio_uri: clientUri,
          clientAudioFileUri: clientUri,
          phone,
          customer_name: customerName,
          stems1,
          stems2,
        });
        await finishAsyncMix(mixRes);
      }
    } catch (err) {
      console.error("Erro capturado no executePipeline:", err);
      setFormError(`Erro no processamento: ${err.message || err}`);
      setFlowStage("initial");
    }
  };

  
  const handleSendPreview = async () => {
    setSendingPreview(true);
    try {
      const res = await base44.functions.sendUmblerPreview({
        job_id: jobResults?.job?.id || jobResults?.job_id,
        phone: phone || jobResults?.job?.phone,
        customer_name: customerName,
      });
      if (res.data?.success) {
        setPreviewSentSuccess(true);
        toast.success("Prévia e cobrança Pix enviadas com sucesso para o WhatsApp!");
      } else {
        toast.error(res.data?.error || "Erro ao enviar prévia via WhatsApp.");
      }
    } catch (err) {
      toast.error("Falha ao comunicar com o servidor para envio da prévia.");
    } finally {
      setSendingPreview(false);
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
                Cante ou anexe sua voz. O sistema sincroniza seus vocais com os playbacks e entrega os arquivos prontos para lançamento.
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
                      <div className="text-xs text-slate-400 mt-0.5">Envie os vocais da IA e instrumentais (Versão 2 opcional).</div>
                    </div>
                  </button>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pt-2">
                {arrangementMode === "generate_suno" && (
                  <div className="space-y-5 animate-in fade-in duration-200">
                    <div className="space-y-2">
                      <Label className="text-slate-300 text-xs font-semibold uppercase tracking-wider">Tags de Estilo Musical</Label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                        {STYLE_OPTIONS.map((style) => (
                          <button
                            key={style}
                            type="button"
                            onClick={() => {
                              setSelectedStyle(style);
                              if (!customStyle) setGeneratedPrompt("");
                            }}
                            className={`text-xs font-medium py-2 px-2.5 rounded-lg border transition-all text-center truncate ${
                              selectedStyle === style
                                ? "bg-indigo-600 border-indigo-400 text-white shadow-md shadow-indigo-600/30"
                                : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                            }`}
                          >
                            {style}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2 bg-slate-950/80 p-4 rounded-xl border border-slate-800">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="customStyle" className="text-slate-200 font-semibold text-sm flex items-center gap-1.5">
                          <Sliders className="w-4 h-4 text-indigo-400" />
                          Estilo Personalizado (Opcional)
                        </Label>
                      </div>
                      <Input
                        id="customStyle"
                        placeholder="Digite o estilo ou detalhes do arranjo..."
                        value={customStyle}
                        onChange={(e) => setCustomStyle(e.target.value)}
                        className="bg-slate-900 border-slate-700 text-white placeholder:text-slate-600 focus:border-indigo-500"
                      />
                    </div>
                  </div>
                )}

                {arrangementMode === "pre_generated" && (
                  <div className="space-y-6 animate-in fade-in duration-200">
                    <Alert className="bg-indigo-950/40 border-indigo-500/30 text-indigo-200">
                      <Layers className="w-4 h-4 text-indigo-400" />
                      <AlertDescription className="text-xs leading-relaxed ml-2">
                        <strong>Envio Direto:</strong> A <strong>Versão 01</strong> é obrigatória. A <strong>Versão 02</strong> é opcional (se não enviar, duplicamos a Versão 01).
                      </AlertDescription>
                    </Alert>

                    {/* Versão 01 (Obrigatória) */}
                    <div className="space-y-3 bg-slate-950/90 border border-slate-800 rounded-xl p-4">
                      <h4 className="font-bold text-sm text-indigo-300">Versão 01 (Obrigatória)</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-xs text-slate-300 font-medium">Voz da IA (Vocal) - Versão 01*</Label>
                          {!v1VocalFile ? (
                            <label className="cursor-pointer border border-dashed border-slate-700 hover:border-indigo-500 rounded-lg p-3 mt-1 flex flex-col items-center justify-center text-center">
                              <Upload className="w-5 h-5 text-indigo-400 mb-1" />
                              <span className="text-xs text-slate-300">Selecionar Vocal 1</span>
                              <input type="file" accept="audio/*" className="hidden" onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) { setV1VocalFile(f); handleUploadFile(f, setV1VocalUri); }
                              }} />
                            </label>
                          ) : (
                            <div className="text-xs text-emerald-400 mt-1 flex items-center justify-between bg-slate-900 p-2 rounded">
                              <span>✓ {v1VocalFile.name}</span>
                              <button onClick={() => { setV1VocalFile(null); setV1VocalUri(null); }} className="text-red-400 hover:text-red-300 ml-2">Remover</button>
                            </div>
                          )}
                        </div>

                        <div>
                          <Label className="text-xs text-slate-300 font-medium">Playback (Instrumental) - Versão 01*</Label>
                          {!v1InstFile ? (
                            <label className="cursor-pointer border border-dashed border-slate-700 hover:border-indigo-500 rounded-lg p-3 mt-1 flex flex-col items-center justify-center text-center">
                              <Upload className="w-5 h-5 text-indigo-400 mb-1" />
                              <span className="text-xs text-slate-300">Selecionar Playback 1</span>
                              <input type="file" accept="audio/*" className="hidden" onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) { setV1InstFile(f); handleUploadFile(f, setV1InstUri); }
                              }} />
                            </label>
                          ) : (
                            <div className="text-xs text-emerald-400 mt-1 flex items-center justify-between bg-slate-900 p-2 rounded">
                              <span>✓ {v1InstFile.name}</span>
                              <button onClick={() => { setV1InstFile(null); setV1InstUri(null); }} className="text-red-400 hover:text-red-300 ml-2">Remover</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Versão 02 (Opcional) */}
                    <div className="space-y-3 bg-slate-950/90 border border-slate-800 rounded-xl p-4">
                      <h4 className="font-bold text-sm text-purple-300">Versão 02 (Opcional)</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-xs text-slate-300 font-medium">Voz da IA (Vocal) - Versão 02</Label>
                          {!v2VocalFile ? (
                            <label className="cursor-pointer border border-dashed border-slate-700 hover:border-purple-500 rounded-lg p-3 mt-1 flex flex-col items-center justify-center text-center">
                              <Upload className="w-5 h-5 text-purple-400 mb-1" />
                              <span className="text-xs text-slate-300">Selecionar Vocal 2 (Opcional)</span>
                              <input type="file" accept="audio/*" className="hidden" onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) { setV2VocalFile(f); handleUploadFile(f, setV2VocalUri); }
                              }} />
                            </label>
                          ) : (
                            <div className="text-xs text-emerald-400 mt-1 flex items-center justify-between bg-slate-900 p-2 rounded">
                              <span>✓ {v2VocalFile.name}</span>
                              <button onClick={() => { setV2VocalFile(null); setV2VocalUri(null); }} className="text-red-400 hover:text-red-300 ml-2">Remover</button>
                            </div>
                          )}
                        </div>

                        <div>
                          <Label className="text-xs text-slate-300 font-medium">Playback (Instrumental) - Versão 02</Label>
                          {!v2InstFile ? (
                            <label className="cursor-pointer border border-dashed border-slate-700 hover:border-purple-500 rounded-lg p-3 mt-1 flex flex-col items-center justify-center text-center">
                              <Upload className="w-5 h-5 text-purple-400 mb-1" />
                              <span className="text-xs text-slate-300">Selecionar Playback 2 (Opcional)</span>
                              <input type="file" accept="audio/*" className="hidden" onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) { setV2InstFile(f); handleUploadFile(f, setV2InstUri); }
                              }} />
                            </label>
                          ) : (
                            <div className="text-xs text-emerald-400 mt-1 flex items-center justify-between bg-slate-900 p-2 rounded">
                              <span>✓ {v2InstFile.name}</span>
                              <button onClick={() => { setV2InstFile(null); setV2InstUri(null); }} className="text-red-400 hover:text-red-300 ml-2">Remover</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-center pt-2">
              <Button
                size="lg"
                onClick={handleStartProduction}
                disabled={uploadingClientAudio || uploadingPreGen}
                className="w-full sm:w-auto min-w-[280px] bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white font-bold py-6 text-base shadow-xl shadow-indigo-600/20 gap-2 rounded-xl transition-all"
              >
                <Sparkles className="w-5 h-5" />
                Iniciar Produção Musical
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
          </div>
        )}

        {flowStage === "processing" && (
          <div className="space-y-8 max-w-2xl mx-auto py-12 animate-in fade-in duration-300 text-center">
            <div className="inline-flex p-4 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-400 mb-2">
              <Loader2 className="w-10 h-10 animate-spin" />
            </div>
            <h2 className="text-2xl font-bold text-white">Produzindo Sua Música</h2>
            <p className="text-sm text-slate-400">{pipelineMessage}</p>
          </div>
        )}

        {flowStage === "ready" && jobResults && (
          <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl mx-auto">
            <div className="text-center space-y-2">
              <div className="inline-flex p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 mb-2">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h2 className="text-3xl font-extrabold text-white">Sua Produção Está Pronta!</h2>
              <p className="text-sm text-slate-400 max-w-xl mx-auto">
                Todas as faixas foram mixadas, sincronizadas e preparadas com sucesso. Ouça e baixe abaixo:
              </p>
            </div>

            {/* Alerta não-bloqueante do Google Drive caso ocorra falha no salvamento */}
            {showDriveAlert && jobResults.drive_status && !jobResults.drive_status.saved && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3 text-sm">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-amber-300">Aviso sobre o Google Drive</p>
                    <p className="text-xs text-amber-200/80">
                      {jobResults.drive_status.message || "Não foi possível salvar uma cópia no Google Drive neste momento, mas seus arquivos estão prontos para download abaixo."}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDriveAlert(false)}
                  className="border-amber-500/40 text-amber-300 hover:bg-amber-500/20 text-xs shrink-0"
                >
                  Continuar assim mesmo
                </Button>
              </div>
            )}

            {/* CENTRAL DE AÇÕES / ENVIO DE PRÉVIA */}
            <Card className="bg-slate-900/90 border-purple-500/30 shadow-xl p-5">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="space-y-1 text-center sm:text-left">
                  <h4 className="text-base font-bold text-white flex items-center gap-2 justify-center sm:justify-start">
                    <Send className="w-4 h-4 text-purple-400" /> Envio de Prévia para o Cliente
                  </h4>
                  <p className="text-xs text-slate-400">
                    Dispara o bot no WhatsApp, envia a música cortada em 1:10 e o botão oficial Meta para copiar a chave Pix.
                  </p>
                </div>
                <Button
                  onClick={handleSendPreview}
                  disabled={sendingPreview || previewSentSuccess}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-semibold gap-2 shrink-0 px-6 py-2"
                >
                  {sendingPreview ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Enviando...
                    </>
                  ) : previewSentSuccess ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Prévia Enviada!
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" /> Enviar prévia
                    </>
                  )}
                </Button>
              </div>
            </Card>

            {/* CENTRAL DE DOWNLOADS */}
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <FileMusic className="w-5 h-5 text-indigo-400" /> Central de Downloads da Produção
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* BLOCO 1: Mixagem com a Voz (Disponível em WAV e MP3) */}
                <Card className="bg-slate-900 border-indigo-500/40 shadow-xl">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base text-indigo-300 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-indigo-400" /> Bloco 1: Mixagem com a Voz
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-400">
                      Sua voz afinada e sincronizada aos arranjos (WAV e MP3)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Versão 01 */}
                    {(jobResults.downloads?.final_voz_1 || jobResults.downloads?.final_voz_1_mp3) && (
                      <div className="space-y-2 p-3 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                          <span>FINAL COM VOZ 01</span>
                          <div className="flex items-center gap-3">
                            {jobResults.downloads.final_voz_1 && (
                              <a href={jobResults.downloads.final_voz_1} download className="text-indigo-400 hover:underline">
                                Baixar WAV
                              </a>
                            )}
                            {jobResults.downloads.final_voz_1_mp3 && (
                              <a href={jobResults.downloads.final_voz_1_mp3} download className="text-emerald-400 hover:underline">
                                Baixar MP3
                              </a>
                            )}
                          </div>
                        </div>
                        <audio controls className="w-full h-8" src={jobResults.downloads.final_voz_1 || jobResults.downloads.final_voz_1_mp3} />
                      </div>
                    )}

                    {/* Versão 02 */}
                    {(jobResults.downloads?.final_voz_2 || jobResults.downloads?.final_voz_2_mp3) && (
                      <div className="space-y-2 p-3 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                          <span>FINAL COM VOZ 02</span>
                          <div className="flex items-center gap-3">
                            {jobResults.downloads.final_voz_2 && (
                              <a href={jobResults.downloads.final_voz_2} download className="text-indigo-400 hover:underline">
                                Baixar WAV
                              </a>
                            )}
                            {jobResults.downloads.final_voz_2_mp3 && (
                              <a href={jobResults.downloads.final_voz_2_mp3} download className="text-emerald-400 hover:underline">
                                Baixar MP3
                              </a>
                            )}
                          </div>
                        </div>
                        <audio controls className="w-full h-8" src={jobResults.downloads.final_voz_2 || jobResults.downloads.final_voz_2_mp3} />
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* BLOCO 2: Playbacks Instrumentais (Disponível em MP3 e WAV) */}
                <Card className="bg-slate-900 border-amber-500/40 shadow-xl">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base text-amber-300 flex items-center gap-2">
                      <Headphones className="w-4 h-4 text-amber-400" /> Bloco 2: Playbacks Instrumentais
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-400">
                      Instrumentais isolados de estúdio (MP3 e WAV)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Playback 01 */}
                    {(jobResults.downloads?.playback_1 || jobResults.downloads?.playback_1_wav) && (
                      <div className="space-y-2 p-3 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                          <span>PLAYBACK 01</span>
                          <div className="flex items-center gap-3">
                            {jobResults.downloads.playback_1 && (
                              <a href={jobResults.downloads.playback_1} download className="text-amber-400 hover:underline">
                                Baixar MP3
                              </a>
                            )}
                            {jobResults.downloads.playback_1_wav && (
                              <a href={jobResults.downloads.playback_1_wav} download className="text-indigo-400 hover:underline">
                                Baixar WAV
                              </a>
                            )}
                          </div>
                        </div>
                        <audio controls className="w-full h-8" src={jobResults.downloads.playback_1 || jobResults.downloads.playback_1_wav} />
                      </div>
                    )}

                    {/* Playback 02 */}
                    {(jobResults.downloads?.playback_2 || jobResults.downloads?.playback_2_wav) && (
                      <div className="space-y-2 p-3 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                          <span>PLAYBACK 02</span>
                          <div className="flex items-center gap-3">
                            {jobResults.downloads.playback_2 && (
                              <a href={jobResults.downloads.playback_2} download className="text-amber-400 hover:underline">
                                Baixar MP3
                              </a>
                            )}
                            {jobResults.downloads.playback_2_wav && (
                              <a href={jobResults.downloads.playback_2_wav} download className="text-indigo-400 hover:underline">
                                Baixar WAV
                              </a>
                            )}
                          </div>
                        </div>
                        <audio controls className="w-full h-8" src={jobResults.downloads.playback_2 || jobResults.downloads.playback_2_wav} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            <div className="flex justify-center pt-4">
              <Button onClick={() => setFlowStage("initial")} variant="outline" className="border-slate-700 text-slate-200 gap-2">
                <RotateCcw className="w-4 h-4" /> Produzir Outra Música
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}