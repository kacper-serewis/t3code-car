import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

import { detectLanguage, type CarLanguage } from "./voice/speechText";

export type LanguageMode = "auto" | CarLanguage;

export interface CarSettings {
  /** `auto` follows the language being spoken; otherwise one language is fixed. */
  readonly languageMode: LanguageMode;
  /**
   * The language in use right now: the fixed one, or in `auto` the one last heard in the
   * conversation. Derived, never stored.
   */
  readonly language: CarLanguage;
  /** With a key, OpenAI reads replies aloud, and transcribes when the computer cannot. */
  readonly openAiKey: string | null;
  /** The computer's text model cleans up transcripts: punctuation, filler, corrections. */
  readonly cleanup: boolean;
}

const KEY = "t3car.settings.v2";
// v1 stored the device's language as if it had been chosen; only its key is carried over.
const LEGACY_KEY = "t3car.settings.v1";

function deviceLanguage(): CarLanguage {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("nl")
      ? "nl-NL"
      : "en-US";
  } catch {
    return "en-US";
  }
}

function readStored(key: string): Partial<CarSettings> | null {
  try {
    const raw = SecureStore.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<CarSettings>) : null;
  } catch {
    return null;
  }
}

function load(): CarSettings {
  const stored = readStored(KEY);
  const source = stored ?? readStored(LEGACY_KEY);
  const languageMode: LanguageMode =
    stored?.languageMode === "nl-NL" || stored?.languageMode === "en-US"
      ? stored.languageMode
      : "auto";
  return {
    languageMode,
    language: languageMode === "auto" ? deviceLanguage() : languageMode,
    openAiKey:
      typeof source?.openAiKey === "string" && source.openAiKey.trim()
        ? source.openAiKey.trim()
        : null,
    cleanup: stored?.cleanup !== false,
  };
}

let current = load();
const listeners = new Set<() => void>();

export function getSettings(): CarSettings {
  return current;
}

export function updateSettings(
  patch: Partial<Pick<CarSettings, "languageMode" | "openAiKey" | "cleanup">>,
): void {
  const next = { ...current, ...patch };
  current = {
    ...next,
    language:
      next.languageMode !== "auto"
        ? next.languageMode
        : patch.languageMode === "auto"
          ? deviceLanguage()
          : current.language,
  };
  try {
    // The API key lives in the Keychain with the rest; nothing here is synced or backed up in plain text.
    SecureStore.setItem(
      KEY,
      JSON.stringify({
        languageMode: current.languageMode,
        openAiKey: current.openAiKey,
        cleanup: current.cleanup,
      }),
    );
  } catch {
    // Settings still apply for this launch.
  }
  for (const listener of listeners) listener();
}

/** In `auto`, text from the conversation decides which language the app speaks and listens in. */
export function noteConversationText(text: string): void {
  if (current.languageMode !== "auto") return;
  const detected = detectLanguage(text);
  if (detected === null || detected === current.language) return;
  current = { ...current, language: detected };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): CarSettings {
  return useSyncExternalStore(subscribe, getSettings);
}
