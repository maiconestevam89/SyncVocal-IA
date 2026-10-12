// Pure-JS WAV decoder and encoder for server-side audio processing.
// No browser APIs — works in the Deno backend function runtime.

// Decode a WAV ArrayBuffer into { channels: Float32Array[], sampleRate, duration }.
// Supports 16-bit PCM, 24-bit PCM, and 32-bit float WAV files.
export function decodeWav(arrayBuffer) {
  const ab = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : new Uint8Array(arrayBuffer).buffer;
  const view = new DataView(ab);

  // Verify RIFF header
  const riff = view.getUint32(0, false);
  if (riff !== 0x52494646) throw new Error("Não é um arquivo WAV válido (header RIFF ausente).");

  let offset = 12;
  let sampleRate = 0;
  let numChannels = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataOffset = 0;
  let dataLength = 0;

  // Walk chunks to find fmt and data
  while (offset + 8 <= view.buffer.byteLength) {
    const chunkId = view.getUint32(offset, false);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 0x666D7420) { // "fmt "
      audioFormat = view.getUint16(offset + 8, true);
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 0x64617461) { // "data"
      dataOffset = offset + 8;
      dataLength = chunkSize;
      break;
    }
    offset += 8 + chunkSize + (chunkSize & 1); // pad to even
  }

  if (!dataOffset || !sampleRate || !numChannels) {
    throw new Error("WAV inválido: chunk fmt ou data ausente.");
  }

  const bytesPerSample = bitsPerSample / 8;
  const numFrames = Math.floor(dataLength / (numChannels * bytesPerSample));
  const channels = [];
  for (let c = 0; c < numChannels; c++) channels.push(new Float32Array(numFrames));

  if (bitsPerSample === 16) {
    for (let i = 0; i < numFrames; i++) {
      for (let c = 0; c < numChannels; c++) {
        const s = view.getInt16(dataOffset + (i * numChannels + c) * 2, true);
        channels[c][i] = s / 32768;
      }
    }
  } else if (bitsPerSample === 24) {
    for (let i = 0; i < numFrames; i++) {
      for (let c = 0; c < numChannels; c++) {
        const o = dataOffset + (i * numChannels + c) * 3;
        let s = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
        if (s > 0x7FFFFF) s -= 0x1000000;
        channels[c][i] = s / 0x800000;
      }
    }
  } else if (bitsPerSample === 32 && audioFormat === 3) { // 32-bit float
    for (let i = 0; i < numFrames; i++) {
      for (let c = 0; c < numChannels; c++) {
        channels[c][i] = view.getFloat32(dataOffset + (i * numChannels + c) * 4, true);
      }
    }
  } else if (bitsPerSample === 32) { // 32-bit int
    for (let i = 0; i < numFrames; i++) {
      for (let c = 0; c < numChannels; c++) {
        channels[c][i] = view.getInt32(dataOffset + (i * numChannels + c) * 4, true) / 0x80000000;
      }
    }
  } else {
    throw new Error(`Formato WAV não suportado: ${bitsPerSample}-bit, formato ${audioFormat}.`);
  }

  return { channels, sampleRate, duration: numFrames / sampleRate };
}

