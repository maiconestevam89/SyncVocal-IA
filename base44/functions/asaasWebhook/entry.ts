import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import { extractPhone, invokeStartBot, sendUmblerMediaFile, sendUmblerTextMessage, truncate } from '../../shared/umblerTalk.ts';
import {
  getGoogleDriveAccessToken,
  findCustomerDriveFolder,
  findLatestMusicSubfolder,
  findMusicDeliveryFiles,
  downloadDriveFile,
} from '../../shared/googleDrive.ts';

const ASAAS_API_URL = "https://api.asaas.com/v3";

export default async function(req: Request) {
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

  // Filtra apenas eventos de pagamento confirmado
  if (event !== "PAYMENT_RECEIVED" && event !== "PAYMENT_CONFIRMED" && !body?.force) {
    return Response.json({
      ignored: true,
      reason: `Evento '${event}' não requer disparo de entrega.`,
    });
  }

  const paymentId = payment?.id || body?.paymentId;
  let rawPhone = payment?.externalReference || body?.phone;

  // 2. Se o telefone não veio no externalReference, consulta o cliente no Asaas
  const asaasApiKey = secrets.get("ASAAS_API_KEY");
  if (!rawPhone && payment?.customer && asaasApiKey) {
    try {
      const cusRes = await fetch(`${ASAAS_API_URL}/customers/${payment.customer}`, {
        headers: { "access_token": asaasApiKey, "User-Agent": "SyncVocal-App/1.0" },
        signal: AbortSignal.timeout(15000),
      });
      if (cusRes.ok) {
        const cusData = await cusRes.json();
        rawPhone = cusData?.mobilePhone || cusData?.phone;
      }
    } catch (err) {
      console.error("Erro ao buscar cliente no Asaas:", err);
    }
  }

  const phoneInfo = extractPhone(rawPhone);
  if (!phoneInfo) {
    return Response.json({
      success: false,
      error: `Não foi possível identificar o telefone do cliente na cobrança ${paymentId}.`,
    }, { status: 400 });
  }

  // 3. Atualiza registro da cobrança no banco
  let paymentEntityId: string | null = null;
  if (base44?.asServiceRole?.entities?.MusicPayment) {
    try {
      const records = await base44.asServiceRole.entities.MusicPayment.filter({
        asaas_payment_id: paymentId,
      });
      if (records && records.length > 0) {
        paymentEntityId = records[0].id;
        await base44.asServiceRole.entities.MusicPayment.update(paymentEntityId, {
          status: "paid",
        });
      }
    } catch (err) {
      console.error("Erro ao atualizar status pago no MusicPayment:", err);
    }
  }

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

    // Pausa de 8 segundos para o bot de saudação enviar as mensagens antes da entrega dos arquivos
    await new Promise((r) => setTimeout(r, 8000));
  }

  // 5. Consulta e Download dos Arquivos no Google Drive
  const serviceAccountJson = secrets.get("GOOGLE_SERVICE_ACCOUNT_JSON") || secrets.get("GOOGLE_DRIVE_SERVICE_KEY");
  const directDriveToken = secrets.get("GOOGLE_DRIVE_ACCESS_TOKEN");

  let driveToken: string | null = null;
  if (serviceAccountJson) {
    try {
      driveToken = await getGoogleDriveAccessToken(serviceAccountJson);
    } catch (err: any) {
      deliveryLog.drive_auth_error = err.message;
    }
  } else if (directDriveToken) {
    driveToken = directDriveToken;
  }

  if (!driveToken) {
    const errorMsg = "Credenciais do Google Drive não configuradas (defina GOOGLE_SERVICE_ACCOUNT_JSON nos secrets).";
    if (paymentEntityId && base44?.asServiceRole?.entities?.MusicPayment) {
      await base44.asServiceRole.entities.MusicPayment.update(paymentEntityId, {
        error_message: errorMsg,
      });
    }
    return Response.json({
      success: false,
      warning: "Pagamento processado e bot disparado, mas os arquivos do Google Drive não puderam ser acessados.",
      error: errorMsg,
      deliveryLog,
    }, { status: 200 });
  }

  try {
    // 5.1 Localiza a pasta principal do cliente
    const customerFolder = await findCustomerDriveFolder(driveToken, phoneInfo.digits, phoneInfo.formatted);
    if (!customerFolder) {
      throw new Error(`Pasta do cliente para o telefone ${phoneInfo.formatted} não encontrada no Google Drive.`);
    }

    deliveryLog.customer_folder = { id: customerFolder.id, name: customerFolder.name };

    // 5.2 Localiza a subpasta mais recente (ex: MUSICA 02)
    const latestSubfolder = await findLatestMusicSubfolder(driveToken, customerFolder.id);
    deliveryLog.subfolder = { id: latestSubfolder.id, name: latestSubfolder.name };

    // 5.3 Encontra os 4 arquivos (FINAL 01, FINAL 02, PLAYBACK 01, PLAYBACK 02)
    const musicFiles = await findMusicDeliveryFiles(driveToken, latestSubfolder.id);
    deliveryLog.found_files_count = musicFiles.length;

    if (musicFiles.length === 0) {
      throw new Error(`Nenhum arquivo final/playback encontrado na pasta ${latestSubfolder.name}.`);
    }

    // 5.4 Envia cada arquivo para o cliente via Umbler Talk
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
          http_status: sendRes.status,
        });

        if (sendRes.ok) deliveredCount++;

        // Pausa entre envios para preservar ordem e evitar limite do WhatsApp
        await new Promise((r) => setTimeout(r, 4000));
      } catch (fileErr: any) {
        deliveryLog.files_delivered.push({
          name: f.name,
          category: f.category,
          status: "error",
          error: fileErr.message,
        });
      }
    }

    // 6. Atualiza o registro final no banco
    if (paymentEntityId && base44?.asServiceRole?.entities?.MusicPayment) {
      await base44.asServiceRole.entities.MusicPayment.update(paymentEntityId, {
        status: deliveredCount >= 4 ? "delivered" : "paid",
        drive_folder_id: customerFolder.id,
        drive_subfolder_name: latestSubfolder.name,
        files_delivered_count: deliveredCount,
      });
    }

    return Response.json({
      success: true,
      status: "Pagamento confirmado e entrega de arquivos concluída",
      delivered_count: deliveredCount,
      deliveryLog,
    });
  } catch (error: any) {
    if (paymentEntityId && base44?.asServiceRole?.entities?.MusicPayment) {
      try {
        await base44.asServiceRole.entities.MusicPayment.update(paymentEntityId, {
          error_message: error.message,
        });
      } catch {}
    }

    return Response.json({
      success: false,
      error: error.message,
      deliveryLog,
    }, { status: 500 });
  }
}
