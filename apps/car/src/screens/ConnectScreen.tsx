import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { connectPairingUrl } from "@t3tools/mobile/src/connection/onboarding";
import { hasCloudPublicConfig } from "@t3tools/mobile/src/features/cloud/publicConfig";
import { extractPairingUrlFromQrPayload } from "@t3tools/mobile/src/features/connection/pairing";
import { appAtomRegistry } from "@t3tools/mobile/src/state/atom-registry";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FieldRow, LargeTitle, NavBar, NavButton, Row, Screen, Section } from "../ui";
import { CloudSection } from "./CloudSection";

// A build-time constant: T3 Connect exists only in builds configured for it.
const cloudEnabled = hasCloudPublicConfig();

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Koppelen is mislukt. Controleer de link en of je computer bereikbaar is.";
}

export function ConnectScreen(props: {
  readonly canClose: boolean;
  readonly onClose: () => void;
  readonly onConnected: () => void;
}) {
  const [link, setLink] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const connect = async (pairingUrl: string) => {
    const trimmed = pairingUrl.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    const result = await runAtomCommand(
      appAtomRegistry,
      connectPairingUrl,
      { pairingUrl: trimmed },
      { label: "car:connect-pairing-url", reportFailure: false },
    );
    setBusy(false);
    if (result._tag === "Success") props.onConnected();
    else setError(failureMessage(squashAtomCommandFailure(result)));
  };

  const startScanning = async () => {
    setError(null);
    const granted = permission?.granted ?? (await requestPermission()).granted;
    if (granted) setScanning(true);
    else setError("Geef T3 Car toegang tot de camera om de koppelcode te scannen.");
  };

  if (scanning) {
    return (
      <View style={styles.scanner}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => {
            setScanning(false);
            try {
              const pairingUrl = extractPairingUrlFromQrPayload(data);
              setLink(pairingUrl);
              void connect(pairingUrl);
            } catch (cause) {
              setError(failureMessage(cause));
            }
          }}
        />
        <SafeAreaView>
          <NavBar left={<NavButton title="Annuleer" onPress={() => setScanning(false)} />} />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <Screen>
      <NavBar
        right={
          props.canClose ? <NavButton bold title="Gereed" onPress={props.onClose} /> : undefined
        }
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <LargeTitle>Computer koppelen</LargeTitle>
        {cloudEnabled ? <CloudSection onConnected={props.onConnected} /> : null}
        <Section
          header={cloudEnabled ? "Direct koppelen" : undefined}
          footer={
            error ??
            "Maak in T3 Code op je computer een koppellink onder Settings › Sharing & access. Scan de QR-code of plak de link."
          }
        >
          <Row kind="action" title="Scan QR-code" onPress={() => void startScanning()} />
          <FieldRow
            value={link}
            onChangeText={setLink}
            placeholder="Koppellink"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => void connect(link)}
          />
          <Row
            kind="action"
            title={busy ? "Koppelen…" : "Koppel"}
            disabled={busy || !link.trim()}
            onPress={() => void connect(link)}
          />
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 48 },
  scanner: { flex: 1, backgroundColor: "#000000" },
});
