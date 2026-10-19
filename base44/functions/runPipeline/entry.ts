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
      clientAudioFileUri: clientAudioFileUriRaw,
      client_audio_uri: clientAudioUriSnake,
      hasDirectStems: hasDirectStemsRaw,
      v1VocalFileUri: v1VocalFileUriRaw,
      pre_generated_v1_vocal_uri: v1VocalUriSnake,
      v1InstFileUri: v1InstFileUriRaw,
      pre_generated_v1_instrumental_uri: v1InstUriSnake,
      v2VocalFileUri: v2VocalFileUriRaw,
      pre_generated_v2_vocal_uri: v2VocalUriSnake,
      v2InstFileUri: v2InstFileUriRaw,
      pre_generated_v2_instrumental_uri: v2InstUriSnake,
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

    const clientAudioFileUri = clientAudioFileUriRaw || clientAudioUriSnake;
    const hasDirectStems = hasDirectStemsRaw ?? Boolean(v1VocalFileUriRaw || v1VocalUriSnake);
    const v1VocalFileUri = v1VocalFileUriRaw || v1VocalUriSnake;
    const v1InstFileUri = v1InstFileUriRaw || v1InstUriSnake;
    const v2VocalFileUri = v2VocalFileUriRaw || v2VocalUriSnake || v1VocalFileUri;
    const v2InstFileUri = v2InstFileUriRaw || v2InstUriSnake || v1InstFileUri;

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

    // Passa os bytes originais: audioProcessor detecta e decodifica WAV/MP3/WebM real.
    const clientBuffer = clientRaw;
    const v1VocalBuffer = v1VocalRaw;
    const v1InstBuffer = v1InstRaw;
    const v2VocalBuffer = v2VocalRaw;
    const v2InstBuffer = v2InstRaw;

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
    const [p1Audio, p2Audio, previaInst1, previaInst2] = await Promise.all([
      convertToWavAndMp3(v1InstBuffer),
      convertToWavAndMp3(v2InstBuffer),
      create70sPreviewMp3(v1InstBuffer),
      create70sPreviewMp3(v2InstBuffer),
    ]);

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
