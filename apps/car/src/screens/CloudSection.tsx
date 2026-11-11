import { useAuth, useSignIn, useUser } from "@clerk/expo";
import { useAtomValue } from "@effect/atom-react";
import {
  RelayConnectionRegistration,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { RelayClientEnvironmentRecord } from "@t3tools/contracts/relay";
import { environmentCatalog } from "@t3tools/mobile/src/connection/catalog";
import { appAtomRegistry } from "@t3tools/mobile/src/state/atom-registry";
import { relayEnvironmentDiscovery } from "@t3tools/mobile/src/state/relay";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, ui } from "../theme";

function messageOf(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const clerk = error as {
      readonly errors?: ReadonlyArray<{ readonly longMessage?: string; readonly message?: string }>;
      readonly message?: string;
    };
    const first = clerk.errors?.[0];
    const text = first?.longMessage ?? first?.message ?? clerk.message;
    if (text?.trim()) return text;
  }
  return fallback;
}

/**
 * T3 Connect: sign in with a code sent by email, then add the computers linked to the account.
 * Rendered only in builds that carry the T3 Connect configuration, inside the Clerk provider.
 */
export function CloudSection(props: { readonly onConnected: () => void }) {
  const { isLoaded, isSignedIn, signOut } = useAuth();
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>T3 Connect</Text>
      {!isLoaded ? (
        <Text style={ui.dim}>Laden…</Text>
      ) : isSignedIn ? (
        <SignedIn onConnected={props.onConnected} onSignOut={() => void signOut()} />
      ) : (
        <EmailCodeSignIn />
      )}
    </View>
  );
}

function EmailCodeSignIn() {
  const { signIn } = useSignIn();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    const emailAddress = email.trim();
    if (!emailAddress || busy) return;
    setBusy(true);
    setError(null);
    const result = await signIn.emailCode.sendCode({ emailAddress });
    setBusy(false);
    if (result.error) setError(messageOf(result.error, "De code kon niet verstuurd worden."));
    else setCodeSent(true);
  };

  const verify = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await signIn.emailCode.verifyCode({ code: code.trim() });
    if (result.error) {
      setBusy(false);
      setError(messageOf(result.error, "Deze code klopt niet."));
      return;
    }
    if (signIn.status !== "complete") {
      setBusy(false);
      setError("Dit account vraagt een extra stap die T3 Car niet ondersteunt.");
      return;
    }
    const finalized = await signIn.finalize();
    setBusy(false);
    if (finalized.error) setError(messageOf(finalized.error, "Inloggen is mislukt."));
  };

  if (!codeSent) {
    return (
      <>
        <Text style={ui.dim}>Log in met het e-mailadres van je T3 Connect-account.</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="E-mailadres"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          returnKeyType="send"
          onSubmitEditing={() => void sendCode()}
          style={ui.input}
        />
        <Pressable
          disabled={busy || !email.trim()}
          onPress={() => void sendCode()}
          style={({ pressed }) => [
            ui.bigButton,
            styles.button,
            (pressed || busy || !email.trim()) && ui.pressed,
          ]}
        >
          <Text style={ui.bigButtonText}>{busy ? "Versturen…" : "Stuur code"}</Text>
        </Pressable>
        {error !== null ? <Text style={styles.error}>{error}</Text> : null}
      </>
    );
  }

  return (
    <>
      <Text style={ui.dim}>Vul de code in die naar {email.trim()} is gestuurd.</Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="Code"
        placeholderTextColor={colors.textDim}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        keyboardType="number-pad"
        returnKeyType="done"
        onSubmitEditing={() => void verify()}
        style={ui.input}
      />
      <Pressable
        disabled={busy || !code.trim()}
        onPress={() => void verify()}
        style={({ pressed }) => [
          ui.bigButton,
          styles.button,
          (pressed || busy || !code.trim()) && ui.pressed,
        ]}
      >
        <Text style={ui.bigButtonText}>{busy ? "Controleren…" : "Log in"}</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          setCodeSent(false);
          setCode("");
          setError(null);
        }}
        style={({ pressed }) => [styles.link, pressed && ui.pressed]}
      >
        <Text style={ui.dim}>Ander e-mailadres</Text>
      </Pressable>
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
    </>
  );
}

function SignedIn(props: { readonly onConnected: () => void; readonly onSignOut: () => void }) {
  const { user } = useUser();
  const discovery = useAtomValue(relayEnvironmentDiscovery.stateValueAtom);
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const [error, setError] = useState<string | null>(null);
  const environments = [...discovery.environments.values()].map((entry) => entry.environment);

  const add = async (environment: RelayClientEnvironmentRecord) => {
    setError(null);
    const result = await runAtomCommand(
      appAtomRegistry,
      environmentCatalog.register,
      new RelayConnectionRegistration({
        target: new RelayConnectionTarget({
          environmentId: environment.environmentId,
          label: environment.label,
        }),
      }),
      { label: "car:register-relay-environment", reportFailure: false },
    );
    if (result._tag === "Success") props.onConnected();
    else setError(messageOf(squashAtomCommandFailure(result), "Koppelen is mislukt."));
  };

  return (
    <>
      <Text style={ui.dim}>
        Ingelogd als {user?.primaryEmailAddress?.emailAddress ?? "je T3 Connect-account"}.
      </Text>
      {environments.length === 0 ? (
        <Text style={ui.dim}>
          {discovery.refreshing
            ? "Computers zoeken…"
            : "Geen computers gevonden. Zet T3 Connect aan in T3 Code op je computer."}
        </Text>
      ) : null}
      {environments.map((environment) => {
        const added = catalog.entries.has(environment.environmentId);
        return (
          <Pressable
            key={environment.environmentId}
            disabled={added}
            onPress={() => void add(environment)}
            style={({ pressed }) => [
              ui.bigButton,
              styles.button,
              added && styles.added,
              pressed && ui.pressed,
            ]}
          >
            <Text numberOfLines={1} style={ui.bigButtonText}>
              {added ? `${environment.label} ✓` : `Koppel ${environment.label}`}
            </Text>
          </Pressable>
        );
      })}
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        onPress={props.onSignOut}
        style={({ pressed }) => [styles.link, pressed && ui.pressed]}
      >
        <Text style={ui.dim}>Uitloggen</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  heading: { color: colors.text, fontSize: 20, fontWeight: "700" },
  button: { minHeight: 64, backgroundColor: colors.accent },
  added: { backgroundColor: colors.surfaceRaised },
  link: { minHeight: 44, justifyContent: "center" },
  error: { color: colors.danger, fontSize: 17, lineHeight: 24 },
});
