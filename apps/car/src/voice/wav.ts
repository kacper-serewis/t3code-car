/** Reads and trims uncompressed WAV recordings, so only the user's utterance is uploaded. */

export interface WavAudio {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
  /** Raw PCM frames. */
  readonly data: Uint8Array;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let index = 0; index < length; index++) {
    text += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return text;
}

/** Null when the bytes are not a PCM WAV file. */
export function parseWav(bytes: Uint8Array): WavAudio | null {
  if (bytes.length < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: Omit<WavAudio, "data"> | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= bytes.length) {
      const encoding = view.getUint16(body, true);
      // 1 is integer PCM; 0xFFFE is the extensible header iOS writes for the same data.
      if (encoding !== 1 && encoding !== 0xfffe) return null;
      format = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (format === null) return null;
      // A recorder that was still writing leaves the size at zero or beyond the file.
      const end = size === 0 || body + size > bytes.length ? bytes.length : body + size;
      return { ...format, data: bytes.subarray(body, end) };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

export function wavDurationMs(audio: WavAudio): number {
  const bytesPerSecond = audio.sampleRate * audio.channels * (audio.bitsPerSample / 8);
  return bytesPerSecond > 0 ? (audio.data.length / bytesPerSecond) * 1000 : 0;
}

/** The audio from `fromMs` to the end, cut on a frame boundary. */
export function trimWavStart(audio: WavAudio, fromMs: number): WavAudio {
  const frameBytes = audio.channels * (audio.bitsPerSample / 8);
  const frame = Math.max(0, Math.floor((fromMs / 1000) * audio.sampleRate));
  const start = Math.min(audio.data.length, frame * frameBytes);
  return { ...audio, data: audio.data.subarray(start) };
}

export function encodeWav(audio: WavAudio): Uint8Array {
  const bytes = new Uint8Array(44 + audio.data.length);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      bytes[offset + index] = text.charCodeAt(index);
    }
  };
  const blockAlign = audio.channels * (audio.bitsPerSample / 8);
  write(0, "RIFF");
  view.setUint32(4, 36 + audio.data.length, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, audio.channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, audio.bitsPerSample, true);
  write(36, "data");
  view.setUint32(40, audio.data.length, true);
  bytes.set(audio.data, 44);
  return bytes;
}
