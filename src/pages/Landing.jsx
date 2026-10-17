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
  FileText
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
  "Sertanejo",
  "Pop Rock",
  "MPB",
  "Trap / Hip-Hop",
  "Gospel",
  "Samba / Pagode",
  "Forró",
  "Bossa Nova",
  "Eletrônica / Pop",
  "Romântica",
];

export default function Landing() {
  const navigate = useNavigate();

  // Estados principais
  const [phone, setPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [selectedStyle, setSelectedStyle] = useState("Sertanejo");
  const [customStyle, setCustomStyle] = useState("");
  const [audioFile, setAudioFile] = useState(null);
  const [audioUri, setAudioUri] = useState(null);

  // Estados de etapas e fluxos
  // "initial" | "checking_copyright" | "copyright_blocked" | "processing" | "ready"
  const [flowStage, setFlowStage] = useState("initial");
  const [copyrightData, setCopyrightData] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Pipeline de processamento
  const [pipelineStep, setPipelineStep] = useState(0);
  const [pipelineMessage, setPipelineMessage] = useState("");
  const [jobResults, setJobResults] = useState(null);

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

  // Formata telefone brasileiro (XX) 9XXXX-XXXX
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

  // Upload do arquivo do cliente e Fluxo 1 (Detecção de direitos autorais)
  const handleAudioSelected = async (file) => {
    if (!file) return;
    setAudioFile(file);
    setFlowStage("checking_copyright");
    setCopyrightData(null);

    try {
      // 1. Upload para o storage do Base44
      const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
      setAudioUri(file_uri);

      // 2. FLUXO 1: Chamada à API Music.ai com workflow "Identify Song"
      const res = await base44.functions.invoke("checkCopyright", {
        file_uri,
        phone,
      });

      if (res.data?.copyright_detected) {
        // Direitos autorais detectados -> Bloqueia o avanço!
        setFlowStage("copyright_blocked");
        setCopyrightData(res.data.details || {});
      } else {
        // Sem direitos autorais -> Prossegue imediatamente com o fluxo!
        setFlowStage("initial");
        // Inicia o pipeline de produção
        startProductionPipeline(file_uri);
      }
    } catch (err) {
      console.error("Erro na verificação:", err);
      // Fallback seguro: prossegue para pipeline
      setFlowStage("initial");
    }
  };

  // Botão "Tentar outra música" do Fluxo 1
  const handleRetryAnotherSong = () => {
    setAudioFile(null);
    setAudioUri(null);
    setCopyrightData(null);
    setFlowStage("initial");
  };

  // Início do pipeline completo (Fluxos 2 a 7)
  const startProductionPipeline = async (clientUri) => {
    setFlowStage("processing");
    setPipelineStep(1);
    setPipelineMessage("Transcrevendo áudio com Gemini e organizando letra...");

    const styleToUse = customStyle.trim() || selectedStyle;

    try {
      // Simulação visual de passos enquanto a função backend executa
      const stepTimer1 = setTimeout(() => {
        setPipelineStep(2);
        setPipelineMessage("Gerando 2 versões no Suno com o prompt musical...");
      }, 5000);

      const stepTimer2 = setTimeout(() => {
        setPipelineStep(3);
        setPipelineMessage("Separando vocais e instrumentais das 2 versões...");
      }, 15000);

      const stepTimer3 = setTimeout(() => {
        setPipelineStep(4);
        setPipelineMessage("Limpando e masterizando a voz do cliente no Music.ai...");
      }, 25000);

      const stepTimer4 = setTimeout(() => {
        setPipelineStep(5);
        setPipelineMessage("Sincronizando e mixando a voz masterizada nas 2 versões...");
      }, 40000);

      const stepTimer5 = setTimeout(() => {
        setPipelineStep(6);
        setPipelineMessage("Salvando os 8 arquivos estruturados no Google Drive...");
      }, 55000);

      const res = await base44.functions.invoke("runPipeline", {
        client_audio_uri: clientUri,
        phone,
        customer_name: customerName,
        style_choice: styleToUse,
      });

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      clearTimeout(stepTimer3);
      clearTimeout(stepTimer4);
      clearTimeout(stepTimer5);

      if (res.data?.success) {
        setJobResults(res.data);
        setPipelineStep(7);
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

  // FLUXO 9: Disparo de prévia e cobrança Umbler/Asaas
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
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
                Cante ou envie uma gravação da sua voz. Nossa inteligência artificial cria os arranjos, masteriza seus vocais e entrega duas versões impecáveis prontas para lançamento.
              </p>
            </div>

            {/* Card com Dados do Cliente e Estilo */}
            <Card className="bg-slate-900 border-slate-800 shadow-2xl">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 text-white">
                  <Headphones className="w-5 h-5 text-indigo-400" />
                  1. Dados e Estilo Musical
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Informe o WhatsApp para envio dos áudios e selecione a estética musical desejada.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone" className="text-slate-300">WhatsApp do Cliente (com DDD)*</Label>
                    <Input
                      id="phone"
                      placeholder="(11) 98803-2049"
                      value={phone}
                      onChange={handlePhoneChange}
                      className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-600 focus:border-indigo-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-slate-300">Nome do Artista / Cliente</Label>
                    <Input
                      id="name"
                      placeholder="Ex: João Silva"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-600 focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Estilo Musical de Referência</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                    {STYLE_OPTIONS.map((style) => (
                      <button
                        key={style}
                        type="button"
                        onClick={() => {
                          setSelectedStyle(style);
                          setCustomStyle("");
                        }}
                        className={`text-xs font-medium py-2.5 px-3 rounded-lg border transition-all text-center ${
                          selectedStyle === style && !customStyle
                            ? "bg-indigo-600 border-indigo-400 text-white shadow-md shadow-indigo-600/30"
                            : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                        }`}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Card de Anexo de Áudio (Upload ou Gravação) */}
            <Card className="bg-slate-900 border-slate-800 shadow-2xl">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 text-white">
                  <FileMusic className="w-5 h-5 text-indigo-400" />
                  2. Anexe sua Voz Cantando
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Grave agora mesmo pelo microfone ou envie um arquivo de áudio (MP3, WAV, M4A, etc.).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                  {/* Gravação Direta */}
                  <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center text-center">
                    <h3 className="font-semibold text-slate-200 text-sm mb-4">Gravar com Microfone</h3>
                    <AudioRecorder onRecorded={handleAudioSelected} label="Iniciar Gravação" />
                  </div>

                  {/* Upload de Arquivo */}
                  <div className="bg-slate-950/80 border border-slate-800 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center">
                    <Upload className="w-10 h-10 text-indigo-400 mb-3" />
                    <h3 className="font-semibold text-slate-200 text-sm mb-1">Enviar Arquivo de Áudio</h3>
                    <p className="text-xs text-slate-500 mb-4">Suporta MP3, WAV, OGG, M4A (máx. 25MB)</p>
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleAudioSelected(file);
                        }}
                      />
                      <span className="inline-flex items-center justify-center rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 shadow-md transition-colors">
                        Selecionar Arquivo
                      </span>
                    </label>
                  </div>
                </div>
              </CardContent>
            </Card>
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
                  <span>{Math.round((pipelineStep / 7) * 100)}%</span>
                </div>
                <Progress value={(pipelineStep / 7) * 100} className="h-2.5 bg-slate-950" />
                <p className="text-xs text-indigo-400 font-medium text-center pt-2">
                  {pipelineMessage}
                </p>
              </div>

              {/* Lista de etapas */}
              <div className="space-y-3 text-xs">
                {[
                  { num: 1, text: "Detecção de direitos autorais (Music.ai)" },
                  { num: 2, text: "Transcrição da letra com Gemini e estilo musical" },
                  { num: 3, text: "Geração Suno (2 versões completas mantidas)" },
                  { num: 4, text: "Separação de stems (Vocais e Playbacks)" },
                  { num: 5, text: "Limpeza e Masterização Vocal da voz do cliente (Music.ai)" },
                  { num: 6, text: "Sincronização e Mixagem Dupla DSP" },
                  { num: 7, text: "Armazenamento estruturado no Google Drive" },
                ].map((st) => (
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
                      Duas variações completas geradas pelo Suno
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
