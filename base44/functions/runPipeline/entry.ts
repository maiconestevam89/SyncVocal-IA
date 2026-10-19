import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
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

async function uploadAudioFile(base44: any, buffer: ArrayBuffer, filename: string, mime: string) {
  const fileObj = new File([buffer], filename, { type: mime });
  const uploadRes = await base44.asServiceRole.integrations.Core.UploadPrivateFile({
    file: fileObj,
  });
  const fileUri = uploadRes.file_uri;
  const signedRes = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
    file_uri: fileUri,
    expires_in: 3600,
  });
  return { fileUri, signedUrl: signedRes.signed_url };
}

export default async function (req: Request): Promise<Response> {
  let base44: any = null;
  try {
    base44 = createClientFromRequest(req);
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
        const msg = String(err?.message || "").toLowerCase();
        if (msg.includes("tempo limite") || msg.includes("timeout") || msg.includes("abort")) {
          return Response.json({ status: "PENDING" });
        }
        return Response.json({ status: "ERROR", error: err?.message || msg });
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
        const msg = String(err?.message || "").toLowerCase();
        if (msg.includes("tempo limite") || msg.includes("timeout") || msg.includes("abort")) {
          return Response.json({ status: "PENDING" });
        }
        return Response.json({ status: "ERROR", error: err?.message || msg });
      }
    }

    if (action === "start_mix") {
      const clientUri = clientAudioFileUriRaw || clientAudioUriSnake;
      const direct = hasDirectStemsRaw ?? Boolean(v1VocalFileUriRaw || v1VocalUriSnake);
      const stem1 = direct
        ? { vocal: v1VocalFileUriRaw || v1VocalUriSnake, instrumental: v1InstFileUriRaw || v1InstUriSnake }
        : { vocal: providedStems1?.vocalUrl, instrumental: providedStems1?.instrumentalUrl };
      const stem2 = direct
        ? {
            vocal: v2VocalFileUriRaw || v2VocalUriSnake || stem1.vocal,
            instrumental: v2InstFileUriRaw || v2InstUriSnake || stem1.instrumental,
          }
        : { vocal: providedStems2?.vocalUrl, instrumental: providedStems2?.instrumentalUrl };

      if (!clientUri || !stem1.vocal || !stem1.instrumental || !stem2.vocal || !stem2.instrumental) {
        return Response.json({ error: "Áudio do cliente e stems das duas versões são obrigatórios." }, { status: 400 });
      }

      const createMixJob = (stem: any, version: number) =>
        base44.asServiceRole.entities.ProcessingJob.create({
          audio1_name: payload.audio1_name || ("Produção musical - versão " + version),
          audio2_file_uri: clientUri,
          phone: phone || "",
          phone_digits: (phone || "").replace(/\D/g, ""),
          direct_stems: true,
          version,
          vocal1_uri: stem.vocal,
          vocal2_uri: clientUri,
          instrumental_uri: stem.instrumental,
          status: "pending",
        });

      const [job1, job2] = await Promise.all([createMixJob(stem1, 1), createMixJob(stem2, 2)]);
      return Response.json({ success: true, jobIds: [job1.id, job2.id], job_id: job1.id });
    }

    if (action === "finalize_mix") {
      const firstId = payload.jobId || payload.job_id;
      const secondId = payload.otherJobId || payload.other_job_id;
      if (!firstId || !secondId) {
        return Response.json({ error: "Os dois IDs de processamento são obrigatórios." }, { status: 400 });
      }

      const [job1, job2] = await Promise.all([
        base44.asServiceRole.entities.ProcessingJob.get(firstId),
        base44.asServiceRole.entities.ProcessingJob.get(secondId),
      ]);
      if (job1?.status !== "completed" || job2?.status !== "completed") {
        return Response.json({ error: "A mixagem ainda não terminou." }, { status: 409 });
      }

      await base44.asServiceRole.entities.ProcessingJob.update(firstId, {
        preview_v2_uri: job2.preview_v2_uri,
        preview_voz_v2_uri: job2.preview_voz_v2_uri,
      });

      let driveStatus = { saved: false, message: "O backup automático no Google Drive está pendente." };
      try {
        const drivePromise = base44.asServiceRole.functions.invoke("saveToDrive", {
          job_id: firstId,
          phone: phone || job1.phone || "",
          urls: {
            final_orig_1: job1.playback_mp3_url,
            final_orig_2: job2.playback_mp3_url,
            final_voz_1: job1.result_url,
            final_voz_2: job2.result_url,
          },
        });
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 4000));
        const driveResult: any = await Promise.race([drivePromise, timeoutPromise]);
        if (driveResult?.timeout) {
          driveStatus.message = "Os arquivos estão prontos; o backup no Google Drive continua em segundo plano.";
        } else {
          const driveData = driveResult?.data || driveResult;
          driveStatus = driveData?.success
            ? { saved: true, message: "Arquivos salvos no Google Drive." }
            : { saved: false, message: driveData?.error || driveStatus.message };
        }
      } catch (driveError: any) {
        driveStatus.message = driveError?.message || driveStatus.message;
      }

      return Response.json({
        success: true,
        job: { id: job1.id, phone: job1.phone || phone || "" },
        job_id: job1.id,
        downloads: {
          final_voz_1: job1.result_url,
          final_voz_1_mp3: job1.result_mp3_url,
          final_voz_2: job2.result_url,
          final_voz_2_mp3: job2.result_mp3_url,
          playback_1: job1.playback_mp3_url,
          playback_1_wav: job1.playback_wav_url,
          playback_2: job2.playback_mp3_url,
          playback_2_wav: job2.playback_wav_url,
        },
        drive_status: driveStatus,
      });
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
      uploadAudioFile(base44, track1.finalWav, "final_com_voz_01.wav", "audio/wav"),
      uploadAudioFile(base44, track1.finalMp3, "final_com_voz_01.mp3", "audio/mpeg"),
      uploadAudioFile(base44, track2.finalWav, "final_com_voz_02.wav", "audio/wav"),
      uploadAudioFile(base44, track2.finalMp3, "final_com_voz_02.mp3", "audio/mpeg"),
      uploadAudioFile(base44, p1Audio.mp3, "playback_01.mp3", "audio/mpeg"),
      uploadAudioFile(base44, p1Audio.wav, "playback_01.wav", "audio/wav"),
      uploadAudioFile(base44, p2Audio.mp3, "playback_02.mp3", "audio/mpeg"),
      uploadAudioFile(base44, p2Audio.wav, "playback_02.wav", "audio/wav"),
      uploadAudioFile(base44, track1.previewMp3, "previa_voz_01.mp3", "audio/mpeg"),
      uploadAudioFile(base44, track2.previewMp3, "previa_voz_02.mp3", "audio/mpeg"),
      uploadAudioFile(base44, previaInst1, "previa_playback_01.mp3", "audio/mpeg"),
      uploadAudioFile(base44, previaInst2, "previa_playback_02.mp3", "audio/mpeg"),
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
    return Response.json({
      error: error?.message || "Erro interno no processamento",
      details: String(error?.stack || error || "")
    }, { status: 500 });
  }
};
