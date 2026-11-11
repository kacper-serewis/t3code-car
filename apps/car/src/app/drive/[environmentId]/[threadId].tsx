import { Button, Host, HStack, VStack } from "@expo/ui/swift-ui";
import { buttonStyle, controlSize, frame, tint } from "@expo/ui/swift-ui/modifiers";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useKeepAwake } from "expo-keep-awake";
import { Stack, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useState, useSyncExternalStore } from "react";
import { PlatformColor, Pressable, StyleSheet, Text, View, type ColorValue } from "react-native";

import { DriveSession, type DriveSnapshot } from "../../../drive/driveSession";

const colors = {
  background: PlatformColor("systemBackground"),
  label: PlatformColor("label"),
  secondaryLabel: PlatformColor("secondaryLabel"),
  blue: PlatformColor("systemBlue"),
  red: PlatformColor("systemRed"),
  green: PlatformColor("systemGreen"),
  orange: PlatformColor("systemOrange"),
  purple: PlatformColor("systemPurple"),
  gray: PlatformColor("systemGray"),
} as const;

interface Presented {
  readonly label: string;
  readonly color: ColorValue;
  readonly symbol: SFSymbol;
}

/** The one thing the driver needs to know right now: a color, a symbol and two words. */
function presentState(state: DriveSnapshot): Presented {
  // The microphone comes first: a tap must show at once, whatever else is going on.
  if (state.micOn) return { label: "Ik luister", color: colors.green, symbol: "waveform" };
  if (!state.joined) return { label: "Verbinden…", color: colors.gray, symbol: "wifi" };
  if (state.sending) return { label: "Versturen…", color: colors.blue, symbol: "arrow.up" };
  if (state.speaking) {
    return { label: "Agent spreekt", color: colors.purple, symbol: "speaker.wave.2.fill" };
  }
  if (state.approval !== null || state.question !== null) {
    return { label: "Wacht op jou", color: colors.red, symbol: "exclamationmark" };
  }
  if (state.agentBusy) return { label: "Agent werkt", color: colors.orange, symbol: "ellipsis" };
  return { label: "Tik om te praten", color: colors.gray, symbol: "mic.fill" };
}

export default function Drive() {
  useKeepAwake();
  const params = useLocalSearchParams<{
    environmentId: string;
    threadId: string;
    title?: string;
  }>();
  // One session per screen: it owns the microphone and the voice while the screen is open.
  const [session] = useState(
    () =>
      new DriveSession({
        environmentId: EnvironmentId.make(params.environmentId),
        threadId: ThreadId.make(params.threadId),
      }),
  );

  useEffect(() => {
    session.start();
    return () => session.dispose();
  }, [session]);

  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const presented = presentState(state);
  const question = state.question?.questions.length === 1 ? state.question.questions[0] : undefined;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: params.title ?? "" }} />
      {state.agentBusy ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="stop.fill" onPress={() => session.interrupt()} />
        </Stack.Toolbar>
      ) : null}

      <Pressable
        accessibilityLabel={state.micOn ? "Microfoon uit" : "Praat"}
        // One target for the whole upper half: take the floor, or give it back.
        onPressIn={() => session.tap()}
        style={styles.stage}
      >
        <View style={[styles.orb, { backgroundColor: presented.color }]}>
          <SymbolView name={presented.symbol} size={36} tintColor="#ffffff" />
        </View>
        <Text style={styles.stateLabel}>{presented.label}</Text>
        <Text numberOfLines={5} style={styles.caption}>
          {state.hearing ?? state.notice ?? state.lastSaid ?? ""}
        </Text>
        <Text style={styles.hint}>
          {state.micOn
            ? "Tik om de microfoon te sluiten"
            : state.speaking
              ? "Tik om te onderbreken en te praten"
              : "De microfoon gaat vanzelf aan als de agent op je wacht"}
        </Text>
      </Pressable>

      {state.approval !== null ? (
        <View style={styles.actions}>
          <Text numberOfLines={3} style={styles.caption}>
            {state.approval.reason ?? state.approval.detail ?? "De agent vraagt toestemming."}
          </Text>
          <Host matchContents={{ vertical: true }}>
            <HStack spacing={12}>
              <Button
                label="Weiger"
                role="destructive"
                onPress={() => session.respondToApproval("decline")}
                modifiers={[
                  buttonStyle("glassProminent"),
                  controlSize("extraLarge"),
                  tint(colors.red),
                  frame({ maxWidth: Infinity }),
                ]}
              />
              <Button
                label="Keur goed"
                onPress={() => session.respondToApproval("accept")}
                modifiers={[
                  buttonStyle("glassProminent"),
                  controlSize("extraLarge"),
                  tint(colors.green),
                  frame({ maxWidth: Infinity }),
                ]}
              />
            </HStack>
          </Host>
        </View>
      ) : question !== undefined ? (
        <View style={styles.actions}>
          <Text numberOfLines={3} style={styles.caption}>
            {question.question}
          </Text>
          <Host matchContents={{ vertical: true }}>
            <VStack spacing={10}>
              {question.options.slice(0, 4).map((option) => (
                <Button
                  key={option.value ?? option.label}
                  label={option.label}
                  onPress={() => session.answerQuestion(option.value ?? option.label)}
                  modifiers={[
                    buttonStyle("glass"),
                    controlSize("extraLarge"),
                    frame({ maxWidth: Infinity }),
                  ]}
                />
              ))}
            </VStack>
          </Host>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  orb: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  stateLabel: { color: colors.label, fontSize: 28, fontWeight: "700", textAlign: "center" },
  caption: { color: colors.label, fontSize: 17, lineHeight: 22, textAlign: "center" },
  hint: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18, textAlign: "center" },
  actions: { paddingHorizontal: 20, paddingBottom: 34, gap: 14 },
});
