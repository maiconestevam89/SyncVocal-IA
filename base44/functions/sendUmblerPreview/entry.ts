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

// Dispara um bot no Umbler Talk testando a assinatura oficial e variações caso retorne 404
async function invokeStartBot({ apiToken, botId, orgId, triggerName, channelPhone, customerPhone }) {
  const attempts = [
    {
      url: `${UTALK_BASE}/v1/chats/start-bot/`,
      body: { botId, organizationId: orgId, triggerName, toPhone: channelPhone, fromPhone: customerPhone },
      label: "oficial_com_barra",
    },
    {
      url: `${UTALK_BASE}/v1/chats/start-bot`,
      body: { botId, organizationId: orgId, triggerName, toPhone: channelPhone, fromPhone: customerPhone },
      label: "oficial_sem_barra",
    },
    {
      url: `${UTALK_BASE}/v1/chats/start-bot/`,
      body: { botId, organizationId: orgId, triggerName, toPhone: customerPhone, fromPhone: channelPhone },
      label: "invertido_com_barra",
    },
    {
      url: `${UTALK_BASE}/v1/chats/start-bot`,
      body: { botId, organizationId: orgId, triggerName, toPhone: customerPhone, fromPhone: channelPhone },
      label: "invertido_sem_barra",
    },
  ];

  let lastStatus = 0;
  let lastData = null;

  for (const att of attempts) {
    try {
      const res = await fetch(att.url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(att.body),
        signal: AbortSignal.timeout(30000),
      });

      lastStatus = res.status;
      try { lastData = await res.json(); } catch { lastData = await res.text(); }

      if (res.ok) {
        return { ok: true, status: lastStatus, data: lastData, attempt: att.label };
      }
    } catch (err) {
      lastStatus = 500;
      lastData = err.message;
    }
  }

  return { ok: false, status: lastStatus, data: lastData };
}

