import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { uploadToMusicAi, identifySongCopyright } from '../../shared/musicAi.ts';

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { file_uri, job_id, phone } = body;

    if (!file_uri) {
      return Response.json({ error: "file_uri é obrigatório" }, { status: 400 });
    }

    if (job_id) {
      try {
        await base44.asServiceRole.entities.ProcessingJob.update(job_id, {
          status: "checking_copyright",
        });
      } catch {}
    }

    // 1. Gera URL assinada do arquivo privado
    const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri,
      expires_in: 3600,
    });

    // 2. Baixa o buffer do áudio para enviar para o Music.ai
    const audioRes = await fetch(signed_url);
    if (!audioRes.ok) {
      throw new Error(`Falha ao obter áudio do storage (${audioRes.status})`);
    }
    const audioBuffer = await audioRes.arrayBuffer();

    // 3. Faz upload para o Music.ai staging
    const { fileReference } = await uploadToMusicAi(audioBuffer, "audio/mpeg");

    // 4. Executa o workflow "Identify Song"
    const copyrightResult = await identifySongCopyright(fileReference, "Identify Song - Check");

    if (copyrightResult.hasCopyright) {
      if (job_id) {
        try {
          await base44.asServiceRole.entities.ProcessingJob.update(job_id, {
            status: "copyright_blocked",
            copyright_detected: true,
            copyright_details: copyrightResult,
          });
        } catch {}
      }

      return Response.json({
        copyright_detected: true,
        details: {
          title: copyrightResult.title,
          artist: copyrightResult.artist,
          label: copyrightResult.label,
          isrc: copyrightResult.isrc,
          raw: copyrightResult.rawMetadata,
        },
      });
    }

    if (job_id) {
      try {
        await base44.asServiceRole.entities.ProcessingJob.update(job_id, {
          copyright_detected: false,
        });
      } catch {}
    }

    return Response.json({
      copyright_detected: false,
      message: "Nenhum direito autoral detectado. Fluxo liberado.",
    });
  } catch (error: any) {
    console.error("[checkCopyright error]:", error);
    return Response.json({
      error: error.message || "Erro ao verificar direitos autorais",
    }, { status: 500 });
  }
}
