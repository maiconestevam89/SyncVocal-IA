import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import {
  extractPhone,
  invokeStartBot,
  sendUmblerMediaFile,
  sendUmblerTextMessage,
  sendUmblerTemplateMessage,
  ensureE164,
} from '../../shared/umblerTalk.ts';
import {
  findOrCreateAsaasCustomer,
  findPendingAsaasPayment,
  findRecentPaidAsaasPayment,
  createAsaasPixPayment,
  getAsaasPixQrCode,
} from '../../shared/asaas.ts';

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { job_id, phone: rawPhone, customer_name = "" } = body;

    if (!rawPhone && !job_id) {
      return Response.json({ error: "Telefone ou job_id são obrigatórios." }, { status: 400 });
    }

    let job: any = null;
    if (job_id) {
      try {
        job = await base44.asServiceRole.entities.ProcessingJob.get(job_id);
      } catch {}
    }

    const phoneStr = rawPhone || job?.phone || "";
    const phoneInfo = extractPhone(phoneStr);
    if (!phoneInfo) {
      return Response.json({
        error: `Telefone inválido "${phoneStr}". Formato esperado: (DDD) 9XXXX-XXXX`,
      }, { status: 400 });
    }

    // ── 1. Geração ou recuperação de cobrança Asaas única (somente PIX direto) ──
    const asaasApiKey = secrets.get("ASAAS_API_KEY");
    let pixCode = "";
    let pixQrBase64 = "";
    let asaasPaymentId = "";
    let invoiceUrl = "";

    if (asaasApiKey) {
      try {
        const asaasCustomer = await findOrCreateAsaasCustomer(asaasApiKey, {
          name: customer_name || `Cliente ${phoneInfo.formatted}`,
          phoneDigits: phoneInfo.digits,
        });

        // Verifica se já existe pagamento pendente para evitar cobrança duplicada
        const existingPending = await findPendingAsaasPayment(asaasApiKey, {
          customerId: asaasCustomer.id,
          externalReference: `job_${job_id || phoneInfo.digits}`,
        });

        let paymentObj = existingPending;

        if (!paymentObj) {
          paymentObj = await createAsaasPixPayment(asaasApiKey, {
            customerId: asaasCustomer.id,
            value: 49.90,
            externalReference: `job_${job_id || phoneInfo.digits}`,
            description: "Produção Musical Personalizada - SyncVocal / MM Music",
          });
        }

        if (paymentObj) {
          asaasPaymentId = paymentObj.id;
          invoiceUrl = paymentObj.invoiceUrl;

          // Obtém o PIX Copia e Cola e imagem do QR Code
          const pixData = await getAsaasPixQrCode(asaasApiKey, paymentObj.id);
          pixCode = pixData.payload;
          pixQrBase64 = pixData.encodedImage;

          // Salva ou atualiza a entidade MusicPayment
          try {
            await base44.asServiceRole.entities.MusicPayment.create({
              phone: phoneInfo.e164,
              phone_digits: phoneInfo.digits,
              customer_name,
              asaas_customer_id: asaasCustomer.id,
              asaas_payment_id: paymentObj.id,
              pix_code: pixCode,
              invoice_url: invoiceUrl,
              amount: 49.90,
              status: "pending",
            });
          } catch {}
        }
      } catch (asaasErr: any) {
        console.warn("[Asaas Warning]:", asaasErr.message);
      }
    }

    // ── 2. Disparo específico do Bot no Umbler ──
    const apiToken = secrets.get("UMBLER_TALK_API_TOKEN");
    const orgId = secrets.get("UMBLER_TALK_ORGANIZATION_ID");
    const channelPhone = secrets.get("UMBLER_TALK_FROM_PHONE");
    const pendingBotId = secrets.get("UMBLER_TALK_BOT_ID_PENDING") || secrets.get("UMBLER_TALK_BOT_ID") || "bot_pendente_pagamento";
    const pendingTriggerName = secrets.get("UMBLER_TALK_TRIGGER_PENDING") || "pendente de pagamento";

    if (apiToken && orgId && channelPhone) {
      try {
        await invokeStartBot({
          apiToken,
          botId: pendingBotId,
          orgId,
          triggerName: pendingTriggerName,
          channelPhone,
          customerPhone: phoneInfo.e164,
        });
      } catch (botErr: any) {
        console.warn("[Umbler Bot warning]:", botErr.message);
      }

      // Pausa curta de 3 segundos para o bot de saudação
      await new Promise((r) => setTimeout(r, 3000));

      // ── 3. Envio das 4 prévias cortadas (1:10) pelo WhatsApp ──
      const previewUris = [
        { uri: job?.preview_v1_uri, name: `${phoneInfo.formatted} - PREVIA 01.mp3` },
        { uri: job?.preview_v2_uri, name: `${phoneInfo.formatted} - PREVIA 02.mp3` },
        { uri: job?.preview_voz_v1_uri, name: `${phoneInfo.formatted} - PREVIA FINAL COM VOZ 01.mp3` },
        { uri: job?.preview_voz_v2_uri, name: `${phoneInfo.formatted} - PREVIA FINAL COM VOZ 02.mp3` },
      ].filter((p) => Boolean(p.uri));

      for (const p of previewUris) {
        try {
          const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: p.uri });
          const audioRes = await fetch(signed_url);
          if (audioRes.ok) {
            const blob = await audioRes.blob();
            await sendUmblerMediaFile({
              apiToken,
              orgId,
              channelPhone,
              customerPhone: phoneInfo.e164,
              fileBlob: blob,
              fileName: p.name,
            });
            await new Promise((r) => setTimeout(r, 3000));
          }
        } catch (mediaErr: any) {
          console.warn(`[Falha ao enviar prévia ${p.name}]:`, mediaErr.message);
        }
      }

      // ── 4. Envio do Pix via Template Oficial Aprovado "cobrana_pix_qr" ──
      if (pixCode) {
        const pixTemplateName = secrets.get("UMBLER_TALK_TEMPLATE_ID_PIX") || "cobrana_pix_qr";
        let sentWithTemplate = false;

        try {
          const tmplRes = await sendUmblerTemplateMessage({
            apiToken,
            orgId,
            channelPhone,
            customerPhone: phoneInfo.e164,
            templateNameOrId: pixTemplateName,
            params: [pixCode],
          });

          if (tmplRes.ok) {
            sentWithTemplate = true;
            console.log(`[PIX] Template "${pixTemplateName}" enviado com sucesso via botão Meta!`);
          } else {
            console.warn(`[PIX] Aviso ao enviar template "${pixTemplateName}":`, tmplRes);
          }
        } catch (tErr: any) {
          console.warn("[Umbler Template PIX Warning]:", tErr.message);
        }

        // Se o template falhar por qualquer motivo, envia a chave direta sem links
        if (!sentWithTemplate) {
          try {
            await sendUmblerTextMessage({
              apiToken,
              orgId,
              channelPhone,
              customerPhone: phoneInfo.e164,
              text: `Aqui está o seu Pix para liberação das suas músicas em alta definição e playbacks! 🎶\n\n💵 *Valor:* R$ 49,90\n\n📋 *Chave Pix Copia e Cola:* (toque abaixo para copiar)\n\`\`\`\n${pixCode}\n\`\`\`\n\nAssim que o pagamento for identificado, enviaremos automaticamente todas as suas faixas completas aqui na conversa!`,
            });
          } catch {}
        }
      }
    }

    if (job_id) {
      try {
        await base44.asServiceRole.entities.ProcessingJob.update(job_id, {
          asaas_payment_id: asaasPaymentId,
          pix_code: pixCode,
          pix_qr_base64: pixQrBase64,
        });
      } catch {}
    }

    return Response.json({
      success: true,
      pix_code: pixCode,
      pix_qr_base64: pixQrBase64,
      invoice_url: invoiceUrl,
      asaas_payment_id: asaasPaymentId,
      phone: phoneInfo.formatted,
    });
  } catch (error: any) {
    console.error("[sendUmblerPreview error]:", error);
    return Response.json({ error: error.message || "Erro ao enviar prévias" }, { status: 500 });
  }
}
