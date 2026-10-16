const ASAAS_API_URL = "https://api.asaas.com/v3";
const ASAAS_USER_AGENT = "SyncVocal-App/1.0";

function asaasHeaders(apiKey: string) {
  return {
    "access_token": apiKey,
    "Content-Type": "application/json",
    "User-Agent": ASAAS_USER_AGENT,
  };
}

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
  dateCreated?: string;
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
    headers: asaasHeaders(apiKey),
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
    headers: asaasHeaders(apiKey),
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

/**
 * Busca se já existe uma cobrança PENDENTE ativa no Asaas para este cliente ou telefone.
 * Evita geração repetida de cobranças para o mesmo pedido.
 */
export async function findPendingAsaasPayment(
  apiKey: string,
  { customerId, externalReference }: { customerId?: string; externalReference?: string }
): Promise<AsaasPayment | null> {
  try {
    if (externalReference) {
      const res = await fetch(`${ASAAS_API_URL}/payments?externalReference=${encodeURIComponent(externalReference)}&status=PENDING&limit=1`, {
        headers: asaasHeaders(apiKey),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const list = await res.json();
        if (list?.data && list.data.length > 0) {
          return list.data[0];
        }
      }
    }

    if (customerId) {
      const res = await fetch(`${ASAAS_API_URL}/payments?customer=${encodeURIComponent(customerId)}&status=PENDING&limit=1`, {
        headers: asaasHeaders(apiKey),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const list = await res.json();
        if (list?.data && list.data.length > 0) {
          return list.data[0];
        }
      }
    }
  } catch (err) {
    console.warn("Aviso ao buscar cobrança pendente existente no Asaas:", err);
  }

  return null;
}

/**
 * Busca se existe uma cobrança PAGA recentemente (RECEIVED ou CONFIRMED) no Asaas.
 * Garante que quem já pagou não receba novas cobranças em loop.
 */
export async function findRecentPaidAsaasPayment(
  apiKey: string,
  { customerId, externalReference }: { customerId?: string; externalReference?: string }
): Promise<AsaasPayment | null> {
  try {
    const checkQuery = async (query: string): Promise<AsaasPayment | null> => {
      const res = await fetch(`${ASAAS_API_URL}/payments?${query}&limit=5`, {
        headers: asaasHeaders(apiKey),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const list = await res.json();
        if (list?.data && list.data.length > 0) {
          const paid = list.data.find((p: any) => p.status === "RECEIVED" || p.status === "CONFIRMED");
          if (paid) return paid;
        }
      }
      return null;
    };

    if (externalReference) {
      const paid = await checkQuery(`externalReference=${encodeURIComponent(externalReference)}`);
      if (paid) return paid;
    }

    if (customerId) {
      const paid = await checkQuery(`customer=${encodeURIComponent(customerId)}`);
      if (paid) return paid;
    }
  } catch (err) {
    console.warn("Aviso ao buscar cobrança paga recente no Asaas:", err);
  }

  return null;
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
    headers: asaasHeaders(apiKey),
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
    headers: asaasHeaders(apiKey),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha ao obter QR Code Pix do Asaas (${res.status}): ${errText}`);
  }

  return await res.json();
}
