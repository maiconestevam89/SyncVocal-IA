import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import {
  extractPhone,
  invokeStartBot,
  sendUmblerMediaFile,
  sendUmblerTextMessage,
  truncate,
} from '../../shared/umblerTalk.ts';
import {
  getGoogleDriveAccessToken,
  findCustomerDriveFolder,
  findLatestMusicSubfolder,
  findMusicDeliveryFiles,
  downloadDriveFile,
  copyFolderToSharedAndGetLink,
} from '../../shared/googleDrive.ts';

const ASAAS_API_URL = "https://api.asaas.com/v3";
const processedPaymentsMap = new Map<string, number>();

export default async function (req: Request) {
  if (req.method === "GET") {
    return Response.json({
      status: "online",
      description: "Webhook do Asaas para confirmação de pagamento e entrega via Google Drive e Umbler Talk",
    });
  }

  let base44: any = null;
  try {
    base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch {}
  } catch {}

  // 1. Validação de segurança do token Asaas
  const configuredWebhookToken = secrets.get("ASAAS_WEBHOOK_TOKEN");
  const receivedToken = req.headers.get("asaas-access-token");
  if (configuredWebhookToken && receivedToken !== configuredWebhookToken) {
    return Response.json({ error: "Token de webhook não autorizado" }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Payload JSON inválido" }, { status: 400 });
  }

  const event = body?.event;
  const payment = body?.payment;

  if (event !== "PAYMENT_RECEIVED" && event !== "PAYMENT_CONFIRMED" && !body?.force) {
    return Response.json({
      ignored: true,
      reason: `Evento '${event}' não requer disparo de entrega.`,
    });
  }

  const paymentId = payment?.id || body?.paymentId;
  if (!paymentId) {
    return Response.json({ error: "paymentId não informado no payload" }, { status: 400 });
  }

  // Trava anti-duplicidade em memória (10 minutos)
  const now = Date.now();
  const lastProcessed = processedPaymentsMap.get(paymentId);
  if (lastProcessed && now - lastProcessed < 10 * 60 * 1000 && !body?.force) {
    return Response.json({
      ignored: true,
      reason: `Pagamento ${paymentId} já processado recentemente.`,
    });
  }

  // 2. Extração do telefone do cliente
  let rawPhone = payment?.mobilePhone || payment?.phone;
  let customerName = payment?.customerName || "";

  if (!rawPhone && payment?.customer) {
    const asaasApiKey = secrets.get("ASAAS_API_KEY");
    if (asaasApiKey) {
      try {
        const custRes = await fetch(`${ASAAS_API_URL}/customers/${payment.customer}`, {
          headers: { access_token: asaasApiKey, "User-Agent": "SyncVocal/1.0" },
        });
        if (custRes.ok) {
          const custData = await custRes.json();
          rawPhone = custData.mobilePhone || custData.phone;
          customerName = custData.name || customerName;
        }
      } catch {}
    }
  }

  const phoneInfo = extractPhone(rawPhone || "");
  if (!phoneInfo) {
    return Response.json({
      error: `Não foi possível extrair um telefone válido do pagamento ${paymentId}.`,
    }, { status: 400 });
  }

  // 3. Atualiza entidade MusicPayment
  let paymentEntityId: string | null = null;
  if (base44?.asServiceRole?.entities?.MusicPayment) {
    try {
      const records = await base44.asServiceRole.entities.MusicPayment.filter({
        asaas_payment_id: paymentId,
      });
      if (records && records.length > 0) {
        paymentEntityId = records[0].id;
        if (records[0].status === "delivered" && !body?.force) {
          processedPaymentsMap.set(paymentId, now);
          return Response.json({
            ignored: true,
            reason: `Entrega da cobrança ${paymentId} já havia sido concluída anteriormente.`,
          });
        }
        await base44.asServiceRole.entities.MusicPayment.update(paymentEntityId, {
          status: "paid",
        });
      }
    } catch (err) {
      console.error("Erro ao atualizar status pago no MusicPayment:", err);
    }
  }

  processedPaymentsMap.set(paymentId, now);

  const deliveryLog: any = {
    payment_id: paymentId,
    phone: phoneInfo.e164,
    bot_triggered: false,
    files_delivered: [],
  };

  // 4. Disparo do Bot "Pagamento da música" no Umbler Talk
  const umblerToken = secrets.get("UMBLER_TALK_API_TOKEN");
  const umblerOrgId = secrets.get("UMBLER_TALK_ORGANIZATION_ID");
  const umblerChannelPhone = secrets.get("UMBLER_TALK_FROM_PHONE");
  const paymentBotId = secrets.get("UMBLER_TALK_BOT_ID_PAYMENT") || secrets.get("UMBLER_TALK_BOT_ID") || "aaRxg5RS5vxsTe8j";
  const paymentTriggerName = secrets.get("UMBLER_TALK_TRIGGER_PAYMENT") || "Pagamento da música";

  if (umblerToken && umblerOrgId && umblerChannelPhone) {
    try {
      const botRes = await invokeStartBot({
        apiToken: umblerToken,
        botId: paymentBotId,
        orgId: umblerOrgId,
        triggerName: paymentTriggerName,
        channelPhone: umblerChannelPhone,
        customerPhone: phoneInfo.e164,
      });
      deliveryLog.bot_triggered = botRes.ok;
      deliveryLog.bot_details = botRes;
    } catch (err: any) {
      deliveryLog.bot_error = err.message;
    }

    // Pausa para mensagens de saudação do bot
    await new Promise((r) => setTimeout(r, 6000));
  }

  // 5. Consulta e Download dos Arquivos no Google Drive
  const serviceAccountJson = secrets.get("GOOGLE_SERVICE_ACCOUNT_JSON") || secrets.get("GOOGLE_DRIVE_SERVICE_KEY");
  let driveToken: string | null = null;
  if (serviceAccountJson) {
    try {
      driveToken = await getGoogleDriveAccessToken(serviceAccountJson);
    } catch (err: any) {
      deliveryLog.drive_auth_error = err.message;
    }
  }

  if (!driveToken) {
    return Response.json({
      success: false,
      warning: "Pagamento recebido, mas o Google Drive não pôde ser autenticado.",
      deliveryLog,
    });
  }

  try {
    // 5.1 Localiza pasta do cliente
    const customerFolder = await findCustomerDriveFolder(driveToken, phoneInfo.digits, phoneInfo.formatted);
    if (!customerFolder) {
      throw new Error(`Pasta do cliente ${phoneInfo.formatted} não encontrada no Google Drive.`);
    }

    // 5.2 Localiza a subpasta mais recente
    const latestSubfolder = await findLatestMusicSubfolder(driveToken, customerFolder.id);

    // 5.3 Encontra os arquivos de áudio completos
    const musicFiles = await findMusicDeliveryFiles(driveToken, latestSubfolder.id);

    // 5.4 Envia os arquivos completos para o cliente via WhatsApp
    let deliveredCount = 0;
    for (const f of musicFiles) {
      try {
        const blob = await downloadDriveFile(driveToken, f.id);
        const sendRes = await sendUmblerMediaFile({
          apiToken: umblerToken!,
          orgId: umblerOrgId!,
          channelPhone: umblerChannelPhone!,
          customerPhone: phoneInfo.e164,
          fileBlob: blob,
          fileName: f.name,
        });

        deliveryLog.files_delivered.push({
          name: f.name,
          category: f.category,
          status: sendRes.ok ? "sent" : "failed",
        });

        if (sendRes.ok) deliveredCount++;
        await new Promise((r) => setTimeout(r, 4000));
      } catch (fileErr: any) {
        deliveryLog.files_delivered.push({ name: f.name, status: "error", error: fileErr.message });
      }
    }

    // ── 6. FLUXO 10: Compartilhando diretório do Drive (Pastas compartilhadas) ──
    let sharedLink = "";
    try {
      const copyResult = await copyFolderToSharedAndGetLink(
        driveToken,
        phoneInfo.formatted,
        latestSubfolder.name,
        latestSubfolder.id
      );
      sharedLink = copyResult.webViewLink;
      deliveryLog.shared_drive_link = sharedLink;
    } catch (shareErr: any) {
      console.warn("Aviso ao copiar para pastas compartilhadas:", shareErr.message);
    }

    // ── 7. FLUXO 11: Mensagem de Download Dinâmica ──
    if (sharedLink && umblerToken && umblerOrgId && umblerChannelPhone) {
      try {
        const dynamicMsg = `Você também pode baixar todas suas produções feitas conosco através do link abaixo:\n${sharedLink}\nAcesse e faça o download de sua música!`;
        await sendUmblerTextMessage({
          apiToken: umblerToken,
          orgId: umblerOrgId,
          channelPhone: umblerChannelPhone,
          customerPhone: phoneInfo.e164,
          text: dynamicMsg,
        });
        deliveryLog.dynamic_link_message_sent = true;
      } catch (msgErr: any) {
        console.warn("Erro ao enviar mensagem dinâmica:", msgErr.message);
      }

      await new Promise((r) => setTimeout(r, 4000));

      // ── 8. FLUXO 12: Agradecimento e Upsell ──
      try {
        const upsellMsg = `Agradecemos pela preferência em produzir conosco! 🎵✨\n\nDeseja potencializar ainda mais o seu projeto? Confira nossos serviços adicionais:\n\n1️⃣ Registro da música (R$ 49,90) - Garanta a proteção autoral da sua obra\n2️⃣ Criação de vídeo com legenda karaokê (R$ 39,90) - Pronto para divulgar nas redes\n3️⃣ Partitura cifrada (R$ 29,90) - Cifras completas para tocar e cantar\n\nResponda diretamente a esta mensagem para solicitar algum desses serviços adicionais!`;

        await sendUmblerTextMessage({
          apiToken: umblerToken,
          orgId: umblerOrgId,
          channelPhone: umblerChannelPhone,
          customerPhone: phoneInfo.e164,
          text: upsellMsg,
        });
        deliveryLog.upsell_message_sent = true;
      } catch (upsellErr: any) {
        console.warn("Erro ao enviar mensagem de upsell:", upsellErr.message);
      }
    }

    // 9. Atualiza status no banco
    if (paymentEntityId && base44?.asServiceRole?.entities?.MusicPayment) {
      await base44.asServiceRole.entities.MusicPayment.update(paymentEntityId, {
        status: "delivered",
        drive_folder_id: customerFolder.id,
        drive_subfolder_name: latestSubfolder.name,
        files_delivered_count: deliveredCount,
      });
    }

    return Response.json({
      success: true,
      status: "Entrega completa realizada com sucesso!",
      deliveredCount,
      sharedLink,
      deliveryLog,
    });
  } catch (error: any) {
    return Response.json({
      success: false,
      error: error.message,
      deliveryLog,
    }, { status: 500 });
  }
}
