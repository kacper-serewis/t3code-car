import { createAudioPlayer } from "expo-audio";
import type { File } from "expo-file-system";
import * as Speech from "expo-speech";

import { getSettings } from "../settings";
import { synthesizeSpeech } from "./openai";
import { splitForSpeech } from "./speechText";

/** How long spoken text stays relevant for telling the app's own voice from the user's. */
const RECENT_MS = 12_000;

interface Prepared {
  readonly text: string;
  /** Audio from OpenAI; null means the system voice reads the text. */
  readonly audio: Promise<File | null>;
}

/**
 * Reads text aloud in order. With an OpenAI key the next sentence is synthesized while the
 * current one plays; without one, or when OpenAI cannot be reached, the system voice reads it.
 */
export class Speaker {
  private readonly queue: string[] = [];
  private generation = 0;
  private pumping = false;
  private stopCurrent: (() => void) | null = null;
  private abort: AbortController | null = null;
  private waiters: Array<() => void> = [];
  private recent: Array<{ readonly text: string; readonly at: number }> = [];
  private isSpeaking = false;

  constructor(private readonly onSpeakingChange: (speaking: boolean) => void) {}

  get speaking(): boolean {
    return this.isSpeaking;
  }

  /** What was said in the last seconds, for recognizing echo of the app's own voice. */
  recentText(): string {
    const cutoff = Date.now() - RECENT_MS;
    this.recent = this.recent.filter((entry) => entry.at >= cutoff);
    return this.recent.map((entry) => entry.text).join(" ");
  }

  say(text: string): void {
    for (const part of splitForSpeech(text)) this.queue.push(part);
    void this.pump();
  }

  /** Drops everything queued and cuts off the current sentence. */
  stop(): void {
    this.generation += 1;
    this.queue.length = 0;
    this.abort?.abort();
    this.abort = null;
    this.stopCurrent?.();
    if (!this.pumping) this.settle();
  }

  /** Resolves once everything queued so far has been spoken or stopped. */
  drained(): Promise<void> {
    if (!this.pumping && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private setSpeaking(value: boolean) {
    if (this.isSpeaking === value) return;
    this.isSpeaking = value;
    this.onSpeakingChange(value);
  }

  private settle() {
    this.setSpeaking(false);
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  private prepare(text: string): Prepared {
    const apiKey = getSettings().openAiKey;
    if (apiKey === null) return { text, audio: Promise.resolve(null) };
    this.abort ??= new AbortController();
    return {
      text,
      // A failed request falls back to the system voice for this sentence.
      audio: synthesizeSpeech(apiKey, text, this.abort.signal).catch(() => null),
    };
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    const generation = this.generation;
    try {
      let next: Prepared | null = null;
      while (generation === this.generation && (next !== null || this.queue.length > 0)) {
        const current: Prepared = next ?? this.prepare(this.queue.shift()!);
        next = this.queue.length > 0 ? this.prepare(this.queue.shift()!) : null;
        const audio = await current.audio;
        if (generation !== this.generation) {
          discard(audio);
          break;
        }
        this.setSpeaking(true);
        this.recent.push({ text: current.text, at: Date.now() });
        if (audio !== null) await this.play(audio);
        else await this.speakWithSystemVoice(current.text);
        // Text queued while this sentence played.
        if (next === null && generation === this.generation && this.queue.length > 0) {
          next = this.prepare(this.queue.shift()!);
        }
      }
      if (next !== null) void next.audio.then(discard);
    } finally {
      this.pumping = false;
      // Text queued after a stop belongs to the next generation and still needs a pump.
      if (this.queue.length > 0) void this.pump();
      else this.settle();
    }
  }

  private play(file: File): Promise<void> {
    return new Promise((resolve) => {
      const player = createAudioPlayer(file.uri, { updateInterval: 200 });
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        this.stopCurrent = null;
        subscription.remove();
        try {
          player.pause();
          player.remove();
        } catch {
          // Already released.
        }
        discard(file);
        resolve();
      };
      const subscription = player.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish) finish();
      });
      this.stopCurrent = finish;
      try {
        player.play();
      } catch {
        finish();
      }
    });
  }

  private speakWithSystemVoice(text: string): Promise<void> {
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        this.stopCurrent = null;
        resolve();
      };
      this.stopCurrent = () => {
        void Speech.stop();
        finish();
      };
      Speech.speak(text, {
        language: getSettings().language,
        // Share the listening session, so the microphone's echo cancellation hears this voice.
        useApplicationAudioSession: true,
        onDone: finish,
        onStopped: finish,
        onError: finish,
      });
    });
  }
}

function discard(file: File | null): void {
  if (file === null) return;
  try {
    file.delete();
  } catch {
    // The cache is cleared by the system.
  }
}
