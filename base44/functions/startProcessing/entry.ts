import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// Creates a ProcessingJob entity. The entity-triggered workflow
// (Process Audio Pipeline) picks it up and runs the full pipeline
// server-side: isolate -> align -> mix -> send via WhatsApp.
//
// Receives:
// - Direct Stems mode: { direct_stems: true, vocal1_uri, instrumental_uri, vocal2_uri, version, phone, customer_name }
// - Raw reference audio mode: { audio1_file_uri, audio2_file_uri, audio1_name, phone, customer_name }
// Returns: { success: true, job_id, id }
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const {
      audio1_file_uri,
      audio2_file_uri,
      audio1_name,
      phone = '',
      customer_name = '',
      direct_stems = false,
      version = 1,
      vocal1_uri,
      vocal2_uri,
      instrumental_uri,
    } = body;

    const phone_digits = String(phone || '').replace(/\D/g, '');

    const jobData: Record<string, any> = {
      status: 'pending',
      phone: String(phone || ''),
      phone_digits,
    };

    if (direct_stems) {
      if (!vocal1_uri || !instrumental_uri || !vocal2_uri) {
        return Response.json(
          { error: 'Stems ausentes: vocal1_uri, instrumental_uri e vocal2_uri são obrigatórios.' },
          { status: 400 }
        );
      }
      jobData.direct_stems = true;
      jobData.version = Number(version) || 1;
      jobData.vocal1_uri = vocal1_uri;
      jobData.vocal2_uri = vocal2_uri;
      jobData.instrumental_uri = instrumental_uri;
      jobData.audio2_file_uri = vocal2_uri;
      jobData.audio1_name = audio1_name || ('Produção musical - versão ' + version);
    } else {
      if (!audio1_file_uri || !audio2_file_uri) {
        return Response.json(
          { error: 'Parâmetros ausentes: audio1_file_uri e audio2_file_uri são obrigatórios.' },
          { status: 400 }
        );
      }
      jobData.audio1_file_uri = audio1_file_uri;
      jobData.audio2_file_uri = audio2_file_uri;
      jobData.audio1_name = audio1_name || 'Música de Referência';
    }

    const job = await base44.asServiceRole.entities.ProcessingJob.create(jobData);
    return Response.json({ success: true, job_id: job.id, id: job.id });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
