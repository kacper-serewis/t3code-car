import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

import type { CarLanguage } from "./voice/speechText";

export interface CarSettings {
  /** Language you speak and the agent is read in. */
  readonly language: CarLanguage;
  /** With a key, OpenAI reads replies aloud and transcribes what you say. */
  readonly openAiKey: string | null;
  /** Talking while the agent speaks cuts it off. Off: tap the screen to cut it off. */
  readonly voiceInterrupt: boolean;
}

const KEY = "t3car.settings.v1";

function deviceLanguage(): CarLanguage {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("nl")
      ? "nl-NL"
      : "en-US";
  } catch {
    return "en-US";
  }
}

function load(): CarSettings {
  const defaults: CarSettings = {
    language: deviceLanguage(),
    openAiKey: null,
    voiceInterrupt: true,
  };
  try {
    const raw = SecureStore.getItem(KEY);
    if (!raw) return defaults;
    const stored = JSON.parse(raw) as Partial<CarSettings>;
    return {
      language:
        stored.language === "nl-NL" || stored.language === "en-US"
          ? stored.language
          : defaults.language,
      openAiKey:
        typeof stored.openAiKey === "string" && stored.openAiKey.trim()
          ? stored.openAiKey.trim()
          : null,
      voiceInterrupt: stored.voiceInterrupt !== false,
    };
  } catch {
    return defaults;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function getSettings(): CarSettings {
  return current;
}

export function updateSettings(patch: Partial<CarSettings>): void {
  current = { ...current, ...patch };
  try {
    // The API key lives in the Keychain with the rest; nothing here is synced or backed up in plain text.
    SecureStore.setItem(KEY, JSON.stringify(current));
  } catch {
    // Settings still apply for this launch.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): CarSettings {
  return useSyncExternalStore(subscribe, getSettings);
}
