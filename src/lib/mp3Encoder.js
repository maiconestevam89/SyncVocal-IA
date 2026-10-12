// Encodes an AudioBuffer into an MP3 Blob at the given bitrate (kbps).
// The heavy lifting runs in a Web Worker so the UI thread stays responsive.
// Returns a Promise<Blob> — all callers must await it.
export function audioBufferToMp3Blob(buffer, bitrate = 128) {
  return new Promise((resolve, reject) => {
    const numChannels = Math.min(2, buffer.numberOfChannels);
    const sampleRate = buffer.sampleRate;

    // Copy channel data into transferable Float32Arrays. getChannelData returns
    // a live view; transferring it would detach the AudioBuffer's internal data.
    const leftCopy = new Float32Array(buffer.getChannelData(0));
    const transferables = [leftCopy.buffer];
    let rightCopy = leftCopy;
    if (numChannels > 1) {
      rightCopy = new Float32Array(buffer.getChannelData(1));
      transferables.push(rightCopy.buffer);
    }

    const worker = new Worker(new URL("./mp3Worker.js", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (e) => {
      const blob = new Blob([e.data.buffer], { type: "audio/mp3" });
      worker.terminate();
      resolve(blob);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "Falha na codificação MP3."));
    };

    worker.postMessage(
      { left: leftCopy, right: rightCopy, sampleRate, numChannels, bitrate },
      transferables
    );
  });
}