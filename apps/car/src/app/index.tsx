import { useAtomValue } from "@effect/atom-react";
import {
  Button,
  ContentUnavailableView,
  Host,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import { buttonStyle, lineLimit } from "@expo/ui/swift-ui/modifiers";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { environmentCatalog } from "@t3tools/mobile/src/connection/catalog";
import { useEnvironments } from "@t3tools/mobile/src/state/environments";
import { environmentThreadShells } from "@t3tools/mobile/src/state/threads";
import { Redirect, Stack, useRouter } from "expo-router";
import { PlatformColor } from "react-native";

import { isTerminalRunStatus } from "../drive/threadFeed";
import { layout, primaryText, secondaryText, subheadline } from "../native";

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

export default function Threads() {
  const router = useRouter();
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const shells = useAtomValue(environmentThreadShells.navigationThreadShellsAtom);
  const { environments } = useEnvironments();

  if (catalog.isReady && catalog.entries.size === 0) return <Redirect href="/connect" />;

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
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="gearshape" onPress={() => router.push("/settings")} />
      </Stack.Toolbar>
      <Host style={layout.fill}>
        {threads.length === 0 ? (
          <ContentUnavailableView
            title={connected ? "Geen threads" : "Verbinden…"}
            systemImage={connected ? "bubble.left.and.bubble.right" : "wifi"}
            description={
              connected
                ? "Start een thread in T3 Code op je computer."
                : "T3 Car zoekt verbinding met je computer."
            }
          />
        ) : (
          <List>
            <Section>
              {threads.map((thread) => {
                const state = threadState(thread);
                return (
                  <Button
                    key={`${thread.environmentId}:${thread.id}`}
                    modifiers={[buttonStyle("plain")]}
                    onPress={() =>
                      router.push({
                        pathname: "/drive/[environmentId]/[threadId]",
                        params: {
                          environmentId: thread.environmentId,
                          threadId: thread.id,
                          title: thread.title,
                        },
                      })
                    }
                  >
                    <HStack spacing={10}>
                      {state === "idle" ? null : (
                        <Image
                          systemName="circle.fill"
                          size={9}
                          color={PlatformColor(state === "waiting" ? "systemRed" : "systemOrange")}
                        />
                      )}
                      <VStack alignment="leading" spacing={2}>
                        <Text modifiers={[primaryText, lineLimit(2)]}>
                          {thread.title || "Naamloze thread"}
                        </Text>
                        <Text modifiers={[secondaryText, subheadline]}>
                          {[STATE_LABEL[state], relativeTime(activityAt(thread))]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </VStack>
                      <Spacer />
                      <Image
                        systemName="chevron.right"
                        size={13}
                        color={PlatformColor("tertiaryLabel")}
                      />
                    </HStack>
                  </Button>
                );
              })}
            </Section>
          </List>
        )}
      </Host>
    </>
  );
}
