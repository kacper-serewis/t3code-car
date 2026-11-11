import { useKeepAwake } from "expo-keep-awake";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DriveSession, type DriveSnapshot, type DriveThreadRef } from "../drive/driveSession";
import { colors, ui } from "../theme";

/** The one thing the driver needs to know right now, as a color and two words. */
function presentState(state: DriveSnapshot): { readonly label: string; readonly color: string } {
  if (!state.joined) return { label: "Verbinden…", color: colors.muted };
  if (state.micOn) return { label: "Ik luister", color: colors.listening };
  if (state.sending) return { label: "Versturen…", color: colors.accent };
  if (state.speaking) return { label: "Agent spreekt", color: colors.speaking };
  if (state.approval !== null || state.question !== null) {
    return { label: "Wacht op jou", color: colors.danger };
  }
  if (state.agentBusy) return { label: "Agent werkt", color: colors.working };
  return { label: "Tik om te praten", color: colors.muted };
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
    <SafeAreaView style={ui.screen}>
      <View style={ui.header}>
        <Pressable
          accessibilityLabel="Terug naar threads"
          onPress={props.onLeave}
          style={({ pressed }) => [ui.headerButton, pressed && ui.pressed]}
        >
          <Text style={ui.headerButtonText}>‹ Threads</Text>
        </Pressable>
        <Text numberOfLines={1} style={[ui.dim, styles.threadTitle]}>
          {props.title}
        </Text>
      </View>

      <Pressable
        accessibilityLabel={state.micOn ? "Microfoon uit" : "Praat"}
        // One target for the whole upper half: take the floor, or give it back.
        onPress={() => session.tap()}
        style={styles.stage}
      >
        <View style={[styles.orb, { backgroundColor: presented.color }]} />
        <Text style={styles.stateLabel}>{presented.label}</Text>
        <Text numberOfLines={4} style={styles.caption}>
          {state.hearing ?? state.notice ?? state.lastSaid ?? ""}
        </Text>
        <Text style={[ui.dim, styles.hint]}>
          {state.micOn
            ? "Tik om de microfoon te sluiten"
            : state.speaking
              ? "Tik om te onderbreken en te praten"
              : "De microfoon gaat vanzelf aan als de agent iets vraagt"}
        </Text>
      </Pressable>

      <View style={styles.actions}>
        {state.approval !== null ? (
          <>
            <Text numberOfLines={3} style={ui.body}>
              {state.approval.reason ?? state.approval.detail ?? "De agent vraagt toestemming."}
            </Text>
            <View style={styles.row}>
              <Pressable
                onPress={() => session.respondToApproval("decline")}
                style={({ pressed }) => [
                  ui.bigButton,
                  styles.half,
                  { backgroundColor: colors.danger },
                  pressed && ui.pressed,
                ]}
              >
                <Text style={ui.bigButtonText}>Weiger</Text>
              </Pressable>
              <Pressable
                onPress={() => session.respondToApproval("accept")}
                style={({ pressed }) => [
                  ui.bigButton,
                  styles.half,
                  { backgroundColor: colors.approve },
                  pressed && ui.pressed,
                ]}
              >
                <Text style={ui.bigButtonText}>Keur goed</Text>
              </Pressable>
            </View>
          </>
        ) : question !== undefined ? (
          <>
            <Text numberOfLines={3} style={ui.body}>
              {question.question}
            </Text>
            {question.options.slice(0, 4).map((option) => (
              <Pressable
                key={option.value ?? option.label}
                onPress={() => session.answerQuestion(option.value ?? option.label)}
                style={({ pressed }) => [
                  ui.bigButton,
                  styles.option,
                  { backgroundColor: colors.surfaceRaised },
                  pressed && ui.pressed,
                ]}
              >
                <Text numberOfLines={1} style={ui.bigButtonText}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </>
        ) : state.agentBusy ? (
          <Pressable
            onPress={() => session.interrupt()}
            style={({ pressed }) => [
              ui.bigButton,
              { backgroundColor: colors.surfaceRaised },
              pressed && ui.pressed,
            ]}
          >
            <Text style={ui.bigButtonText}>Stop agent</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  threadTitle: { flex: 1, textAlign: "right" },
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    paddingHorizontal: 24,
  },
  orb: { width: 190, height: 190, borderRadius: 95 },
  stateLabel: { color: colors.text, fontSize: 40, fontWeight: "800", textAlign: "center" },
  caption: { color: colors.text, fontSize: 22, lineHeight: 30, textAlign: "center", minHeight: 60 },
  hint: { textAlign: "center" },
  actions: { paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  row: { flexDirection: "row", gap: 12 },
  half: { flex: 1, minHeight: 96 },
  option: { minHeight: 68 },
});
