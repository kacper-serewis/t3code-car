import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useEnvironments } from "@t3tools/mobile/src/state/environments";
import { environmentThreadShells } from "@t3tools/mobile/src/state/threads";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { DriveThreadRef } from "../drive/driveSession";
import { isTerminalRunStatus } from "../drive/threadFeed";
import { colors, ui } from "../theme";

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
const STATE_COLOR: Record<ThreadState, string> = {
  waiting: colors.danger,
  working: colors.working,
  idle: colors.muted,
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
    <SafeAreaView style={ui.screen} edges={["top", "left", "right"]}>
      <View style={ui.header}>
        <Text style={ui.title}>T3 Car</Text>
        <Pressable
          accessibilityLabel="Instellingen"
          onPress={props.onOpenSettings}
          style={({ pressed }) => [ui.headerButton, pressed && ui.pressed]}
        >
          <Text style={ui.headerButtonText}>Instellingen</Text>
        </Pressable>
      </View>
      {!connected ? (
        <Text style={[ui.dim, styles.status]}>
          {environments.length === 0 ? "Geen server gekoppeld." : "Verbinden met je computer…"}
        </Text>
      ) : null}
      <FlatList
        data={threads}
        keyExtractor={(thread) => `${thread.environmentId}:${thread.id}`}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          connected ? (
            <Text style={[ui.dim, styles.status]}>Geen threads gevonden.</Text>
          ) : undefined
        }
        renderItem={({ item }) => {
          const state = threadState(item);
          return (
            <Pressable
              onPress={() =>
                props.onJoin({ environmentId: item.environmentId, threadId: item.id }, item.title)
              }
              style={({ pressed }) => [styles.row, pressed && ui.pressed]}
            >
              <View style={[styles.dot, { backgroundColor: STATE_COLOR[state] }]} />
              <View style={styles.rowText}>
                <Text numberOfLines={2} style={styles.rowTitle}>
                  {item.title || "Naamloze thread"}
                </Text>
                <Text style={ui.dim}>
                  {[STATE_LABEL[state], relativeTime(activityAt(item))].filter(Boolean).join(" · ")}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  status: { paddingHorizontal: 20, paddingVertical: 12 },
  list: { paddingHorizontal: 12, paddingBottom: 40, gap: 8 },
  row: {
    minHeight: 84,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { color: colors.text, fontSize: 21, fontWeight: "600", lineHeight: 27 },
});