export default async function(req) {
  let job_id = null;
  try {
    const base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch {}

    const body = await req.json();
    const { file_url, audio1_name } = body;
    job_id = body.job_id;

    if (!file_url || !audio1_name) {
      return Response.json({ error: "file_url e audio1_name são obrigatórios." }, { status: 400 });
    }

    // ETAPA PRELIMINAR: extrair e validar o telefone do nome do Áudio 1
    const customerPhone = extractPhone(audio1_name);
    if (!customerPhone) {
      return Response.json({
        success: false,
        error: `Não foi possível extrair um telefone válido do nome "${audio1_name}". ` +
               "O nome do arquivo precisa conter o telefone com DDD (ex: 11 98803-2049 - MUSICA 01.mp3) e tente novamente.",
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

    const logs = { phone: customerPhone, step1: null, step2: null, step3: null, debug };

    if (job_id) {
      try { await base44.asServiceRole.entities.ProcessingJob.update(job_id, { status: "sending" }); } catch {}
    }

    // ETAPA 1: Iniciar o chatbot "Música pronta"
    const step1Result = await invokeStartBot({
      apiToken,
      botId,
      orgId,
      triggerName,
      channelPhone,
      customerPhone,
    });
    logs.step1 = step1Result;

    // Se a Etapa 1 FALHAR: interromper e NÃO enviar o arquivo de áudio
    if (!step1Result.ok) {
      const errDetail = typeof step1Result.data === "object" ? JSON.stringify(step1Result.data) : String(step1Result.data || "");
      await base44.asServiceRole.entities.UmblerTalkLog.create({
        audio1_name,
        phone: customerPhone,
        status: "failed",
        step1_http_status: step1Result.status,
        step1_response: truncate(errDetail),
        step2_http_status: 0,
        step2_response: "",
        error_message: `Etapa 1 (chatbot) falhou com HTTP ${step1Result.status}: ${errDetail}`,
      });
      return Response.json({
        success: false,
        phone: customerPhone,
        error: `Etapa 1 falhou: o chatbot não pôde ser iniciado (HTTP ${step1Result.status}). Detalhes: ${errDetail}`,
        logs,
      }, { status: 502 });
    }

    // ETAPA 2: Enviar o arquivo de mídia (prévia de 1:10)
    // Executada EXCLUSIVAMENTE após a confirmação de sucesso da Etapa 1.
    // Pausa de 15s para o chatbot enviar todas as mensagens de saudação antes do áudio chegar
    await new Promise((r) => setTimeout(r, 15000));

    const audioRes = await fetch(file_url, { signal: AbortSignal.timeout(30000) });
    if (!audioRes.ok) {
      await base44.asServiceRole.entities.UmblerTalkLog.create({
        audio1_name,
        phone: customerPhone,
        status: "chatbot_started",
        step1_http_status: step1Result.status,
        step1_response: truncate(step1Result.data),
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
      const errDetail = typeof step2Data === "object" ? JSON.stringify(step2Data) : String(step2Data || "");
      await base44.asServiceRole.entities.UmblerTalkLog.create({
        audio1_name,
        phone: customerPhone,
        status: "chatbot_started",
        step1_http_status: step1Result.status,
        step1_response: truncate(step1Result.data),
        step2_http_status: step2Status,
        step2_response: truncate(step2Data),
        error_message: `Etapa 2 (envio de mídia) falhou com HTTP ${step2Status}: ${errDetail}`,
      });
      return Response.json({
        success: false,
        phone: customerPhone,
        error: `Etapa 1 OK, mas Etapa 2 falhou: envio de mídia não concluído (HTTP ${step2Status}). Detalhes: ${errDetail}`,
        logs,
      }, { status: 502 });
    }

    // ETAPA 3: Disparar o chatbot "Pendente de pagamento" após o envio da prévia
    // Pausa de 10s para o cliente receber e ouvir a prévia antes do bot de pagamento
    await new Promise((r) => setTimeout(r, 10000));

    const paymentBotId = "aaRxg5RS5vxsTe8j";
    const paymentTriggerName = "Pendente de pagamento";

    const step3Result = await invokeStartBot({
      apiToken,
      botId: paymentBotId,
      orgId,
      triggerName: paymentTriggerName,
      channelPhone,
      customerPhone,
    });
    logs.step3 = step3Result;

    if (!step3Result.ok) {
      const errDetail = typeof step3Result.data === "object" ? JSON.stringify(step3Result.data) : String(step3Result.data || "");
      await base44.asServiceRole.entities.UmblerTalkLog.create({
        audio1_name,
        phone: customerPhone,
        status: "chatbot_started_and_preview_sent",
        step1_http_status: step1Result.status,
        step1_response: truncate(step1Result.data),
        step2_http_status: step2Status,
        step2_response: truncate(step2Data),
        error_message: `Etapa 3 (bot Pendente de pagamento) falhou com HTTP ${step3Result.status}: ${errDetail}`,
      });
      return Response.json({
        success: false,
        phone: customerPhone,
        error: `Etapas 1 e 2 OK, mas Etapa 3 falhou: bot "Pendente de pagamento" não iniciado (HTTP ${step3Result.status}). Detalhes: ${errDetail}`,
        logs,
      }, { status: 502 });
    }

    // Todas as etapas concluídas com sucesso
    await base44.asServiceRole.entities.UmblerTalkLog.create({
      audio1_name,
      phone: customerPhone,
      status: "chatbot_started_and_preview_sent",
      step1_http_status: step1Result.status,
      step1_response: truncate(step1Result.data),
      step2_http_status: step2Status,
      step2_response: truncate(step2Data),
      error_message: "",
    });

    if (job_id) {
      try { await base44.asServiceRole.entities.ProcessingJob.update(job_id, { status: "completed" }); } catch {}
    }

    return Response.json({
      success: true,
      phone: customerPhone,
      status: "Chatbot Iniciado, Prévia Enviada e Pendente de Pagamento Disparado",
      logs,
    });
  } catch (error) {
    if (job_id) {
      try {
        const b = createClientFromRequest(req);
        await b.asServiceRole.entities.ProcessingJob.update(job_id, { status: "failed", error_message: error.message });
      } catch {}
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
}
