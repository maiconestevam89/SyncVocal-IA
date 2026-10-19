import { Deno } from "base44:runtime";
import { base44 } from "base44:runtime";
import {
  createSunoGenerationTask,
  pollSunoGeneration,
  createSunoStemTask,
  pollSunoStems,
} from "../../shared/suno.ts";
import {
  alignAndMixTrackPair,
  create70sPreviewMp3,
  convertToWavAndMp3,
} from "../../shared/audioProcessor.ts";

function ensureValidWavHeader(arrayBuffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(arrayBuffer);
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45
  ) {
    return arrayBuffer;
  }
  const sampleRate = 22050;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = bytes.length;
  const chunkSize = 36 + dataSize;
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, chunkSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  const combined = new Uint8Array(44 + bytes.length);
  combined.set(new Uint8Array(wavHeader), 0);
  combined.set(bytes, 44);
  return combined.buffer;
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar áudio (${res.status}): ${url}`);
  return res.arrayBuffer();
}

async function uploadAudioFile(buffer: ArrayBuffer, filename: string, mime: string) {
  const fileObj = new File([buffer], filename, { type: mime });
  const uploadRes = await base44.asServiceRole.integrations.Core.UploadPrivateFile({
    file: fileObj,
  });
  const fileUri = uploadRes.file_uri;
  const signedRes = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
    file_uri: fileUri,
    expires_in: 86400 * 7,
  });
  return { fileUri, signedUrl: signedRes.signed_url };
}

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();
    const {
      action,
      jobId,
      lyrics,
      musicPrompt,
      clientAudioFileUri,
      hasDirectStems,
      v1VocalFileUri,
      v1InstFileUri,
      v2VocalFileUri,
      v2InstFileUri,
      stems1: providedStems1,
      stems2: providedStems2,
      phone,
    } = payload;

    // Ações modulares assíncronas para Suno (evitam timeout 504 no frontend)
    if (action === "create_suno") {
      const taskId = await createSunoGenerationTask({
        lyrics: lyrics || "Música personalizada",
        stylePrompt: musicPrompt || "Pop, upbeat, radio mix",
      });
      return Response.json({ success: true, taskId });
    }

    if (action === "poll_suno") {
      const taskId = payload.taskId;
      if (!taskId) return Response.json({ error: "taskId é obrigatório" }, { status: 400 });
      try {
        const result = await pollSunoGeneration(taskId, 7000);
        return Response.json({ status: "SUCCESS", result });
      } catch (err: any) {
        const msg = String(err?.message || "");
        if (msg.includes("Tempo limite") || msg.includes("timeout")) {
          return Response.json({ status: "PENDING" });
        }
        return Response.json({ status: "ERROR", error: msg });
      }
    }

    if (action === "create_stems") {
      const { taskId, audioId } = payload;
      const stemTaskId = await createSunoStemTask(taskId, audioId);
      return Response.json({ success: true, stemTaskId });
    }

    if (action === "poll_stems") {
      const { stemTaskId } = payload;
      if (!stemTaskId) return Response.json({ error: "stemTaskId é obrigatório" }, { status: 400 });
      try {
        const stems = await pollSunoStems(stemTaskId, 7000);
        return Response.json({ status: "SUCCESS", stems });
      } catch (err: any) {
        const msg = String(err?.message || "");
        if (msg.includes("Tempo limite") || msg.includes("timeout")) {
          return Response.json({ status: "PENDING" });
        }
        return Response.json({ status: "ERROR", error: msg });
      }
    }

    // ==========================================
    // FLUXO DE PROCESSAMENTO, ALINHAMENTO E MIX
    // ==========================================
    console.log("[runPipeline] Iniciando alinhamento e mixagem...");

    // 1. Obter URL assinada do áudio do cliente
    if (!clientAudioFileUri) {
      return Response.json({ error: "clientAudioFileUri é obrigatório" }, { status: 400 });
    }
    const clientSignedRes = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri: clientAudioFileUri,
      expires_in: 3600,
    });
    const clientSignedUrl = clientSignedRes.signed_url;

    // 2. Determinar URLs das stems (Vocal e Instrumental de V1 e V2)
    let v1VocalUrl = "";
    let v1InstUrl = "";
    let v2VocalUrl = "";
    let v2InstUrl = "";

    if (hasDirectStems) {
      // Stems fornecidas diretamente pelo usuário: obter URLs assinadas em lote
      const [s1Vocal, s1Inst, s2Vocal, s2Inst] = await Promise.all([
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: v1VocalFileUri, expires_in: 3600 }),
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: v1InstFileUri, expires_in: 3600 }),
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: v2VocalFileUri, expires_in: 3600 }),
        base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: v2InstFileUri, expires_in: 3600 }),
      ]);
      v1VocalUrl = s1Vocal.signed_url;
      v1InstUrl = s1Inst.signed_url;
      v2VocalUrl = s2Vocal.signed_url;
      v2InstUrl = s2Inst.signed_url;
    } else if (providedStems1 && providedStems2) {
      // Stems já geradas via Suno assíncrono
      v1VocalUrl = providedStems1.vocalUrl;
      v1InstUrl = providedStems1.instrumentalUrl;
      v2VocalUrl = providedStems2.vocalUrl;
      v2InstUrl = providedStems2.instrumentalUrl;
    } else {
      return Response.json({
        error: "Stems não fornecidas. Use o fluxo assíncrono ou forneça stems diretas.",
      }, { status: 400 });
    }

    // 3. Download paralelo de todos os áudios necessários
    const [clientRaw, v1VocalRaw, v1InstRaw, v2VocalRaw, v2InstRaw] = await Promise.all([
      fetchBuffer(clientSignedUrl),
      fetchBuffer(v1VocalUrl),
      fetchBuffer(v1InstUrl),
      fetchBuffer(v2VocalUrl),
      fetchBuffer(v2InstUrl),
    ]);

    const clientBuffer = ensureValidWavHeader(clientRaw);
    const v1VocalBuffer = ensureValidWavHeader(v1VocalRaw);
    const v1InstBuffer = ensureValidWavHeader(v1InstRaw);
    const v2VocalBuffer = ensureValidWavHeader(v2VocalRaw);
    const v2InstBuffer = ensureValidWavHeader(v2InstRaw);

    // 4. Processamento paralelo de DSP para Faixa 1 e Faixa 2
    const [track1, track2] = await Promise.all([
      alignAndMixTrackPair({
        clientAudioBuffer: clientBuffer,
        referenceVocalBuffer: v1VocalBuffer,
        instrumentalBuffer: v1InstBuffer,
      }),
      alignAndMixTrackPair({
        clientAudioBuffer: clientBuffer,
        referenceVocalBuffer: v2VocalBuffer,
        instrumentalBuffer: v2InstBuffer,
      }),
    ]);

    // 5. Gera playbacks em WAV e MP3 e prévias instrumentais
    const p1Audio = convertToWavAndMp3(v1InstBuffer);
    const p2Audio = convertToWavAndMp3(v2InstBuffer);
    const previaInst1 = create70sPreviewMp3(v1InstBuffer);
    const previaInst2 = create70sPreviewMp3(v2InstBuffer);

    // 6. Upload paralelo dos arquivos finais
    const [
      upVoz1Wav, upVoz1Mp3,
      upVoz2Wav, upVoz2Mp3,
      upPlay1Mp3, upPlay1Wav,
      upPlay2Mp3, upPlay2Wav,
      upPreviaVoz1, upPreviaVoz2,
      upPreviaInst1, upPreviaInst2,
    ] = await Promise.all([
      uploadAudioFile(track1.finalWav, "final_com_voz_01.wav", "audio/wav"),
      uploadAudioFile(track1.finalMp3, "final_com_voz_01.mp3", "audio/mpeg"),
      uploadAudioFile(track2.finalWav, "final_com_voz_02.wav", "audio/wav"),
      uploadAudioFile(track2.finalMp3, "final_com_voz_02.mp3", "audio/mpeg"),
      uploadAudioFile(p1Audio.mp3, "playback_01.mp3", "audio/mpeg"),
      uploadAudioFile(p1Audio.wav, "playback_01.wav", "audio/wav"),
      uploadAudioFile(p2Audio.mp3, "playback_02.mp3", "audio/mpeg"),
      uploadAudioFile(p2Audio.wav, "playback_02.wav", "audio/wav"),
      uploadAudioFile(track1.previewMp3, "previa_voz_01.mp3", "audio/mpeg"),
      uploadAudioFile(track2.previewMp3, "previa_voz_02.mp3", "audio/mpeg"),
      uploadAudioFile(previaInst1, "previa_playback_01.mp3", "audio/mpeg"),
      uploadAudioFile(previaInst2, "previa_playback_02.mp3", "audio/mpeg"),
    ]);

    // 7. Chamada ao Google Drive com isolamento de erro (não-bloqueante contra 504)
    let driveWarning: string | null = null;
    let driveSaved = false;

    try {
      const drivePromise = base44.asServiceRole.functions.invoke("saveToDrive", {
        job_id: jobId || `job_${Date.now()}`,
        phone: phone || "",
        urls: {
          finalVoz1Wav: upVoz1Wav.signedUrl,
          finalVoz1Mp3: upVoz1Mp3.signedUrl,
          finalVoz2Wav: upVoz2Wav.signedUrl,
          finalVoz2Mp3: upVoz2Mp3.signedUrl,
          playback1Mp3: upPlay1Mp3.signedUrl,
          playback1Wav: upPlay1Wav.signedUrl,
          playback2Mp3: upPlay2Mp3.signedUrl,
          playback2Wav: upPlay2Wav.signedUrl,
        },
      });

      // Aguarda até 4 segundos no máximo; se o Drive demorar, não derruba a resposta com 504
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Drive timeout tolerado")), 4000)
      );
      await Promise.race([drivePromise, timeoutPromise]);
      driveSaved = true;
    } catch (driveErr: any) {
      console.warn("[runPipeline] Google Drive não concluiu a tempo:", driveErr?.message);
      driveWarning = "Os arquivos estão disponíveis para download imediato, mas o backup automático no Google Drive está pendente.";
    }

    return Response.json({
      success: true,
      downloads: {
        finalVoz1Wav: upVoz1Wav.signedUrl,
        finalVoz1Mp3: upVoz1Mp3.signedUrl,
        finalVoz2Wav: upVoz2Wav.signedUrl,
        finalVoz2Mp3: upVoz2Mp3.signedUrl,
        playback1Mp3: upPlay1Mp3.signedUrl,
        playback1Wav: upPlay1Wav.signedUrl,
        playback2Mp3: upPlay2Mp3.signedUrl,
        playback2Wav: upPlay2Wav.signedUrl,
        previaVoz1: upPreviaVoz1.signedUrl,
        previaVoz2: upPreviaVoz2.signedUrl,
        previaPlayback1: upPreviaInst1.signedUrl,
        previaPlayback2: upPreviaInst2.signedUrl,
      },
      driveSaved,
      driveWarning,
    });
  } catch (error: any) {
    console.error("[runPipeline] Erro:", error);
    return Response.json({ error: error?.message || "Erro interno no processamento" }, { status: 500 });
  }
});
