import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import {
  uploadToMusicAi,
  cleanupCustomerVocal,
  masterCustomerVocal,
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
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
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
      pre_generated_v1_vocal_uri,
      pre_generated_v1_instrumental_uri,
      pre_generated_v2_vocal_uri,
      pre_generated_v2_instrumental_uri,
    } = body;
    jobId = body.job_id;

    if (!client_audio_uri) {
      return Response.json({ success: false, error: "Arquivo de áudio da voz é obrigatório." }, { status: 200 });
    }

    const hasDirectStems = Boolean(
      pre_generated_v1_vocal_uri &&
      pre_generated_v1_instrumental_uri
    );

    const effectiveV2VocalUri = pre_generated_v2_vocal_uri || pre_generated_v1_vocal_uri;
    const effectiveV2InstUri = pre_generated_v2_instrumental_uri || pre_generated_v1_instrumental_uri;

    const musicAiKey = secrets.get("MUSIC_AI_API_KEY") || process.env["MUSIC_AI_API_KEY"];
    if (!hasDirectStems && (!musicAiKey || !musicAiKey.trim())) {
      return Response.json({ success: false, error: "Chave MUSIC_AI_API_KEY ausente." }, { status: 200 });
    }

    if (!hasDirectStems) {
      const sunoKey = secrets.get("SUNO_API_KEY");
      if (!sunoKey || !sunoKey.trim()) {
        return Response.json({ success: false, error: "Chave SUNO_API_KEY ausente." }, { status: 200 });
      }
    }

    const phoneInfo = extractPhone(rawPhone || "11988032049");
    const customerPhoneStr = phoneInfo?.formatted || rawPhone || "11 98803-2049";
    const phoneDigits = phoneInfo?.digits || "11988032049";

    currentStep = "Preparação de URLs e Downloads em Paralelo";
    const urlsToSign = [
      { key: 'client', uri: client_audio_uri },
      { key: 'v1Vocal', uri: pre_generated_v1_vocal_uri },
      { key: 'v1Inst', uri: pre_generated_v1_instrumental_uri },
      { key: 'v2Vocal', uri: effectiveV2VocalUri },
      { key: 'v2Inst', uri: effectiveV2InstUri },
    ];

    const signedUrlsMap: Record<string, string> = {};
    await Promise.all(
      urlsToSign.map(async (item) => {
        if (!item.uri) return;
        const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
          file_uri: item.uri,
          expires_in: 3600,
        });
        signedUrlsMap[item.key] = signed_url;
      })
    );

    // Baixar voz do cliente e stems em paralelo absoluto para poupar tempo de servidor
    const downloadPromises: Record<string, Promise<ArrayBuffer>> = {
      client: fetchBuffer(signedUrlsMap['client']),
    };

    if (hasDirectStems) {
      downloadPromises['v1Vocal'] = fetchBuffer(signedUrlsMap['v1Vocal']);
      downloadPromises['v1Inst'] = fetchBuffer(signedUrlsMap['v1Inst']);
      downloadPromises['v2Vocal'] = fetchBuffer(signedUrlsMap['v2Vocal']);
      downloadPromises['v2Inst'] = fetchBuffer(signedUrlsMap['v2Inst']);
    }

    const downloadedKeys = Object.keys(downloadPromises);
    const downloadedBuffers = await Promise.all(Object.values(downloadPromises));
    const buffersMap: Record<string, ArrayBuffer> = {};
    downloadedKeys.forEach((key, index) => {
      buffersMap[key] = downloadedBuffers[index];
    });

    let organizedLyrics = "Música Autoral - Letra em Produção";
    let musicPrompt = style_choice;
    let stems1: { vocalUrl: string; instrumentalUrl: string };
    let stems2: { vocalUrl: string; instrumentalUrl: string };
    let sunoTaskId: string = hasDirectStems ? "direct_stems_by_user" : "";
    let v1AudioUrl = "";
    let v2AudioUrl = "";
    let sunoV1Buffer: ArrayBuffer = new ArrayBuffer(0);
    let sunoV2Buffer: ArrayBuffer = new ArrayBuffer(0);

    if (hasDirectStems) {
      currentStep = "Processando Stems Diretos";
      stems1 = { vocalUrl: signedUrlsMap['v1Vocal'], instrumentalUrl: signedUrlsMap['v1Inst'] };
      stems2 = { vocalUrl: signedUrlsMap['v2Vocal'], instrumentalUrl: signedUrlsMap['v2Inst'] };
      v1AudioUrl = signedUrlsMap['v1Inst'];
      v2AudioUrl = signedUrlsMap['v2Inst'];
      sunoV1Buffer = buffersMap['v1Inst'];
      sunoV2Buffer = buffersMap['v2Inst'];

      try {
        const rawTranscript = await transcribeAudioUrl(signedUrlsMap['client']);
        organizedLyrics = await organizeLyricsWithLLM(base44, rawTranscript);
      } catch (err: any) {
        console.warn("[transcribe] aviso:", err.message);
      }
    } else {
      currentStep = "Geração no Suno";
      const rawTranscript = await transcribeAudioUrl(signedUrlsMap['client']);
      organizedLyrics = await organizeLyricsWithLLM(base44, rawTranscript);
      musicPrompt = await generateMusicalPrompt(base44, style_choice);

      sunoTaskId = await createSunoGenerationTask({ lyrics: organizedLyrics, stylePrompt: musicPrompt });
      const sunoResult = await pollSunoGeneration(sunoTaskId);
      v1AudioUrl = sunoResult.version1.audioUrl;
      v2AudioUrl = sunoResult.version2.audioUrl;

      const [stemTask1Id, stemTask2Id] = await Promise.all([
        createSunoStemTask(sunoTaskId, sunoResult.version1.audioId),
        createSunoStemTask(sunoTaskId, sunoResult.version2.audioId),
      ]);

      [stems1, stems2] = await Promise.all([
        pollSunoStems(stemTask1Id),
        pollSunoStems(stemTask2Id),
      ]);

      [sunoV1Buffer, sunoV2Buffer] = await Promise.all([
        fetchBuffer(v1AudioUrl),
        fetchBuffer(v2AudioUrl),
      ]);
    }

    let clientMasteredBuffer: ArrayBuffer;
    if (hasDirectStems) {
      currentStep = "Usando voz do cliente diretamente";
      clientMasteredBuffer = buffersMap['client'];
    } else {
      currentStep = "Limpeza e Masterização no Music.ai";
      const { fileReference: clientFileRef } = await uploadToMusicAi(buffersMap['client'], "audio/mpeg");
      const cleanVocalsUrl = await cleanupCustomerVocal(clientFileRef, `Cleanup ${customerPhoneStr}`);
      const aiMasteredUrl = await masterCustomerVocal(cleanVocalsUrl, `Master ${customerPhoneStr}`);
      clientMasteredBuffer = await fetchBuffer(aiMasteredUrl);
    }

    currentStep = "Sincronização e Mixagem DSP";
    const [
      v1VocalBuffer,
      v1InstBuffer,
      v2VocalBuffer,
      v2InstBuffer,
    ] = await Promise.all([
      fetchBuffer(stems1.vocalUrl),
      fetchBuffer(stems1.instrumentalUrl),
      fetchBuffer(stems2.vocalUrl),
      fetchBuffer(stems2.instrumentalUrl),
    ]);

    const [mix1, mix2] = await Promise.all([
      alignAndMixTrackPair(v1VocalBuffer, clientMasteredBuffer, v1InstBuffer),
      alignAndMixTrackPair(v2VocalBuffer, clientMasteredBuffer, v2InstBuffer),
    ]);

    const previaOriginal1Bytes = create70sPreviewMp3(sunoV1Buffer);
    const previaOriginal2Bytes = create70sPreviewMp3(sunoV2Buffer);

    currentStep = "Upload dos Ficheiros Finais";
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
      status: "completed",
      phone: customerPhoneStr,
      phone_digits: phoneDigits,
      lyrics: organizedLyrics,
      style_prompt: musicPrompt,
      suno_task_id: sunoTaskId,
      suno_v1_audio_url: v1AudioUrl,
      suno_v2_audio_url: v2AudioUrl,
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
  } catch (err: any) {
    console.error(`[runPipeline CRITICAL ERROR at step '${currentStep}']:`, err);
    if (jobId && base44) {
      try { 
        await base44.asServiceRole.entities.ProcessingJob.update(jobId, { 
          status: "failed", 
          error_message: `${currentStep}: ${err.message || "Erro desconhecido"}` 
        }); 
      } catch {}
    }
    return Response.json({ 
      success: false, 
      error: `Erro [${currentStep}]: ${err.message || "Erro interno no servidor"}`,
      step: currentStep,
      stack: err.stack || ""
    }, { status: 200 });
  }
});
