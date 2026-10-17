import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import decode from 'npm:audio-decode';
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

// Conversor universal robusto: se for MP3/M4A/WAV descompacta e recria um WAV RIFF PCM válido
async function ensureValidWavBuffer(arrayBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const view = new DataView(arrayBuffer);
    if (arrayBuffer.byteLength > 12) {
      const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
      const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
      if (riff === 'RIFF' && wave === 'WAVE') {
        return arrayBuffer; // Já está no formato WAV correto
      }
    }

    // Se for MP3 ou outro formato comprimido, decodifica via audio-decode e converte para PCM WAV
    const audioBuffer = await decode(arrayBuffer);
    return encodeWAV(audioBuffer);
  } catch (err: any) {
    console.warn("Aviso na conversão para WAV:", err.message);
    return arrayBuffer; // Fallback se falhar
  }
}

function encodeWAV(audioBuffer: any): ArrayBuffer {
  const numOfChan = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  let result: Float32Array;
  if (numOfChan === 2) {
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    result = new Float32Array(left.length + right.length);
    for (let i = 0; i < left.length; i++) {
      result[i * 2] = left[i];
      result[i * 2 + 1] = right[i];
    }
  } else {
    result = audioBuffer.getChannelData(0);
  }

  const samples = result;
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numOfChan * (bitDepth / 8), true);
  view.setUint16(32, numOfChan * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
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
    const clientRawBuffer = await fetchBuffer(clientSignedUrl);

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

      try {
        const rawTranscript = await transcribeAudioUrl(clientSignedUrl);
        organizedLyrics = await organizeLyricsWithLLM(base44, rawTranscript);
      } catch (err: any) {
        console.warn("[transcribe] aviso:", err.message);
      }
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

    currentStep = "Conversão e normalização da voz do cliente";
    const clientMasteredBuffer = await ensureValidWavBuffer(clientRawBuffer);

    currentStep = "Sincronização e Mixagem DSP";
    const [v1VocalRaw, v1InstRaw, v2VocalRaw, v2InstRaw] = await Promise.all([
      fetchBuffer(stems1.vocalUrl),
      fetchBuffer(stems1.instrumentalUrl),
      fetchBuffer(stems2.vocalUrl),
      fetchBuffer(stems2.instrumentalUrl),
    ]);

    // Converte automaticamente qualquer MP3 para WAV RIFF mantendo a sincronização intacta
    const [v1VocalBuffer, v1InstBuffer, v2VocalBuffer, v2InstBuffer] = await Promise.all([
      ensureValidWavBuffer(v1VocalRaw),
      ensureValidWavBuffer(v1InstRaw),
      ensureValidWavBuffer(v2VocalRaw),
      ensureValidWavBuffer(v2InstRaw),
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
