const ASAAS_API_URL = "https://api.asaas.com/v3";

export interface AsaasCustomer {
  id: string;
  name: string;
  mobilePhone?: string;
  phone?: string;
}

export interface AsaasPayment {
  id: string;
  customer: string;
  value: number;
  netValue?: number;
  billingType: string;
  status: string;
  dueDate: string;
  invoiceUrl: string;
  externalReference?: string;
  description?: string;
}

export interface AsaasPixQrCode {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}

export async function findOrCreateAsaasCustomer(
  apiKey: string,
  { name, phoneDigits }: { name?: string; phoneDigits: string }
): Promise<AsaasCustomer> {
  const searchRes = await fetch(`${ASAAS_API_URL}/customers?mobilePhone=${encodeURIComponent(phoneDigits)}&limit=1`, {
    headers: {
      "access_token": apiKey,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20000),
  });

  if (searchRes.ok) {
    const list = await searchRes.json();
    if (list?.data && list.data.length > 0) {
      return list.data[0];
    }
  }

  // Se não encontrou pelo mobilePhone, cria o cliente
  const displayName = (name && name.trim().length > 1) ? name.trim() : `Cliente ${phoneDigits}`;
  const createRes = await fetch(`${ASAAS_API_URL}/customers`, {
    method: "POST",
    headers: {
      "access_token": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: displayName,
      mobilePhone: phoneDigits,
      notificationDisabled: true,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Falha ao criar cliente no Asaas (${createRes.status}): ${errText}`);
  }

  return await createRes.json();
}

export async function createAsaasPixPayment(
  apiKey: string,
  {
    customerId,
    value = 49.90,
    externalReference,
    description = "Música Personalizada - Produção Final",
  }: {
    customerId: string;
    value?: number;
    externalReference: string;
    description?: string;
  }
): Promise<AsaasPayment> {
  // Data de vencimento = hoje + 2 dias
  const dueDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const res = await fetch(`${ASAAS_API_URL}/payments`, {
    method: "POST",
    headers: {
      "access_token": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customer: customerId,
      billingType: "PIX",
      value,
      dueDate,
      description,
      externalReference,
      postalService: false,
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha ao criar cobrança no Asaas (${res.status}): ${errText}`);
  }

  return await res.json();
}

export async function getAsaasPixQrCode(
  apiKey: string,
  paymentId: string
): Promise<AsaasPixQrCode> {
  const res = await fetch(`${ASAAS_API_URL}/payments/${paymentId}/pixQrCode`, {
    headers: {
      "access_token": apiKey,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha ao obter QR Code Pix do Asaas (${res.status}): ${errText}`);
  }

  return await res.json();
}
