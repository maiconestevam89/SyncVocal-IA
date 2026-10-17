import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import {
  uploadToMusicAi,
  cleanupCustomerVocal,
  masterCustomerVocal,
  separateAudioWithMusicAi,
} from '../../shared/musicAi.ts';
import {
  createSunoGenerationTask,
  pollSunoGeneration,
  createSunoStemTask,
  pollSunoStems,
} from '../../shared/suno.ts';
import { transcribeAudioUrl } from '../../shared/transcription.ts';
import { organizeLyricsWithLLM, generateMusicalPrompt } from '../../shared/organizeLyrics.ts';
import { alignAndMixTrackPair, create70sPreviewMp3 } from '../../shared/audioProcessor.ts';
import { extractPhone } from '../../shared/umblerTalk.ts';

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Falha ao baixar áudio (${res.status}): ${url}`);
  const buf = await res.arrayBuffer();
  return buf instanceof ArrayBuffer ? buf : new Uint8Array(buf).buffer;
}

Deno.serve(async (req: Request) => {
  let jobId: string | null = null;
  let base44: any = null;
  let currentStep = "Inicialização";

  try {
    base44 = createClientFromRequest(req);
    const body = await req.json();
    const {
      client_audio_uri,
      phone: rawPhone,
      customer_name,
      style_choice = "Pop",
      pre_generated_v1_uri,
      pre_generated_v2_uri,
    } = body;
    jobId = body.job_id;

    if (!client_audio_uri) {
      return Response.json({ success: false, error: "Arquivo de áudio da voz é obrigatório." });
    }

    const hasPreGenerated = Boolean(pre_generated_v1_uri && pre_generated_v2_uri);

    const musicAiKey = secrets.get("MUSIC_AI_API_KEY") || process.env["MUSIC_AI_API_KEY"];
    if (!musicAiKey || !musicAiKey.trim()) {
      return Response.json({ success: false, error: "Chave MUSIC_AI_API_KEY ausente." });
    }

    if (!hasPreGenerated) {
      const sunoKey = secrets.get("SUNO_API_KEY");
      if (!sunoKey || !sunoKey.trim()) {
        return Response.json({ success: false, error: "Chave SUNO_API_KEY ausente." });
      }
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

    currentStep = "Download da voz do cliente";
    const { signed_url: clientSignedUrl } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri: client_audio_uri,
      expires_in: 3600,
    });
    const clientAudioBuffer = await fetchBuffer(clientSignedUrl);

    let organizedLyrics = "Música Autoral - Letra em Produção";
    let musicPrompt = style_choice;
    let sunoV1Buffer: ArrayBuffer;
    let sunoV2Buffer: ArrayBuffer;
    let stems1: { vocalUrl: string; instrumentalUrl: string };
    let stems2: { vocalUrl: string; instrumentalUrl: string };
    let sunoTaskId: string = hasPreGenerated ? "pre_generated_by_user" : "";
    let v1AudioUrl = "";
    let v2AudioUrl = "";

    if (hasPreGenerated) {
      currentStep = "Carregando versões fornecidas";
      await updateStatus("using_pregenerated");

      const [{ signed_url: v1SignedUrl }, { signed_url: v2SignedUrl }] = await Promise.all([
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: pre_generated_v1_uri, expires_in: 3600 }),
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: pre_generated_v2_uri, expires_in: 3600 }),
      ]);

      v1AudioUrl = v1SignedUrl;
      v2AudioUrl = v2SignedUrl;

      [sunoV1Buffer, sunoV2Buffer] = await Promise.all([
        fetchBuffer(v1SignedUrl),
        fetchBuffer(v2SignedUrl),
      ]);

      try {
        const rawTranscript = await transcribeAudioUrl(clientSignedUrl);
        organizedLyrics = await organizeLyricsWithLLM(base44, rawTranscript);
      } catch (err: any) {
        console.warn("[transcribe] aviso:", err.message);
      }

      currentStep = "Separação de stems com Music.ai";
      await updateStatus("separating_stems");
      [stems1, stems2] = await Promise.all([
        separateAudioWithMusicAi(sunoV1Buffer, "V1 Stems"),
        separateAudioWithMusicAi(sunoV2Buffer, "V2 Stems"),
      ]);
    } else {
      currentStep = "Transcrição e organização da letra";
      await updateStatus("transcribing");
      const rawTranscript = await transcribeAudioUrl(clientSignedUrl);
      organizedLyrics = await organizeLyricsWithLLM(base44, rawTranscript);
      musicPrompt = await generateMusicalPrompt(base44, style_choice);

      currentStep = "Geração de 2 versões no Suno";
      await updateStatus("generating_suno");

      sunoTaskId = await createSunoGenerationTask({ lyrics: organizedLyrics, stylePrompt: musicPrompt });
      const sunoResult = await pollSunoGeneration(sunoTaskId);
      const { version1, version2 } = sunoResult;
      v1AudioUrl = version1.audioUrl;
      v2AudioUrl = version2.audioUrl;

      currentStep = "Separação de stems no Suno";
      await updateStatus("separating_stems");

      const [stemTask1Id, stemTask2Id] = await Promise.all([
        createSunoStemTask(sunoTaskId, version1.audioId),
        createSunoStemTask(sunoTaskId, version2.audioId),
      ]);

      [stems1, stems2] = await Promise.all([
        pollSunoStems(stemTask1Id),
        pollSunoStems(stemTask2Id),
      ]);

      [sunoV1Buffer, sunoV2Buffer] = await Promise.all([
        fetchBuffer(version1.audioUrl),
        fetchBuffer(version2.audioUrl),
      ]);
    }

    currentStep = "Limpeza da voz do cliente no Music.ai";
    await updateStatus("cleaning_vocals");
    const { fileReference: clientFileRef } = await uploadToMusicAi(clientAudioBuffer, "audio/mpeg");
    const cleanVocalsUrl = await cleanupCustomerVocal(clientFileRef, `Cleanup ${customerPhoneStr}`);

    currentStep = "Masterização da voz no Music.ai";
    await updateStatus("mastering_vocal");
    const aiMasteredUrl = await masterCustomerVocal(cleanVocalsUrl, `Master ${customerPhoneStr}`);

    currentStep = "Sincronização e mixagem DSP";
    await updateStatus("mixing");

    const [
      clientMasteredBuffer,
      v1VocalBuffer,
      v1InstBuffer,
      v2VocalBuffer,
      v2InstBuffer,
    ] = await Promise.all([
      fetchBuffer(aiMasteredUrl),
      fetchBuffer(stems1.vocalUrl),
      fetchBuffer(stems1.instrumentalUrl),
      fetchBuffer(stems2.vocalUrl),
      fetchBuffer(stems2.instrumentalUrl),
    ]);

    const mix1 = await alignAndMixTrackPair(v1VocalBuffer, clientMasteredBuffer, v1InstBuffer);
    const mix2 = await alignAndMixTrackPair(v2VocalBuffer, clientMasteredBuffer, v2InstBuffer);

    const previaOriginal1Bytes = create70sPreviewMp3(sunoV1Buffer);
    const previaOriginal2Bytes = create70sPreviewMp3(sunoV2Buffer);

    currentStep = "Upload das faixas finalizadas";
    const uploadPrivate = async (bytes: Uint8Array | ArrayBuffer, name: string, mime: string) => {
      const file = new File([new Blob([bytes instanceof ArrayBuffer ? bytes : bytes.buffer])], name, { type: mime });
      const { file_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });
      const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri, expires_in: 86400 });
      return { file_uri, signed_url };
    };

    const [
      finalVoz1Upload, finalVoz2Upload,
      previaVoz1Upload, previaVoz2Upload,
      previaOrig1Upload, previaOrig2Upload,
      finalOrig1Upload, finalOrig2Upload,
      playback1Upload, playback2Upload,
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

    const completedData = {
      status: "completed_awaiting_drive", // Novo status intermediário
      phone: customerPhoneStr,
      phone_digits: phoneDigits,
      lyrics: organizedLyrics,
      style_prompt: musicPrompt,
      suno_task_id: sunoTaskId,
      suno_v1_audio_url: v1AudioUrl,
      suno_v2_audio_url: v2AudioUrl,
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
    };

    if (jobId) {
      try { await base44.asServiceRole.entities.ProcessingJob.update(jobId, completedData); } catch {}
    }

    return Response.json({ success: true, job: completedData });
  } catch (err: any) {
    if (jobId && base44) {
      try { await base44.asServiceRole.entities.ProcessingJob.update(jobId, { status: "failed", error_message: `${currentStep}: ${err.message}` }); } catch {}
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
      }
    });
