// Server-side audio alignment and mixing engine.
import {
  computeFeatures,
  subsequenceDTW,
  buildWarp,
  warpStretch,
  toMono16kRaw,
  computeSilenceGateRaw,
  applyGate,
  autoMatchGainsRaw,
} from "./dsp.ts";
import { decodeWavMonoAtRate, encodeWav } from "./wavCodec.ts";
import { encodeMp3 } from "./mp3Encoder.ts";

const PROCESS_RATE = 22050;

export interface AlignedTrackPair {
  finalWav: ArrayBuffer;
  finalMp3: ArrayBuffer;
  previewMp3: ArrayBuffer;
  durationSeconds: number;
}

/**
 * Converte ou extrai áudio para WAV e MP3
 */
export function convertToWavAndMp3(audioBuffer: ArrayBuffer): { wav: ArrayBuffer; mp3: ArrayBuffer } {
  try {
    const decoded = decodeWavMonoAtRate(audioBuffer, PROCESS_RATE);
    const wavBytes = encodeWav(decoded.channels, decoded.sampleRate);
    const mp3Bytes = encodeMp3(decoded.channels, decoded.sampleRate, 192);
    return { wav: wavBytes.buffer, mp3: mp3Bytes };
  } catch {
    return { wav: audioBuffer, mp3: audioBuffer };
  }
}

/**
 * Cria corte de prévia de até 70 segundos (1:10) em MP3 a partir de um áudio
 */
export function create70sPreviewMp3(audioBuffer: ArrayBuffer): ArrayBuffer {
  try {
    const decoded = decodeWavMonoAtRate(audioBuffer, PROCESS_RATE);
    const previewSeconds = 70;
    const previewLen = Math.min(decoded.channels[0].length, Math.floor(previewSeconds * decoded.sampleRate));
    const previewChannels = [decoded.channels[0].subarray(0, previewLen)];
    return encodeMp3(previewChannels, decoded.sampleRate, 192);
  } catch (err) {
    console.warn("[audioProcessor] Falha ao gerar preview MP3:", err);
    return audioBuffer;
  }
}

/**
 * Alinha e mixa a voz do cliente à voz de referência e ao playback instrumental.
 * Retorna os buffers do áudio final em WAV e MP3 e da prévia de 70 segundos.
 */
export async function alignAndMixTrackPair({
  clientAudioBuffer,
  referenceVocalBuffer,
  instrumentalBuffer,
}: {
  clientAudioBuffer: ArrayBuffer;
  referenceVocalBuffer: ArrayBuffer;
  instrumentalBuffer: ArrayBuffer;
}): Promise<AlignedTrackPair> {
  // 1. Carrega vocal de referência
  const vocal1 = decodeWavMonoAtRate(referenceVocalBuffer, PROCESS_RATE);
  const refDur = vocal1.channels[0].length / vocal1.sampleRate;
  const hop = Math.max(0.04, refDur / 5000);

  const refMono = toMono16kRaw(vocal1.channels, vocal1.sampleRate);
  const refFeatures = await computeFeatures(refMono, hop);
  const gateCurve = computeSilenceGateRaw(
    vocal1.channels, vocal1.channels[0].length, vocal1.sampleRate
  );
  vocal1.channels = null;
  refMono.fill(0);

  // 2. Carrega vocal do cliente
  const vocal2 = decodeWavMonoAtRate(clientAudioBuffer, PROCESS_RATE);
  const vocalDur = vocal2.channels[0].length / vocal2.sampleRate;
  const vocalHop = Math.max(0.04, Math.max(refDur, vocalDur) / 5000);

  const vocalMono = toMono16kRaw(vocal2.channels, vocal2.sampleRate);
  const vocalFeatures = await computeFeatures(vocalMono, vocalHop);

  const first = vocalFeatures.active.indexOf(1);
  const last = vocalFeatures.active.lastIndexOf(1);
  if (first < 0 || refFeatures.active.indexOf(1) < 0) {
    throw new Error("Não encontrei voz suficiente nos áudios para alinhar.");
  }

  const q = {
    feats: vocalFeatures.feats.subarray(first * vocalFeatures.dim, (last + 1) * vocalFeatures.dim),
    dim: vocalFeatures.dim,
    nFrames: last - first + 1,
    active: vocalFeatures.active.subarray(first, last + 1),
  };
  const dtw = await subsequenceDTW(q, refFeatures);
  if (!dtw) throw new Error("Não foi possível alinhar a voz à referência.");

  const tq = (i: number) => (i + first) * vocalFeatures.hop + vocalFeatures.offset;
  const tr = (j: number) => j * refFeatures.hop + refFeatures.offset;
  const warp = buildWarp(dtw.path, tq, tr, refFeatures.hop);

  const aligned = await warpStretch(vocal2.channels, vocal2.sampleRate, warp, refDur);
  vocal2.channels = null;

  // 3. Carrega instrumental e mixa
  const instrumental = decodeWavMonoAtRate(instrumentalBuffer, PROCESS_RATE);
  const gated = applyGate(aligned, gateCurve, instrumental.sampleRate);

  const tracks = [
    { channels: gated, length: gated[0].length, gain: 1 },
    { channels: instrumental.channels, length: instrumental.channels[0].length, gain: 0.8 },
  ];
  const gains = autoMatchGainsRaw(tracks);

  const maxLen = Math.max(gated[0].length, instrumental.channels[0].length);
  const mixed = new Float32Array(maxLen);

  for (let i = 0; i < maxLen; i++) {
    let v = 0;
    if (i < gated[0].length) v += gated[0][i] * gains[0];
    if (i < instrumental.channels[0].length) v += instrumental.channels[0][i] * gains[1];
    mixed[i] = v;
  }

  // 4. Codifica WAV e MP3 completos
  const wavBytes = encodeWav([mixed], instrumental.sampleRate);
  const finalMp3 = encodeMp3([mixed], instrumental.sampleRate, 192);

  // 5. Codifica prévia de 70 segundos (1:10)
  const previewSeconds = 70;
  const previewLen = Math.min(mixed.length, Math.floor(previewSeconds * instrumental.sampleRate));
  const previewChannels = [mixed.subarray(0, previewLen)];
  const previewMp3 = encodeMp3(previewChannels, instrumental.sampleRate, 192);

  return {
    finalWav: wavBytes.buffer,
    finalMp3,
    previewMp3,
    durationSeconds: maxLen / instrumental.sampleRate,
  };
}
