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
import { dropLeadingWords, wordCount } from "./speechText";

/** Silence after the last recognized word that ends what the user is saying. */
const END_OF_SPEECH_MS = 1_300;
/** An idle session is restarted this often so its recording stays small. */
const RECYCLE_AFTER_MS = 60_000;
const RESTART_DELAY_MS = 150;
const MAX_RESTART_DELAY_MS = 5_000;
const STOP_GRACE_MS = 2_500;
const HEALTHY_SESSION_MS = 5_000;

export interface Utterance {
  /** The on-device transcript. */
  readonly text: string;
  /** Recording of the listening session this utterance ended, when one was kept. */
  readonly audioUri: string | null;
  /** Where the utterance starts in that recording. */
  readonly speechStartedMs: number;
}

export interface ListenerHandlers {
  /** The words heard so far, or null when the user is not speaking. */
  onHearing(text: string | null): void;
  onUtterance(utterance: Utterance): void;
  /** A message to show, or null when listening works again. */
  onProblem(message: string | null): void;
  /** True when `heard` is the app's own voice, or speech that must be ignored right now. */
  shouldIgnore(heard: string): boolean;
  /** False while a restart would disturb playback. */
  canRecycle(): boolean;
}

/**
 * Keeps the microphone open and reports each thing the user says. On-device recognition runs
 * continuously and decides when speech starts and ends; nothing is sent anywhere by this class.
 * Voice processing removes the app's own speech from the microphone signal, so the user can
 * talk over the agent.
 */
export class Listener {
  private running = false;
  private sessionActive = false;
  private sessionStartedAt = 0;
  private audioUri: string | null = null;
  private audioStartedAt = 0;
  private heard = "";
  private heardSince: number | null = null;
  /** Words at the start of this session's transcript that were the app's own voice. */
  private ignoredWords = 0;
  private pending: Utterance | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private recycleTimer: ReturnType<typeof setInterval> | null = null;
  private restartDelay = RESTART_DELAY_MS;
  private voiceProcessing = true;
  private subscriptions: Array<{ remove(): void }> = [];

  constructor(private readonly handlers: ListenerHandlers) {}

  get active(): boolean {
    return this.running;
  }

  /** Asks for microphone and speech permission when needed. False when the user refused. */
  async start(): Promise<boolean> {
    if (this.running) return true;
    const permission = await Recognition.requestPermissionsAsync();
    if (!permission.granted) {
      this.handlers.onProblem(
        "Geef T3 Car toegang tot microfoon en spraakherkenning in Instellingen.",
      );
      return false;
    }
    this.running = true;
    this.subscriptions = [
      Recognition.addListener("start", () => {
        this.sessionActive = true;
        this.sessionStartedAt = Date.now();
        this.handlers.onProblem(null);
      }),
      Recognition.addListener("audiostart", (event) => {
        this.audioUri = event.uri;
        this.audioStartedAt = event.timestamp;
      }),
      Recognition.addListener("result", (event) => this.onResult(event)),
      Recognition.addListener("error", (event) => this.onError(event)),
      Recognition.addListener("end", () => this.onEnd()),
    ];
    this.recycleTimer = setInterval(() => this.recycleIfIdle(), 10_000);
    this.startSession();
    return true;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions = [];
    this.clearTimers();
    if (this.recycleTimer) clearInterval(this.recycleTimer);
    this.recycleTimer = null;
    try {
      Recognition.abort();
    } catch {
      // Not recognizing.
    }
    this.sessionActive = false;
    this.pending = null;
    this.resetHeard();
    this.discardRecording();
  }

  private startSession(): void {
    if (!this.running || this.sessionActive) return;
    this.resetHeard();
    this.ignoredWords = 0;
    this.audioUri = null;
    try {
      Recognition.start({
        lang: getSettings().language,
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        addsPunctuation: true,
        requiresOnDeviceRecognition: Recognition.supportsOnDeviceRecognition(),
        iosVoiceProcessingEnabled: this.voiceProcessing,
        iosCategory: {
          category: AVAudioSessionCategory.playAndRecord,
          categoryOptions: [
            AVAudioSessionCategoryOptions.defaultToSpeaker,
            // The car's hands-free microphone and speakers.
            AVAudioSessionCategoryOptions.allowBluetooth,
          ],
          mode: AVAudioSessionMode.voiceChat,
        },
        // Kept only when OpenAI transcribes; 16 kHz mono keeps the upload small.
        recordingOptions: {
          persist: getSettings().openAiKey !== null,
          outputSampleRate: 16_000,
          outputEncoding: "pcmFormatInt16",
        },
      });
    } catch {
      this.scheduleRestart();
    }
  }

