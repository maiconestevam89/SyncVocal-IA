import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import { extractPhone, sendUmblerTextMessage, truncate } from '../../shared/umblerTalk.ts';
import {
  findOrCreateAsaasCustomer,
  createAsaasPixPayment,
  getAsaasPixQrCode,
  findPendingAsaasPayment,
} from '../../shared/asaas.ts';

// Mapa em memória para evitar rajadas simultâneas (debounce de 2 minutos por telefone)
const phoneDebounceMap = new Map<string, number>();
const DEBOUNCE_MS = 2 * 60 * 1000;

function extractAllStrings(obj: any): string[] {
  const strings: string[] = [];
  function recurse(val: any) {
    if (!val) return;
    if (typeof val === "string") {
      strings.push(val);
    } else if (Array.isArray(val)) {
      for (const item of val) recurse(item);
    } else if (typeof val === "object") {
      for (const v of Object.values(val)) recurse(v);
    }
  }
  recurse(obj);
  return strings;
}

function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export default async function(req: Request) {
  if (req.method === "GET") {
    return Response.json({
      status: "online",
      description: "Webhook do Umbler Talk com proteção anti-loop e idempotência para o bot 'Pendente de pagamento'",
    });
  }

  let base44: any = null;
  try {
    base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch {}
  } catch {}

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Payload JSON inválido" }, { status: 400 });
  }

  // 1. Extração universal de todos os textos do payload
  const allStrings = extractAllStrings(body);
  const normalizedStrings = allStrings.map(normalizeString);

  // TRAVA 1: Rejeitar mensagens do próprio sistema / Pix para evitar auto-gatilho e loop infinito
  const isSelfSystemMessage = normalizedStrings.some(s =>
    s.includes("aqui esta o seu pix para liberacao") ||
    s.includes("codigo pix copia e cola") ||
    s.includes("ou pague pelo link") ||
    s.includes("assim que o pagamento for identificado")
  );

  if (isSelfSystemMessage && !body?.force) {
    return Response.json({
      ignored: true,
      reason: "Mensagem emitida pelo próprio sistema de pagamento (descartada para prevenir loop infinito).",
    });
  }

  // TRAVA 2: O gatilho DEVE ser a frase específica da primeira mensagem do bot "Pendente de pagamento"
  // NUNCA usar apenas o nome do bot ("pendente de pagamento") porque ele fica anexado nos metadados do chat para todos os eventos!
  const isTriggerMatch =
    normalizedStrings.some(s =>
      s.includes("para adquirir o playback ou colocar sua voz") ||
      s.includes("conclua o pagamento com os dados abaixo")
    ) ||
    body?.force === true;

  if (!isTriggerMatch) {
    return Response.json({
      ignored: true,
      reason: "Mensagem ou evento não corresponde ao texto inicial do bot 'Pendente de pagamento'.",
      received_preview: truncate(allStrings.join(" | "), 150),
    });
  }

  // 2. Extração do telefone do cliente (prioriza campos oficiais do Umbler Talk)
  const explicitCandidates = [
    body?.Payload?.Content?.Contact?.PhoneNumber,
    body?.payload?.content?.contact?.phoneNumber,
    body?.Payload?.Content?.Contact?.Phone,
    body?.payload?.content?.contact?.phone,
    body?.Payload?.Content?.LastMessage?.ToPhone,
    body?.Payload?.Content?.LastMessage?.FromPhone,
    body?.contact?.phoneNumber,
    body?.contact?.phone,
    body?.chat?.contact?.phoneNumber,
    body?.chat?.contact?.phone,
    body?.chat?.toPhone,
    body?.chat?.fromPhone,
    body?.["contact[number]"],
    body?.customerPhone,
    body?.phone,
    body?.toPhone,
    body?.fromPhone,
  ];

  let phoneInfo = null;
  for (const cand of explicitCandidates) {
    if (cand) {
      phoneInfo = extractPhone(cand);
      if (phoneInfo) break;
    }
  }

  // Se não encontrou nos campos explícitos, busca em qualquer string do payload
  if (!phoneInfo) {
    for (const str of allStrings) {
      const candidate = extractPhone(str);
      if (candidate) {
        phoneInfo = candidate;
        break;
      }
    }
  }

  if (!phoneInfo) {
    return Response.json({
      success: false,
      error: "Telefone do contato não identificado no payload do Umbler.",
      payload_sample: truncate(body, 500),
    }, { status: 400 });
  }

  // TRAVA 3: Debounce em memória por telefone (bloqueia requisições duplicadas em menos de 2 minutos)
  const now = Date.now();
  const lastProcessed = phoneDebounceMap.get(phoneInfo.digits);
  if (lastProcessed && (now - lastProcessed) < DEBOUNCE_MS && !body?.force) {
    return Response.json({
      ignored: true,
      reason: `Requisição ignorada pelo debounce: cobrança já disparada para ${phoneInfo.formatted} há menos de 2 minutos.`,
    });
  }

  const customerName =
    body?.Payload?.Content?.Contact?.Name ||
    body?.payload?.content?.contact?.name ||
    body?.contact?.name ||
    body?.chat?.contact?.name ||
    body?.["contact[name]"] ||
    "";

  // 3. Verificação das credenciais
  const asaasApiKey = secrets.get("ASAS_API_KEY") || secrets.get("ASAAS_API_KEY");
  const umblerToken = secrets.get("UMBLER_TALK_API_TOKEN");
  const umblerOrgId = secrets.get("UMBLER_TALK_ORGANIZATION_ID");
  const umblerChannelPhone = secrets.get("UMBLER_TALK_FROM_PHONE");

  if (!asaasApiKey) {
    return Response.json({
      error: "Secret ASAAS_API_KEY não configurado.",
    }, { status: 500 });
  }

  try {
    // TRAVA 4: Idempotência no banco de dados Base44 (MusicPayment)
    // Se já existir cobrança pendente ou criada nos últimos 15 minutos, NÃO criar nem reenviar!
    if (base44?.asServiceRole?.entities?.MusicPayment && !body?.force) {
      try {
        const existingRecords = await base44.asServiceRole.entities.MusicPayment.filter({
          phone_digits: phoneInfo.digits,
        });

        const pendingOrRecent = existingRecords?.find((rec: any) => {
          if (rec.status === "pending") return true;
          const createdTime = rec.created_at ? new Date(rec.created_at).getTime() : 0;
          return (now - createdTime) < 15 * 60 * 1000; // 15 minutos
        });

        if (pendingOrRecent) {
          // Atualiza debounce para segurar próximas chamadas
          phoneDebounceMap.set(phoneInfo.digits, now);

          return Response.json({
            ignored: true,
            reason: `Cobrança já ativa para este telefone no sistema (Status: ${pendingOrRecent.status}, ID: ${pendingOrRecent.asaas_payment_id}). Cooldown ativo para evitar cobranças repetidas.`,
            payment_id: pendingOrRecent.asaas_payment_id,
            invoice_url: pendingOrRecent.invoice_url,
          });
        }
      } catch (dbCheckErr) {
        console.warn("Aviso ao verificar cobranças existentes em MusicPayment:", dbCheckErr);
      }
    }

    // 4. Localização ou Criação do cliente no Asaas
    const customer = await findOrCreateAsaasCustomer(asaasApiKey, {
      name: customerName,
      phoneDigits: phoneInfo.digits,
    });

    // TRAVA 5: Idempotência na API do Asaas
    // Verifica se já existe uma cobrança PENDENTE para este telefone ou cliente
    let payment = await findPendingAsaasPayment(asaasApiKey, {
      customerId: customer.id,
      externalReference: phoneInfo.digits,
    });

    let isNewPayment = false;
    if (!payment) {
      payment = await createAsaasPixPayment(asaasApiKey, {
        customerId: customer.id,
        value: 49.90,
        externalReference: phoneInfo.digits,
        description: "Música Personalizada - Produção Final e Playbacks",
      });
      isNewPayment = true;
    } else {
      console.log(`Reutilizando cobrança pendente existente no Asaas: ${payment.id}`);
    }

    const pixData = await getAsaasPixQrCode(asaasApiKey, payment.id);

    // Registra timestamp do debounce
    phoneDebounceMap.set(phoneInfo.digits, now);

    // 5. Salva na entidade MusicPayment
    if (base44?.asServiceRole?.entities?.MusicPayment) {
      try {
        await base44.asServiceRole.entities.MusicPayment.create({
          phone: phoneInfo.e164,
          phone_digits: phoneInfo.digits,
          customer_name: customerName || customer.name,
          asaas_customer_id: customer.id,
          asaas_payment_id: payment.id,
          pix_code: pixData.payload,
          invoice_url: payment.invoiceUrl,
          amount: payment.value || 49.90,
          status: "pending",
        });
      } catch (dbErr: any) {
        console.error("Erro ao registrar MusicPayment no banco:", dbErr);
      }
    }

    // 6. Envia mensagem com código Pix via Umbler Talk APENAS se for uma cobrança nova
    // Se a cobrança já existia, NÃO reenvia mensagem para não lotar o chat do cliente
    let umblerSendResult: any = null;
    if (isNewPayment && umblerToken && umblerOrgId && umblerChannelPhone) {
      const pixMessage =
        "Aqui está o seu Pix para liberação das suas músicas em alta definição e playbacks! 🎶\n\n" +
        "💰 *Valor:* R$ 49,90\n\n" +
        "📱 *Código Pix Copia e Cola:*\n" +
        `${pixData.payload}\n\n` +
        "🔗 *Ou pague pelo link:*\n" +
        `${payment.invoiceUrl}\n\n` +
        "Assim que o pagamento for identificado, enviaremos automaticamente todas as suas faixas completas aqui na conversa!";

      umblerSendResult = await sendUmblerTextMessage({
        apiToken: umblerToken,
        orgId: umblerOrgId,
        channelPhone: umblerChannelPhone,
        customerPhone: phoneInfo.e164,
        text: pixMessage,
      });
    }

    return Response.json({
      success: true,
      phone: phoneInfo.e164,
      asaas_payment_id: payment.id,
      invoice_url: payment.invoiceUrl,
      pix_code: pixData.payload,
      new_payment_created: isNewPayment,
      umbler_notified: isNewPayment ? (umblerSendResult?.ok ?? false) : false,
      notice: isNewPayment ? "Cobrança gerada e enviada com sucesso." : "Cobrança pendente existente reutilizada.",
    });
  } catch (error: any) {
    return Response.json({
      success: false,
      error: error.message || String(error),
    }, { status: 500 });
  }
}
