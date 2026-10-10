import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';

// Isolates the lead vocal from an uploaded audio file using Demucs on fal.ai.
// Input:  { audio_base64: string, mime: string }
// Output: { audio_base64: string, mime: string, request_id: string }
// The key lives in the FAL_KEY secret — never sent to the browser.

const FAL_API = 'https://fal.run/fal-ai/demucs';
const QUEUE_SUBMIT = 'https://queue.fal.run/fal-ai/demucs';
const QUEUE_STATUS = 'https://queue.fal.run/fal-ai/demucs';
const QUEUE_RESULT = 'https://queue.fal.run/fal-ai/demucs';

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const key = secrets.get('FAL_KEY');
    if (!key) return Response.json({ error: 'Chave do fal.ai não configurada' }, { status: 500 });

    const body = await req.json();
    const audio_base64 = body?.audio_base64;
    const mime = body?.mime || 'audio/wav';
    if (!audio_base64 || typeof audio_base64 !== 'string') {
      return Response.json({ error: 'Áudio ausente' }, { status: 400 });
    }
    // Bound the payload to ~40 MB so we don't ship huge files through the proxy.
    if (audio_base64.length > 40 * 1024 * 1024) {
      return Response.json({ error: 'Áudio muito grande (máx ~30 MB)' }, { status: 413 });
    }

    const authHeaders = {
      Authorization: `Key ${key}`,
      'Content-Type': 'application/json',
    };

    // Submit to the queue (fal accepts a base64 data URI as audio_url).
    const submitRes = await fetch(QUEUE_SUBMIT, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        audio_url: `data:${mime};base64,${audio_base64}`,
        model: 'htdemucs_ft',
        stems: ['vocals'],
        output_format: 'wav',
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!submitRes.ok) {
      const txt = await submitRes.text();
      return Response.json({ error: `fal.ai (submit): ${submitRes.status} ${txt.slice(0, 200)}` }, { status: 502 });
    }
    const submitJson = await submitRes.json();
    const requestId = submitJson?.request_id;
    if (!requestId) return Response.json({ error: 'fal.ai não retornou request_id' }, { status: 502 });

    // Poll the queue until done. Demucs on GPU usually finishes within a few minutes.
    let status = '';
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const stRes = await fetch(`${QUEUE_STATUS}/requests/${requestId}`, {
        headers: { Authorization: `Key ${key}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!stRes.ok) continue;
      const stJson = await stRes.json();
      status = stJson?.status || '';
      if (status === 'COMPLETED' || status === 'FAILED' || stJson?.error) {
        if (status === 'FAILED' || stJson?.error) {
          return Response.json({ error: 'fal.ai falhou na separação', detail: JSON.stringify(stJson).slice(0, 300) }, { status: 502 });
        }
        break;
      }
    }
    if (status !== 'COMPLETED') {
      return Response.json({ error: 'Tempo esgotado aguardando o fal.ai' }, { status: 504 });
    }

    // Fetch the result and read the vocals URL.
    const resultRes = await fetch(`${QUEUE_RESULT}/requests/${requestId}`, {
      headers: { Authorization: `Key ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!resultRes.ok) {
      return Response.json({ error: `fal.ai (result): ${resultRes.status}` }, { status: 502 });
    }
    const resultJson = await resultRes.json();
    const vocalsUrl = resultJson?.data?.vocals?.url;
    if (!vocalsUrl) return Response.json({ error: 'fal.ai não retornou o stem vocal' }, { status: 502 });

    // Download the separated vocal and relay it back to the browser as base64.
    const dlRes = await fetch(vocalsUrl, { signal: AbortSignal.timeout(30000) });
    if (!dlRes.ok) return Response.json({ error: 'Não foi possível baixar o stem' }, { status: 502 });
    const buf = await dlRes.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return Response.json({
      audio_base64: b64,
      mime: 'audio/wav',
      request_id: requestId,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}