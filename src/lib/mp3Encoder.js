import lame from "lamejs";

// Encode an AudioBuffer into an MP3 Blob at the given bitrate (kbps).
export function audioBufferToMp3Blob(buffer, bitrate = 128) {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const encoder = new lame.Mp3Encoder(numChannels, sampleRate, bitrate);

  const left = buffer.getChannelData(0);
  const right = numChannels > 1 ? buffer.getChannelData(1) : left;
  const samples = buffer.length;
  const blockSize = 1152;
  const chunks = [];

  const toInt16 = (f) => {
    const s = Math.max(-1, Math.min(1, f));
    return s < 0 ? s * 0x8000 : s * 0x7fff;
  };

  for (let i = 0; i < samples; i += blockSize) {
    const len = Math.min(blockSize, samples - i);
    const left16 = new Int16Array(len);
    const right16 = new Int16Array(len);
    for (let j = 0; j < len; j++) {
      left16[j] = toInt16(left[i + j]);
      right16[j] = toInt16(right[i + j]);
    }
    const mp3buf =
      numChannels > 1
        ? encoder.encodeBuffer(left16, right16)
        : encoder.encodeBuffer(left16);
    if (mp3buf.length > 0) chunks.push(new Uint8Array(mp3buf));
  }

  const end = encoder.flush();
  if (end.length > 0) chunks.push(new Uint8Array(end));

  return new Blob(chunks, { type: "audio/mp3" });
}