import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';

// Polls a Replicate Demucs prediction started by isolateVocalsStart.
// Returns { status, vocals_url } — vocals_url is set once status === 'succeeded'.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const predictionId = body?.prediction_id;
    if (!predictionId || typeof predictionId !== 'string') {
      return Response.json({ error: 'prediction_id é obrigatório.' }, { status: 400 });
    }

    const token = secrets.get('REPLICATE_API_TOKEN');
    if (!token) {
      return Response.json(
        { error: 'REPLICATE_API_TOKEN não configurado.' },
        { status: 500 }
      );
    }

    const apiRes = await fetch(
      `https://api.replicate.com/v1/predictions/${encodeURIComponent(predictionId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!apiRes.ok) {
      const detail = await apiRes.text();
      return Response.json(
        { error: 'Falha ao consultar o Replicate.', detail },
        { status: 502 }
      );
    }

    const prediction = await apiRes.json();

    // Demucs returns an object of stem URLs when succeeded; we want vocals.
    let vocalsUrl = null;
    if (prediction.status === 'succeeded' && prediction.output) {
      vocalsUrl =
        typeof prediction.output === 'object'
          ? prediction.output.vocals
          : null;
    }

    return Response.json({
      status: prediction.status,
      error: prediction.error || null,
      vocals_url: vocalsUrl,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}