import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { environmentCatalog } from "@t3tools/mobile/src/connection/catalog";
import { appAtomRegistry } from "@t3tools/mobile/src/state/atom-registry";
import { installThreadOutboxDelivery } from "@t3tools/mobile/src/state/threadOutboxDelivery";
import { useState } from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { DriveThreadRef } from "./drive/driveSession";
import { ConnectScreen } from "./screens/ConnectScreen";
import { DriveScreen } from "./screens/DriveScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { ThreadPickerScreen } from "./screens/ThreadPickerScreen";

// Spoken messages go through the same durable outbox as the T3 Code app's composer.
installThreadOutboxDelivery();

type Route =
  | { readonly name: "threads" }
  | { readonly name: "connect" }
  | { readonly name: "settings" }
  | { readonly name: "drive"; readonly thread: DriveThreadRef; readonly title: string };

export default function App() {
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" />
        <Screens />
      </SafeAreaProvider>
    </RegistryContext.Provider>
  );
}

function Screens() {
  const [route, setRoute] = useState<Route>({ name: "threads" });
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const unpaired = catalog.isReady && catalog.entries.size === 0;

  if (route.name === "drive") {
    return (
      <DriveScreen
        // A new session per thread: nothing carries over from the previous conversation.
        key={`${route.thread.environmentId}:${route.thread.threadId}`}
        thread={route.thread}
        title={route.title}
        onLeave={() => setRoute({ name: "threads" })}
      />
    );
  }
  if (route.name === "settings") {
    return (
      <SettingsScreen
        onClose={() => setRoute({ name: "threads" })}
        onAddServer={() => setRoute({ name: "connect" })}
      />
    );
  }
  if (route.name === "connect" || unpaired) {
    return (
      <ConnectScreen
        canClose={!unpaired}
        onClose={() => setRoute({ name: "threads" })}
        onConnected={() => setRoute({ name: "threads" })}
      />
    );
  }
  return (
    <ThreadPickerScreen
      onOpenSettings={() => setRoute({ name: "settings" })}
      onJoin={(thread, title) => setRoute({ name: "drive", thread, title })}
    />
  );
}
