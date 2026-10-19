// Server-side audio alignment and mixing engine.
import decode from "npm:audio-decode";
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
 * Decodifica qualquer arquivo de áudio (WAV, MP3, WebM, OGG, AAC, FLAC)
 * e o converte em um canal mono reamostrado na taxa desejada (padrão 22050 Hz).
 */
export async function decodeAudioMono(
  audioBuffer: ArrayBuffer | Uint8Array,
  targetRate: number = PROCESS_RATE
): Promise<{ channels: [Float32Array]; sampleRate: number; duration: number }> {
  const ab: ArrayBuffer = audioBuffer instanceof ArrayBuffer
    ? audioBuffer
    : new Uint8Array(audioBuffer).slice().buffer as ArrayBuffer;

  // 1. Tenta o decodificador multi-formato de alta performance (lê MP3, WebM, OGG, AAC, WAV, FLAC)
  try {
    const decoded = await decode(ab);
    const channels = decoded.channelData;
    const srcRate = decoded.sampleRate || 44100;
    const numChannels = channels.length;
    const numFrames = channels[0].length;
    const ratio = srcRate / targetRate;
    const outLen = Math.max(1, Math.floor(numFrames / ratio));
    const out = new Float32Array(outLen);

    for (let i = 0; i < outLen; i++) {
      const srcIdx = i * ratio;
      const idx0 = Math.floor(srcIdx);
      const frac = srcIdx - idx0;
      const frame0 = idx0 < numFrames ? idx0 : numFrames - 1;
      const frame1 = idx0 + 1 < numFrames ? idx0 + 1 : frame0;
      let s0 = 0;
      let s1 = 0;
      for (let c = 0; c < numChannels; c++) {
        s0 += channels[c][frame0];
        s1 += channels[c][frame1];
      }
      out[i] = (s0 * (1 - frac) + s1 * frac) / numChannels;
    }

    return { channels: [out], sampleRate: targetRate, duration: outLen / targetRate };
  } catch (errDec: any) {
    // 2. Se falhar, tenta o decodificador WAV puro embutido como fallback
    try {
      const wav = decodeWavMonoAtRate(ab, targetRate);
      return { channels: wav.channels, sampleRate: wav.sampleRate, duration: wav.duration };
    } catch {
      throw new Error(`Não foi possível decodificar o arquivo de áudio (${errDec?.message || "formato não reconhecido"}). Certifique-se de que é um arquivo WAV ou MP3 válido.`);
    }
  }
}

/**
 * Converte ou extrai áudio para WAV e MP3 padronizados
 */
export async function convertToWavAndMp3(
  audioBuffer: ArrayBuffer
): Promise<{ wav: ArrayBuffer; mp3: ArrayBuffer }> {
  try {
    const decoded = await decodeAudioMono(audioBuffer, PROCESS_RATE);
    const wavBytes = encodeWav(decoded.channels, decoded.sampleRate);
    const mp3Bytes = encodeMp3(decoded.channels, decoded.sampleRate, 192);
    return { wav: wavBytes, mp3: mp3Bytes };
  } catch (err) {
    console.error("[convertToWavAndMp3] Falha ao converter o áudio:", err);
    throw err;
  }
}

/**
 * Cria corte de prévia de até 70 segundos (1:10) em MP3 a partir de qualquer áudio (WAV ou MP3)
 */
export async function create70sPreviewMp3(audioBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const decoded = await decodeAudioMono(audioBuffer, PROCESS_RATE);
    const previewSeconds = 70;
    const previewLen = Math.min(decoded.channels[0].length, Math.floor(previewSeconds * decoded.sampleRate));
    const previewChannels = [decoded.channels[0].subarray(0, previewLen)];
    return encodeMp3(previewChannels, decoded.sampleRate, 192);
  } catch (err) {
    console.error("[audioProcessor] Falha ao gerar preview MP3:", err);
    throw err;
  }
}

/**
 * Alinha e mixa a voz do cliente à voz de referência e ao playback instrumental.
 * Funciona de forma transparente com entradas em WAV, MP3 ou WebM.
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
  // 1. Carrega vocal de referência (IA ou Stems fornecidos)
  const vocal1 = await decodeAudioMono(referenceVocalBuffer, PROCESS_RATE);
  const refDur = vocal1.channels[0].length / vocal1.sampleRate;
  const hop = Math.max(0.04, refDur / 5000);

  const refMono = toMono16kRaw(vocal1.channels, vocal1.sampleRate);
  const refFeatures = await computeFeatures(refMono, hop);
  const gateCurve = computeSilenceGateRaw(
    vocal1.channels, vocal1.channels[0].length, vocal1.sampleRate
  );
  refMono.fill(0);

  // 2. Carrega vocal do cliente (gravado no mic ou enviado em WAV/MP3)
  const vocal2 = await decodeAudioMono(clientAudioBuffer, PROCESS_RATE);
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

  // 3. Carrega instrumental (WAV ou MP3) e mixa
  const instrumental = await decodeAudioMono(instrumentalBuffer, PROCESS_RATE);
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
    finalWav: wavBytes,
    finalMp3,
    previewMp3,
    durationSeconds: maxLen / instrumental.sampleRate,
  };
}
