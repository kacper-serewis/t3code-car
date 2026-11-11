import { useKeepAwake } from "expo-keep-awake";
import type { SFSymbol } from "expo-symbols";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View, type ColorValue } from "react-native";

import { DriveSession, type DriveSnapshot, type DriveThreadRef } from "../drive/driveSession";
import { Button, colors, NavBar, NavButton, Row, Screen, Section, Symbol, text } from "../ui";

interface Presented {
  readonly label: string;
  readonly color: ColorValue;
  readonly symbol: SFSymbol;
}

/** The one thing the driver needs to know right now: a color, a symbol and two words. */
function presentState(state: DriveSnapshot): Presented {
  if (!state.joined) return { label: "Verbinden…", color: colors.gray, symbol: "wifi" };
  if (state.micOn) return { label: "Ik luister", color: colors.green, symbol: "waveform" };
  if (state.sending) return { label: "Versturen…", color: colors.tint, symbol: "arrow.up" };
  if (state.speaking) {
    return { label: "Agent spreekt", color: colors.purple, symbol: "speaker.wave.2.fill" };
  }
  if (state.approval !== null || state.question !== null) {
    return { label: "Wacht op jou", color: colors.red, symbol: "exclamationmark" };
  }
  if (state.agentBusy) return { label: "Agent werkt", color: colors.orange, symbol: "ellipsis" };
  return { label: "Tik om te praten", color: colors.gray, symbol: "mic.fill" };
}

export function DriveScreen(props: {
  readonly thread: DriveThreadRef;
  readonly title: string;
  readonly onLeave: () => void;
}) {
  useKeepAwake();
  // The screen is keyed by thread, so one session lives exactly as long as it is open.
  const [session] = useState(() => new DriveSession(props.thread));

  useEffect(() => {
    session.start();
    return () => session.dispose();
  }, [session]);

  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const presented = presentState(state);
  const question = state.question?.questions.length === 1 ? state.question.questions[0] : undefined;

  return (
    <Screen>
      <NavBar
        title={props.title}
        left={<NavButton back title="Threads" onPress={props.onLeave} />}
      />

      <Pressable
        accessibilityLabel={state.micOn ? "Microfoon uit" : "Praat"}
        // One target for the whole upper half: take the floor, or give it back.
        onPress={() => session.tap()}
        style={styles.stage}
      >
        <View style={[styles.orb, { backgroundColor: presented.color }]}>
          <Symbol name={presented.symbol} size={36} color="#ffffff" />
        </View>
        <Text style={styles.stateLabel}>{presented.label}</Text>
        <Text numberOfLines={5} style={[text.body, styles.caption]}>
          {state.hearing ?? state.notice ?? state.lastSaid ?? ""}
        </Text>
        <Text style={[text.footnote, styles.caption]}>
          {state.micOn
            ? "Tik om de microfoon te sluiten"
            : state.speaking
              ? "Tik om te onderbreken en te praten"
              : "De microfoon gaat vanzelf aan als de agent op je wacht"}
        </Text>
      </Pressable>

      {state.approval !== null ? (
        <View style={styles.actions}>
          <Text numberOfLines={3} style={text.body}>
            {state.approval.reason ?? state.approval.detail ?? "De agent vraagt toestemming."}
          </Text>
          <View style={styles.buttons}>
            <Button
              flex
              title="Weiger"
              color={colors.red}
              onPress={() => session.respondToApproval("decline")}
            />
            <Button
              flex
              title="Keur goed"
              color={colors.green}
              onPress={() => session.respondToApproval("accept")}
            />
          </View>
        </View>
      ) : question !== undefined ? (
        <View style={styles.questionActions}>
          <Section header={question.question}>
            {question.options.slice(0, 4).map((option) => (
              <Row
                key={option.value ?? option.label}
                kind="action"
                title={option.label}
                onPress={() => session.answerQuestion(option.value ?? option.label)}
              />
            ))}
          </Section>
        </View>
      ) : state.agentBusy ? (
        <View style={styles.questionActions}>
          <Section>
            <Row kind="destructive" title="Stop agent" onPress={() => session.interrupt()} />
          </Section>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  orb: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  stateLabel: { color: colors.label, fontSize: 28, fontWeight: "700", textAlign: "center" },
  caption: { textAlign: "center" },
  actions: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  buttons: { flexDirection: "row", gap: 12 },
  questionActions: { paddingBottom: 12 },
});