// Decode a WAV ArrayBuffer directly to a single mono Float32Array at a target
// sample rate. This avoids allocating per-channel Float32Arrays at the original
// rate (which for a 5-min stereo 44.1 kHz file is ~104 MB) — instead producing
// a single downsampled mono buffer (~26 MB at 22050 Hz). Critical for staying
// within the Deno worker's ~128 MB memory limit.
export function decodeWavMonoAtRate(arrayBuffer, targetRate) {
  // Ensure we have a proper ArrayBuffer (Deno fetch can return Uint8Array)
  const ab = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : new Uint8Array(arrayBuffer).buffer;
  const view = new DataView(ab);

  const riff = view.getUint32(0, false);
  if (riff !== 0x52494646) throw new Error("Não é um arquivo WAV válido (header RIFF ausente).");

  let offset = 12;
  let sampleRate = 0, numChannels = 0, bitsPerSample = 0, audioFormat = 0;
  let dataOffset = 0, dataLength = 0;

  while (offset + 8 <= view.buffer.byteLength) {
    const chunkId = view.getUint32(offset, false);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 0x666D7420) {
      audioFormat = view.getUint16(offset + 8, true);
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 0x64617461) {
      dataOffset = offset + 8;
      dataLength = chunkSize;
      break;
    }
    offset += 8 + chunkSize + (chunkSize & 1);
  }

  if (!dataOffset || !sampleRate || !numChannels) {
    throw new Error("WAV inválido: chunk fmt ou data ausente.");
  }

  const bytesPerSample = bitsPerSample / 8;
  const numFrames = Math.floor(dataLength / (numChannels * bytesPerSample));
  const ratio = sampleRate / targetRate;
  const outLen = Math.max(1, Math.floor(numFrames / ratio));
  const out = new Float32Array(outLen);

  // Inline sample reading for the common 16-bit PCM case (Kits.ai output)
  if (bitsPerSample === 16) {
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i * ratio;
      const idx0 = Math.floor(srcIdx);
      const frac = srcIdx - idx0;
      const frame0 = idx0 < numFrames ? idx0 : numFrames - 1;
      const frame1 = idx0 + 1 < numFrames ? idx0 + 1 : frame0;
      let s0 = 0, s1 = 0;
      for (let c = 0; c < numChannels; c++) {
        s0 += view.getInt16(dataOffset + (frame0 * numChannels + c) * 2, true) / 32768;
        s1 += view.getInt16(dataOffset + (frame1 * numChannels + c) * 2, true) / 32768;
      }
      out[i] = (s0 * (1 - frac) + s1 * frac) / numChannels;
    }
  } else {
    // Fallback for 24-bit / 32-bit float / 32-bit int
    const readSample = (frameIdx, ch) => {
      const o = dataOffset + (frameIdx * numChannels + ch) * bytesPerSample;
      if (bitsPerSample === 24) {
        let s = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
        if (s > 0x7FFFFF) s -= 0x1000000;
        return s / 0x800000;
      } else if (bitsPerSample === 32 && audioFormat === 3) {
        return view.getFloat32(o, true);
      } else if (bitsPerSample === 32) {
        return view.getInt32(o, true) / 0x80000000;
      }
      return 0;
    };
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i * ratio;
      const idx0 = Math.floor(srcIdx);
      const frac = srcIdx - idx0;
      const frame0 = idx0 < numFrames ? idx0 : numFrames - 1;
      const frame1 = idx0 + 1 < numFrames ? idx0 + 1 : frame0;
      let s0 = 0, s1 = 0;
      for (let c = 0; c < numChannels; c++) {
        s0 += readSample(frame0, c);
        s1 += readSample(frame1, c);
      }
      out[i] = (s0 * (1 - frac) + s1 * frac) / numChannels;
    }
  }

  return { channels: [out], sampleRate: targetRate, duration: outLen / targetRate };
}

// Encode raw Float32Array channels into a 16-bit PCM WAV ArrayBuffer.
export function encodeWav(channels, sampleRate) {
  const numChannels = channels.length;
  const numFrames = channels[0].length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;

  const writeStr = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i)); };
  const writeU32 = (v) => { view.setUint32(offset, v, true); offset += 4; };
  const writeU16 = (v) => { view.setUint16(offset, v, true); offset += 2; };

  writeStr("RIFF");
  writeU32(36 + dataSize);
  writeStr("WAVE");
  writeStr("fmt ");
  writeU32(16);
  writeU16(1); // PCM
  writeU16(numChannels);
  writeU32(sampleRate);
  writeU32(sampleRate * blockAlign);
  writeU16(blockAlign);
  writeU16(16); // bits per sample
  writeStr("data");
  writeU32(dataSize);

  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }

  return buffer;
}