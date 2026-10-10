import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';

// Vocal isolation with Demucs on fal.ai (queue API).
//   { action: 'start', audio_url }  -> { request_id }
//   { action: 'poll',  request_id } -> { status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED', vocals_url? }
// FAL_KEY stays on the server; the browser only ever sees the final stem URL.

const QUEUE = 'https://queue.fal.run/fal-ai/demucs';
const ID_RE = /^[0-9a-fA-F-]{20,64}$/;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const key = secrets.get('FAL_KEY');
    if (!key) return Response.json({ error: 'Chave do fal.ai não configurada' }, { status: 500 });
    const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };

    const body = await req.json();
    const action = body?.action;

    if (action === 'start') {
      const audioUrl = body?.audio_url;
      if (typeof audioUrl !== 'string' || !audioUrl.startsWith('https://') || audioUrl.length > 4000) {
        return Response.json({ error: 'Link do áudio inválido' }, { status: 400 });
      }
      const res = await fetch(QUEUE, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          audio_url: audioUrl,
          model: 'htdemucs_ft',
          stems: ['vocals'],
          output_format: 'mp3',
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const txt = await res.text();
        return Response.json({ error: `fal.ai recusou o envio (${res.status}): ${txt.slice(0, 300)}` }, { status: 502 });
      }
      const json = await res.json();
      if (!json?.request_id) return Response.json({ error: 'fal.ai não retornou o identificador' }, { status: 502 });
      return Response.json({ request_id: json.request_id });
    }

    if (action === 'poll') {
      const id = body?.request_id;
      if (typeof id !== 'string' || !ID_RE.test(id)) {
        return Response.json({ error: 'Identificador inválido' }, { status: 400 });
      }
      const stRes = await fetch(`${QUEUE}/requests/${id}/status`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!stRes.ok) {
        const txt = await stRes.text();
        return Response.json({ error: `fal.ai (status ${stRes.status}): ${txt.slice(0, 300)}` }, { status: 502 });
      }
      const st = await stRes.json();
      if (st?.status !== 'COMPLETED') {
        return Response.json({ status: st?.status || 'IN_QUEUE', queue_position: st?.queue_position ?? null });
      }

      const resRes = await fetch(`${QUEUE}/requests/${id}`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!resRes.ok) {
        const txt = await resRes.text();
        return Response.json({ error: `fal.ai falhou na separação (${resRes.status}): ${txt.slice(0, 300)}` }, { status: 502 });
      }
      const result = await resRes.json();
      const vocalsUrl = result?.vocals?.url || result?.data?.vocals?.url;
      if (!vocalsUrl) return Response.json({ error: 'fal.ai não retornou a faixa de voz' }, { status: 502 });
      return Response.json({ status: 'COMPLETED', vocals_url: vocalsUrl });
    }

    return Response.json({ error: 'Ação inválida' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}