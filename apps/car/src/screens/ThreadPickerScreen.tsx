import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useEnvironments } from "@t3tools/mobile/src/state/environments";
import { environmentThreadShells } from "@t3tools/mobile/src/state/threads";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import type { DriveThreadRef } from "../drive/driveSession";
import { isTerminalRunStatus } from "../drive/threadFeed";
import { colors, LargeTitle, NavBar, NavButton, Row, Screen, Section, text } from "../ui";

const MAX_THREADS = 40;

type ThreadState = "waiting" | "working" | "idle";

function threadState(thread: EnvironmentThreadShell): ThreadState {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "waiting";
  if (thread.latestRun !== null && !isTerminalRunStatus(thread.latestRun.status)) return "working";
  return "idle";
}

const STATE_ORDER: Record<ThreadState, number> = { waiting: 0, working: 1, idle: 2 };
const STATE_LABEL: Record<ThreadState, string> = {
  waiting: "Wacht op jou",
  working: "Bezig",
  idle: "",
};

function activityAt(thread: EnvironmentThreadShell): string {
  return thread.latestUserMessageAt ?? thread.updatedAt;
}

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "nu";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} u`;
  return `${Math.round(hours / 24)} d`;
}

export function ThreadPickerScreen(props: {
  readonly onOpenSettings: () => void;
  readonly onJoin: (thread: DriveThreadRef, title: string) => void;
}) {
  const shells = useAtomValue(environmentThreadShells.navigationThreadShellsAtom);
  const { environments } = useEnvironments();
  // Threads that need you first, then the ones at work, then the most recent.
  // Hermes has no Array.prototype.toSorted.
  const threads = [...shells]
    .sort(
      (left, right) =>
        STATE_ORDER[threadState(left)] - STATE_ORDER[threadState(right)] ||
        activityAt(right).localeCompare(activityAt(left)),
    )
    .slice(0, MAX_THREADS);
  const connected = environments.some(
    (environment) => environment.connection.phase === "connected",
  );

  return (
    <Screen>
      <NavBar right={<NavButton title="Instellingen" onPress={props.onOpenSettings} />} />
      <ScrollView contentContainerStyle={styles.content}>
        <LargeTitle>Threads</LargeTitle>
        {threads.length > 0 ? (
          <Section>
            {threads.map((thread) => {
              const state = threadState(thread);
              return (
                <Row
                  key={`${thread.environmentId}:${thread.id}`}
                  title={thread.title || "Naamloze thread"}
                  titleLines={2}
                  subtitle={[STATE_LABEL[state], relativeTime(activityAt(thread))]
                    .filter(Boolean)
                    .join(" · ")}
                  chevron
                  leading={
                    state === "idle" ? undefined : (
                      <View
                        style={[
                          styles.dot,
                          { backgroundColor: state === "waiting" ? colors.red : colors.orange },
                        ]}
                      />
                    )
                  }
                  onPress={() =>
                    props.onJoin(
                      { environmentId: thread.environmentId, threadId: thread.id },
                      thread.title,
                    )
                  }
                />
              );
            })}
          </Section>
        ) : (
          <Text style={[text.secondary, styles.empty]}>
            {environments.length === 0
              ? "Geen computer gekoppeld."
              : connected
                ? "Geen threads gevonden."
                : "Verbinden met je computer…"}
          </Text>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  empty: { paddingHorizontal: 20, paddingTop: 12 },
});
