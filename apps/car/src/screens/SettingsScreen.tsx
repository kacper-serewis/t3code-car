import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { environmentCatalog } from "@t3tools/mobile/src/connection/catalog";
import { hasCloudPublicConfig } from "@t3tools/mobile/src/features/cloud/publicConfig";
import { appAtomRegistry } from "@t3tools/mobile/src/state/atom-registry";
import { useEnvironments } from "@t3tools/mobile/src/state/environments";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet } from "react-native";

import { updateSettings, useSettings, type LanguageMode } from "../settings";
import { FieldRow, LargeTitle, NavBar, NavButton, Row, Screen, Section } from "../ui";
import { checkApiKey } from "../voice/openai";
import { CloudAccount } from "./CloudSection";

// A build-time constant: T3 Connect exists only in builds configured for it.
const cloudEnabled = hasCloudPublicConfig();

const LANGUAGES: ReadonlyArray<{ readonly value: LanguageMode; readonly label: string }> = [
  { value: "auto", label: "Automatisch" },
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
    setKeyStatus("Key bewaard. OpenAI leest voor en verstaat je.");
  };

  const confirmRemove = (
    environmentId: (typeof environments)[number]["environmentId"],
    label: string,
  ) =>
    Alert.alert(`${label} verwijderen?`, "Je kunt de computer later opnieuw koppelen.", [
      { text: "Annuleer", style: "cancel" },
      {
        text: "Verwijder",
        style: "destructive",
        onPress: () =>
          void runAtomCommand(appAtomRegistry, environmentCatalog.remove, environmentId, {
            label: "car:remove-environment",
            reportFailure: true,
          }),
      },
    ]);

  return (
    <Screen>
      <NavBar right={<NavButton bold title="Gereed" onPress={props.onClose} />} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <LargeTitle>Instellingen</LargeTitle>

        <Section
          header="OpenAI API-key"
          footer={
            keyStatus ??
            (settings.openAiKey === null
              ? "Geen key: T3 Car gebruikt nu de stem en spraakherkenning van iOS. Met een key leest OpenAI de agent voor en zet het om wat je zegt. De key staat alleen in de sleutelhanger van dit toestel."
              : "OpenAI is actief: het leest de agent voor en zet om wat je zegt. Zonder bereik valt T3 Car terug op iOS.")
          }
        >
          <Row title="Spraak" detail={settings.openAiKey === null ? "iOS" : "OpenAI"} />
          <FieldRow
            value={keyDraft}
            onChangeText={(value) => {
              setKeyDraft(value);
              setKeyStatus(null);
            }}
            placeholder="sk-…"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Row
            kind={draft || settings.openAiKey === null ? "action" : "destructive"}
            title={
              checking
                ? "Controleren…"
                : draft || settings.openAiKey === null
                  ? "Bewaar"
                  : "Verwijder key"
            }
            disabled={!keyChanged || checking}
            onPress={() => void saveKey()}
          />
        </Section>

        <Section
          header="Taal"
          footer="Automatisch herkent de taal die je spreekt. Kies een vaste taal als dat misgaat."
        >
          {LANGUAGES.map((language) => (
            <Row
              key={language.value}
              title={language.label}
              checked={settings.languageMode === language.value}
              onPress={() => updateSettings({ languageMode: language.value })}
            />
          ))}
        </Section>

        {cloudEnabled ? <CloudAccount onSignIn={props.onAddServer} /> : null}

        <Section header="Computers" footer="Tik op een computer om hem te verwijderen.">
          {environments.map((environment) => (
            <Row
              key={environment.environmentId}
              title={environment.label}
              subtitle={environment.connection.error}
              detail={PHASE_LABEL[environment.connection.phase] ?? environment.connection.phase}
              onPress={() => confirmRemove(environment.environmentId, environment.label)}
            />
          ))}
          <Row kind="action" title="Computer koppelen" onPress={props.onAddServer} />
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 48 },
});
