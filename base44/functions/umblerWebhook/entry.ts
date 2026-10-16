import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import { extractPhone, sendUmblerTextMessage, truncate } from '../../shared/umblerTalk.ts';
import { findOrCreateAsaasCustomer, createAsaasPixPayment, getAsaasPixQrCode } from '../../shared/asaas.ts';

export default async function(req: Request) {
  if (req.method === "GET") {
    return Response.json({
      status: "online",
      description: "Webhook do Umbler Talk para disparo da cobrança Asaas ao iniciar o bot 'Pendente de pagamento'",
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

  // 1. Extração do texto e trigger
  const textContent = (
    body?.message?.content ||
    body?.message?.text ||
    body?.message?.body ||
    body?.content ||
    body?.text ||
    body?.Message?.Content ||
    body?.Message?.Text ||
    body?.payload?.message?.text ||
    body?.data?.message?.text ||
    body?.triggerName ||
    body?.botName ||
    body?.TriggerName ||
    body?.BotName ||
    ""
  ).toString();

  const normalized = textContent
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Mensagem inicial da execução do bot "Pendente de pagamento":
  // "Para adquirir o playback ou colocar sua voz, conclua o pagamento com os dados abaixo:"
  const isTriggerMatch =
    normalized.includes("para adquirir o playback ou colocar sua voz") ||
    normalized.includes("conclua o pagamento com os dados abaixo") ||
    normalized.includes("adquirir o playback") ||
    normalized.includes("pendente de pagamento") ||
    body?.force === true;

  if (!isTriggerMatch) {
    return Response.json({
      ignored: true,
      reason: "Mensagem ou evento não corresponde ao gatilho do bot 'Pendente de pagamento' ('Para adquirir o playback ou colocar sua voz, conclua o pagamento com os dados abaixo:')",
      received_preview: truncate(textContent, 100),
    });
  }

  // 2. Extração do telefone do cliente
  const phoneCandidate =
    body?.contact?.phoneNumber ||
    body?.contact?.phone ||
    body?.chat?.contact?.phoneNumber ||
    body?.chat?.contact?.phone ||
    body?.chat?.toPhone ||
    body?.chat?.fromPhone ||
    body?.customerPhone ||
    body?.phone ||
    body?.toPhone ||
    body?.fromPhone ||
    body?.Contact?.PhoneNumber ||
    body?.Chat?.Contact?.PhoneNumber ||
    body?.FromPhone ||
    body?.ToPhone ||
    body?.payload?.contact?.phoneNumber ||
    body?.data?.contact?.phoneNumber ||
    "";

  const customerName =
    body?.contact?.name ||
    body?.chat?.contact?.name ||
    body?.Contact?.Name ||
    body?.Chat?.Contact?.Name ||
    body?.payload?.contact?.name ||
    body?.data?.contact?.name ||
    "";

  const phoneInfo = extractPhone(phoneCandidate || textContent);
  if (!phoneInfo) {
    return Response.json({
      success: false,
      error: "Telefone do contato não identificado no payload do Umbler.",
      payload_sample: truncate(body, 500),
    }, { status: 400 });
  }

  // 3. Verificação das credenciais
  const asaasApiKey = secrets.get("ASAAS_API_KEY");
  const umblerToken = secrets.get("UMBLER_TALK_API_TOKEN");
  const umblerOrgId = secrets.get("UMBLER_TALK_ORGANIZATION_ID");
  const umblerChannelPhone = secrets.get("UMBLER_TALK_FROM_PHONE");

  if (!asaasApiKey) {
    return Response.json({
      error: "Secret ASAAS_API_KEY não configurado.",
    }, { status: 500 });
  }

  try {
    // 4. Criação do cliente e cobrança no Asaas
    const customer = await findOrCreateAsaasCustomer(asaasApiKey, {
      name: customerName,
      phoneDigits: phoneInfo.digits,
    });

    const payment = await createAsaasPixPayment(asaasApiKey, {
      customerId: customer.id,
      value: 49.90,
      externalReference: phoneInfo.digits,
      description: "Música Personalizada - Produção Final e Playbacks",
    });

    const pixData = await getAsaasPixQrCode(asaasApiKey, payment.id);

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

    // 6. Envia mensagem com código Pix de volta para o cliente via Umbler Talk
    let umblerSendResult: any = null;
    if (umblerToken && umblerOrgId && umblerChannelPhone) {
      const pixMessage =
        "Aqui está o seu Pix para liberação das suas músicas em alta definição e playbacks! 🎶\n\n" +
        "💰 *Valor:* R$ 49,90\n\n" +
        "📌 *Código Pix Copia e Cola:*\n" +
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
      umbler_notified: umblerSendResult?.ok ?? false,
    });
  } catch (error: any) {
    return Response.json({
      success: false,
      error: error.message || String(error),
    }, { status: 500 });
  }
}
