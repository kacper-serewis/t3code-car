import { describe, expect, it } from "vite-plus/test";

import { encodeWav, parseWav, trimWavStart, wavDurationMs } from "./wav";

const second = (value: number) => {
  const data = new Uint8Array(32_000);
  data.fill(value);
  return data;
};

describe("wav", () => {
  it("round-trips 16 kHz mono PCM", () => {
    const encoded = encodeWav({
      sampleRate: 16_000,
      channels: 1,
      bitsPerSample: 16,
      data: second(1),
    });
    const parsed = parseWav(encoded);
    expect(parsed).not.toBeNull();
    expect(parsed?.sampleRate).toBe(16_000);
    expect(wavDurationMs(parsed!)).toBe(1_000);
  });

  it("keeps only the audio after the cut", () => {
    const data = new Uint8Array(64_000);
    data.set(second(1), 0);
    data.set(second(2), 32_000);
    const trimmed = trimWavStart(
      { sampleRate: 16_000, channels: 1, bitsPerSample: 16, data },
      1_000,
    );
    expect(wavDurationMs(trimmed)).toBe(1_000);
    expect(trimmed.data[0]).toBe(2);
  });

  it("reads a file whose recorder never wrote the data size", () => {
    const encoded = encodeWav({
      sampleRate: 16_000,
      channels: 1,
      bitsPerSample: 16,
      data: second(1),
    });
    new DataView(encoded.buffer).setUint32(40, 0, true);
    expect(parseWav(encoded)?.data.length).toBe(32_000);
  });

  it("rejects anything that is not PCM WAV", () => {
    expect(parseWav(new Uint8Array(100))).toBeNull();
  });
});
