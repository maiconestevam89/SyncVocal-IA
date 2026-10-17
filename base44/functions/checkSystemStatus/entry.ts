import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { secrets } from "base44:runtime";

export default async function (req: Request): Promise<Response> {
  try {
    const musicAiKey = secrets.get("MUSIC_AI_API_KEY") || process.env["MUSIC_AI_API_KEY"];
    const sunoKey = secrets.get("SUNO_API_KEY");
    const sunoBaseUrl = secrets.get("SUNO_API_BASE_URL") || "https://api.apipass.dev";
    const googleServiceAccount = secrets.get("GOOGLE_SERVICE_ACCOUNT_JSON") || secrets.get("GOOGLE_DRIVE_SERVICE_KEY");
    const asaasKey = secrets.get("ASAAS_API_KEY");
    const asaasWebhook = secrets.get("ASAAS_WEBHOOK_TOKEN");
    const umblerToken = secrets.get("UMBLER_TALK_API_TOKEN");
    const openRouterKey = secrets.get("OPENROUTER_API_KEY");

    let googleDriveStatus = "missing";
    if (googleServiceAccount) {
      try {
        const parsed = JSON.parse(googleServiceAccount);
        if (parsed.client_email && parsed.private_key) {
          googleDriveStatus = "valid_json";
        } else {
          googleDriveStatus = "invalid_fields";
        }
      } catch {
        googleDriveStatus = "invalid_json";
      }
    }

    const report = {
      suno: {
        configured: Boolean(sunoKey && sunoKey.trim()),
        baseUrl: sunoBaseUrl,
        keyLength: sunoKey ? sunoKey.length : 0,
      },
      musicAi: {
        configured: Boolean(musicAiKey && musicAiKey.trim()),
        keyLength: musicAiKey ? musicAiKey.length : 0,
      },
      googleDrive: {
        configured: Boolean(googleServiceAccount && googleServiceAccount.trim()),
        status: googleDriveStatus,
      },
      asaas: {
        configured: Boolean(asaasKey && asaasKey.trim()),
        webhookConfigured: Boolean(asaasWebhook && asaasWebhook.trim()),
      },
      umbler: {
        configured: Boolean(umblerToken && umblerToken.trim()),
      },
      openRouter: {
        configured: Boolean(openRouterKey && openRouterKey.trim()),
      },
    };

    const missing = [];
    if (!report.suno.configured) missing.push("SUNO_API_KEY");
    if (!report.musicAi.configured) missing.push("MUSIC_AI_API_KEY");
    if (!report.googleDrive.configured) missing.push("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!report.asaas.configured) missing.push("ASAAS_API_KEY");
    if (!report.umbler.configured) missing.push("UMBLER_TALK_API_TOKEN");

    return Response.json({
      success: true,
      report,
      missing,
      has_missing_keys: missing.length > 0,
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
