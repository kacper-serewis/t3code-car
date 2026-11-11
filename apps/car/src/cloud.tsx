import { useAuth, useSignIn, useUser } from "@clerk/expo";
import { useAtomValue } from "@effect/atom-react";
import { Button, HStack, Image, Section, Spacer, Text, TextField, VStack } from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  buttonStyle,
  disabled,
  keyboardType,
  onSubmit,
  textContentType,
  textInputAutocapitalization,
} from "@expo/ui/swift-ui/modifiers";
import {
  RelayConnectionRegistration,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { RelayClientEnvironmentRecord } from "@t3tools/contracts/relay";
import { environmentCatalog } from "@t3tools/mobile/src/connection/catalog";
import { appAtomRegistry } from "@t3tools/mobile/src/state/atom-registry";
import { relayEnvironmentDiscovery } from "@t3tools/mobile/src/state/relay";
import { useEffect, useState } from "react";
import { PlatformColor } from "react-native";

import { footnote, primaryText, secondaryText, subheadline } from "./native";

const AVAILABILITY_ORDER = { online: 0, checking: 1, error: 2, offline: 3 } as const;
const AVAILABILITY_LABEL = {
  online: "Online",
  checking: "Controleren…",
  error: "Onbekend",
  offline: "Offline",
} as const;

function linkedOn(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

function messageOf(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const clerk = error as {
      readonly errors?: ReadonlyArray<{ readonly longMessage?: string; readonly message?: string }>;
      readonly message?: string;
    };
    const first = clerk.errors?.[0];
    const message = first?.longMessage ?? first?.message ?? clerk.message;
    if (message?.trim()) return message;
  }
  return fallback;
}

function Footer(props: { readonly children: string }) {
  return <Text modifiers={[footnote, secondaryText]}>{props.children}</Text>;
}

/**
 * T3 Connect on the pairing screen: sign in with a code sent by email, then add the computers
 * linked to the account. Rendered only in builds configured for T3 Connect, inside Clerk.
 */
export function CloudSection(props: { readonly onConnected: () => void }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return (
      <Section title="T3 Connect">
        <Text modifiers={[secondaryText]}>Laden…</Text>
      </Section>
    );
  }
  return isSignedIn ? <LinkedComputers onConnected={props.onConnected} /> : <EmailCodeSignIn />;
}

/** The account in Settings: who is signed in, and a way out. */
export function CloudAccount(props: { readonly onSignIn: () => void }) {
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <Section title="T3 Connect">
        <Button label="Log in" onPress={props.onSignIn} />
      </Section>
    );
  }
  return (
    <Section title="T3 Connect">
      <Text>{user?.primaryEmailAddress?.emailAddress ?? "Ingelogd"}</Text>
      <Button label="Log uit" role="destructive" onPress={() => void signOut()} />
    </Section>
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
      <Section
        title="T3 Connect"
        footer={<Footer>{error ?? "Je krijgt een code per e-mail om in te loggen."}</Footer>}
      >
        <TextField
          placeholder="E-mailadres"
          onTextChange={setEmail}
          modifiers={[
            keyboardType("email-address"),
            textContentType("emailAddress"),
            textInputAutocapitalization("never"),
            autocorrectionDisabled(),
            onSubmit(() => void sendCode()),
          ]}
        />
        <Button
          label={busy ? "Versturen…" : "Stuur code"}
          onPress={() => void sendCode()}
          modifiers={[disabled(busy || !email.trim())]}
        />
      </Section>
    );
  }

  return (
    <Section
      title="T3 Connect"
      footer={<Footer>{error ?? `De code is gestuurd naar ${email.trim()}.`}</Footer>}
    >
      <TextField
        placeholder="Code"
        onTextChange={setCode}
        modifiers={[
          keyboardType("numeric"),
          textContentType("oneTimeCode"),
          onSubmit(() => void verify()),
        ]}
      />
      <Button
        label={busy ? "Controleren…" : "Log in"}
        onPress={() => void verify()}
        modifiers={[disabled(busy || !code.trim())]}
      />
      <Button
        label="Ander e-mailadres"
        onPress={() => {
          setCodeSent(false);
          setCode("");
          setError(null);
        }}
      />
    </Section>
  );
}

function LinkedComputers(props: { readonly onConnected: () => void }) {
  const { user } = useUser();
  const discovery = useAtomValue(relayEnvironmentDiscovery.stateValueAtom);
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const [error, setError] = useState<string | null>(null);
  // Several links can carry the same name; the ones that answer come first.
  const entries = [...discovery.environments.values()].sort(
    (left, right) =>
      AVAILABILITY_ORDER[left.availability] - AVAILABILITY_ORDER[right.availability] ||
      right.environment.linkedAt.localeCompare(left.environment.linkedAt),
  );

  // The list is read once per sign-in; without this it stays empty until the app restarts.
  useEffect(() => {
    void runAtomCommand(appAtomRegistry, relayEnvironmentDiscovery.refresh, undefined, {
      label: "car:refresh-relay-environments",
      reportFailure: false,
    });
  }, []);

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
    <Section
      title="T3 Connect"
      footer={
        <Footer>
          {error ?? `Ingelogd als ${user?.primaryEmailAddress?.emailAddress ?? "je account"}.`}
        </Footer>
      }
    >
      {entries.length === 0 ? (
        <Text modifiers={[secondaryText]}>
          {discovery.refreshing
            ? "Computers zoeken…"
            : "Geen computers gevonden. Zet T3 Connect aan in T3 Code op je computer."}
        </Text>
      ) : null}
      {entries.map(({ environment, availability }) => {
        const added = catalog.entries.has(environment.environmentId);
        return (
          <Button
            key={environment.environmentId}
            onPress={() => void add(environment)}
            modifiers={[buttonStyle("plain"), disabled(added)]}
          >
            <HStack spacing={10}>
              <VStack alignment="leading" spacing={2}>
                <Text modifiers={[primaryText]}>{environment.label}</Text>
                <Text modifiers={[secondaryText, subheadline]}>
                  {`${AVAILABILITY_LABEL[availability]} · gekoppeld op ${linkedOn(environment.linkedAt)}`}
                </Text>
              </VStack>
              <Spacer />
              <Image
                systemName={added ? "checkmark" : "plus.circle"}
                size={17}
                color={PlatformColor("systemBlue")}
              />
            </HStack>
          </Button>
        );
      })}
    </Section>
  );
}
