import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';

const UTALK_BASE = "https://app-utalk.umbler.com/api";

// Extrai o telefone brasileiro do nome do arquivo, aceitando separadores (espaço, hífen, ponto,
// parênteses) e ignorando o restante do texto (ex: "11 98803-2049 - MUSICA 01").
// Formato: [+55] DDD (2 dígitos) + número (8 ou 9 dígitos, o 9º dígito é opcional).
// Retorna o telefone em E.164 (+55DDDNÚMERO) ou null se não encontrar.
const PHONE_REGEX = /(?<!\d)(?:\+?55[\s.\-]*)?\(?(\d{2})\)?[\s.\-]*(9?\d{4})[\s.\-]*(\d{4})(?!\d)/;

function extractPhone(filename) {
  const m = (filename || "").match(PHONE_REGEX);
  if (!m) return null;
  const phone = "+55" + m[1] + m[2] + m[3];
  return /^\+55\d{10,11}$/.test(phone) ? phone : null;
}

function truncate(obj, max = 2000) {
  const str = typeof obj === "string" ? obj : JSON.stringify(obj);
  return str.length > max ? str.slice(0, max) : str;
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { file_url, audio1_name } = body;

    if (!file_url || !audio1_name) {
      return Response.json({ error: "file_url e audio1_name são obrigatórios." }, { status: 400 });
    }

    // ETAPA PRELIMINAR: extrair e validar o telefone do nome do Áudio 1
    const customerPhone = extractPhone(audio1_name);
    if (!customerPhone) {
      return Response.json({
        success: false,
        error: `Não foi possível extrair um telefone válido do nome "${audio1_name}". ` +
               "O nome do Áudio 1 precisa conter o telefone com DDD (ex: 11 98803-2049 - MUSICA 01.mp3) e tente novamente.",
      }, { status: 400 });
    }

    const apiToken = secrets.get("UMBLER_TALK_API_TOKEN");
    const orgId = secrets.get("UMBLER_TALK_ORGANIZATION_ID");
    const channelPhone = secrets.get("UMBLER_TALK_FROM_PHONE");
    const botId = secrets.get("UMBLER_TALK_BOT_ID");
    const triggerName = secrets.get("UMBLER_TALK_TRIGGER_NAME");

    // Diagnóstico: mostra se cada secret está populado e seu tamanho (sem expor o valor)
    const debug = {
      apiToken: { set: !!apiToken, length: apiToken?.length || 0 },
      orgId: { set: !!orgId, length: orgId?.length || 0 },
      channelPhone: { set: !!channelPhone, length: channelPhone?.length || 0, preview: channelPhone ? channelPhone.slice(0, 3) + "..." + channelPhone.slice(-4) : "" },
      botId: { set: !!botId, length: botId?.length || 0 },
      triggerName: { set: !!triggerName, length: triggerName?.length || 0 },
    };

    if (!apiToken || !orgId || !channelPhone || !botId || !triggerName) {
      return Response.json({ error: "Credenciais do Umbler Talk não configuradas nos secrets.", debug }, { status: 500 });
    }

    const logs = { phone: customerPhone, step1: null, step2: null, debug };

    // ETAPA 1: Iniciar o chatbot "Música pronta"
    // Apesar da documentação dizer toPhone=canal, o comportamento real da API é o mesmo
    // do endpoint de mensagens: toPhone = destino (cliente), fromPhone = origem (canal).
    // Confirmado pelos logs: com toPhone=customerPhone a Etapa 1 retorna 200.
    const step1Body = {
      botId,
      organizationId: orgId,
      triggerName,
      toPhone: customerPhone,
      fromPhone: channelPhone,
    };

    const step1Res = await fetch(`${UTALK_BASE}/v1/chats/start-bot/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(step1Body),
      signal: AbortSignal.timeout(30000),
    });

    const step1Status = step1Res.status;
    let step1Data;
    try { step1Data = await step1Res.json(); } catch { step1Data = await step1Res.text(); }
    logs.step1 = { status: step1Status, ok: step1Res.ok, data: step1Data };

    // Se a Etapa 1 FALHAR: interromper e NÃO enviar o arquivo de áudio
    if (!step1Res.ok) {
      await base44.entities.UmblerTalkLog.create({
        audio1_name,
        phone: customerPhone,
        status: "failed",
        step1_http_status: step1Status,
        step1_response: truncate(step1Data),
        step2_http_status: 0,
        step2_response: "",
        error_message: `Etapa 1 (chatbot) falhou com HTTP ${step1Status}`,
      });
      return Response.json({
        success: false,
        phone: customerPhone,
        error: `Etapa 1 falhou: o chatbot não pôde ser iniciado (HTTP ${step1Status}). O arquivo de áudio não foi enviado.`,
        logs,
      }, { status: 502 });
    }

    // ETAPA 2: Enviar o arquivo de mídia (prévia de 1:10)
    // Executada EXCLUSIVAMENTE após a confirmação de sucesso da Etapa 1.
    // No endpoint simplified: ToPhone = destino (cliente), FromPhone = origem (canal)

    // Pausa de 8s para o chatbot enviar a saudação antes do áudio chegar
    await new Promise((r) => setTimeout(r, 8000));

    const audioRes = await fetch(file_url, { signal: AbortSignal.timeout(30000) });
    if (!audioRes.ok) {
      await base44.entities.UmblerTalkLog.create({
        audio1_name,
        phone: customerPhone,
        status: "chatbot_started",
        step1_http_status: step1Status,
        step1_response: truncate(step1Data),
        step2_http_status: 0,
        step2_response: "",
        error_message: `Falha ao baixar o arquivo de prévia (HTTP ${audioRes.status})`,
      });
      return Response.json({
        success: false,
        phone: customerPhone,
        error: `Etapa 1 OK, mas falha ao baixar o arquivo de prévia (HTTP ${audioRes.status}).`,
        logs,
      }, { status: 502 });
    }

    const audioBlob = await audioRes.blob();
    const formData = new FormData();
    formData.append("ToPhone", customerPhone);
    formData.append("FromPhone", channelPhone);
    formData.append("OrganizationId", orgId);
    // Sem parâmetro de mensagem de texto — o chatbot já envia a saudação
    formData.append("File", audioBlob, "preview.mp3");

    const step2Res = await fetch(`${UTALK_BASE}/v1/messages/simplified/`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiToken}` },
      body: formData,
      signal: AbortSignal.timeout(60000),
    });

    const step2Status = step2Res.status;
    let step2Data;
    try { step2Data = await step2Res.json(); } catch { step2Data = await step2Res.text(); }
    logs.step2 = { status: step2Status, ok: step2Res.ok, data: step2Data };

    if (!step2Res.ok) {
      await base44.entities.UmblerTalkLog.create({
        audio1_name,
        phone: customerPhone,
        status: "chatbot_started",
        step1_http_status: step1Status,
        step1_response: truncate(step1Data),
        step2_http_status: step2Status,
        step2_response: truncate(step2Data),
        error_message: `Etapa 2 (envio de mídia) falhou com HTTP ${step2Status}`,
      });
      return Response.json({
        success: false,
        phone: customerPhone,
        error: `Etapa 1 OK, mas Etapa 2 falhou: envio de mídia não concluído (HTTP ${step2Status}).`,
        logs,
      }, { status: 502 });
    }

    // Ambas as etapas concluídas com sucesso
    await base44.entities.UmblerTalkLog.create({
      audio1_name,
      phone: customerPhone,
      status: "chatbot_started_and_preview_sent",
      step1_http_status: step1Status,
      step1_response: truncate(step1Data),
      step2_http_status: step2Status,
      step2_response: truncate(step2Data),
      error_message: "",
    });

    return Response.json({
      success: true,
      phone: customerPhone,
      status: "Chatbot Iniciado e Prévia Enviada",
      logs,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}