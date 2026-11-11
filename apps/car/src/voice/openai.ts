import { File, Paths } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";

import type { CarLanguage } from "./speechText";
import { encodeWav, parseWav, trimWavStart, wavDurationMs } from "./wav";

const API = "https://api.openai.com/v1";
// The first model is preferred; the next is used when the account or API no longer offers it.
const SPEECH_MODELS = ["gpt-4o-mini-tts", "tts-1"] as const;
const TRANSCRIPTION_MODELS = ["gpt-4o-transcribe", "whisper-1"] as const;
const VOICE = "alloy";
const SPEECH_TIMEOUT_MS = 20_000;
const TRANSCRIPTION_TIMEOUT_MS = 20_000;
/** Longer recordings are not uploaded; the on-device transcript is used instead. */
const MAX_UTTERANCE_MS = 120_000;
/** Kept before the first recognized word, which arrives a little after speech starts. */
const LEAD_IN_MS = 1_500;

function isModelProblem(status: number, body: string): boolean {
  return (status === 400 || status === 403 || status === 404) && /model/i.test(body);
}

function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  if (signal?.aborted) controller.abort();
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

let fileCounter = 0;
function cacheFile(extension: string): File {
  fileCounter += 1;
  return new File(Paths.cache, `t3car-${Date.now()}-${fileCounter}.${extension}`);
}

/** Synthesizes `text` and returns the audio file to play. The caller deletes it. */
export async function synthesizeSpeech(
  apiKey: string,
  text: string,
  signal?: AbortSignal,
): Promise<File> {
  let lastError: Error | null = null;
  for (const model of SPEECH_MODELS) {
    const timeout = withTimeout(signal, SPEECH_TIMEOUT_MS);
    try {
      const response = await expoFetch(`${API}/audio/speech`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, voice: VOICE, input: text, response_format: "mp3" }),
        signal: timeout.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        lastError = new Error(`OpenAI speech failed (${response.status}).`);
        if (isModelProblem(response.status, body)) continue;
        throw lastError;
      }
      const file = cacheFile("mp3");
      file.write(new Uint8Array(await response.arrayBuffer()));
      return file;
    } finally {
      timeout.done();
    }
  }
  throw lastError ?? new Error("OpenAI speech failed.");
}

/**
 * Transcribes what the user said. `uri` is the recording of the whole listening session;
 * only the part from `speechStartedMs` (measured from the start of the file) is uploaded.
 * Returns null when the recording cannot be used, so the caller keeps its own transcript.
 */
export async function transcribeUtterance(input: {
  readonly apiKey: string;
  readonly uri: string;
  readonly speechStartedMs: number;
  /** Omitted to let OpenAI detect the language that was spoken. */
  readonly language?: CarLanguage | undefined;
  readonly signal?: AbortSignal;
}): Promise<string | null> {
  const recording = parseWav(await new File(input.uri).bytes());
  if (recording === null) return null;
  const utterance = trimWavStart(recording, Math.max(0, input.speechStartedMs - LEAD_IN_MS));
  const duration = wavDurationMs(utterance);
  if (duration < 200 || duration > MAX_UTTERANCE_MS) return null;

  const upload = cacheFile("wav");
  upload.write(encodeWav(utterance));
  try {
    let lastError: Error | null = null;
    for (const model of TRANSCRIPTION_MODELS) {
      const form = new FormData();
      // React Native uploads a file from its `uri`.
      form.append("file", {
        uri: upload.uri,
        name: "speech.wav",
        type: "audio/wav",
      } as unknown as Blob);
      form.append("model", model);
      if (input.language !== undefined) form.append("language", input.language.slice(0, 2));
      form.append("response_format", "json");
      const timeout = withTimeout(input.signal, TRANSCRIPTION_TIMEOUT_MS);
      try {
        const response = await fetch(`${API}/audio/transcriptions`, {
          method: "POST",
          headers: { authorization: `Bearer ${input.apiKey}` },
          body: form,
          signal: timeout.signal,
        });
        const body = await response.text();
        if (!response.ok) {
          lastError = new Error(`OpenAI transcription failed (${response.status}).`);
          if (isModelProblem(response.status, body)) continue;
          throw lastError;
        }
        const text = (JSON.parse(body) as { text?: unknown }).text;
        return typeof text === "string" ? text.trim() : null;
      } finally {
        timeout.done();
      }
    }
    throw lastError ?? new Error("OpenAI transcription failed.");
  } finally {
    try {
      upload.delete();
    } catch {
      // The cache is cleared by the system.
    }
  }
}

/** Checks a key without spending anything. Returns an error message, or null when it works. */
export async function checkApiKey(apiKey: string): Promise<string | null> {
  const timeout = withTimeout(undefined, 10_000);
  try {
    const response = await expoFetch(`${API}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: timeout.signal,
    });
    if (response.ok) return null;
    return response.status === 401
      ? "OpenAI herkent deze key niet."
      : `OpenAI gaf een fout (${response.status}).`;
  } catch {
    return "OpenAI is niet bereikbaar.";
  } finally {
    timeout.done();
  }
}
