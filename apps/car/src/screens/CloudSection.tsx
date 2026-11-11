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
import { useEffect, useState } from "react";

import { FieldRow, Row, Section } from "../ui";

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

/**
 * T3 Connect on the pairing screen: sign in with a code sent by email, then add the computers
 * linked to the account. Rendered only in builds configured for T3 Connect, inside Clerk.
 */
export function CloudSection(props: { readonly onConnected: () => void }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return (
      <Section header="T3 Connect">
        <Row title="Laden…" />
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
      <Section header="T3 Connect">
        <Row kind="action" title="Log in" onPress={props.onSignIn} />
      </Section>
    );
  }
  return (
    <Section header="T3 Connect">
      <Row title={user?.primaryEmailAddress?.emailAddress ?? "Ingelogd"} />
      <Row kind="destructive" title="Log uit" onPress={() => void signOut()} />
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
        header="T3 Connect"
        footer={error ?? "Je krijgt een code per e-mail om in te loggen."}
      >
        <FieldRow
          value={email}
          onChangeText={setEmail}
          placeholder="E-mailadres"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          returnKeyType="send"
          onSubmitEditing={() => void sendCode()}
        />
        <Row
          kind="action"
          title={busy ? "Versturen…" : "Stuur code"}
          disabled={busy || !email.trim()}
          onPress={() => void sendCode()}
        />
      </Section>
    );
  }

  return (
    <Section header="T3 Connect" footer={error ?? `De code is gestuurd naar ${email.trim()}.`}>
      <FieldRow
        value={code}
        onChangeText={setCode}
        placeholder="Code"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        keyboardType="number-pad"
        returnKeyType="done"
        onSubmitEditing={() => void verify()}
      />
      <Row
        kind="action"
        title={busy ? "Controleren…" : "Log in"}
        disabled={busy || !code.trim()}
        onPress={() => void verify()}
      />
      <Row
        kind="action"
        title="Ander e-mailadres"
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
      header="T3 Connect"
      footer={error ?? `Ingelogd als ${user?.primaryEmailAddress?.emailAddress ?? "je account"}.`}
    >
      {entries.length === 0 ? (
        <Row
          title={discovery.refreshing ? "Computers zoeken…" : "Geen computers gevonden"}
          subtitle={discovery.refreshing ? null : "Zet T3 Connect aan in T3 Code op je computer."}
        />
      ) : null}
      {entries.map(({ environment, availability }) => {
        const added = catalog.entries.has(environment.environmentId);
        return (
          <Row
            key={environment.environmentId}
            kind={added ? "text" : "action"}
            title={environment.label}
            subtitle={`Gekoppeld op ${linkedOn(environment.linkedAt)}`}
            detail={AVAILABILITY_LABEL[availability]}
            checked={added}
            onPress={added ? undefined : () => void add(environment)}
          />
        );
      })}
    </Section>
  );
}
