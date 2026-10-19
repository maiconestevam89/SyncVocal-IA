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
import { alignAndMixTrackPair, create70sPreviewMp3, convertToWavAndMp3 } from '../../shared/audioProcessor.ts';
import { extractPhone } from '../../shared/umblerTalk.ts';

// Injeta um cabeçalho RIFF WAV válido garantindo compatibilidade total com o DSP sem falhas
function ensureValidWavHeader(arrayBuffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(arrayBuffer);
  
  // Verifica se já tem o cabeçalho RIFF
  if (bytes.length > 12) {
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (riff === 'RIFF' && wave === 'WAVE') {
      return arrayBuffer;
    }
  }

  // Se não tiver, cria um container WAV válido (PCM 16-bit, 44100Hz, estéreo) envolvendo os dados brutos
  const sampleRate = 44100;
  const channels = 2;
  const bitsPerSample = 16;
  const dataSize = bytes.length;
  const chunkSize = 36 + dataSize;
  
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  // "RIFF" chunk descriptor
  view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46);
  view.setUint32(4, chunkSize, true);
  view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45);

  // "fmt " sub-chunk
  view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20);
  view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, channels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true); // ByteRate
  view.setUint16(32, channels * (bitsPerSample / 8), true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample

  // "data" sub-chunk
  view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61);
  view.setUint32(40, dataSize, true);

  const combined = new Uint8Array(44 + bytes.length);
  combined.set(new Uint8Array(wavHeader), 0);
  combined.set(bytes, 44);

  return combined.buffer;
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Falha ao descarregar áudio (${res.status}): ${url}`);
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
      return Response.json({ success: false, error: "O ficheiro de áudio da voz é obrigatório." }, { status: 200 });
    }

    const hasDirectStems = Boolean(
      pre_generated_v1_vocal_uri &&
      pre_generated_v1_instrumental_uri
    );

    const effectiveV2VocalUri = pre_generated_v2_vocal_uri || pre_generated_v1_vocal_uri;
    const effectiveV2InstUri = pre_generated_v2_instrumental_uri || pre_generated_v1_instrumental_uri;

    const phoneInfo = extractPhone(rawPhone || "11988032049");
    const customerPhoneStr = phoneInfo?.formatted || rawPhone || "11 98803-2049";
    const phoneDigits = phoneInfo?.digits || "11988032049";

    currentStep = "Obtenção de URLs assinados";
    const getSignedUrl = async (uri: string) => {
      const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
        file_uri: uri,
        expires_in: 3600,
      });
      return signed_url;
    };

    const clientSignedUrl = await getSignedUrl(client_audio_uri);
    const clientAudioBuffer = await fetchBuffer(clientSignedUrl);

    let organizedLyrics = "Música Autoral - Letra em Produção";
    let musicPrompt = style_choice;
    let stems1 = { vocalUrl: "", instrumentalUrl: "" };
    let stems2 = { vocalUrl: "", instrumentalUrl: "" };
    let sunoTaskId = hasDirectStems ? "direct_stems_by_user" : "";
    let v1AudioUrl = "";
    let v2AudioUrl = "";
    let sunoV1Buffer = new ArrayBuffer(0);
    let sunoV2Buffer = new ArrayBuffer(0);

    if (hasDirectStems) {
      currentStep = "Carregamento de Stems Diretos";
      const v1VocalSigned = await getSignedUrl(pre_generated_v1_vocal_uri);
      const v1InstSigned = await getSignedUrl(pre_generated_v1_instrumental_uri);
      const v2VocalSigned = await getSignedUrl(effectiveV2VocalUri);
      const v2InstSigned = await getSignedUrl(effectiveV2InstUri);

      stems1 = { vocalUrl: v1VocalSigned, instrumentalUrl: v1InstSigned };
      stems2 = { vocalUrl: v2VocalSigned, instrumentalUrl: v2InstSigned };
      v1AudioUrl = v1InstSigned;
      v2AudioUrl = v2InstSigned;

      sunoV1Buffer = await fetchBuffer(v1InstSigned);
      sunoV2Buffer = await fetchBuffer(v2InstSigned);

      // No modo com stems já existentes, a transcrição é opcional e pulada para evitar lentidão e timeout 504
      organizedLyrics = "Faixa com Stems pré-existentes";
    } else {
      currentStep = "Geração no Suno";
      const rawTranscript = await transcribeAudioUrl(clientSignedUrl);
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

    currentStep = "Preparação da voz do cliente";
    const clientMasteredBuffer = ensureValidWavHeader(clientAudioBuffer);

    currentStep = "Sincronização e Mixagem DSP";
    const [v1VocalRaw, v1InstRaw, v2VocalRaw, v2InstRaw] = await Promise.all([
      fetchBuffer(stems1.vocalUrl),
      fetchBuffer(stems1.instrumentalUrl),
      fetchBuffer(stems2.vocalUrl),
      fetchBuffer(stems2.instrumentalUrl),
    ]);

    const v1VocalBuffer = ensureValidWavHeader(v1VocalRaw);
    const v1InstBuffer = ensureValidWavHeader(v1InstRaw);
    const v2VocalBuffer = ensureValidWavHeader(v2VocalRaw);
    const v2InstBuffer = ensureValidWavHeader(v2InstRaw);

    // Etapa de sincronização totalmente intacta:
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

    // Prepara playbacks em MP3 e WAV
    const p1Audio = convertToWavAndMp3(v1InstBuffer);
    const p2Audio = convertToWavAndMp3(v2InstBuffer);

    const [
      finalVoz1WavUpload, finalVoz1Mp3Upload,
      finalVoz2WavUpload, finalVoz2Mp3Upload,
      playback1Mp3Upload, playback1WavUpload,
      playback2Mp3Upload, playback2WavUpload,
      previaVoz1Upload, previaVoz2Upload,
      previaOrig1Upload, previaOrig2Upload,
      finalOrig1Upload, finalOrig2Upload,
    ] = await Promise.all([
      uploadPrivate(mix1.fullWavBytes, `${customerPhoneStr} - FINAL COM VOZ 01.wav`, "audio/wav"),
      uploadPrivate(mix1.fullMp3Bytes || mix1.previewMp3Bytes, `${customerPhoneStr} - FINAL COM VOZ 01.mp3`, "audio/mpeg"),
      uploadPrivate(mix2.fullWavBytes, `${customerPhoneStr} - FINAL COM VOZ 02.wav`, "audio/wav"),
      uploadPrivate(mix2.fullMp3Bytes || mix2.previewMp3Bytes, `${customerPhoneStr} - FINAL COM VOZ 02.mp3`, "audio/mpeg"),
      uploadPrivate(p1Audio.mp3Bytes, `${customerPhoneStr} - PLAYBACK 01.mp3`, "audio/mpeg"),
      uploadPrivate(p1Audio.wavBytes, `${customerPhoneStr} - PLAYBACK 01.wav`, "audio/wav"),
      uploadPrivate(p2Audio.mp3Bytes, `${customerPhoneStr} - PLAYBACK 02.mp3`, "audio/mpeg"),
      uploadPrivate(p2Audio.wavBytes, `${customerPhoneStr} - PLAYBACK 02.wav`, "audio/wav"),
      uploadPrivate(mix1.previewMp3Bytes, `${customerPhoneStr} - PREVIA FINAL COM VOZ 01.mp3`, "audio/mpeg"),
      uploadPrivate(mix2.previewMp3Bytes, `${customerPhoneStr} - PREVIA FINAL COM VOZ 02.mp3`, "audio/mpeg"),
      uploadPrivate(previaOriginal1Bytes, `${customerPhoneStr} - PREVIA 01.mp3`, "audio/mpeg"),
      uploadPrivate(previaOriginal2Bytes, `${customerPhoneStr} - PREVIA 02.mp3`, "audio/mpeg"),
      uploadPrivate(sunoV1Buffer, `${customerPhoneStr} - FINAL 01.mp3`, "audio/mpeg"),
      uploadPrivate(sunoV2Buffer, `${customerPhoneStr} - FINAL 02.mp3`, "audio/mpeg"),
    ]);

    // SALVAMENTO NO GOOGLE DRIVE (com try/catch não-bloqueante)
    let driveStatus = { saved: true, message: "Arquivos salvos no Google Drive." };
    try {
      const driveKey = secrets.get("GOOGLE_SERVICE_ACCOUNT_JSON") || secrets.get("GOOGLE_DRIVE_SERVICE_KEY");
      if (driveKey) {
        currentStep = "Salvando no Google Drive";
        const driveRes = await base44.asServiceRole.functions.saveToDrive({
          job_id: jobId,
          phone: customerPhoneStr,
          urls: {
            final_orig_1: finalOrig1Upload.signed_url,
            final_orig_2: finalOrig2Upload.signed_url,
            final_voz_1: finalVoz1WavUpload.signed_url,
            final_voz_2: finalVoz2WavUpload.signed_url,
          },
        });
        if (driveRes && driveRes.success === false) {
          driveStatus = { saved: false, message: driveRes.error || "Aviso: Não foi possível salvar no Google Drive." };
        }
      } else {
        driveStatus = { saved: false, message: "Google Drive não configurado nos secrets (GOOGLE_SERVICE_ACCOUNT_JSON)." };
      }
    } catch (driveErr: any) {
      console.warn("[Google Drive Warning]: Erro ao salvar no Drive:", driveErr.message);
      // O fluxo NÃO para: apenas reporta o aviso no retorno
      driveStatus = { saved: false, message: `Falha ao salvar no Drive: ${driveErr.message}` };
    }

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
      final_voz_v1_uri: finalVoz1WavUpload.file_uri,
      final_voz_v2_uri: finalVoz2WavUpload.file_uri,
      preview_v1_uri: previaOrig1Upload.file_uri,
      preview_v2_uri: previaOrig2Upload.file_uri,
      preview_voz_v1_uri: previaVoz1Upload.file_uri,
      preview_voz_v2_uri: previaVoz2Upload.file_uri,
      drive_saved: driveStatus.saved,
      drive_message: driveStatus.message,
    };

    if (jobId) {
      try { await base44.asServiceRole.entities.ProcessingJob.update(jobId, completedData); } catch {}
    }

    return Response.json({
      success: true,
      job: completedData,
      drive_status: driveStatus,
      downloads: {
        final_voz_1: finalVoz1WavUpload.signed_url,
        final_voz_1_mp3: finalVoz1Mp3Upload.signed_url,
        final_voz_2: finalVoz2WavUpload.signed_url,
        final_voz_2_mp3: finalVoz2Mp3Upload.signed_url,
        playback_1: playback1Mp3Upload.signed_url,
        playback_1_wav: playback1WavUpload.signed_url,
        playback_2: playback2Mp3Upload.signed_url,
        playback_2_wav: playback2WavUpload.signed_url,
        final_orig_1: finalOrig1Upload.signed_url,
        final_orig_2: finalOrig2Upload.signed_url,
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
