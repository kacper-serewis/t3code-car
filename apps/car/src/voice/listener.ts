import { File } from "expo-file-system";
import {
  AVAudioSessionCategory,
  AVAudioSessionCategoryOptions,
  AVAudioSessionMode,
  ExpoSpeechRecognitionModule as Recognition,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from "expo-speech-recognition";

import { getSettings } from "../settings";

/** Silence after the last recognized word that ends what the user is saying. */
const END_OF_SPEECH_MS = 1_300;
/** The microphone closes again when nothing is said for this long. */
const NO_SPEECH_MS = 8_000;
const STOP_GRACE_MS = 2_500;

export interface Utterance {
  /** The on-device transcript. */
  readonly text: string;
  /** Recording of this utterance, when one was kept. */
  readonly audioUri: string | null;
  /** Where the utterance starts in that recording. */
  readonly speechStartedMs: number;
}

export interface ListenerHandlers {
  /** The words heard so far, or null when the user is not speaking. */
  onHearing(text: string | null): void;
  /** The microphone closed, with what the user said or null when they said nothing. */
  onClosed(utterance: Utterance | null): void;
  /** A message to show, or null when listening works. */
  onProblem(message: string | null): void;
}

/**
 * Opens the microphone for one thing the user says. On-device recognition decides when speech
 * starts and ends; nothing is sent anywhere by this class. While it is open the audio session
 * records, which stops other apps' music; closing gives the session back.
 */
export class Listener {
  private open = false;
  private audioUri: string | null = null;
  private audioStartedAt = 0;
  private heard = "";
  private heardSince: number | null = null;
  private finishing = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions: Array<{ remove(): void }> = [];

  constructor(private readonly handlers: ListenerHandlers) {}

  get active(): boolean {
    return this.open;
  }

  /** Asks for microphone and speech permission when needed. False when it could not open. */
  async start(): Promise<boolean> {
    if (this.open) return true;
    const permission = await Recognition.requestPermissionsAsync();
    if (!permission.granted) {
      this.handlers.onProblem(
        "Geef T3 Car toegang tot microfoon en spraakherkenning in Instellingen.",
      );
      return false;
    }
    if (this.open) return true;
    this.open = true;
    this.finishing = false;
    this.heard = "";
    this.heardSince = null;
    this.audioUri = null;
    this.subscriptions = [
      Recognition.addListener("start", () => this.handlers.onProblem(null)),
      Recognition.addListener("audiostart", (event) => {
        this.audioUri = event.uri;
        this.audioStartedAt = event.timestamp;
      }),
      Recognition.addListener("result", (event) => this.onResult(event)),
      Recognition.addListener("error", (event) => this.onError(event)),
      Recognition.addListener("end", () => this.close(true)),
    ];
    try {
      Recognition.start({
        lang: getSettings().language,
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        addsPunctuation: true,
        requiresOnDeviceRecognition: Recognition.supportsOnDeviceRecognition(),
        iosCategory: {
          category: AVAudioSessionCategory.playAndRecord,
          categoryOptions: [
            AVAudioSessionCategoryOptions.defaultToSpeaker,
            // The car's hands-free microphone and speakers.
            AVAudioSessionCategoryOptions.allowBluetooth,
          ],
          mode: AVAudioSessionMode.measurement,
        },
        // The recording is what gets transcribed; 16 kHz mono is what the computer expects.
        recordingOptions: {
          persist: true,
          outputSampleRate: 16_000,
          outputEncoding: "pcmFormatInt16",
        },
      });
    } catch {
      this.handlers.onProblem("De microfoon is niet beschikbaar.");
      this.close(false);
      return false;
    }
    this.silenceTimer = setTimeout(() => this.finish(), NO_SPEECH_MS);
    return true;
  }

  /** Closes the microphone and discards what was being said. */
  cancel(): void {
    if (!this.open) return;
    this.heard = "";
    try {
      Recognition.abort();
    } catch {
      // Not recognizing.
    }
    this.close(false);
  }

  private onResult(event: ExpoSpeechRecognitionResultEvent): void {
    const text = (event.results[0]?.transcript ?? "").trim();
    if (!text) return;
    this.heardSince ??= Date.now();
    this.heard = text;
    if (this.finishing) return;
    this.handlers.onHearing(text);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (event.isFinal) this.finish();
    else this.silenceTimer = setTimeout(() => this.finish(), END_OF_SPEECH_MS);
  }

  /** Ends recognition so the recording is complete; `end` then closes the microphone. */
  private finish(): void {
    if (!this.open || this.finishing) return;
    this.finishing = true;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    try {
      Recognition.stop();
    } catch {
      this.close(true);
      return;
    }
    this.stopTimer = setTimeout(() => {
      try {
        Recognition.abort();
      } catch {
        // Already ended.
      }
      this.close(true);
    }, STOP_GRACE_MS);
  }

  private onError(event: ExpoSpeechRecognitionErrorEvent): void {
    switch (event.error) {
      case "aborted":
      case "no-speech":
      case "speech-timeout":
        break;
      case "not-allowed":
      case "service-not-allowed":
        this.handlers.onProblem("Spraakherkenning is niet toegestaan op dit toestel.");
        break;
      case "language-not-supported":
        this.handlers.onProblem("Deze taal wordt niet ondersteund door de spraakherkenning.");
        break;
      default:
        // The recognizer's own code tells a route problem from a missing language model.
        this.handlers.onProblem(`De microfoon is niet beschikbaar (${event.error}).`);
        break;
    }
    // Some failures arrive without an `end`.
    setTimeout(() => this.close(true), 500);
  }

  private close(report: boolean): void {
    if (!this.open) return;
    this.open = false;
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions = [];
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.silenceTimer = null;
    this.stopTimer = null;
    const utterance: Utterance | null =
      report && this.heard
        ? {
            text: this.heard,
            audioUri: this.audioUri,
            speechStartedMs: Math.max(0, (this.heardSince ?? Date.now()) - this.audioStartedAt),
          }
        : null;
    if (utterance === null) deleteRecording(this.audioUri);
    this.audioUri = null;
    this.heard = "";
    this.handlers.onHearing(null);
    this.handlers.onClosed(utterance);
  }
}

export function deleteRecording(uri: string | null): void {
  if (uri === null) return;
  try {
    new File(uri).delete();
  } catch {
    // The cache is cleared by the system.
  }
}
