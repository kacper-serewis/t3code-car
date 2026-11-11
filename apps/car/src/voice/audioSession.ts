import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioPlayer,
} from "expo-audio";
import { File, Paths } from "expo-file-system";

import { encodeWav } from "./wav";

/**
 * What the app does to the driver's music. `quiet`: nothing, and a silent loop keeps the app
 * running behind a navigation app. `speaking`: music is lowered while a voice plays.
 * `listening`: the speech recognizer owns the session and music stops.
 */
type Phase = "off" | "quiet" | "speaking" | "listening";

let phase: Phase = "off";
let keepAlive: AudioPlayer | null = null;
// Transitions run one after another; a later one always wins.
let chain: Promise<void> = Promise.resolve();

function silenceFile(): File {
  const file = new File(Paths.cache, "t3car-silence.wav");
  if (!file.exists) {
    file.write(
      encodeWav({
        sampleRate: 8_000,
        channels: 1,
        bitsPerSample: 16,
        data: new Uint8Array(8_000 * 2 * 2),
      }),
    );
  }
  return file;
}

function pauseKeepAlive(): void {
  try {
    keepAlive?.pause();
  } catch {
    // Released.
  }
}

function releaseKeepAlive(): void {
  try {
    keepAlive?.pause();
    keepAlive?.remove();
  } catch {
    // Released.
  }
  keepAlive = null;
}

async function activate(interruptionMode: "mixWithOthers" | "duckOthers"): Promise<void> {
  pauseKeepAlive();
  // Lowering or restoring other audio only takes effect when the session is activated again.
  await setIsAudioActiveAsync(false).catch(() => {});
  await setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode,
    allowsRecording: false,
    shouldPlayInBackground: true,
  });
  await setIsAudioActiveAsync(true);
  if (keepAlive === null) {
    keepAlive = createAudioPlayer(silenceFile().uri);
    keepAlive.loop = true;
  }
  keepAlive.play();
}

function transition(next: Phase, run: () => Promise<void>): Promise<void> {
  chain = chain
    .then(async () => {
      if (phase === next) return;
      phase = next;
      await run();
    })
    .catch(() => {});
  return chain;
}

/** Music at full volume; the app stays alive in the background. */
export function enterQuiet(): Promise<void> {
  return transition("quiet", () => activate("mixWithOthers"));
}

/** Lower the music. Call right before the voice plays, not while it is being generated. */
export function enterSpeaking(): Promise<void> {
  return transition("speaking", () => activate("duckOthers"));
}

/** Hand the session to the speech recognizer, which stops the music. */
export function enterListening(): Promise<void> {
  return transition("listening", async () => {
    // The recognizer reconfigures the session for recording; it must find it released, or the
    // audio server can stall while both hold it.
    releaseKeepAlive();
    await setIsAudioActiveAsync(false).catch(() => {});
  });
}

/** Leaving the conversation: give audio back to the other apps. */
export function leaveAudio(): Promise<void> {
  return transition("off", async () => {
    releaseKeepAlive();
    await setIsAudioActiveAsync(false).catch(() => {});
  });
}