  private onResult(event: ExpoSpeechRecognitionResultEvent): void {
    const raw = event.results[0]?.transcript ?? "";
    const text = dropLeadingWords(raw, this.ignoredWords);
    if (this.pending !== null) {
      // The final result of the utterance being closed.
      if (text) this.pending = { ...this.pending, text };
      return;
    }
    if (!text) return;
    if (this.handlers.shouldIgnore(text)) {
      this.ignoredWords = wordCount(raw);
      this.resetHeard();
      return;
    }
    this.heardSince ??= Date.now();
    this.heard = text;
    this.handlers.onHearing(text);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (event.isFinal) this.finishUtterance();
    else this.silenceTimer = setTimeout(() => this.finishUtterance(), END_OF_SPEECH_MS);
  }

  /** Closes the session so its recording is complete; the utterance is reported on `end`. */
  private finishUtterance(): void {
    if (this.pending !== null || !this.heard) return;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    this.pending = {
      text: this.heard,
      audioUri: this.audioUri,
      speechStartedMs: Math.max(0, (this.heardSince ?? Date.now()) - this.audioStartedAt),
    };
    // The utterance now owns the recording.
    this.audioUri = null;
    try {
      Recognition.stop();
    } catch {
      this.onEnd();
      return;
    }
    this.stopTimer = setTimeout(() => {
      try {
        Recognition.abort();
      } catch {
        // Already ended.
      }
      this.onEnd();
    }, STOP_GRACE_MS);
  }

  private onEnd(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.sessionActive = false;
    // A session that ends right away is failing; back off instead of restarting in a loop.
    this.restartDelay =
      Date.now() - this.sessionStartedAt > HEALTHY_SESSION_MS
        ? RESTART_DELAY_MS
        : Math.min(MAX_RESTART_DELAY_MS, this.restartDelay * 2);
    // A session the recognizer ended itself still reports what was heard.
    const utterance: Utterance | null =
      this.pending ??
      (this.heard
        ? {
            text: this.heard,
            audioUri: this.audioUri,
            speechStartedMs: Math.max(0, (this.heardSince ?? Date.now()) - this.audioStartedAt),
          }
        : null);
    if (utterance !== null) this.audioUri = null;
    this.pending = null;
    this.resetHeard();
    this.discardRecording();
    if (utterance !== null) {
      // Ending on something the user said is a healthy session, however short.
      this.restartDelay = RESTART_DELAY_MS;
      this.handlers.onUtterance(utterance);
    }
    this.scheduleRestart();
  }

  private onError(event: ExpoSpeechRecognitionErrorEvent): void {
    switch (event.error) {
      case "aborted":
      case "no-speech":
      case "speech-timeout":
        return;
      case "not-allowed":
      case "service-not-allowed":
        this.handlers.onProblem("Spraakherkenning is niet toegestaan op dit toestel.");
        this.stop();
        return;
      case "language-not-supported":
        this.handlers.onProblem("Deze taal wordt niet ondersteund door de spraakherkenning.");
        this.stop();
        return;
      case "audio-capture":
        // Voice processing is unavailable on some routes and in the simulator.
        if (this.voiceProcessing) this.voiceProcessing = false;
        else this.handlers.onProblem("De microfoon is niet beschikbaar.");
        break;
      default:
        break;
    }
    this.restartDelay = Math.min(MAX_RESTART_DELAY_MS, this.restartDelay * 2);
    // Some failures arrive without an `end`.
    if (this.sessionActive) setTimeout(() => this.sessionActive && this.onEnd(), 500);
    else this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (!this.running || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.startSession();
    }, this.restartDelay);
  }

  private recycleIfIdle(): void {
    if (
      !this.sessionActive ||
      this.pending !== null ||
      this.heard ||
      Date.now() - this.sessionStartedAt < RECYCLE_AFTER_MS ||
      !this.handlers.canRecycle()
    ) {
      return;
    }
    try {
      Recognition.abort();
    } catch {
      // The next tick tries again.
    }
  }

  private resetHeard(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    const wasHearing = this.heard !== "";
    this.heard = "";
    this.heardSince = null;
    if (wasHearing) this.handlers.onHearing(null);
  }

  private clearTimers(): void {
    for (const timer of [this.silenceTimer, this.stopTimer, this.restartTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.silenceTimer = null;
    this.stopTimer = null;
    this.restartTimer = null;
  }

  private discardRecording(): void {
    const uri = this.audioUri;
    this.audioUri = null;
    deleteRecording(uri);
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
