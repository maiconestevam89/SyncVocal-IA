import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';

// Starts a Replicate Demucs prediction to isolate the vocals stem from a mixed
// audio track. The audio must already be uploaded to private storage; we sign
// a short-lived URL so Replicate can fetch it. Returns the prediction id the
// client polls with isolateVocalsPoll.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const fileUri = body?.file_uri;
    if (!fileUri || typeof fileUri !== 'string') {
      return Response.json({ error: 'file_uri é obrigatório.' }, { status: 400 });
    }

    // Sign a short-lived URL so Replicate can read the private upload.
    const { signed_url } =
      await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
        file_uri: fileUri,
        expires_in: 600,
      });

    const token = secrets.get('REPLICATE_API_TOKEN');
    if (!token) {
      return Response.json(
        { error: 'REPLICATE_API_TOKEN não configurado.' },
        { status: 500 }
      );
    }

    const apiRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait',
      },
      body: JSON.stringify({
        version:
          'cjwbw/demucs:25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953',
        input: {
          stem: 'vocals',
          audio: signed_url,
          shifts: 1,
          float32: false,
          overlap: 0.25,
          clip_mode: 'rescale',
          model_name: 'htdemucs',
          mp3_bitrate: 320,
          output_format: 'mp3',
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text();
      return Response.json(
        { error: 'Replicate rejeitou a requisição.', detail },
        { status: 502 }
      );
    }

    const prediction = await apiRes.json();
    return Response.json({
      prediction_id: prediction.id,
      status: prediction.status,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}