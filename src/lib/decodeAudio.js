// Decode an uploaded audio File into an AudioBuffer.
//
// The native AudioContext.decodeAudioData() rejects some MP3s that browsers
// can otherwise play (unusual sample rates, certain encoders, voice-memo
// files). When that happens we fall back to routing the file through a hidden
// <audio> element + MediaElementSource, which uses the browser's full media
// pipeline and accepts a wider range of MP3s. We render that source into an
// OfflineAudioContext so the rest of the app still gets a plain AudioBuffer.

export async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    try {
      return await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch (firstErr) {
      // Fallback: use the browser's media element pipeline, which decodes
      // a broader range of MP3s than decodeAudioData.
      return await decodeViaMediaElement(file, ctx);
    }
  } finally {
    ctx.close();
  }
}

async function decodeViaMediaElement(file, ctx) {
  const url = URL.createObjectURL(file);
  const audioEl = new Audio();
  audioEl.src = url;
  audioEl.muted = true;
  audioEl.preload = "auto";

  try {
    // Wait for metadata + enough data to know the duration.
    await new Promise((resolve, reject) => {
      const onErr = () => reject(new Error("Não foi possível ler o áudio (formato não suportado)."));
      audioEl.addEventListener("loadedmetadata", resolve, { once: true });
      audioEl.addEventListener("error", onErr, { once: true });
      // Safety timeout.
      setTimeout(() => reject(new Error("Tempo excedido ao ler o áudio.")), 15000);
    });

    let duration = isFinite(audioEl.duration) && audioEl.duration > 0
      ? audioEl.duration
      : 0;

    if (!duration) {
      // Some browsers need a play() to populate duration.
      try { await audioEl.play(); } catch {}
      audioEl.pause();
      audioEl.currentTime = 0;
      duration = isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
    }

    if (!duration) {
      duration = await estimateDuration(file);
    }
    if (!duration || !isFinite(duration)) {
      throw new Error("Não foi possível determinar a duração do áudio.");
    }

    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(duration * sampleRate);
    const offline = new OfflineAudioContext(2, length, sampleRate);
    const src = offline.createMediaElementSource(audioEl);
    src.connect(offline.destination);
    audioEl.currentTime = 0;
    try { await audioEl.play(); } catch {}

    const rendered = await offline.startRendering();
    return rendered;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Some browsers keep duration at 0 or Infinity even after metadata loaded;
// fall back to a byte-rate heuristic for CBR MP3s.
async function estimateDuration(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let frameCount = 0;
  let frameLen = 0;
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] === 0xFF && (bytes[i + 1] & 0xE0) === 0xE0) {
      frameLen = decodeMp3FrameLength(bytes, i);
      if (frameLen > 0) {
        frameCount++;
        i += frameLen - 1;
      }
    }
  }
  if (frameCount > 0 && frameLen > 0) {
    // 1152 samples per frame at the file's sample rate; we approximate using
    // 44.1kHz since the OfflineAudioContext resamples anyway.
    return (frameCount * 1152) / 44100;
  }
  return 0;
}

function decodeMp3FrameLength(bytes, offset) {
  const header = (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
  // MPEG version + layer: we only care about MPEG-1 Layer III (0x02 bitmap).
  const versionBits = (bytes[offset + 1] >> 3) & 0x03;
  const layerBits = (bytes[offset + 1] >> 1) & 0x03;
  if (versionBits === 1 || layerBits !== 1) return 0; // reserved/MPEG-2.5
  const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0F;
  const sampleIndex = (bytes[offset + 2] >> 2) & 0x03;
  const padding = (bytes[offset + 2] >> 1) & 0x01;
  if (bitrateIndex === 0 || bitrateIndex === 15) return 0;
  if (sampleIndex === 3) return 0;
  const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const samples = [44100, 48000, 32000, 0];
  const bitrate = bitrates[bitrateIndex] * 1000;
  const sampleRate = samples[sampleIndex];
  if (!bitrate || !sampleRate) return 0;
  return Math.floor((144 * bitrate) / sampleRate) + padding;
}