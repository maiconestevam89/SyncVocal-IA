import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import {
  getGoogleDriveAccessToken,
  ensureFolderHierarchy,
  createNextSequentialMusicSubfolder,
  uploadFileToDriveFolder,
} from '../../shared/googleDrive.ts';

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar áudio: ${url}`);
  const buf = await res.arrayBuffer();
  return buf;
}

export default async function (req: Request): Promise<Response> {
  let base44: any = null;

  try {
    base44 = createClientFromRequest(req);
    const body = await req.json();
    const { job_id, phone, urls } = body;

    const serviceAccountJson = secrets.get("GOOGLE_SERVICE_ACCOUNT_JSON") || secrets.get("GOOGLE_DRIVE_SERVICE_KEY");
    if (!serviceAccountJson) {
      return Response.json({ success: false, error: "Credenciais do Google Drive não configuradas." });
    }

    if (job_id) {
      await base44.asServiceRole.entities.ProcessingJob.update(job_id, { status: "uploading_drive" });
    }

    // Baixa os ficheiros usando os URLs temporários que o runPipeline enviou
    const [final1Buf, final2Buf, voz1Buf, voz2Buf] = await Promise.all([
      fetchBuffer(urls.final_orig_1),
      fetchBuffer(urls.final_orig_2),
      fetchBuffer(urls.final_voz_1),
      fetchBuffer(urls.final_voz_2),
    ]);

    const driveToken = await getGoogleDriveAccessToken(serviceAccountJson);
    const customerFolder = await ensureFolderHierarchy(driveToken, ["MM Music", "2026", "Clientes", phone]);
    const musicSubfolder = await createNextSequentialMusicSubfolder(driveToken, customerFolder.id);

    await Promise.all([
      uploadFileToDriveFolder(driveToken, musicSubfolder.id, `${phone} - FINAL 01.mp3`, final1Buf, "audio/mpeg"),
      uploadFileToDriveFolder(driveToken, musicSubfolder.id, `${phone} - FINAL 02.mp3`, final2Buf, "audio/mpeg"),
      uploadFileToDriveFolder(driveToken, musicSubfolder.id, `${phone} - FINAL COM VOZ 01.wav`, voz1Buf, "audio/wav"),
      uploadFileToDriveFolder(driveToken, musicSubfolder.id, `${phone} - FINAL COM VOZ 02.wav`, voz2Buf, "audio/wav"),
    ]);

    if (job_id) {
      await base44.asServiceRole.entities.ProcessingJob.update(job_id, { 
        status: "completed",
        drive_folder_id: customerFolder.id,
        drive_subfolder_name: musicSubfolder.name
      });
    }

    return Response.json({ success: true, folder: musicSubfolder.name });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message });
  }
}
