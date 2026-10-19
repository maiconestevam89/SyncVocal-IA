import { secrets } from "base44:runtime";

export function getSunoConfig() {
  const rawBase = (secrets.get("SUNO_API_BASE_URL") || "https://api.apipass.dev")
    .trim()
    .replace(/[\[\]\s]+/g, "")
    .replace(/\/+$/, "");
  const apiKey = (secrets.get("SUNO_API_KEY") || "")
    .trim()
    .replace(/[\[\]"'\s]/g, "")
    .replace(/^Bearer/i, "")
    .trim();

  if (!apiKey) {
    throw new Error("Credencial do Suno não configurada. Defina SUNO_API_KEY nos secrets.");
  }
  return { baseUrl: rawBase || "https://api.apipass.dev", apiKey };
}

export async function sunoRequest(path: string, options: RequestInit = {}): Promise<any> {
  const { baseUrl, apiKey } = getSunoConfig();
  const cleanPath = path.replace(/^\/+/, "");
  const url = `${baseUrl}/${cleanPath}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[sunoRequest] status:", response.status, "url:", url, "body:", errorText.slice(0, 500));
    let errorMessage = `Erro na API Suno (${response.status})`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage =
        errorJson.message ||
        errorJson.msg ||
        errorJson.error ||
        errorJson.detail ||
        (errorJson.errors && errorJson.errors[0] && errorJson.errors[0].description) ||
        errorMessage;
    } catch {
      if (errorText) errorMessage = errorText;
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

export interface SunoVersionData {
  audioId: string;
  audioUrl: string;
  playbackUrl?: string;
  title?: string;
}

export interface SunoGenerationResult {
  taskId: string;
  version1: SunoVersionData;
  version2: SunoVersionData;
}

/**
 * FLUXO 2 - Gera música no Suno mantendo obrigatoriamente as DUAS versões
 */
export async function createSunoGenerationTask({
  lyrics,
  stylePrompt,
}: {
  lyrics: string;
  stylePrompt: string;
}): Promise<string> {
  const truncatedStyle = stylePrompt.length > 200 ? stylePrompt.slice(0, 197) + "..." : stylePrompt;

  const res = await sunoRequest("/api/v1/jobs/createTask", {
    method: "POST",
    body: JSON.stringify({
      model: "suno/generate",
      input: {
        model_version: "V6",
        prompt: lyrics,
        title: "Minha Música",
        style: truncatedStyle,
        negativeTags: "low quality, noise, distortion",
        customMode: true,
        instrumental: false,
      },
    }),
  });

  const taskId = res?.data?.taskId || res?.data?.task_id || res?.taskId;
  if (!taskId) {
    throw new Error("Não foi possível iniciar a geração musical no Suno.");
  }

  return taskId;
}

/**
 * Aguarda conclusão da geração e retorna as 2 versões completas
 */
export async function pollSunoGeneration(taskId: string, _maxWaitMs = 600000): Promise<SunoGenerationResult> {
  // Uma única consulta por invocação evita que o gateway expire enquanto
  // aguardamos dentro da função serverless.
  const res = await sunoRequest(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
  const status = (res?.data?.status || res?.status || "").toUpperCase();

  if (status === "SUCCESS" || status === "COMPLETED" || status === "FINISHED") {
    const versions = Array.isArray(res?.data) ? res.data : (res?.data?.response?.data || []);
    if (versions.length >= 2) {
      const v1 = versions[0];
      const v2 = versions[1];

      return {
        taskId,
        version1: {
          audioId: v1.id || v1.audioId || v1.audio_id,
          audioUrl: v1.audio_url || v1.audioUrl,
          playbackUrl: v1.instrumental_url || v1.playback_url,
          title: v1.title || "Versão 1",
        },
        version2: {
          audioId: v2.id || v2.audioId || v2.audio_id,
          audioUrl: v2.audio_url || v2.audioUrl,
          playbackUrl: v2.instrumental_url || v2.playback_url,
          title: v2.title || "Versão 2",
        },
      };
    }
  } else if (status === "FAILED" || status === "ERROR") {
    throw new Error(`Geração no Suno falhou: ${res?.data?.errorMessage || "Erro desconhecido"}`);
  }

  // O endpoint modular traduz esse marcador para status PENDING.
  throw new Error("Tempo limite aguardando geração musical no Suno.");
}

/**
 * FLUXO 3 - Separação de stems para uma versão
 */
export async function createSunoStemTask(taskId: string, audioId: string): Promise<string> {
  const res = await sunoRequest("/api/v1/jobs/createTask", {
    method: "POST",
    body: JSON.stringify({
      model: "suno/vocal-separation",
      channel: "regular",
      input: {
        taskId,
        audioId,
      },
    }),
  });

  const stemTaskId = res?.data?.taskId || res?.data?.task_id || res?.taskId;
  if (!stemTaskId) {
    throw new Error("Não foi possível iniciar a separação de stems no Suno.");
  }
  return stemTaskId;
}

export interface StemsResult {
  vocalUrl: string;
  instrumentalUrl: string;
}

/**
 * Aguarda conclusão da separação de stems e retorna vocal e instrumental
 */
export async function pollSunoStems(taskId: string, _maxWaitMs = 360000): Promise<StemsResult> {
  // Uma única consulta por invocação evita que o gateway expire enquanto
  // aguardamos dentro da função serverless.
  const res = await sunoRequest(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
  const status = (res?.data?.status || res?.status || "").toUpperCase();

  if (status === "SUCCESS" || status === "COMPLETED" || status === "FINISHED") {
    const stems = Array.isArray(res?.data) ? res.data : (res?.data?.response?.data || []);
    let vocalUrl = "";
    let instrumentalUrl = "";

    for (const stem of stems) {
      const type = String(stem.type || stem.stem_type || stem.title || "").toLowerCase();
      const url = stem.audio_url || stem.audioUrl;
      if (!url) continue;

      if (type.includes("vocal") || type.includes("voice")) {
        vocalUrl = url;
      } else if (type.includes("instrumental") || type.includes("playback") || type.includes("backing")) {
        instrumentalUrl = url;
      }
    }

    if (!vocalUrl && stems[0]?.audio_url) vocalUrl = stems[0].audio_url;
    if (!instrumentalUrl && stems[1]?.audio_url) instrumentalUrl = stems[1].audio_url;

    if (vocalUrl && instrumentalUrl) {
      return { vocalUrl, instrumentalUrl };
    }
  } else if (status === "FAILED" || status === "ERROR") {
    throw new Error(`Separação de stems falhou: ${res?.data?.errorMessage || "Erro desconhecido"}`);
  }

  // O endpoint modular traduz esse marcador para status PENDING.
  throw new Error("Tempo limite aguardando separação de stems.");
}
