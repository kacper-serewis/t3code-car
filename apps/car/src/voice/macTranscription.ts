import {
  postProcessEnvironmentTranscript,
  transcribeCloudPcm,
} from "@t3tools/client-runtime/voice-input";
import type { EnvironmentId, ProjectId, SpeechTranscriptionOptions } from "@t3tools/contracts";
import { runSpeech } from "@t3tools/mobile/src/features/voice-input/voiceDestination";
import { appAtomRegistry } from "@t3tools/mobile/src/state/atom-registry";
import { serverEnvironment } from "@t3tools/mobile/src/state/server";
import { environmentSession } from "@t3tools/mobile/src/state/session";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveSpeechVocabulary } from "@t3tools/shared/speech";
import * as Option from "effect/Option";
import { File } from "expo-file-system";

import type { CarLanguage } from "./speechText";
import { parseWav, trimWavStart, wavDurationMs } from "./wav";

/** Kept before the first recognized word, which arrives a little after speech starts. */
const LEAD_IN_MS = 1_500;
/** The server's limit for one recording. */
const MAX_UTTERANCE_MS = 120_000;

/** The 16 kHz mono 16-bit recording as the 32-bit float samples the server expects. */
async function utterancePcm(uri: string, speechStartedMs: number): Promise<Uint8Array | null> {
  const recording = parseWav(await new File(uri).bytes());
  if (
    recording === null ||
    recording.sampleRate !== 16_000 ||
    recording.channels !== 1 ||
    recording.bitsPerSample !== 16
  ) {
    return null;
  }
  const utterance = trimWavStart(recording, Math.max(0, speechStartedMs - LEAD_IN_MS));
  const duration = wavDurationMs(utterance);
  if (duration < 200 || duration > MAX_UTTERANCE_MS) return null;
  const bytes = Uint8Array.from(utterance.data);
  const samples = new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
  const pcm = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index++) pcm[index] = samples[index]! / 32768;
  return new Uint8Array(pcm.buffer);
}

/**
 * Transcribes what the user said through T3 Code on their computer, with OpenAI and the
 * computer's dictionary, then cleans it up with the computer's text model. Returns null when
 * the computer cannot do this right now, so the caller falls back.
 */
export async function transcribeOnComputer(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly projectName: string | null;
  readonly uri: string;
  readonly speechStartedMs: number;
  /** Omitted to let OpenAI detect the language that was spoken. */
  readonly language?: CarLanguage | undefined;
  readonly cleanup: boolean;
}): Promise<string | null> {
  const prepared = Option.getOrNull(
    appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(input.environmentId)),
  );
  if (prepared === null) return null;
  const pcm = await utterancePcm(input.uri, input.speechStartedMs);
  if (pcm === null) return null;

  const serverSettings = appAtomRegistry.get(
    serverEnvironment.settingsValueAtom(input.environmentId),
  );
  // The shared dictionary from the computer's Voice settings, for this thread's project.
  const project =
    serverSettings === null
      ? []
      : resolveProjectSettings(serverSettings, input.projectId).settings.speechProjectCustomWords;
  const speechCustomWords = resolveSpeechVocabulary({
    personal: [],
    project,
    hints: [input.projectName ?? ""],
  });
  const options: SpeechTranscriptionOptions = {
    speechLanguage: input.language === undefined ? "auto" : input.language.slice(0, 2),
    speechTranslateToEnglish: false,
    speechCustomWords,
    speechRemoveFillerWords: true,
    speechSilenceFiltering: true,
  };
  const canSend = () => true;

  const { text } = await runSpeech(transcribeCloudPcm(prepared, "openai", pcm, options, canSend));
  if (!input.cleanup || !text.trim()) return text.trim();
  try {
    const cleaned = await runSpeech(
      postProcessEnvironmentTranscript(
        prepared,
        text,
        { text: "", selection: { start: 0, end: 0 } },
        {
          speechCustomWords,
          speechPostProcessingPrompt: { mode: "default", customInstructions: "" },
        },
        canSend,
      ),
    );
    return cleaned.text.trim() || text.trim();
  } catch {
    // The raw transcript is still good to send.
    return text.trim();
  }
}
