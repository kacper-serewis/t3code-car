import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  ThreadPendingApproval,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  MessageId,
  type EnvironmentId,
  type ProviderApprovalDecision,
  type ThreadId,
} from "@t3tools/contracts";
import { makeQueuedMessageMetadata } from "@t3tools/mobile/src/lib/commandMetadata";
import { appAtomRegistry } from "@t3tools/mobile/src/state/atom-registry";
import { readEnvironmentScope } from "@t3tools/mobile/src/state/session";
import { enqueueThreadOutboxMessage } from "@t3tools/mobile/src/state/thread-outbox";
import {
  environmentThreadDetails,
  environmentThreads,
  threadEnvironment,
} from "@t3tools/mobile/src/state/threads";
import * as Option from "effect/Option";

import { getSettings, noteConversationText } from "../settings";
import { enterListening, enterQuiet, leaveAudio } from "../voice/audioSession";
import { deleteRecording, Listener, type Utterance } from "../voice/listener";
import { transcribeUtterance } from "../voice/openai";
import { Speaker } from "../voice/speaker";
import { phrase, spokenCommand, toSpeakableText } from "../voice/speechText";
import { hasActiveRun, ThreadFeed } from "./threadFeed";

export interface DriveThreadRef {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

export interface DriveSnapshot {
  /** The thread is synchronized; from here on new agent text is read aloud. */
  readonly joined: boolean;
  /** The microphone is open, which stops the music. */
  readonly micOn: boolean;
  /** What the user is saying right now. */
  readonly hearing: string | null;
  /** The user's words are being transcribed and sent. */
  readonly sending: boolean;
  readonly agentBusy: boolean;
  readonly speaking: boolean;
  readonly approval: ThreadPendingApproval | null;
  readonly question: ThreadPendingUserInput | null;
  readonly lastHeard: string | null;
  readonly lastSaid: string | null;
  readonly notice: string | null;
}

const MAX_SPOKEN_DETAIL = 220;

/**
 * One hands-free conversation with a thread: joining is silent, new agent text is read aloud.
 * The microphone opens by itself only when the agent waits for the user (its turn ended, or
 * it asks for approval or a choice); while a turn runs it stays closed, so music plays.
 */
export class DriveSession {
  private snapshot: DriveSnapshot = {
    joined: false,
    micOn: false,
    hearing: null,
    sending: false,
    agentBusy: false,
    speaking: false,
    approval: null,
    question: null,
    lastHeard: null,
    lastSaid: null,
    notice: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly feed = new ThreadFeed(() => getSettings().language);
  private readonly speaker = new Speaker((speaking) => {
    this.set({ speaking });
    if (!speaking) this.afterSpeech();
  });
  private readonly listener = new Listener({
    onHearing: (hearing) => this.set({ hearing }),
    onClosed: (utterance) => void this.onMicClosed(utterance),
    onProblem: (notice) => this.set({ notice }),
  });
  private readonly announced = new Set<string>();
  /** Agent text that arrived while the user had the floor. */
  private held: string[] = [];
  /** Open the microphone once the voice has finished. */
  private promptPending = false;
  /** The microphone is being opened; nothing else may claim the audio session meanwhile. */
  private micOpening = false;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;

  constructor(readonly thread: DriveThreadRef) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private set(patch: Partial<DriveSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  start(): void {
    this.disposed = false;
    const { environmentId, threadId } = this.thread;
    const stateAtom = environmentThreads.stateAtom(environmentId, threadId);
    const requestsAtom = environmentThreadDetails.pendingRequestsAtom(this.thread);
    const check = () => this.onThreadChanged();
    const unsubscribeState = appAtomRegistry.subscribe(stateAtom, check, { immediate: true });
    const unsubscribeRequests = appAtomRegistry.subscribe(requestsAtom, check);
    this.unsubscribe = () => {
      unsubscribeState();
      unsubscribeRequests();
    };
    void enterQuiet();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.disposed = true;
    this.promptPending = false;
    this.held = [];
    this.listener.cancel();
    this.speaker.stop();
    void leaveAudio();
  }

  /** The one tap: take the floor, or give it back. */
  tap(): void {
    if (this.snapshot.sending) return;
    if (this.listener.active) {
      this.listener.cancel();
      return;
    }
    // Tapping while the agent talks cuts it off so the user can speak.
    this.speaker.stop();
    void this.openMic();
  }

  /** Stops the agent's current turn. */
  interrupt(): void {
    void runAtomCommand(
      appAtomRegistry,
      threadEnvironment.interruptTurn,
      { environmentId: this.thread.environmentId, input: { threadId: this.thread.threadId } },
      { label: "car:interrupt-turn", reportFailure: true },
    );
  }

  respondToApproval(decision: ProviderApprovalDecision): void {
    const approval = this.snapshot.approval;
    if (approval === null) return;
    this.promptPending = false;
    this.listener.cancel();
    this.set({ approval: null });
    this.say(phrase(getSettings().language, decision === "decline" ? "declined" : "approved"));
    void runAtomCommand(
      appAtomRegistry,
      threadEnvironment.respondToApproval,
      {
        environmentId: this.thread.environmentId,
        input: { threadId: this.thread.threadId, requestId: approval.requestId, decision },
      },
      { label: "car:respond-approval", reportFailure: true },
    );
  }

  /** Answers the pending single question with one of its options or a spoken answer. */
  answerQuestion(answer: string): void {
    const request = this.snapshot.question;
    const question = request?.questions[0];
    if (!request || !question || request.questions.length !== 1) return;
    this.promptPending = false;
    this.listener.cancel();
    this.set({ question: null, lastHeard: answer });
    void runAtomCommand(
      appAtomRegistry,
      threadEnvironment.respondToUserInput,
      {
        environmentId: this.thread.environmentId,
        input: {
          threadId: this.thread.threadId,
          requestId: request.requestId,
          answers: { [question.id]: question.multiSelect ? [answer] : answer },
        },
      },
      { label: "car:respond-user-input", reportFailure: true },
    );
  }

  private say(text: string): void {
    // The agent does not talk over the user; it continues once they are done.
    if (this.micOpening || this.listener.active || this.snapshot.sending) this.held.push(text);
    else this.speaker.say(text);
  }

  /** The agent waits for the user: open the microphone once it has finished talking. */
  private promptUser(): void {
    this.promptPending = true;
    void this.speaker.drained().then(() => this.afterSpeech());
  }

  private afterSpeech(): void {
    if (
      this.disposed ||
      this.speaker.busy ||
      this.micOpening ||
      this.listener.active ||
      this.snapshot.sending
    ) {
      return;
    }
    if (this.promptPending) {
      this.promptPending = false;
      void this.openMic();
    } else {
      // Nothing to say and nothing asked: the music gets its volume back.
      void enterQuiet();
    }
  }

  private async openMic(): Promise<void> {
    if (this.disposed || this.micOpening || this.listener.active) return;
    this.promptPending = false;
    this.micOpening = true;
    await enterListening();
    const opened = await this.listener.start();
    this.micOpening = false;
    if (this.disposed) {
      this.listener.cancel();
      return;
    }
    this.set({ micOn: opened });
    if (!opened) void enterQuiet();
  }

  private async onMicClosed(utterance: Utterance | null): Promise<void> {
    this.set({ micOn: false, hearing: null });
    if (utterance !== null) await this.onUtterance(utterance);
    if (this.disposed) return;
    const held = this.held;
    this.held = [];
    for (const text of held) this.speaker.say(text);
    if (held.length === 0) this.afterSpeech();
  }

  private onThreadChanged(): void {
    if (this.disposed) return;
    const result = appAtomRegistry.get(
      environmentThreads.stateAtom(this.thread.environmentId, this.thread.threadId),
    );
    if (result._tag !== "Success") return;
    const projection = Option.getOrNull(result.value.data);
    if (projection === null) return;
    const language = getSettings().language;
    let lastSaid = this.snapshot.lastSaid;
    let turnEnded = false;
    for (const event of this.feed.advance(projection, result.value.status === "live")) {
      if (event.type === "say") {
        noteConversationText(event.text);
        lastSaid = event.text;
        this.say(event.text);
      } else if (event.type === "run-finished") {
        if (event.status === "failed") this.say(phrase(language, "failed"));
        else if (event.status === "completed" && !event.spoke) this.say(phrase(language, "done"));
        turnEnded = true;
      }
    }
    this.set({ joined: this.feed.joined, agentBusy: hasActiveRun(projection), lastSaid });
    // The same state the T3 Code composer shows: with no run left the send button is back and
    // the agent waits for the user; while a run is active (stop button) it is still working.
    let asked = turnEnded && !hasActiveRun(projection);
    if (this.feed.joined && this.onPendingRequests()) asked = true;
    if (asked) this.promptUser();
  }

  /** Announces new requests. True when one was announced, which the user should answer. */
  private onPendingRequests(): boolean {
    const requests = appAtomRegistry.get(environmentThreadDetails.pendingRequestsAtom(this.thread));
    const language = getSettings().language;
    const approval =
      requests?.approvals.find((candidate) => candidate.responseCapability === "live") ?? null;
    const question = requests?.userInputs[0] ?? null;
    let announced = false;
    if (approval !== null && !this.announced.has(approval.requestId)) {
      this.announced.add(approval.requestId);
      announced = true;
      const what = toSpeakableText(approval.reason ?? approval.detail ?? "", language).slice(
        0,
        MAX_SPOKEN_DETAIL,
      );
      this.say(`${phrase(language, "approvalAsk")} ${what} ${phrase(language, "approvalHint")}`);
    }
    if (question !== null && !this.announced.has(question.requestId)) {
      this.announced.add(question.requestId);
      const only = question.questions.length === 1 ? question.questions[0] : undefined;
      if (only === undefined) {
        this.say(`${phrase(language, "question")} ${phrase(language, "questionInApp")}`);
      } else {
        announced = true;
        const options = only.options.map((option, index) => `${index + 1}: ${option.label}.`);
        this.say(
          [
            phrase(language, "question"),
            toSpeakableText(only.question, language),
            ...(options.length > 0 ? [phrase(language, "options"), ...options] : []),
          ].join(" "),
        );
      }
    }
    if (approval !== this.snapshot.approval || question !== this.snapshot.question) {
      this.set({ approval, question });
    }
    return announced;
  }

  private async onUtterance(utterance: Utterance): Promise<void> {
    this.set({ sending: true });
    let text = utterance.text;
    const { openAiKey, language, languageMode } = getSettings();
    if (openAiKey !== null && utterance.audioUri !== null) {
      try {
        text =
          (await transcribeUtterance({
            apiKey: openAiKey,
            uri: utterance.audioUri,
            speechStartedMs: utterance.speechStartedMs,
            // In `auto` OpenAI hears for itself which language was spoken.
            ...(languageMode === "auto" ? {} : { language }),
          })) || text;
      } catch {
        // No reach or a rejected key: the on-device transcript is good enough to send.
      }
    }
    deleteRecording(utterance.audioUri);
    text = text.trim();
    noteConversationText(text);
    // `sending` is cleared first so what the app says next is not held back.
    if (text && !this.disposed) {
      const spoken = await this.handleSpoken(text);
      this.set({ sending: false });
      if (spoken !== null) this.say(spoken);
    } else {
      this.set({ sending: false });
    }
  }

  /** Acts on what the user said. Returns what to say back, if anything. */
  private async handleSpoken(text: string): Promise<string | null> {
    const command = spokenCommand(text);
    if (command === "quiet") return null;
    if (this.snapshot.approval !== null && command !== null) {
      this.set({ sending: false });
      this.respondToApproval(command === "approve" ? "accept" : "decline");
      return null;
    }
    const question = this.snapshot.question;
    const only = question?.questions.length === 1 ? question.questions[0] : undefined;
    if (only !== undefined) {
      const answer =
        matchOption(text, only.options) ?? (only.allowCustomAnswer === false ? null : text);
      if (answer !== null) {
        this.answerQuestion(answer);
        return null;
      }
    }
    return this.send(text);
  }

  private async send(text: string): Promise<string> {
    const { environmentId, threadId } = this.thread;
    const language = getSettings().language;
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      return phrase(language, "notAllowed");
    }
    const metadata = makeQueuedMessageMetadata();
    this.set({ lastHeard: text });
    try {
      // The outbox keeps the message through a dead spot and delivers it once there is reach.
      await enqueueThreadOutboxMessage({
        environmentId,
        threadId,
        messageId: MessageId.make(metadata.messageId),
        commandId: CommandId.make(metadata.commandId),
        text,
        attachments: [],
        // While the agent works the message reaches it in the running turn.
        ...(this.snapshot.agentBusy ? { dispatchMode: "steer" as const } : {}),
        createdAt: metadata.createdAt,
      });
      return phrase(language, "sent");
    } catch {
      return phrase(language, "sendFailed");
    }
  }
}

/** The option the user named, by its number or its label. */
function matchOption(
  text: string,
  options: ReadonlyArray<{ readonly label: string; readonly value?: string | undefined }>,
): string | null {
  const said = text
    .toLowerCase()
    .replace(/[.!?,]/g, "")
    .trim();
  const numbers = ["een", "twee", "drie", "vier", "one", "two", "three", "four"];
  const spokenNumber = /^(optie|option)?\s*(\d|een|één|twee|drie|vier|one|two|three|four)$/.exec(
    said,
  );
  if (spokenNumber?.[2] !== undefined) {
    const word = spokenNumber[2].replace("één", "een");
    const index = /^\d$/.test(word) ? Number(word) - 1 : numbers.indexOf(word) % 4;
    const option = options[index];
    if (option) return option.value ?? option.label;
  }
  const byLabel = options.find((option) => option.label.toLowerCase().trim() === said);
  return byLabel ? (byLabel.value ?? byLabel.label) : null;
}
