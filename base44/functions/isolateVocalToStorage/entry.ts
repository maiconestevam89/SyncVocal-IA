import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from "base44:runtime";
import {
  detectAudioFormat,
  createSeparationJob,
  pollSeparationJob,
  extractResultUrls,
  downloadAudio,
} from "../../shared/kitsai.ts";

// Isolates the vocal from an uploaded audio file using Kits.ai and saves
// the result to private storage (instead of streaming it back to the client).
// This allows the workflow to run independently of the browser.
//
// Receives: { file_uri, with_instrumental, job_id? }
// Returns: { vocal_uri, instrumental_uri? }
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { file_uri, with_instrumental, job_id } = body;
    if (!file_uri) return Response.json({ error: "file_uri ausente." }, { status: 400 });

    const apiKey = secrets.get("KITS_API_KEY");
    if (!apiKey) return Response.json({ error: "KITS_API_KEY não configurada." }, { status: 500 });

    try {
      console.log("[isolateVocalToStorage] step 1: updating job status");
      if (job_id) {
        await base44.asServiceRole.entities.ProcessingJob.update(job_id, {
          status: with_instrumental ? "isolating_1" : "isolating_2",
        });
      }

      console.log("[isolateVocalToStorage] step 2: creating signed URL + downloading");
      const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri });
      let audioBlob = await downloadAudio(signed_url);
      console.log("[isolateVocalToStorage] downloaded blob size:", audioBlob.size);

      const { ext, type: fileContentType, supported } = await detectAudioFormat(audioBlob);
      console.log("[isolateVocalToStorage] step 3: format detected", ext, fileContentType, supported);
      if (!supported) {
        throw new Error(`Formato .${ext} não suportado pelo kits.ai. Use WAV, MP3, FLAC ou WebM.`);
      }

      console.log("[isolateVocalToStorage] step 4: creating Kits.ai separation job");
      const kitsJobId = await createSeparationJob(apiKey, audioBlob, fileContentType, `input.${ext}`);
      console.log("[isolateVocalToStorage] kits job created:", kitsJobId);

      // Release the input blob reference so it can be GC'd during the long poll
      audioBlob = null;

      console.log("[isolateVocalToStorage] step 5: polling Kits.ai job");
      const result = await pollSeparationJob(apiKey, kitsJobId);
      console.log("[isolateVocalToStorage] kits job completed, status:", result?.status);

      const { vocalUrl, instrumentalUrl } = extractResultUrls(result, with_instrumental);
      console.log("[isolateVocalToStorage] step 6: downloading isolated vocal");

      const vocalBlob = await downloadAudio(vocalUrl);
      console.log("[isolateVocalToStorage] vocal blob size:", vocalBlob.size);
      const vocalFile = new File([vocalBlob], "vocal.wav", { type: "audio/wav" });
      console.log("[isolateVocalToStorage] step 7: uploading vocal to storage");
      const { file_uri: vocal_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: vocalFile });
      console.log("[isolateVocalToStorage] vocal uploaded:", vocal_uri);

      let instrumental_uri = null;
      if (with_instrumental && instrumentalUrl) {
        console.log("[isolateVocalToStorage] step 8: downloading + uploading instrumental");
        const instBlob = await downloadAudio(instrumentalUrl);
        console.log("[isolateVocalToStorage] instrumental blob size:", instBlob.size);
        const instFile = new File([instBlob], "instrumental.wav", { type: "audio/wav" });
        const { file_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: instFile });
        instrumental_uri = file_uri;
        console.log("[isolateVocalToStorage] instrumental uploaded:", instrumental_uri);
      }

      // Update job with URIs
      if (job_id) {
        const updateData = {};
        if (with_instrumental) {
          updateData.vocal1_uri = vocal_uri;
          updateData.instrumental_uri = instrumental_uri;
        } else {
          updateData.vocal2_uri = vocal_uri;
        }
        await base44.asServiceRole.entities.ProcessingJob.update(job_id, updateData);
      }

      return Response.json({ vocal_uri, instrumental_uri });
    } catch (error) {
      if (job_id) {
        try {
          await base44.asServiceRole.entities.ProcessingJob.update(job_id, {
            status: "failed",
            error_message: error.message,
          });
        } catch {}
      }
      throw error;
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}