import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import { uploadToMusicAi, cleanupCustomerVocal, masterCustomerVocal } from '../../shared/musicAi.ts';
import {
  createSunoGenerationTask,
  pollSunoGeneration,
  createSunoStemTask,
  pollSunoStems,
} from '../../shared/suno.ts';
import { transcribeAudioUrl } from '../../shared/transcription.ts';
import { organizeLyricsWithLLM, generateMusicalPrompt } from '../../shared/organizeLyrics.ts';
import { alignAndMixTrackPair, create70sPreviewMp3 } from '../../shared/audioProcessor.ts';
import {
  getGoogleDriveAccessToken,
  ensureFolderHierarchy,
  createNextSequentialMusicSubfolder,
  uploadFileToDriveFolder,
} from '../../shared/googleDrive.ts';
import { extractPhone } from '../../shared/umblerTalk.ts';

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Falha ao baixar áudio (${res.status}): ${url}`);
  const buf = await res.arrayBuffer();
  return buf instanceof ArrayBuffer ? buf : new Uint8Array(buf).buffer;
}

export default async function (req: Request): Promise<Response> {
  let jobId: string | null = null;
  let base44: any = null;

  try {
    base44 = createClientFromRequest(req);
    const body = await req.json();
    const { client_audio_uri, phone: rawPhone, style_choice = "Pop" } = body;
    jobId = body.job_id;

    if (!client_audio_uri) {
      return Response.json({ error: "client_audio_uri é obrigatório" }, { status: 400 });
    }

    const phoneInfo = extractPhone(rawPhone || "11988032049");
    const customerPhoneStr = phoneInfo?.formatted || rawPhone || "11 98803-2049";
    const phoneDigits = phoneInfo?.digits || "11988032049";

    const updateStatus = async (status: string, extra = {}) => {
      if (jobId) {
        try {
          await base44.asServiceRole.entities.ProcessingJob.update(jobId, { status, ...extra });
        } catch {}
      }
    };

    // ── 1. URLs e buffers do áudio do cliente ──
    const { signed_url: clientSignedUrl } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri: client_audio_uri,
      expires_in: 7200,
    });
    const clientAudioBuffer = await fetchBuffer(clientSignedUrl);

    // ── 2. FLUXO 2: Transcrição e Geração no Suno ──
    await updateStatus("transcribing");
    const rawTranscript = await transcribeAudioUrl(clientSignedUrl);
    const organizedLyrics = await organizeLyricsWithLLM(base44, rawTranscript);
    const musicPrompt = await generateMusicalPrompt(base44, style_choice);

    await updateStatus("generating_suno", {
      lyrics: organizedLyrics,
      style_prompt: musicPrompt,
    });

    const sunoTaskId = await createSunoGenerationTask({
      lyrics: organizedLyrics,
      stylePrompt: musicPrompt,
    });

    // Suno gera obrigatoriamente 2 versões
    const sunoResult = await pollSunoGeneration(sunoTaskId);
    const { version1, version2 } = sunoResult;

    // ── 3. FLUXO 3: Separação de Stems para as 2 versões ──
    await updateStatus("separating_stems", {
      suno_task_id: sunoTaskId,
      suno_v1_audio_url: version1.audioUrl,
      suno_v2_audio_url: version2.audioUrl,
    });

    const [stemTask1Id, stemTask2Id] = await Promise.all([
      createSunoStemTask(sunoTaskId, version1.audioId),
      createSunoStemTask(sunoTaskId, version2.audioId),
    ]);

    const [stems1, stems2] = await Promise.all([
      pollSunoStems(stemTask1Id),
      pollSunoStems(stemTask2Id),
    ]);

    // ── 4. FLUXO 4: Limpeza Vocal da voz do cliente (Music.ai) ──
    await updateStatus("cleaning_vocals");
    const { fileReference: clientFileRef } = await uploadToMusicAi(clientAudioBuffer, "audio/mpeg");
    const cleanVocalsUrl = await cleanupCustomerVocal(clientFileRef, `Cleanup ${customerPhoneStr}`);

    // ── 5. FLUXO 5: Masterização Vocal (Music.ai) ──
    await updateStatus("mastering_vocal");
    const aiMasteredUrl = await masterCustomerVocal(cleanVocalsUrl, `Master ${customerPhoneStr}`);

    // ── 6. FLUXO 6: Sincronização e Mixagem Dupla (DSP) ──
    await updateStatus("mixing");

    // Baixa os áudios necessários para o processamento DSP
    const [
      clientMasteredBuffer,
      v1VocalBuffer,
      v1InstBuffer,
      v2VocalBuffer,
      v2InstBuffer,
      sunoV1Buffer,
      sunoV2Buffer,
    ] = await Promise.all([
      fetchBuffer(aiMasteredUrl),
      fetchBuffer(stems1.vocalUrl),
      fetchBuffer(stems1.instrumentalUrl),
      fetchBuffer(stems2.vocalUrl),
      fetchBuffer(stems2.instrumentalUrl),
      fetchBuffer(version1.audioUrl),
      fetchBuffer(version2.audioUrl),
    ]);

    // Mixagem Versão 1: Voz cliente masterizada + Instrumental 1 (alinhado ao vocal IA 1)
    const mix1 = await alignAndMixTrackPair(v1VocalBuffer, clientMasteredBuffer, v1InstBuffer);

    // Mixagem Versão 2: Voz cliente masterizada + Instrumental 2 (alinhado ao vocal IA 2)
    const mix2 = await alignAndMixTrackPair(v2VocalBuffer, clientMasteredBuffer, v2InstBuffer);

    // Prévias de 1:10 (70s) das versões originais da IA
    const previaOriginal1Bytes = create70sPreviewMp3(sunoV1Buffer);
    const previaOriginal2Bytes = create70sPreviewMp3(sunoV2Buffer);

    // ── 7. Upload para Storage privado (para download web) ──
    const uploadPrivate = async (bytes: Uint8Array | ArrayBuffer, name: string, mime: string) => {
      const file = new File([new Blob([bytes instanceof ArrayBuffer ? bytes : bytes.buffer])], name, { type: mime });
      const { file_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });
      const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri, expires_in: 86400 });
      return { file_uri, signed_url };
    };

    const [
      finalVoz1Upload,
      finalVoz2Upload,
      previaVoz1Upload,
      previaVoz2Upload,
      previaOrig1Upload,
      previaOrig2Upload,
      finalOrig1Upload,
      finalOrig2Upload,
      playback1Upload,
      playback2Upload,
    ] = await Promise.all([
      uploadPrivate(mix1.fullWavBytes, `${customerPhoneStr} - FINAL COM VOZ 01.wav`, "audio/wav"),
      uploadPrivate(mix2.fullWavBytes, `${customerPhoneStr} - FINAL COM VOZ 02.wav`, "audio/wav"),
      uploadPrivate(mix1.previewMp3Bytes, `${customerPhoneStr} - PREVIA FINAL COM VOZ 01.mp3`, "audio/mpeg"),
      uploadPrivate(mix2.previewMp3Bytes, `${customerPhoneStr} - PREVIA FINAL COM VOZ 02.mp3`, "audio/mpeg"),
      uploadPrivate(previaOriginal1Bytes, `${customerPhoneStr} - PREVIA 01.mp3`, "audio/mpeg"),
      uploadPrivate(previaOriginal2Bytes, `${customerPhoneStr} - PREVIA 02.mp3`, "audio/mpeg"),
      uploadPrivate(sunoV1Buffer, `${customerPhoneStr} - FINAL 01.mp3`, "audio/mpeg"),
      uploadPrivate(sunoV2Buffer, `${customerPhoneStr} - FINAL 02.mp3`, "audio/mpeg"),
      uploadPrivate(v1InstBuffer, `${customerPhoneStr} - PLAYBACK 01.mp3`, "audio/mpeg"),
      uploadPrivate(v2InstBuffer, `${customerPhoneStr} - PLAYBACK 02.mp3`, "audio/mpeg"),
    ]);

    // ── 8. FLUXO 7: Salvamento estruturado no Google Drive ──
    await updateStatus("uploading_drive");

    const serviceAccountJson = secrets.get("GOOGLE_SERVICE_ACCOUNT_JSON") || secrets.get("GOOGLE_DRIVE_SERVICE_KEY");
    let driveCustomerFolderId: string | null = null;
    let driveSubfolderName: string | null = null;

    if (serviceAccountJson) {
      try {
        const driveToken = await getGoogleDriveAccessToken(serviceAccountJson);

        // A - Meu Drive\MM Music\2026\Clientes\[Número do telefone do cliente]
        const customerFolder = await ensureFolderHierarchy(driveToken, [
          "MM Music",
          "2026",
          "Clientes",
          customerPhoneStr,
        ]);
        driveCustomerFolderId = customerFolder.id;

        // B - Subpasta sequencial MUSICA 01, MUSICA 02, etc.
        const musicSubfolder = await createNextSequentialMusicSubfolder(driveToken, customerFolder.id);
        driveSubfolderName = musicSubfolder.name;

        // Upload dos 8 arquivos com a nomenclatura estrita
        await Promise.all([
          uploadFileToDriveFolder(driveToken, musicSubfolder.id, `${customerPhoneStr} - FINAL 01.mp3`, sunoV1Buffer, "audio/mpeg"),
          uploadFileToDriveFolder(driveToken, musicSubfolder.id, `${customerPhoneStr} - FINAL 02.mp3`, sunoV2Buffer, "audio/mpeg"),
          uploadFileToDriveFolder(driveToken, musicSubfolder.id, `${customerPhoneStr} - PLAYBACK 01.mp3`, v1InstBuffer, "audio/mpeg"),
          uploadFileToDriveFolder(driveToken, musicSubfolder.id, `${customerPhoneStr} - PLAYBACK 02.mp3`, v2InstBuffer, "audio/mpeg"),
          uploadFileToDriveFolder(driveToken, musicSubfolder.id, `${customerPhoneStr} - FINAL COM VOZ 01.wav`, mix1.fullWavBytes, "audio/wav"),
          uploadFileToDriveFolder(driveToken, musicSubfolder.id, `${customerPhoneStr} - FINAL COM VOZ 02.wav`, mix2.fullWavBytes, "audio/wav"),
          uploadFileToDriveFolder(driveToken, musicSubfolder.id, `${customerPhoneStr} - PREVIA 01.mp3`, previaOriginal1Bytes, "audio/mpeg"),
          uploadFileToDriveFolder(driveToken, musicSubfolder.id, `${customerPhoneStr} - PREVIA 02.mp3`, previaOriginal2Bytes, "audio/mpeg"),
        ]);
      } catch (driveErr: any) {
        console.warn("[Google Drive Upload warning]:", driveErr.message);
      }
    }

    // ── 9. Conclui o job ──
    const completedData = {
      status: "completed",
      phone: customerPhoneStr,
      phone_digits: phoneDigits,
      lyrics: organizedLyrics,
      style_prompt: musicPrompt,
      suno_task_id: sunoTaskId,
      suno_v1_audio_url: version1.audioUrl,
      suno_v2_audio_url: version2.audioUrl,
      suno_v1_playback_url: stems1.instrumentalUrl,
      suno_v2_playback_url: stems2.instrumentalUrl,
      final_v1_uri: finalOrig1Upload.file_uri,
      final_v2_uri: finalOrig2Upload.file_uri,
      final_voz_v1_uri: finalVoz1Upload.file_uri,
      final_voz_v2_uri: finalVoz2Upload.file_uri,
      preview_v1_uri: previaOrig1Upload.file_uri,
      preview_v2_uri: previaOrig2Upload.file_uri,
      preview_voz_v1_uri: previaVoz1Upload.file_uri,
      preview_voz_v2_uri: previaVoz2Upload.file_uri,
      drive_folder_id: driveCustomerFolderId,
      drive_subfolder_name: driveSubfolderName,
    };

    if (jobId) {
      try {
        await base44.asServiceRole.entities.ProcessingJob.update(jobId, completedData);
      } catch {}
    }

    return Response.json({
      success: true,
      job: completedData,
      downloads: {
        final_orig_1: finalOrig1Upload.signed_url,
        final_orig_2: finalOrig2Upload.signed_url,
        playback_1: playback1Upload.signed_url,
        playback_2: playback2Upload.signed_url,
        final_voz_1: finalVoz1Upload.signed_url,
        final_voz_2: finalVoz2Upload.signed_url,
        previa_1: previaOrig1Upload.signed_url,
        previa_2: previaOrig2Upload.signed_url,
        previa_voz_1: previaVoz1Upload.signed_url,
        previa_voz_2: previaVoz2Upload.signed_url,
      },
    });
  } catch (err: any) {
    console.error("[runPipeline error]:", err);
    if (jobId && base44) {
      try {
        await base44.asServiceRole.entities.ProcessingJob.update(jobId, {
          status: "failed",
          error_message: err.message,
        });
      } catch {}
    }
    return Response.json({ error: err.message || "Erro no pipeline de áudio" }, { status: 500 });
  }
}
