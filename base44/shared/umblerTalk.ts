export const UTALK_BASE = "https://app-utalk.umbler.com/api";

const PHONE_REGEX = /(?<!\d)(?:\+?55[\s.\-]*)?\(?(\d{2})\)?[\s.\-]*(9?\d{4})[\s.\-]*(\d{4})(?!\d)/;

export function extractPhone(text: string): { e164: string; digits: string; ddd: string; formatted: string } | null {
  if (!text) return null;
  const m = String(text).match(PHONE_REGEX);
  if (!m) {
    const rawDigits = String(text).replace(/\D/g, "");
    const cleanDigits = rawDigits.startsWith("55") && rawDigits.length >= 12 ? rawDigits.slice(2) : rawDigits;
    if (cleanDigits.length === 10 || cleanDigits.length === 11) {
      const ddd = cleanDigits.slice(0, 2);
      const rest = cleanDigits.slice(2);
      const p1 = rest.length === 9 ? rest.slice(0, 5) : rest.slice(0, 4);
      const p2 = rest.length === 9 ? rest.slice(5) : rest.slice(4);
      return {
        e164: `+55${cleanDigits}`,
        digits: cleanDigits,
        ddd,
        formatted: `${ddd} ${p1}-${p2}`,
      };
    }
    return null;
  }

  const ddd = m[1];
  const p1 = m[2];
  const p2 = m[3];
  const cleanDigits = `${ddd}${p1}${p2}`;
  return {
    e164: `+55${cleanDigits}`,
    digits: cleanDigits,
    ddd,
    formatted: `${ddd} ${p1}-${p2}`,
  };
}

export function truncate(obj: any, max = 2000): string {
  const str = typeof obj === "string" ? obj : JSON.stringify(obj);
  return str.length > max ? str.slice(0, max) : str;
}

export async function invokeStartBot({
  apiToken,
  botId,
  orgId,
  triggerName,
  channelPhone,
  customerPhone,
}: {
  apiToken: string;
  botId: string;
  orgId: string;
  triggerName: string;
  channelPhone: string;
  customerPhone: string;
}) {
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
  let lastData: any = null;

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
    } catch (err: any) {
      lastStatus = 500;
      lastData = err?.message || String(err);
    }
  }

  return { ok: false, status: lastStatus, data: lastData };
}

export async function sendUmblerTextMessage({
  apiToken,
  orgId,
  channelPhone,
  customerPhone,
  text,
}: {
  apiToken: string;
  orgId: string;
  channelPhone: string;
  customerPhone: string;
  text: string;
}) {
  // Tenta envio simplificado via FormData
  try {
    const formData = new FormData();
    formData.append("ToPhone", customerPhone);
    formData.append("FromPhone", channelPhone);
    formData.append("OrganizationId", orgId);
    formData.append("Message", text);

    const res = await fetch(`${UTALK_BASE}/v1/messages/simplified/`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiToken}` },
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (res.ok) {
      let data;
      try { data = await res.json(); } catch { data = await res.text(); }
      return { ok: true, status: res.status, data };
    }
  } catch (err) {
    // continua para tentativa JSON
  }

  // Fallback JSON
  const jsonRes = await fetch(`${UTALK_BASE}/v1/messages/`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      toPhone: customerPhone,
      fromPhone: channelPhone,
      organizationId: orgId,
      message: text,
    }),
    signal: AbortSignal.timeout(30000),
  });

  let data;
  try { data = await jsonRes.json(); } catch { data = await jsonRes.text(); }
  return { ok: jsonRes.ok, status: jsonRes.status, data };
}

export async function sendUmblerMediaFile({
  apiToken,
  orgId,
  channelPhone,
  customerPhone,
  fileBlob,
  fileName,
}: {
  apiToken: string;
  orgId: string;
  channelPhone: string;
  customerPhone: string;
  fileBlob: Blob;
  fileName: string;
}) {
  const formData = new FormData();
  formData.append("ToPhone", customerPhone);
  formData.append("FromPhone", channelPhone);
  formData.append("OrganizationId", orgId);
  formData.append("File", fileBlob, fileName);

  const res = await fetch(`${UTALK_BASE}/v1/messages/simplified/`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiToken}` },
    body: formData,
    signal: AbortSignal.timeout(90000),
  });

  let data;
  try { data = await res.json(); } catch { data = await res.text(); }
  return { ok: res.ok, status: res.status, data };
}
