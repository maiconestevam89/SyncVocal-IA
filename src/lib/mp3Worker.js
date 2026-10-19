import lame from "@breezystack/lamejs";

// Runs in a Web Worker so the heavy MP3 encoding never blocks the UI thread.
// Receives raw Float32 channel data + params, returns a single ArrayBuffer
// containing the complete MP3 stream (transferred back to avoid copy).
self.onmessage = (e) => {
  const { left, right, sampleRate, numChannels, bitrate } = e.data;
  const encoder = new lame.Mp3Encoder(numChannels, sampleRate, bitrate);
  const samples = left.length;
  const blockSize = 1152;
  const chunks = [];

  const toInt16 = (f) => {
    const s = Math.max(-1, Math.min(1, f));
    return s < 0 ? s * 0x8000 : s * 0x7fff;
  };

  for (let i = 0; i < samples; i += blockSize) {
    const len = Math.min(blockSize, samples - i);
    const left16 = new Int16Array(len);
    const right16 = numChannels > 1 ? new Int16Array(len) : null;
    for (let j = 0; j < len; j++) {
      left16[j] = toInt16(left[i + j]);
      if (right16) right16[j] = toInt16(right[i + j]);
    }
    const mp3buf =
      numChannels > 1
        ? encoder.encodeBuffer(left16, right16)
        : encoder.encodeBuffer(left16);
    if (mp3buf.length > 0) chunks.push(new Uint8Array(mp3buf));
  }

  const end = encoder.flush();
  if (end.length > 0) chunks.push(new Uint8Array(end));

  // Combine all chunks into one transferable ArrayBuffer.
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }

  self.postMessage({ buffer: result.buffer }, [result.buffer]);
};