import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import { extractPhone } from '../../shared/umblerTalk.ts';
import {
  findOrCreateAsaasCustomer,
  findPendingAsaasPayment,
  createAsaasPixPayment,
  getAsaasPixQrCode,
} from '../../shared/asaas.ts';

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { phone: rawPhone, customer_name = "", job_id } = body;

    const phoneInfo = extractPhone(rawPhone || "11988032049");
    if (!phoneInfo) {
      return Response.json({ error: "Telefone inválido" }, { status: 400 });
    }

    const asaasApiKey = secrets.get("ASAAS_API_KEY");
    if (!asaasApiKey) {
      return Response.json({ error: "ASAAS_API_KEY não configurada nos secrets." }, { status: 500 });
    }

    const asaasCustomer = await findOrCreateAsaasCustomer(asaasApiKey, {
      name: customer_name || `Cliente ${phoneInfo.formatted}`,
      phoneDigits: phoneInfo.digits,
    });

    const ref = `job_${job_id || phoneInfo.digits}`;
    let payment = await findPendingAsaasPayment(asaasApiKey, {
      customerId: asaasCustomer.id,
      externalReference: ref,
    });

    if (!payment) {
      payment = await createAsaasPixPayment(asaasApiKey, {
        customerId: asaasCustomer.id,
        value: 49.90,
        externalReference: ref,
        description: "Música Personalizada - SyncVocal / MM Music",
      });
    }

    const pixData = await getAsaasPixQrCode(asaasApiKey, payment.id);

    return Response.json({
      success: true,
      payment_id: payment.id,
      pix_code: pixData.payload,
      pix_qr_base64: pixData.encodedImage,
      invoice_url: payment.invoiceUrl,
      amount: payment.value,
      due_date: payment.dueDate,
    });
  } catch (err: any) {
    return Response.json({ error: err.message || "Erro ao gerar PIX" }, { status: 500 });
  }
}
