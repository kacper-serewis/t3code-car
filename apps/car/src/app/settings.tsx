import {
  Button,
  Form,
  Host,
  HStack,
  LabeledContent,
  Picker,
  Section,
  SecureField,
  Spacer,
  Text,
  Toggle,
} from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  buttonStyle,
  disabled,
  pickerStyle,
  tag,
  textInputAutocapitalization,
} from "@expo/ui/swift-ui/modifiers";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { environmentCatalog } from "@t3tools/mobile/src/connection/catalog";
import { hasCloudPublicConfig } from "@t3tools/mobile/src/features/cloud/publicConfig";
import { appAtomRegistry } from "@t3tools/mobile/src/state/atom-registry";
import { useEnvironments } from "@t3tools/mobile/src/state/environments";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

import { CloudAccount } from "../cloud";
import { footnote, layout, primaryText, secondaryText, subheadline } from "../native";
import { updateSettings, useSettings, type LanguageMode } from "../settings";
import { checkApiKey } from "../voice/openai";

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

function Footer(props: { readonly children: string }) {
  return <Text modifiers={[footnote, secondaryText]}>{props.children}</Text>;
}

export default function Settings() {
  const router = useRouter();
  const settings = useSettings();
  const { environments } = useEnvironments();
  const [keyDraft, setKeyDraft] = useState("");
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const draft = keyDraft.trim();
  const hasKey = settings.openAiKey !== null;

  const saveKey = async () => {
    setChecking(true);
    setKeyStatus(null);
    const problem = await checkApiKey(draft);
    setChecking(false);
    if (problem !== null) {
      setKeyStatus(problem);
      return;
    }
    updateSettings({ openAiKey: draft });
    setKeyStatus("Key bewaard.");
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
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="checkmark" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Host style={layout.fill}>
        <Form>
          <Section
            title="Verstaan"
            footer={
              <Footer>
                Wat je zegt gaat via T3 Code op je computer naar OpenAI, met het gedeelde
                woordenboek van je computer. Opschonen zet leestekens goed, haalt "eh" weg en
                verwerkt gesproken correcties. Is je computer niet bereikbaar, dan gebruikt T3 Car
                de key hieronder of iOS.
              </Footer>
            }
          >
            <LabeledContent label="Via">
              <Text>Je computer</Text>
            </LabeledContent>
            <Toggle
              label="Opschonen"
              isOn={settings.cleanup}
              onIsOnChange={(cleanup) => updateSettings({ cleanup })}
            />
          </Section>

          <Section
            title="Voorlezen"
            footer={
              <Footer>
                {keyStatus ??
                  (hasKey
                    ? "OpenAI leest de agent voor. Zonder bereik valt T3 Car terug op de stem van iOS."
                    : "Met een OpenAI API-key leest OpenAI de agent voor, anders de stem van iOS. De key staat alleen in de sleutelhanger van dit toestel.")}
              </Footer>
            }
          >
            <LabeledContent label="Stem">
              <Text>{hasKey ? "OpenAI" : "iOS"}</Text>
            </LabeledContent>
            <SecureField
              placeholder={hasKey ? "Nieuwe OpenAI API-key" : "OpenAI API-key"}
              onTextChange={(value) => {
                setKeyDraft(value);
                setKeyStatus(null);
              }}
              modifiers={[textInputAutocapitalization("never"), autocorrectionDisabled()]}
            />
            <Button
              label={checking ? "Controleren…" : "Bewaar key"}
              onPress={() => void saveKey()}
              modifiers={[disabled(!draft || checking)]}
            />
            {hasKey ? (
              <Button
                label="Verwijder key"
                role="destructive"
                onPress={() => {
                  updateSettings({ openAiKey: null });
                  setKeyStatus("Key verwijderd. T3 Car leest voor met de stem van iOS.");
                }}
              />
            ) : null}
          </Section>

          <Section
            title="Taal"
            footer={
              <Footer>
                Automatisch herkent de taal die je spreekt. Kies een vaste taal als dat misgaat.
              </Footer>
            }
          >
            <Picker
              label="Taal"
              selection={settings.languageMode}
              onSelectionChange={(languageMode: LanguageMode) => updateSettings({ languageMode })}
              modifiers={[pickerStyle("menu")]}
            >
              {LANGUAGES.map((language) => (
                <Text key={language.value} modifiers={[tag(language.value)]}>
                  {language.label}
                </Text>
              ))}
            </Picker>
          </Section>

          {cloudEnabled ? <CloudAccount onSignIn={() => router.replace("/connect")} /> : null}

          <Section
            title="Computers"
            footer={<Footer>Tik op een computer om hem te verwijderen.</Footer>}
          >
            {environments.map((environment) => (
              <Button
                key={environment.environmentId}
                modifiers={[buttonStyle("plain")]}
                onPress={() => confirmRemove(environment.environmentId, environment.label)}
              >
                <HStack spacing={10}>
                  <Text modifiers={[primaryText]}>{environment.label}</Text>
                  <Spacer />
                  <Text modifiers={[secondaryText, subheadline]}>
                    {environment.connection.error ??
                      PHASE_LABEL[environment.connection.phase] ??
                      environment.connection.phase}
                  </Text>
                </HStack>
              </Button>
            ))}
            <Button label="Computer koppelen" onPress={() => router.replace("/connect")} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
