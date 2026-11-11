import { useAtomValue } from "@effect/atom-react";
import { Button, Form, Host, Section, Text, TextField } from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  disabled,
  keyboardType,
  onSubmit,
  textInputAutocapitalization,
} from "@expo/ui/swift-ui/modifiers";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { environmentCatalog } from "@t3tools/mobile/src/connection/catalog";
import { connectPairingUrl } from "@t3tools/mobile/src/connection/onboarding";
import { hasCloudPublicConfig } from "@t3tools/mobile/src/features/cloud/publicConfig";
import { extractPairingUrlFromQrPayload } from "@t3tools/mobile/src/features/connection/pairing";
import { appAtomRegistry } from "@t3tools/mobile/src/state/atom-registry";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";

import { CloudSection } from "../cloud";
import { footnote, layout, secondaryText } from "../native";

// A build-time constant: T3 Connect exists only in builds configured for it.
const cloudEnabled = hasCloudPublicConfig();

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Koppelen is mislukt. Controleer de link en of je computer bereikbaar is.";
}

export default function Connect() {
  const router = useRouter();
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const [link, setLink] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const paired = catalog.entries.size > 0;
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

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
    if (result._tag === "Success") close();
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
      <>
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="xmark" onPress={() => setScanning(false)} />
        </Stack.Toolbar>
        <CameraView
          style={layout.fill}
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
      </>
    );
  }

  return (
    <>
      {paired ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="checkmark" onPress={close} />
        </Stack.Toolbar>
      ) : null}
      <Host style={layout.fill}>
        <Form>
          {cloudEnabled ? <CloudSection onConnected={close} /> : null}
          <Section
            title={cloudEnabled ? "Direct koppelen" : "Koppelen"}
            footer={
              <Text modifiers={[footnote, secondaryText]}>
                {error ??
                  "Maak in T3 Code op je computer een koppellink onder Settings › Sharing & access. Scan de QR-code of plak de link."}
              </Text>
            }
          >
            <Button
              label="Scan QR-code"
              systemImage="qrcode.viewfinder"
              onPress={() => void startScanning()}
            />
            <TextField
              placeholder="Koppellink"
              onTextChange={setLink}
              modifiers={[
                keyboardType("url"),
                textInputAutocapitalization("never"),
                autocorrectionDisabled(),
                onSubmit(() => void connect(link)),
              ]}
            />
            <Button
              label={busy ? "Koppelen…" : "Koppel"}
              onPress={() => void connect(link)}
              modifiers={[disabled(busy || !link.trim())]}
            />
          </Section>
        </Form>
      </Host>
    </>
  );
}
