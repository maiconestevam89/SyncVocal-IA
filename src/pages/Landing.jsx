import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Music,
  ArrowRight,
  Sparkles,
  Upload,
  Mic,
  ShieldAlert,
  ShieldCheck,
  RotateCcw,
  Headphones,
  CheckCircle2,
  FileMusic,
  Loader2,
  Copy,
  ExternalLink,
  Share2,
  Gift,
  Video,
  FileText,
  Trash2,
  Sliders,
  Layers,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import AudioRecorder from "@/components/audio/AudioRecorder";
import { base44 } from "@/api/base44Client";

const STYLE_OPTIONS = [
  "Sertanejo",
  "Pop Rock",
  "MPB",
  "Trap",
  "Funk",
  "Gospel",
  "Samba",
  "Forró",
  "Bossa Nova",
  "Pagode",
  "Axé",
  "Romântica",
  "Eletrônica",
  "Acústico",
];

export default function Landing() {
  const navigate = useNavigate();

  // ── 1. Dados do Cliente ──
  const [phone, setPhone] = useState("");
  const [customerName, setCustomerName] = useState("");

  // ── 2. Voz do Cliente (Passo 2 - antes do estilo) ──
  const [clientAudioFile, setClientAudioFile] = useState(null);
  const [clientAudioUrl, setClientAudioUrl] = useState(null);
  const [clientAudioUri, setClientAudioUri] = useState(null);
  const [uploadingClientAudio, setUploadingClientAudio] = useState(false);

  // ── 3. Arranjos e Estilo Musical ──
  // Modo de arranjo: "generate_suno" (criar com IA) | "pre_generated" (já possuo 2 versões)
  const [arrangementMode, setArrangementMode] = useState("generate_suno");

  // Modo A: Geração Suno + Prompt personalizado estilo ADS_APP
  const [selectedStyle, setSelectedStyle] = useState("Sertanejo");
  const [customStyle, setCustomStyle] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [generatingPrompt, setGeneratingPrompt] = useState(false);

  // Modo B: 2 Músicas já geradas por IA
  const [preGenV1File, setPreGenV1File] = useState(null);
  const [preGenV1Url, setPreGenV1Url] = useState(null);
  const [preGenV1Uri, setPreGenV1Uri] = useState(null);

  const [preGenV2File, setPreGenV2File] = useState(null);
  const [preGenV2Url, setPreGenV2Url] = useState(null);
  const [preGenV2Uri, setPreGenV2Uri] = useState(null);

  const [uploadingPreGen, setUploadingPreGen] = useState(false);

  // ── Estados de Fluxo & Pipeline ──
  // "initial" | "checking_copyright" | "copyright_blocked" | "processing" | "ready"
  const [flowStage, setFlowStage] = useState("initial");
  const [copyrightData, setCopyrightData] = useState(null);
  const [pipelineStep, setPipelineStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(7);
  const [pipelineMessage, setPipelineMessage] = useState("");
  const [jobResults, setJobResults] = useState(null);
  const [formError, setFormError] = useState("");

  // Modal / Diálogo de envio de prévia (Fluxo 9)
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [sendingPreview, setSendingPreview] = useState(false);
  const [previewSent, setPreviewSent] = useState(false);
  const [pixInfo, setPixInfo] = useState(null);
  const [copiedPix, setCopiedPix] = useState(false);

  // Auto-preenchimento por query string ?phone=
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

  // ── Manipulação do Áudio da Voz do Cliente ──
  const handleClientAudioSelected = async (file) => {
    if (!file) return;
    setFormError("");
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

  // ── Geração do Prompt Suno baseado no Estilo Personalizado (estilo ADS_APP) ──
  const handleGenerateMusicPrompt = async () => {
    const inputStyle = customStyle.trim() || selectedStyle;
    if (!inputStyle) return;

    setGeneratingPrompt(true);
    setFormError("");
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
      // Fallback local caso a função falhe
      setGeneratedPrompt(
        `${inputStyle}, professional music production, acoustic and modern instruments, clear mix, emotional rhythm, radio ready`
      );
    } finally {
      setGeneratingPrompt(false);
    }
  };

  // ── Manipulação das Músicas Pré-Geradas (Modo B) ──
  const handlePreGenV1Selected = async (file) => {
    if (!file) return;
    setPreGenV1File(file);
    setPreGenV1Url(URL.createObjectURL(file));
    setUploadingPreGen(true);
    try {
      const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
      setPreGenV1Uri(file_uri);
    } catch (err) {
      console.error("Erro no upload da versão 1:", err);
      setFormError("Erro ao enviar Música IA - Versão 1");
    } finally {
      setUploadingPreGen(false);
    }
  };

  const handlePreGenV2Selected = async (file) => {
    if (!file) return;
    setPreGenV2File(file);
    setPreGenV2Url(URL.createObjectURL(file));
    setUploadingPreGen(true);
    try {
      const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
      setPreGenV2Uri(file_uri);
    } catch (err) {
      console.error("Erro no upload da versão 2:", err);
      setFormError("Erro ao enviar Música IA - Versão 2");
    } finally {
      setUploadingPreGen(false);
    }
  };

  // ── Validação e Início da Produção ──
  const handleStartProduction = async () => {
    setFormError("");

    if (!phone || phone.replace(/\D/g, "").length < 10) {
      setFormError("Por favor, informe um WhatsApp válido com DDD.");
      return;
    }

    if (!clientAudioFile && !clientAudioUri) {
      setFormError("Por favor, anexe a gravação ou arquivo da sua voz no Passo 2.");
      return;
    }

    if (arrangementMode === "pre_generated") {
      if (!preGenV1File || !preGenV2File) {
        setFormError("No modo de versões já geradas, é obrigatório anexar os 2 arquivos (Versão 1 e Versão 2).");
        return;
      }
    }

    // Garante que o arquivo da voz esteja no storage
    let activeClientUri = clientAudioUri;
    if (!activeClientUri && clientAudioFile) {
      setUploadingClientAudio(true);
      try {
        const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file: clientAudioFile });
        activeClientUri = file_uri;
        setClientAudioUri(file_uri);
      } catch (err) {
        setFormError("Erro ao enviar arquivo da voz. Tente novamente.");
        setUploadingClientAudio(false);
        return;
      }
      setUploadingClientAudio(false);
    }

    // Se estiver no Modo B, garante upload das duas versões
    let v1Uri = preGenV1Uri;
    let v2Uri = preGenV2Uri;
    if (arrangementMode === "pre_generated") {
      setUploadingPreGen(true);
      try {
        if (!v1Uri && preGenV1File) {
          const res1 = await base44.integrations.Core.UploadPrivateFile({ file: preGenV1File });
          v1Uri = res1.file_uri;
          setPreGenV1Uri(v1Uri);
        }
        if (!v2Uri && preGenV2File) {
          const res2 = await base44.integrations.Core.UploadPrivateFile({ file: preGenV2File });
          v2Uri = res2.file_uri;
          setPreGenV2Uri(v2Uri);
        }
      } catch (err) {
        setFormError("Erro ao enviar versões pré-geradas para o servidor.");
        setUploadingPreGen(false);
        return;
      }
      setUploadingPreGen(false);
    }

    // ── Etapa 1: Verificação de Direitos Autorais no Music.ai ──
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
      // Continua se falha de rede temporária
    }

    // Prossegue para o pipeline
    executePipeline(activeClientUri, v1Uri, v2Uri);
  };

  const handleRetryAnotherSong = () => {
    setClientAudioFile(null);
    setClientAudioUrl(null);
    setClientAudioUri(null);
    setCopyrightData(null);
    setFlowStage("initial");
  };

  // ── Execução do Pipeline Backend ──
  const executePipeline = async (clientUri, v1Uri, v2Uri) => {
    setFlowStage("processing");
    const isPreGen = arrangementMode === "pre_generated" && Boolean(v1Uri && v2Uri);
    setTotalSteps(isPreGen ? 6 : 7);

    const styleToUse = generatedPrompt.trim() || customStyle.trim() || selectedStyle;

    setPipelineStep(1);
    setPipelineMessage("Verificação de direitos autorais aprovada.");

    // Atualização de mensagens em etapas
    const t1 = setTimeout(() => {
      setPipelineStep(2);
      setPipelineMessage(
        isPreGen
          ? "Carregando versões de IA fornecidas (criação no Suno dispensada)..."
          : "Transcrevendo áudio com Gemini e gerando prompt no Suno..."
      );
    }, 4000);

    const t2 = setTimeout(() => {
      setPipelineStep(3);
      setPipelineMessage("Separando vocais e instrumentais das 2 versões...");
    }, 12000);

    const t3 = setTimeout(() => {
      setPipelineStep(4);
      setPipelineMessage("Limpando e masterizando a voz do cliente no Music.ai...");
    }, 24000);

    const t4 = setTimeout(() => {
      setPipelineStep(5);
      setPipelineMessage("Sincronizando e mixando a voz masterizada nas 2 versões (DSP)...");
    }, 38000);

    const t5 = setTimeout(() => {
      setPipelineStep(6);
      setPipelineMessage("Salvando os 8 arquivos estruturados no Google Drive...");
    }, 52000);

    try {
      const payload = {
        client_audio_uri: clientUri,
        phone,
        customer_name: customerName,
        style_choice: styleToUse,
      };

      if (isPreGen) {
        payload.pre_generated_v1_uri = v1Uri;
        payload.pre_generated_v2_uri = v2Uri;
      }

      const res = await base44.functions.invoke("runPipeline", payload);

      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);

      if (res.data?.success) {
        setJobResults(res.data);
        setPipelineStep(isPreGen ? 6 : 7);
        setPipelineMessage("Produção finalizada com sucesso!");
        setFlowStage("ready");
      } else {
        throw new Error(res.data?.error || "Falha na produção");
      }
    } catch (err) {
      console.error("Erro no pipeline:", err);
      alert(`Ocorreu um erro no processamento: ${err.message}`);
      setFlowStage("initial");
    }
  };

  // ── FLUXO 9: Disparo de prévia e cobrança Umbler/Asaas ──
  const handleConfirmSendPreview = async () => {
    setSendingPreview(true);
    try {
      const res = await base44.functions.invoke("sendUmblerPreview", {
        job_id: jobResults?.job?.id,
        phone,
        customer_name: customerName,
      });

      if (res.data?.success) {
        setPreviewSent(true);
        setPixInfo({
          pixCode: res.data.pix_code,
          pixQrBase64: res.data.pix_qr_base64,
          invoiceUrl: res.data.invoice_url,
        });
      }
    } catch (err) {
      alert("Erro ao disparar prévias: " + err.message);
    } finally {
      setSendingPreview(false);
      setShowPreviewModal(false);
    }
  };

  const handleCopyPix = () => {
    if (pixInfo?.pixCode) {
      navigator.clipboard.writeText(pixInfo.pixCode);
      setCopiedPix(true);
      setTimeout(() => setCopiedPix(false), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Header com branding */}
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
          <Badge variant="outline" className="border-indigo-500/30 text-indigo-400 bg-indigo-500/10 gap-1.5 py-1 px-3">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            Produção Musical Profissional
          </Badge>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8">
        {/* TELA INICIAL / FORMULÁRIO DE ENTRADA */}
        {flowStage === "initial" && (
          <div className="space-y-8 animate-in fade-in duration-300">
            {/* Hero Banner */}
            <div className="text-center space-y-3">
              <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white">
                Transforme sua voz em uma{" "}
                <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-amber-300 bg-clip-text text-transparent">
                  Música Completa
                </span>
              </h1>
              <p className="text-slate-400 text-sm md:text-base max-w-2xl mx-auto">
                Cante ou anexe sua voz. O sistema masteriza seus vocais, cria ou utiliza suas músicas de inteligência artificial, sincroniza com perfeição e entrega os arquivos prontos para lançamento.
              </p>
            </div>

            {formError && (
              <Alert variant="destructive" className="bg-red-950/60 border-red-800 text-red-200">
                <ShieldAlert className="w-4 h-4 text-red-400" />
                <AlertDescription className="text-sm font-medium">{formError}</AlertDescription>
              </Alert>
            )}

            {/* PASSO 1: DADOS DO CLIENTE */}
            <Card className="bg-slate-900 border-slate-800 shadow-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2 text-white">
                  <span className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 flex items-center justify-center text-xs font-bold">
                    1
                  </span>
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

            {/* PASSO 2: ANEXE SUA VOZ CANTANDO (VINDO ANTES DO ESTILO MUSICAL) */}
            <Card className="bg-slate-900 border-slate-800 shadow-2xl ring-1 ring-indigo-500/20">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2 text-white">
                    <span className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 flex items-center justify-center text-xs font-bold">
                      2
                    </span>
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
                    {/* Gravação Direta */}
                    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center text-center">
                      <div className="w-12 h-12 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3">
                        <Mic className="w-6 h-6" />
                      </div>
                      <h3 className="font-semibold text-slate-200 text-sm mb-1">Gravar com Microfone</h3>
                      <p className="text-xs text-slate-400 mb-4">Cante ou fale direto no navegador</p>
                      <AudioRecorder onRecorded={handleClientAudioSelected} label="Gravar Voz" />
                    </div>

                    {/* Upload de Arquivo */}
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
                        className="text-red-400 hover:text-red-300 hover:bg-red-950/30 h-8 gap-1 text-xs"
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

            {/* PASSO 3: ARRANJOS E ESTILO MUSICAL */}
            <Card className="bg-slate-900 border-slate-800 shadow-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2 text-white">
                  <span className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 flex items-center justify-center text-xs font-bold">
                    3
                  </span>
                  Arranjos e Estilo Musical
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Escolha se deseja que a IA gere os arranjos ou se já possui duas versões criadas.
                </CardDescription>

                {/* Seleção do Modo de Arranjo */}
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
                      <div className="text-xs text-slate-400 mt-0.5">
                        Defina o estilo e gere 2 versões inéditas automaticamente.
                      </div>
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
                      <div className="text-sm font-bold">Já possuo 2 versões de IA</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        Anexe os 2 arquivos para pular a criação de arranjo.
                      </div>
                    </div>
                  </button>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pt-2">
                {/* ── OPÇÃO A: GERAÇÃO COM IA (SUNO) + PROMPT PERSONALIZADO ADS_APP ── */}
                {arrangementMode === "generate_suno" && (
                  <div className="space-y-5 animate-in fade-in duration-200">
                    {/* Tags Rápidas de Estilo */}
                    <div className="space-y-2">
                      <Label className="text-slate-300 text-xs font-semibold uppercase tracking-wider">
                        Tags de Estilo Musical
                      </Label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                        {STYLE_OPTIONS.map((style) => (
                          <button
                            key={style}
                            type="button"
                            onClick={() => {
                              setSelectedStyle(style);
                              // Atualiza prompt gerado quando seleciona tag
                              if (!customStyle) {
                                setGeneratedPrompt("");
                              }
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

                    {/* Campo de Estilo Personalizado (estilo ADS_APP) */}
                    <div className="space-y-2 bg-slate-950/80 p-4 rounded-xl border border-slate-800">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="customStyle" className="text-slate-200 font-semibold text-sm flex items-center gap-1.5">
                          <Sliders className="w-4 h-4 text-indigo-400" />
                          Estilo Personalizado (Opcional)
                        </Label>
                        <span className="text-[11px] text-slate-500">Ex: Sertanejo universitário animado, sanfona marcante</span>
                      </div>
                      <Input
                        id="customStyle"
                        placeholder="Digite o estilo ou detalhes do arranjo que você deseja..."
                        value={customStyle}
                        onChange={(e) => setCustomStyle(e.target.value)}
                        className="bg-slate-900 border-slate-700 text-white placeholder:text-slate-600 focus:border-indigo-500"
                      />

                      {/* Botão para gerar o prompt pro Suno baseado no que está digitado */}
                      <div className="flex items-center justify-between pt-2">
                        <p className="text-xs text-slate-400">
                          Gere um prompt técnico otimizado para o Suno (sem BPM numérico).
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleGenerateMusicPrompt}
                          disabled={generatingPrompt || (!customStyle.trim() && !selectedStyle)}
                          className="bg-purple-600 hover:bg-purple-500 text-white text-xs gap-1.5 shadow-md shadow-purple-600/20"
                        >
                          {generatingPrompt ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Otimizando com IA...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              Gerar Prompt com IA
                            </>
                          )}
                        </Button>
                      </div>

                      {/* Exibição do prompt gerado para o Suno */}
                      {generatedPrompt && (
                        <div className="mt-3 p-3 bg-slate-900 rounded-lg border border-purple-500/30 space-y-1.5 animate-in fade-in duration-200">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-purple-300 flex items-center gap-1">
                              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                              Prompt Otimizado para o Suno:
                            </span>
                            <Badge variant="outline" className="text-[10px] border-purple-500/40 text-purple-300">
                              Pronto para envio
                            </Badge>
                          </div>
                          <p className="text-xs font-mono text-slate-200 leading-relaxed bg-slate-950 p-2.5 rounded border border-slate-800">
                            {generatedPrompt}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── OPÇÃO B: ANEXAR 2 MÚSICAS JÁ GERADAS POR IA ── */}
                {arrangementMode === "pre_generated" && (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <Alert className="bg-indigo-950/40 border-indigo-500/30 text-indigo-200">
                      <Layers className="w-4 h-4 text-indigo-400" />
                      <AlertDescription className="text-xs leading-relaxed ml-2">
                        <strong>Processo de criação no Suno dispensado:</strong> Usaremos diretamente as duas versões enviadas abaixo para separação dos stems (vocal e playback), alinhamento rítmico DSP e mixagem final com a sua voz gravada.
                      </AlertDescription>
                    </Alert>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Campo 1: Música IA - Versão 1 */}
                      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-slate-200 font-semibold text-sm flex items-center gap-1.5">
                            <FileMusic className="w-4 h-4 text-indigo-400" />
                            Música IA - Versão 01*
                          </Label>
                          {preGenV1File && (
                            <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10 text-[10px]">
                              Anexada
                            </Badge>
                          )}
                        </div>

                        {!preGenV1File ? (
                          <label className="cursor-pointer border border-dashed border-slate-700 hover:border-indigo-500 rounded-lg p-5 flex flex-col items-center justify-center text-center transition-colors">
                            <Upload className="w-6 h-6 text-indigo-400 mb-2" />
                            <span className="text-xs font-medium text-slate-300">Upload Versão 01</span>
                            <span className="text-[10px] text-slate-500 mt-0.5">MP3 ou WAV (máx 25MB)</span>
                            <input
                              type="file"
                              accept="audio/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handlePreGenV1Selected(f);
                              }}
                            />
                          </label>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs text-slate-300 font-mono truncate">{preGenV1File.name}</p>
                            {preGenV1Url && <audio controls className="w-full h-8" src={preGenV1Url} />}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setPreGenV1File(null);
                                setPreGenV1Url(null);
                                setPreGenV1Uri(null);
                              }}
                              className="text-xs text-red-400 h-7 p-0 hover:bg-transparent"
                            >
                              Remover / Trocar versão 1
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Campo 2: Música IA - Versão 2 */}
                      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-slate-200 font-semibold text-sm flex items-center gap-1.5">
                            <FileMusic className="w-4 h-4 text-purple-400" />
                            Música IA - Versão 02*
                          </Label>
                          {preGenV2File && (
                            <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10 text-[10px]">
                              Anexada
                            </Badge>
                          )}
                        </div>

                        {!preGenV2File ? (
                          <label className="cursor-pointer border border-dashed border-slate-700 hover:border-purple-500 rounded-lg p-5 flex flex-col items-center justify-center text-center transition-colors">
                            <Upload className="w-6 h-6 text-purple-400 mb-2" />
                            <span className="text-xs font-medium text-slate-300">Upload Versão 02</span>
                            <span className="text-[10px] text-slate-500 mt-0.5">MP3 ou WAV (máx 25MB)</span>
                            <input
                              type="file"
                              accept="audio/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handlePreGenV2Selected(f);
                              }}
                            />
                          </label>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs text-slate-300 font-mono truncate">{preGenV2File.name}</p>
                            {preGenV2Url && <audio controls className="w-full h-8" src={preGenV2Url} />}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setPreGenV2File(null);
                                setPreGenV2Url(null);
                                setPreGenV2Uri(null);
                              }}
                              className="text-xs text-red-400 h-7 p-0 hover:bg-transparent"
                            >
                              Remover / Trocar versão 2
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* BOTÃO PRINCIPAL DE INÍCIO */}
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

        {/* FLUXO 1: VERIFICAÇÃO DE DIREITOS AUTORAIS EM ANDAMENTO */}
        {flowStage === "checking_copyright" && (
          <div className="py-16 text-center space-y-6 animate-in fade-in duration-300">
            <div className="inline-flex p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 animate-pulse">
              <Loader2 className="w-10 h-10 animate-spin" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white">Verificando Direitos Autorais</h2>
              <p className="text-slate-400 max-w-md mx-auto text-sm">
                Analisando o áudio via Music.ai (Audible Magic) para assegurar que a obra está liberada para produção autoral...
              </p>
            </div>
          </div>
        )}

        {/* FLUXO 1: DIREITOS AUTORAIS DETECTADOS (BLOQUEIO E RETRY) */}
        {flowStage === "copyright_blocked" && (
          <div className="space-y-6 max-w-2xl mx-auto animate-in zoom-in-95 duration-300">
            <Alert variant="destructive" className="bg-red-950/50 border-red-800 text-red-200 p-6">
              <ShieldAlert className="w-6 h-6 text-red-400" />
              <AlertTitle className="text-lg font-bold text-red-300 ml-2">
                Direitos Autorais Detectados!
              </AlertTitle>
              <AlertDescription className="text-sm text-red-300/90 ml-2 mt-2 space-y-3">
                <p>
                  O sistema identificou que este áudio pertence a uma obra comercial protegida por direitos autorais. Por motivos legais, músicas protegidas não podem ser produzidas.
                </p>

                {copyrightData && (
                  <div className="bg-red-950/80 rounded-lg p-4 border border-red-800/80 text-xs space-y-1.5 font-mono text-slate-200">
                    <div><strong>Obra:</strong> {copyrightData.title || "Identificada na base fonográfica"}</div>
                    <div><strong>Artista:</strong> {copyrightData.artist || "Não especificado"}</div>
                    {copyrightData.label && <div><strong>Gravadora:</strong> {copyrightData.label}</div>}
                    {copyrightData.isrc && <div><strong>ISRC:</strong> {copyrightData.isrc}</div>}
                  </div>
                )}
              </AlertDescription>
            </Alert>

            <div className="flex justify-center">
              <Button
                size="lg"
                onClick={handleRetryAnotherSong}
                className="bg-indigo-600 hover:bg-indigo-500 text-white gap-2 font-semibold shadow-lg shadow-indigo-600/30"
              >
                <RotateCcw className="w-4 h-4" />
                Tentar outra música
              </Button>
            </div>
          </div>
        )}

        {/* FLUXOS 2 A 7: PIPELINE DE PRODUÇÃO EM ANDAMENTO */}
        {flowStage === "processing" && (
          <div className="space-y-8 max-w-2xl mx-auto py-8 animate-in fade-in duration-300">
            <div className="text-center space-y-3">
              <div className="inline-flex p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                <Sparkles className="w-8 h-8 animate-bounce" />
              </div>
              <h2 className="text-2xl font-bold text-white">Produzindo Sua Música</h2>
              <p className="text-sm text-slate-400">
                Acompanhe o processo em tempo real através da nossa esteira de inteligência artificial:
              </p>
            </div>

            <Card className="bg-slate-900 border-slate-800 p-6 space-y-6 shadow-2xl">
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Progresso Geral</span>
                  <span>{Math.round((pipelineStep / totalSteps) * 100)}%</span>
                </div>
                <Progress value={(pipelineStep / totalSteps) * 100} className="h-2.5 bg-slate-950" />
                <p className="text-xs text-indigo-400 font-medium text-center pt-2">
                  {pipelineMessage}
                </p>
              </div>

              {/* Lista de etapas dinâmica conforme o modo */}
              <div className="space-y-3 text-xs">
                {(arrangementMode === "pre_generated"
                  ? [
                      { num: 1, text: "Verificação de direitos autorais (Music.ai)" },
                      { num: 2, text: "Músicas IA fornecidas pelo usuário (Suno pulado)" },
                      { num: 3, text: "Separação de stems das versões (Vocais e Playbacks)" },
                      { num: 4, text: "Limpeza e Masterização da voz do cliente (Music.ai)" },
                      { num: 5, text: "Sincronização e Mixagem Dupla DSP" },
                      { num: 6, text: "Armazenamento estruturado no Google Drive" },
                    ]
                  : [
                      { num: 1, text: "Verificação de direitos autorais (Music.ai)" },
                      { num: 2, text: "Transcrição da letra e geração do prompt musical" },
                      { num: 3, text: "Geração Suno (2 versões completas mantidas)" },
                      { num: 4, text: "Separação de stems (Vocais e Playbacks)" },
                      { num: 5, text: "Limpeza e Masterização da voz do cliente (Music.ai)" },
                      { num: 6, text: "Sincronização e Mixagem Dupla DSP" },
                      { num: 7, text: "Armazenamento estruturado no Google Drive" },
                    ]
                ).map((st) => (
                  <div
                    key={st.num}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                      pipelineStep >= st.num
                        ? "bg-indigo-950/30 border-indigo-500/30 text-indigo-200"
                        : "bg-slate-950/40 border-slate-800/60 text-slate-500"
                    }`}
                  >
                    {pipelineStep > st.num ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : pipelineStep === st.num ? (
                      <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
                    ) : (
                      <span className="w-4 h-4 rounded-full border border-slate-700 text-[10px] flex items-center justify-center shrink-0">
                        {st.num}
                      </span>
                    )}
                    <span>{st.text}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* FLUXO 8 A 12: MÚSICA PRONTA, DOWNLOADS, PRÉVIA & COBRANÇA */}
        {flowStage === "ready" && jobResults && (
          <div className="space-y-10 animate-in fade-in duration-500">
            {/* Sucesso Header */}
            <div className="text-center space-y-2">
              <div className="inline-flex p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 mb-2">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h2 className="text-3xl font-extrabold text-white">Sua Produção Está Pronta!</h2>
              <p className="text-sm text-slate-400 max-w-xl mx-auto">
                Todas as faixas foram geradas, separadas, mixadas e sincronizadas. Salvas com sucesso no Google Drive na pasta de <strong>{phone}</strong>.
              </p>
            </div>

            {/* FLUXO 9: BOTÃO DE ENVIAR PRÉVIA PARA O WHATSAPP */}
            <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-purple-950 border border-indigo-500/30 rounded-2xl p-6 text-center space-y-4 shadow-xl">
              <h3 className="font-bold text-lg text-white">Disponibilizar Prévia e Cobrança no WhatsApp</h3>
              <p className="text-xs text-slate-300 max-w-lg mx-auto">
                Envie as 4 prévias em alta qualidade e a chave PIX direta para o WhatsApp do cliente através do bot de pré-pagamento.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button
                  size="lg"
                  onClick={() => setShowPreviewModal(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold gap-2 shadow-lg shadow-emerald-600/20"
                >
                  <Share2 className="w-4 h-4" />
                  Enviar prévia
                </Button>
              </div>

              {/* Exibição direta do PIX se gerado */}
              {pixInfo?.pixCode && (
                <div className="mt-6 pt-6 border-t border-slate-800 text-left bg-slate-950/70 p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-emerald-400">PIX Copia e Cola Gerado (R$ 49,90):</span>
                    <Button size="sm" variant="outline" onClick={handleCopyPix} className="text-xs gap-1 border-slate-700">
                      <Copy className="w-3.5 h-3.5" />
                      {copiedPix ? "Copiado!" : "Copiar Chave"}
                    </Button>
                  </div>
                  <div className="p-3 bg-slate-900 rounded border border-slate-800 text-xs font-mono break-all text-slate-300 select-all">
                    {pixInfo.pixCode}
                  </div>
                  {pixInfo.pixQrBase64 && (
                    <div className="flex justify-center pt-2">
                      <img
                        src={`data:image/png;base64,${pixInfo.pixQrBase64}`}
                        alt="QR Code PIX"
                        className="w-40 h-40 rounded-lg border border-slate-700 p-2 bg-white"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* FLUXO 8: PRONTO PARA BAIXAR NA INTERFACE */}
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <FileMusic className="w-5 h-5 text-indigo-400" />
                Central de Downloads da Produção
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* As 2 Versões Mixadas com a Voz do Cliente */}
                <Card className="bg-slate-900 border-indigo-500/40 shadow-xl">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base text-indigo-300 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-indigo-400" />
                      Mixagem com a Voz do Cliente (Sincronizada)
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-400">
                      Voz limpa e masterizada unida aos instrumentais
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {jobResults.downloads.final_voz_1 && (
                      <div className="space-y-1.5 p-3 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                          <span>{phone} - FINAL COM VOZ 01</span>
                          <a href={jobResults.downloads.final_voz_1} download className="text-indigo-400 hover:underline">
                            Baixar WAV
                          </a>
                        </div>
                        <audio controls className="w-full h-8" src={jobResults.downloads.final_voz_1} />
                      </div>
                    )}

                    {jobResults.downloads.final_voz_2 && (
                      <div className="space-y-1.5 p-3 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                          <span>{phone} - FINAL COM VOZ 02</span>
                          <a href={jobResults.downloads.final_voz_2} download className="text-indigo-400 hover:underline">
                            Baixar WAV
                          </a>
                        </div>
                        <audio controls className="w-full h-8" src={jobResults.downloads.final_voz_2} />
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* As 2 Versões Originais da IA (Cantadas) */}
                <Card className="bg-slate-900 border-slate-800 shadow-xl">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base text-purple-300 flex items-center gap-2">
                      <Music className="w-4 h-4 text-purple-400" />
                      Versões Originais da IA (Cantadas)
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-400">
                      Duas variações completas geradas ou enviadas
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {jobResults.downloads.final_orig_1 && (
                      <div className="space-y-1.5 p-3 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                          <span>{phone} - FINAL 01</span>
                          <a href={jobResults.downloads.final_orig_1} download className="text-purple-400 hover:underline">
                            Baixar MP3
                          </a>
                        </div>
                        <audio controls className="w-full h-8" src={jobResults.downloads.final_orig_1} />
                      </div>
                    )}

                    {jobResults.downloads.final_orig_2 && (
                      <div className="space-y-1.5 p-3 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                          <span>{phone} - FINAL 02</span>
                          <a href={jobResults.downloads.final_orig_2} download className="text-purple-400 hover:underline">
                            Baixar MP3
                          </a>
                        </div>
                        <audio controls className="w-full h-8" src={jobResults.downloads.final_orig_2} />
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* As 2 Versões de Playback (Instrumentais) */}
                <Card className="bg-slate-900 border-slate-800 shadow-xl">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base text-amber-300 flex items-center gap-2">
                      <Headphones className="w-4 h-4 text-amber-400" />
                      Playbacks Instrumentais
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-400">
                      Faixas sem voz isoladas para apresentações e shows
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {jobResults.downloads.playback_1 && (
                      <div className="space-y-1.5 p-3 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                          <span>{phone} - PLAYBACK 01</span>
                          <a href={jobResults.downloads.playback_1} download className="text-amber-400 hover:underline">
                            Baixar MP3
                          </a>
                        </div>
                        <audio controls className="w-full h-8" src={jobResults.downloads.playback_1} />
                      </div>
                    )}

                    {jobResults.downloads.playback_2 && (
                      <div className="space-y-1.5 p-3 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                          <span>{phone} - PLAYBACK 02</span>
                          <a href={jobResults.downloads.playback_2} download className="text-amber-400 hover:underline">
                            Baixar MP3
                          </a>
                        </div>
                        <audio controls className="w-full h-8" src={jobResults.downloads.playback_2} />
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* As Prévias Salvas (Corte de 1:10) */}
                <Card className="bg-slate-900 border-slate-800 shadow-xl">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base text-cyan-300 flex items-center gap-2">
                      <FileMusic className="w-4 h-4 text-cyan-400" />
                      Prévias de Demonstração (1:10)
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-400">
                      Cortes otimizados para pré-escuta de WhatsApp e redes
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {jobResults.downloads.previa_1 && (
                      <div className="space-y-1.5 p-3 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                          <span>{phone} - PREVIA 01 (IA)</span>
                          <a href={jobResults.downloads.previa_1} download className="text-cyan-400 hover:underline">
                            Baixar MP3
                          </a>
                        </div>
                        <audio controls className="w-full h-8" src={jobResults.downloads.previa_1} />
                      </div>
                    )}

                    {jobResults.downloads.previa_2 && (
                      <div className="space-y-1.5 p-3 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                          <span>{phone} - PREVIA 02 (IA)</span>
                          <a href={jobResults.downloads.previa_2} download className="text-cyan-400 hover:underline">
                            Baixar MP3
                          </a>
                        </div>
                        <audio controls className="w-full h-8" src={jobResults.downloads.previa_2} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* FLUXO 12: AGRADECIMENTO E UPSELL */}
            <Card className="bg-gradient-to-tr from-slate-900 via-indigo-950 to-slate-900 border-indigo-500/30 p-6 space-y-6 shadow-2xl">
              <div className="text-center space-y-1">
                <Badge variant="outline" className="border-amber-500/40 text-amber-400 bg-amber-500/10 mb-2">
                  <Gift className="w-3.5 h-3.5 mr-1" />
                  Ofertas Especiais de Pós-Produção
                </Badge>
                <h3 className="text-xl font-extrabold text-white">Potencialize o Lançamento da Sua Música</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Agradecemos pela preferência! Escolha um dos nossos serviços adicionais para profissionalizar ainda mais a sua obra:
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center mb-3">
                      <FileText className="w-5 h-5" />
                    </div>
                    <h4 className="font-bold text-sm text-white">Registro da Música</h4>
                    <p className="text-xs text-slate-400 mt-1">
                      Certificado de proteção e registro autoral na blockchain e órgãos de propriedade intelectual.
                    </p>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="font-bold text-sm text-emerald-400">R$ 49,90</span>
                    <Button size="sm" variant="outline" className="text-xs border-indigo-500/40 text-indigo-300">
                      Adicionar
                    </Button>
                  </div>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center mb-3">
                      <Video className="w-5 h-5" />
                    </div>
                    <h4 className="font-bold text-sm text-white">Vídeo com Legenda Karaokê</h4>
                    <p className="text-xs text-slate-400 mt-1">
                      Clipe animado com sincronização de letra palavra por palavra, pronto para TikTok e Reels.
                    </p>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="font-bold text-sm text-emerald-400">R$ 39,90</span>
                    <Button size="sm" variant="outline" className="text-xs border-indigo-500/40 text-indigo-300">
                      Adicionar
                    </Button>
                  </div>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center mb-3">
                      <FileMusic className="w-5 h-5" />
                    </div>
                    <h4 className="font-bold text-sm text-white">Partitura Cifrada</h4>
                    <p className="text-xs text-slate-400 mt-1">
                      Documento PDF com cifragem completa, melodia transcrita e acordes para violão, teclado ou banda.
                    </p>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="font-bold text-sm text-emerald-400">R$ 29,90</span>
                    <Button size="sm" variant="outline" className="text-xs border-indigo-500/40 text-indigo-300">
                      Adicionar
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}
      </main>

      {/* MODAL DO FLUXO 9: CONFIRMAÇÃO DE ENVIO DE PRÉVIA */}
      {showPreviewModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="bg-slate-900 border-slate-700 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
            <CardHeader>
              <CardTitle className="text-lg text-white">Confirmação de Envio</CardTitle>
              <CardDescription className="text-slate-300 text-sm">
                Deseja enviar as prévias para o cliente?
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-slate-400 space-y-2">
              <p>
                Serão enviadas as 2 prévias cantadas (IA) e as 2 prévias mixadas com a voz do cliente para o número <strong>{phone}</strong>, acionando o bot "pendente de pagamento" e gerando a chave PIX automática.
              </p>
            </CardContent>
            <CardFooter className="flex justify-end gap-3 pt-2">
              <Button
                variant="ghost"
                onClick={() => setShowPreviewModal(false)}
                disabled={sendingPreview}
                className="text-slate-400 hover:text-white"
              >
                Não
              </Button>
              <Button
                onClick={handleConfirmSendPreview}
                disabled={sendingPreview}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold gap-2"
              >
                {sendingPreview && <Loader2 className="w-4 h-4 animate-spin" />}
                Sim, enviar
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
