import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import {
  getGoogleDriveAccessToken,
  ensureFolderHierarchy,
  createNextSequentialMusicSubfolder,
  uploadFileToDriveFolder,
} from '../../shared/googleDrive.ts';

async function fetchBuffer(url: string): Promise<ArrayBuffer | null> {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.warn('[saveToDrive] HTTP ' + res.status + ' ao baixar áudio de: ' + url.slice(0, 80));
      return null;
    }
    const buf = await res.arrayBuffer();
    return buf instanceof ArrayBuffer ? buf : new Uint8Array(buf).buffer;
  } catch (err: any) {
    console.warn('[saveToDrive] Erro ao baixar áudio: ' + err.message);
    return null;
  }
}

export default async function (req: Request): Promise<Response> {
  let base44: any = null;

  try {
    base44 = createClientFromRequest(req);
    const body = await req.json();
    const { job_id, phone = '', urls = {} } = body;

    const serviceAccountJson = secrets.get('GOOGLE_SERVICE_ACCOUNT_JSON') || secrets.get('GOOGLE_DRIVE_SERVICE_KEY');
    if (!serviceAccountJson) {
      return Response.json({ success: false, error: 'Credenciais do Google Drive não configuradas.' });
    }

    if (job_id) {
      try {
        await base44.asServiceRole.entities.ProcessingJob.update(job_id, { status: 'uploading_drive' });
      } catch {}
    }

    // Baixa apenas os ficheiros com URLs válidas
    const [final1Buf, final2Buf, voz1Buf, voz2Buf] = await Promise.all([
      fetchBuffer(urls.final_orig_1),
      fetchBuffer(urls.final_orig_2),
      fetchBuffer(urls.final_voz_1),
      fetchBuffer(urls.final_voz_2),
    ]);

    const driveToken = await getGoogleDriveAccessToken(serviceAccountJson);
    const customerFolder = await ensureFolderHierarchy(driveToken, ['MM Music', '2026', 'Clientes', phone || 'Geral']);
    const musicSubfolder = await createNextSequentialMusicSubfolder(driveToken, customerFolder.id);

    const uploads: Promise<any>[] = [];
    if (final1Buf) {
      uploads.push(uploadFileToDriveFolder(driveToken, musicSubfolder.id, (phone || 'musica') + ' - FINAL 01.mp3', final1Buf, 'audio/mpeg'));
    }
    if (final2Buf) {
      uploads.push(uploadFileToDriveFolder(driveToken, musicSubfolder.id, (phone || 'musica') + ' - FINAL 02.mp3', final2Buf, 'audio/mpeg'));
    }
    if (voz1Buf) {
      uploads.push(uploadFileToDriveFolder(driveToken, musicSubfolder.id, (phone || 'musica') + ' - FINAL COM VOZ 01.wav', voz1Buf, 'audio/wav'));
    }
    if (voz2Buf) {
      uploads.push(uploadFileToDriveFolder(driveToken, musicSubfolder.id, (phone || 'musica') + ' - FINAL COM VOZ 02.wav', voz2Buf, 'audio/wav'));
    }

    await Promise.all(uploads);

    if (job_id) {
      try {
        await base44.asServiceRole.entities.ProcessingJob.update(job_id, { 
          status: 'completed',
          drive_folder_id: customerFolder.id,
          drive_subfolder_name: musicSubfolder.name
        });
      } catch {}
    }

    return Response.json({ success: true, folder: musicSubfolder.name, filesCount: uploads.length });
  } catch (err: any) {
    console.error('[saveToDrive] Falha:', err.message);
    return Response.json({ success: false, error: err.message });
  }
}
