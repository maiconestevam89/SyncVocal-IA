import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import {
  extractPhone,
  sendUmblerTextMessage,
  sendUmblerTemplateMessage,
  truncate,
} from '../../shared/umblerTalk.ts';
import {
  findOrCreateAsaasCustomer,
  createAsaasPixPayment,
  getAsaasPixQrCode,
  findPendingAsaasPayment,
  findRecentPaidAsaasPayment,
} from '../../shared/asaas.ts';

// Mapa em memória para evitar rajadas simultâneas do webhook (debounce de 30 segundos por telefone)
const phoneDebounceMap = new Map<string, number>();
const DEBOUNCE_MS = 30 * 1000;

function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export default async function(req: Request) {
  if (req.method === "GET") {
    return Response.json({
      status: "online",
      description: "Webhook do Umbler Talk v4 (Template Meta cobrana_pix_qr, debounce e anti-pausa)",
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
    // Retorna 200 para evitar que o Umbler pause o webhook por falha de parser
    return Response.json({ ignored: true, reason: "Payload JSON inválido" }, { status: 200 });
  }

  // 1. Ignorar confirmações de entrega (ACK) imediatamente para evitar loops
  if (body?.ack || body?.event === "ack" || body?.Event === "ack" || body?.type === "ack") {
    return Response.json({ ignored: true, reason: "Evento de confirmação (ACK) ignorado." });
  }

  // 2. Extrai o texto da MENSAGEM ATUAL (não vasculhar o histórico todo para evitar falsos positivos)
  const currentMessageText = (
    body?.Payload?.Content?.LastMessage?.Content ||
    body?.Payload?.Content?.Message?.Content ||
    body?.message?.content ||
    body?.message?.text ||
    body?.message?.body ||
    body?.chat?.body ||
    body?.chat?.lastMessage ||
    body?.chat?.LastMessage ||
    body?.content ||
    body?.text ||
    body?.Message ||
    ""
  ).toString();

  const normalizedMessage = normalizeString(currentMessageText);

  // 3. TRAVA ANTI-LOOP: Rejeitar mensagens do próprio sistema
  const isSelfSystemMessage =
    normalizedMessage.includes("aqui esta o seu pix") ||
    normalizedMessage.includes("chave pix copia e cola") ||
    normalizedMessage.includes("assim que o pagamento for identificado") ||
    normalizedMessage.includes("pagamento confirmado") ||
    normalizedMessage.includes("aqui estao suas musicas") ||
    normalizedMessage.includes("final 01") ||
    normalizedMessage.includes("final 02") ||
    normalizedMessage.includes("playback 01") ||
    normalizedMessage.includes("playback 02");

  if (isSelfSystemMessage && !body?.force) {
    return Response.json({
      ignored: true,
      reason: "Mensagem do próprio sistema (descartada para prevenir auto-disparo e loop infinito).",
    });
  }

  // 4. TRAVA DE GATILHO: Reconhece pelo bot, trigger ou mensagens de cobrança pendente
  const incomingBotName = (body?.botName || body?.triggerName || body?.botId || "").toLowerCase();
  const isTriggerMatch =
    incomingBotName.includes("pendente") ||
    incomingBotName.includes("pagamento") ||
    normalizedMessage.includes("pendente de pagamento") ||
    normalizedMessage.includes("para adquirir o playback ou colocar sua voz") ||
    normalizedMessage.includes("conclua o pagamento com os dados abaixo") ||
    normalizedMessage.includes("conclua o pagamento") ||
    body?.force === true;

  if (!isTriggerMatch) {
    return Response.json({
      ignored: true,
      reason: "Mensagem ou evento não corresponde ao bot 'Pendente de pagamento'.",
      received_preview: truncate(currentMessageText, 100),
    });
  }

  // 5. Extração do telefone do cliente (prioriza campos oficiais do Umbler Talk)
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

  if (!phoneInfo) {
    return Response.json({
      success: false,
      error: "Telefone do contato não identificado no payload do Umbler.",
    }, { status: 200 }); // Retorna 200 para não pausar o webhook no Umbler
  }

  // 6. TRAVA: Debounce de 30 segundos por telefone para absorver rajadas do Umbler
  const now = Date.now();
  const lastProcessed = phoneDebounceMap.get(phoneInfo.digits);
  if (lastProcessed && (now - lastProcessed) < DEBOUNCE_MS && !body?.force) {
    return Response.json({
      ignored: true,
      reason: `Rajada duplicada ignorada pelo debounce (já enviado para ${phoneInfo.formatted} há menos de 30 segundos).`,
    });
  }

  const customerName =
    body?.Payload?.Content?.Contact?.Name ||
    body?.payload?.content?.contact?.name ||
    body?.contact?.name ||
    body?.chat?.contact?.name ||
    body?.["contact[name]"] ||
    "";

  // 7. Verificação das credenciais
  const asaasApiKey = secrets.get("ASAAS_API_KEY") || secrets.get("ASAS_API_KEY");
  const umblerToken = secrets.get("UMBLER_TALK_API_TOKEN");
  const umblerOrgId = secrets.get("UMBLER_TALK_ORGANIZATION_ID");
  const umblerChannelPhone = secrets.get("UMBLER_TALK_FROM_PHONE");

  if (!asaasApiKey) {
    return Response.json({
      success: false,
      error: "Secret ASAAS_API_KEY não configurado.",
    }, { status: 200 });
  }

  try {
    // 8. Localização ou Criação do cliente no Asaas
    const customer = await findOrCreateAsaasCustomer(asaasApiKey, {
      name: customerName,
      phoneDigits: phoneInfo.digits,
    });

    // 9. Checagem no Asaas se já foi PAGO recentemente
    const recentPaid = await findRecentPaidAsaasPayment(asaasApiKey, {
      customerId: customer.id,
      externalReference: phoneInfo.digits,
    });

    if (recentPaid && !body?.force) {
      phoneDebounceMap.set(phoneInfo.digits, now);
      return Response.json({
        ignored: true,
        reason: `Pagamento já confirmado no Asaas recentemente (${recentPaid.id}, Status: ${recentPaid.status}). Nenhuma nova cobrança gerada.`,
      });
    }

    // 10. Idempotência no Asaas para cobrança PENDENTE existente
    let payment = await findPendingAsaasPayment(asaasApiKey, {
      customerId: customer.id,
      externalReference: phoneInfo.digits,
    });

    let pixCode = "";
    let asaasPaymentId = "";
    let invoiceUrl = "";

    if (payment) {
      console.log(`Reutilizando cobrança pendente existente no Asaas: ${payment.id}`);
      asaasPaymentId = payment.id;
      invoiceUrl = payment.invoiceUrl;
      try {
        const pixData = await getAsaasPixQrCode(asaasApiKey, payment.id);
        pixCode = pixData.payload;
      } catch {}
    } else {
      // Cria cobrança PIX direta no Asaas
      const newPayment = await createAsaasPixPayment(asaasApiKey, {
        customerId: customer.id,
        value: 49.90,
        externalReference: phoneInfo.digits,
        description: "Música Personalizada - Produção Final e Playbacks",
      });
      asaasPaymentId = newPayment.id;
      invoiceUrl = newPayment.invoiceUrl;
      const pixData = await getAsaasPixQrCode(asaasApiKey, newPayment.id);
      pixCode = pixData.payload;
    }

    // Registra timestamp do debounce
    phoneDebounceMap.set(phoneInfo.digits, now);

    // 11. Salva na entidade MusicPayment
    if (base44?.asServiceRole?.entities?.MusicPayment) {
      try {
        await base44.asServiceRole.entities.MusicPayment.create({
          phone: phoneInfo.e164,
          phone_digits: phoneInfo.digits,
          customer_name: customerName || customer.name,
          asaas_customer_id: customer.id,
          asaas_payment_id: asaasPaymentId,
          pix_code: pixCode || "",
          invoice_url: invoiceUrl,
          amount: 49.90,
          status: "pending",
        });
      } catch (dbErr: any) {
        console.error("Erro ao registrar MusicPayment no banco:", dbErr);
      }
    }

    // 12. Envia mensagem para o cliente via Umbler Talk com template Meta cobrana_pix_qr
    let umblerSendResult: any = null;
    if (umblerToken && umblerOrgId && umblerChannelPhone && pixCode) {
      const pixTemplateName = secrets.get("UMBLER_TALK_TEMPLATE_ID_PIX") || "cobrana_pix_qr";
      let sentWithTemplate = false;

      try {
        const tmplRes = await sendUmblerTemplateMessage({
          apiToken: umblerToken,
          orgId: umblerOrgId,
          channelPhone: umblerChannelPhone,
          customerPhone: phoneInfo.e164,
          templateNameOrId: pixTemplateName,
          params: [pixCode],
        });

        if (tmplRes.ok) {
          sentWithTemplate = true;
          umblerSendResult = tmplRes;
          console.log(`[Webhook PIX] Template "${pixTemplateName}" enviado com sucesso via botão Meta!`);
        } else {
          console.warn(`[Webhook PIX] Aviso ao enviar template "${pixTemplateName}":`, tmplRes);
        }
      } catch (tErr: any) {
        console.warn("[Umbler Template PIX Warning no Webhook]:", tErr.message);
      }

      // Se o template falhar por qualquer motivo, envia a chave em bloco de cópia direta
      if (!sentWithTemplate) {
        const pixMessage =
          "Aqui está o seu Pix para liberação das suas músicas em alta definição e playbacks! 🎶\n\n" +
          "💵 *Valor:* R$ 49,90\n\n" +
          "📋 *Chave Pix Copia e Cola:* (toque abaixo para copiar)\n" +
          "```\n" + pixCode + "\n```\n\n" +
          "Assim que o pagamento for identificado, enviaremos automaticamente todas as suas faixas completas aqui na conversa!";

        umblerSendResult = await sendUmblerTextMessage({
          apiToken: umblerToken,
          orgId: umblerOrgId,
          channelPhone: umblerChannelPhone,
          customerPhone: phoneInfo.e164,
          text: pixMessage,
        });
      }
    }

    return Response.json({
      success: true,
      phone: phoneInfo.formatted,
      asaas_payment_id: asaasPaymentId,
      pix_code: pixCode,
      umbler_result: umblerSendResult,
    });
  } catch (err: any) {
    console.error("Erro no processamento do webhook Umbler Talk:", err);
    // Retorna 200 com flag de erro para o Umbler não pausar a rota
    return Response.json({
      success: false,
      error: err.message || "Erro interno",
    }, { status: 200 });
  }
}
