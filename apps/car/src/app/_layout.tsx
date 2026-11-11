import { RegistryContext } from "@effect/atom-react";
import { CloudAuthProvider } from "@t3tools/mobile/src/features/cloud/CloudAuthProvider";
import { appAtomRegistry } from "@t3tools/mobile/src/state/atom-registry";
import { installThreadOutboxDelivery } from "@t3tools/mobile/src/state/threadOutboxDelivery";
import { Stack } from "expo-router";

// Spoken messages go through the same durable outbox as the T3 Code app's composer.
installThreadOutboxDelivery();

/** The native stack: the system draws the navigation bars, titles and transitions. */
export default function Layout() {
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <CloudAuthProvider>
        <Stack>
          <Stack.Screen name="index" options={{ title: "Threads", headerLargeTitle: true }} />
          <Stack.Screen name="drive/[environmentId]/[threadId]" options={{ title: "" }} />
          <Stack.Screen
            name="settings"
            options={{ title: "Instellingen", presentation: "modal" }}
          />
          <Stack.Screen
            name="connect"
            options={{ title: "Computer koppelen", presentation: "modal" }}
          />
        </Stack>
      </CloudAuthProvider>
    </RegistryContext.Provider>
  );
}
