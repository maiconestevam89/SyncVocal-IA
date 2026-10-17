import { secrets } from "base44:runtime";

const MUSIC_AI_BASE = "https://api.music.ai";

export const MUSIC_AI_WORKFLOWS = {
  IDENTIFY_SONG: "untitled-workflow-45dc833",
  AI_AUDIO_MASTERING: "untitled-workflow-45dc22d",
  VOCAL_SEPARATION_CLEANUP: "untitled-workflow-45dc0db",
};

export function getMusicAiKey(): string {
  const k = secrets.get("MUSIC_AI_API_KEY") || process.env["MUSIC_AI_API_KEY"];
  if (k && k.trim()) return k.trim();
  throw new Error("MUSIC_AI_API_KEY não configurada nos secrets do Base44.");
}

export async function musicAiRequest(path: string, options: RequestInit = {}): Promise<any> {
  const key = getMusicAiKey();
  const cleanPath = path.replace(/^\/+/, "");
  const url = `${MUSIC_AI_BASE}/${cleanPath}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: key,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("[Music.ai error]:", res.status, url, errorText);
    throw new Error(`Music.ai API error (${res.status}): ${errorText}`);
  }

  return res.json();
}

export async function uploadToMusicAi(
  fileBuffer: ArrayBuffer | Uint8Array,
  mimeType = "audio/mpeg"
): Promise<{ uploadUrl: string; downloadUrl: string; fileReference: string }> {
  const uploadInfo = await musicAiRequest("/api/upload");
  const { uploadUrl, downloadUrl, fileReference } = uploadInfo;

  if (!uploadUrl || !fileReference) {
    throw new Error("Music.ai não retornou uploadUrl ou fileReference válidos.");
  }

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
    },
    body: fileBuffer instanceof ArrayBuffer ? fileBuffer : fileBuffer.buffer,
    signal: AbortSignal.timeout(120000),
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`Falha no upload do áudio para o Music.ai (${putRes.status}): ${errText}`);
  }

  return { uploadUrl, downloadUrl, fileReference };
}

export async function createMusicAiJob(
  name: string,
  workflowId: string,
  params: Record<string, string>
): Promise<string> {
  const payload = {
    name,
    workflowId,
    params,
  };

  const res = await musicAiRequest("/api/job", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const jobId = res?.id || res?.jobId;
  if (!jobId) {
    throw new Error("Music.ai não retornou o ID do job criado.");
  }

  return jobId;
}

export async function getMusicAiJob(jobId: string): Promise<any> {
  return await musicAiRequest(`/api/job/${jobId}`);
}

export async function pollMusicAiJob(jobId: string, maxWaitMs = 300000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const job = await getMusicAiJob(jobId);
    const status = (job?.status || "").toUpperCase();

    if (status === "SUCCEEDED" || status === "COMPLETED" || status === "FINISHED") {
      return job;
    }
    if (status === "FAILED" || status === "ERROR") {
      throw new Error(`Music.ai job ${jobId} falhou: ${job?.errorMessage || "Erro desconhecido"}`);
    }

    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`Tempo limite atingido aguardando job ${jobId} do Music.ai.`);
}

export interface CopyrightCheckResult {
  hasCopyright: boolean;
  title?: string;
  artist?: string;
  label?: string;
  isrc?: string;
  rawMetadata?: any;
}

export async function identifySongCopyright(
  fileReferenceOrUrl: string,
  jobName = "Identify Song"
): Promise<CopyrightCheckResult> {
  const jobId = await createMusicAiJob(jobName, MUSIC_AI_WORKFLOWS.IDENTIFY_SONG, {
    inputUrl: fileReferenceOrUrl,
  });

  const finishedJob = await pollMusicAiJob(jobId);
  const metadata = finishedJob?.result?.metadata || finishedJob?.metadata || {};

  const statusCode = metadata.statusCode;
  const statusDesc = String(metadata.statusDescription || "");

  if (statusCode === 2005 || statusDesc.includes("No match found") || statusDesc.includes("2005")) {
    return {
      hasCopyright: false,
      rawMetadata: metadata,
    };
  }

  const matches = metadata.matches || metadata.songs || [];
  if (Array.isArray(matches) && matches.length > 0) {
    const topMatch = matches[0];
    return {
      hasCopyright: true,
      title: topMatch.title || topMatch.song_title || topMatch.name,
      artist: topMatch.artist || topMatch.artist_name,
      label: topMatch.label || topMatch.record_label,
      isrc: topMatch.isrc,
      rawMetadata: metadata,
    };
  }

  if (metadata.title || metadata.artist) {
    return {
      hasCopyright: true,
      title: metadata.title,
      artist: metadata.artist,
      label: metadata.label,
      isrc: metadata.isrc,
      rawMetadata: metadata,
    };
  }

  return {
    hasCopyright: false,
    rawMetadata: metadata,
  };
}

export async function cleanupCustomerVocal(
  fileReferenceOrUrl: string,
  jobName = "Vocal Cleanup"
): Promise<string> {
  const jobId = await createMusicAiJob(jobName, MUSIC_AI_WORKFLOWS.VOCAL_SEPARATION_CLEANUP, {
    inputUrl: fileReferenceOrUrl,
  });

  const finishedJob = await pollMusicAiJob(jobId);
  const result = finishedJob?.result || {};

  const vocalUrl =
    result["clean_vocals"] ||
    result["vocal"] ||
    result["vocals"] ||
    result["vocalUrl"] ||
    result["cleanVocals"] ||
    Object.values(result).find((v) => typeof v === "string" && v.startsWith("http"));

  if (!vocalUrl) {
    throw new Error("Music.ai não retornou a URL do vocal limpo.");
  }

  return vocalUrl as string;
}

export async function masterCustomerVocal(
  fileReferenceOrUrl: string,
  jobName = "Vocal Mastering"
): Promise<string> {
  const jobId = await createMusicAiJob(jobName, MUSIC_AI_WORKFLOWS.AI_AUDIO_MASTERING, {
    inputUrl: fileReferenceOrUrl,
  });

  const finishedJob = await pollMusicAiJob(jobId);
  const result = finishedJob?.result || {};

  const masteredUrl =
    result["AI-mastered"] ||
    result["mastered"] ||
    result["masteredUrl"] ||
    result["output"] ||
    Object.values(result).find((v) => typeof v === "string" && v.startsWith("http"));

  if (!masteredUrl) {
    throw new Error("Music.ai não retornou a URL do áudio masterizado.");
  }

  return masteredUrl as string;
}
