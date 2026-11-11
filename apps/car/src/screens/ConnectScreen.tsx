import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { connectPairingUrl } from "@t3tools/mobile/src/connection/onboarding";
import { hasCloudPublicConfig } from "@t3tools/mobile/src/features/cloud/publicConfig";
import { extractPairingUrlFromQrPayload } from "@t3tools/mobile/src/features/connection/pairing";
import { appAtomRegistry } from "@t3tools/mobile/src/state/atom-registry";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, ui } from "../theme";
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
      <View style={ui.screen}>
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
        <SafeAreaView style={styles.scanOverlay}>
          <Pressable
            onPress={() => setScanning(false)}
            style={({ pressed }) => [ui.headerButton, pressed && ui.pressed]}
          >
            <Text style={ui.headerButtonText}>Annuleer</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={ui.screen}>
      <View style={ui.header}>
        <Text style={ui.title}>Koppel je computer</Text>
        {props.canClose ? (
          <Pressable
            onPress={props.onClose}
            style={({ pressed }) => [ui.headerButton, pressed && ui.pressed]}
          >
            <Text style={ui.headerButtonText}>Sluit</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {cloudEnabled ? <CloudSection onConnected={props.onConnected} /> : null}
        {cloudEnabled ? <Text style={styles.heading}>Of koppel direct</Text> : null}
        <Text style={ui.body}>
          Open in T3 Code op je computer Settings › Sharing & access en maak een koppellink. Scan de
          QR-code of plak de link hieronder.
        </Text>
        <Pressable
          onPress={() => void startScanning()}
          style={({ pressed }) => [
            ui.bigButton,
            { backgroundColor: colors.accent },
            pressed && ui.pressed,
          ]}
        >
          <Text style={ui.bigButtonText}>Scan QR-code</Text>
        </Pressable>
        <TextInput
          value={link}
          onChangeText={setLink}
          placeholder="Koppellink"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => void connect(link)}
          style={ui.input}
        />
        <Pressable
          disabled={busy || !link.trim()}
          onPress={() => void connect(link)}
          style={({ pressed }) => [
            ui.bigButton,
            { backgroundColor: colors.surfaceRaised },
            (pressed || busy || !link.trim()) && ui.pressed,
          ]}
        >
          <Text style={ui.bigButtonText}>{busy ? "Koppelen…" : "Koppel"}</Text>
        </Pressable>
        {error !== null ? <Text style={[ui.body, { color: colors.danger }]}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48, gap: 16 },
  heading: { color: colors.text, fontSize: 20, fontWeight: "700", marginTop: 16 },
  scanOverlay: { position: "absolute", top: 0, right: 0, padding: 20 },
});
