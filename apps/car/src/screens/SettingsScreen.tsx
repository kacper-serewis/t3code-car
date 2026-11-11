import { useEnvironments } from "@t3tools/mobile/src/state/environments";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { updateSettings, useSettings } from "../settings";
import { colors, ui } from "../theme";
import { checkApiKey } from "../voice/openai";
import type { CarLanguage } from "../voice/speechText";

const LANGUAGES: ReadonlyArray<{ readonly value: CarLanguage; readonly label: string }> = [
  { value: "nl-NL", label: "Nederlands" },
  { value: "en-US", label: "English" },
];

const PHASE_LABEL: Record<string, string> = {
  connected: "Verbonden",
  connecting: "Verbinden…",
  reconnecting: "Opnieuw verbinden…",
  offline: "Offline",
  available: "Niet verbonden",
};

export function SettingsScreen(props: {
  readonly onClose: () => void;
  readonly onAddServer: () => void;
}) {
  const settings = useSettings();
  const { environments } = useEnvironments();
  const [keyDraft, setKeyDraft] = useState(settings.openAiKey ?? "");
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const draft = keyDraft.trim();
  const keyChanged = draft !== (settings.openAiKey ?? "");

  const saveKey = async () => {
    if (!draft) {
      updateSettings({ openAiKey: null });
      setKeyStatus("Key verwijderd. T3 Car gebruikt de stem en herkenning van iOS.");
      return;
    }
    setChecking(true);
    setKeyStatus(null);
    const problem = await checkApiKey(draft);
    setChecking(false);
    if (problem !== null) {
      setKeyStatus(problem);
      return;
    }
    updateSettings({ openAiKey: draft });
    setKeyStatus("Key opgeslagen. OpenAI leest voor en verstaat je.");
  };

  return (
    <SafeAreaView style={ui.screen}>
      <View style={ui.header}>
        <Text style={ui.title}>Instellingen</Text>
        <Pressable
          onPress={props.onClose}
          style={({ pressed }) => [ui.headerButton, pressed && ui.pressed]}
        >
          <Text style={ui.headerButtonText}>Klaar</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={styles.heading}>OpenAI API-key</Text>
          <Text style={ui.dim}>
            Met een key leest OpenAI de agent voor en zet het om wat je zegt (Whisper). Zonder key,
            of zonder bereik, gebruikt T3 Car de stem en spraakherkenning van iOS. De key staat
            alleen in de sleutelhanger van dit toestel.
          </Text>
          <TextInput
            value={keyDraft}
            onChangeText={(value) => {
              setKeyDraft(value);
              setKeyStatus(null);
            }}
            placeholder="sk-…"
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={ui.input}
          />
          <Pressable
            disabled={!keyChanged || checking}
            onPress={() => void saveKey()}
            style={({ pressed }) => [
              ui.bigButton,
              styles.compactButton,
              { backgroundColor: colors.accent },
              (pressed || !keyChanged || checking) && ui.pressed,
            ]}
          >
            <Text style={ui.bigButtonText}>
              {checking ? "Controleren…" : draft ? "Opslaan" : "Verwijder key"}
            </Text>
          </Pressable>
          {keyStatus !== null ? <Text style={ui.body}>{keyStatus}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Taal</Text>
          <View style={styles.row}>
            {LANGUAGES.map((language) => (
              <Pressable
                key={language.value}
                onPress={() => updateSettings({ language: language.value })}
                style={({ pressed }) => [
                  ui.bigButton,
                  styles.compactButton,
                  styles.flex,
                  {
                    backgroundColor:
                      settings.language === language.value ? colors.accent : colors.surfaceRaised,
                  },
                  pressed && ui.pressed,
                ]}
              >
                <Text style={ui.bigButtonText}>{language.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Computers</Text>
          {environments.map((environment) => (
            <View key={environment.environmentId} style={styles.environment}>
              <Text style={ui.body}>{environment.label}</Text>
              <Text style={ui.dim}>
                {PHASE_LABEL[environment.connection.phase] ?? environment.connection.phase}
                {environment.connection.error ? ` · ${environment.connection.error}` : ""}
              </Text>
            </View>
          ))}
          <Pressable
            onPress={props.onAddServer}
            style={({ pressed }) => [
              ui.bigButton,
              styles.compactButton,
              { backgroundColor: colors.surfaceRaised },
              pressed && ui.pressed,
            ]}
          >
            <Text style={ui.bigButtonText}>Computer koppelen</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 48, gap: 28 },
  section: { gap: 12 },
  heading: { color: colors.text, fontSize: 20, fontWeight: "700" },
  row: { flexDirection: "row", gap: 12 },
  flex: { flex: 1 },
  compactButton: { minHeight: 60 },
  environment: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surface,
    gap: 2,
  },
});
