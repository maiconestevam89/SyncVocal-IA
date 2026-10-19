// Server-side MP3 encoder using @breezystack/lamejs (pure JS, no Worker needed).
import lame from "npm:@breezystack/lamejs@1.2.7";

// Encode raw Float32Array channels into an MP3 ArrayBuffer.
export function encodeMp3(channels, sampleRate, bitrate = 192) {
  const numChannels = Math.min(2, channels.length);
  const encoder = new lame.Mp3Encoder(numChannels, sampleRate, bitrate);
  const samples = channels[0].length;
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
      left16[j] = toInt16(channels[0][i + j]);
      if (right16) right16[j] = toInt16(channels[1][i + j]);
    }
    const mp3buf = numChannels > 1
      ? encoder.encodeBuffer(left16, right16)
      : encoder.encodeBuffer(left16);
    if (mp3buf.length > 0) chunks.push(new Uint8Array(mp3buf));
  }

  const end = encoder.flush();
  if (end.length > 0) chunks.push(new Uint8Array(end));

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.length; }
  return result.buffer;
}