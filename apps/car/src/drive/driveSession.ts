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

import { getSettings } from "../settings";
import { deleteRecording, Listener, type Utterance } from "../voice/listener";
import { transcribeUtterance } from "../voice/openai";
import { Speaker } from "../voice/speaker";
import { isLikelyEcho, phrase, spokenCommand, toSpeakableText } from "../voice/speechText";
import { hasActiveRun, ThreadFeed } from "./threadFeed";

export interface DriveThreadRef {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

export interface DriveSnapshot {
  /** The thread is synchronized; from here on new agent text is read aloud. */
  readonly joined: boolean;
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

/** After the app stops speaking, its voice can still arrive at the microphone this long. */
const ECHO_TAIL_MS = 1_500;
const MAX_SPOKEN_DETAIL = 220;

/**
 * One hands-free conversation with a thread. Joining says nothing and sends nothing: the
 * session follows the thread, reads aloud what the agent writes from then on, and keeps
 * listening so the user can speak at any moment, or not at all.
 * Lives outside React so the microphone and the voice have one owner.
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
    if (!speaking) this.lastSpokeAt = Date.now();
    this.set({ speaking });
  });
  private readonly listener = new Listener({
    onHearing: (text) => {
      // Talking over the agent cuts it off.
      if (text !== null && this.speaker.speaking && getSettings().voiceInterrupt) {
        this.speaker.stop();
      }
      this.set({ hearing: text });
    },
    onUtterance: (utterance) => void this.onUtterance(utterance),
    onProblem: (notice) => this.set({ notice }),
    shouldIgnore: (heard) => {
      const echoPossible = this.speaker.speaking || Date.now() - this.lastSpokeAt < ECHO_TAIL_MS;
      if (!echoPossible) return false;
      if (this.speaker.speaking && !getSettings().voiceInterrupt) return true;
      return isLikelyEcho(heard, this.speaker.recentText());
    },
    canRecycle: () => !this.speaker.speaking && !this.snapshot.sending,
  });
  private readonly announced = new Set<string>();
  private lastSpokeAt = 0;
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
    void this.setMic(true);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listener.stop();
    this.speaker.stop();
    this.disposed = true;
  }

  async setMic(on: boolean): Promise<void> {
    if (on) {
      const started = await this.listener.start();
      if (this.disposed) this.listener.stop();
      else this.set({ micOn: started });
    } else {
      this.listener.stop();
      this.set({ micOn: false, hearing: null });
    }
  }

  toggleMic(): void {
    void this.setMic(!this.snapshot.micOn);
  }

  /** Cuts off what is being read aloud. */
  silence(): void {
    this.speaker.stop();
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
    this.speaker.say(text);
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
    for (const event of this.feed.advance(projection, result.value.status === "live")) {
      if (event.type === "say") {
        lastSaid = event.text;
        this.say(event.text);
      } else if (event.type === "run-finished") {
        if (event.status === "failed") this.say(phrase(language, "failed"));
        else if (event.status === "completed" && !event.spoke) this.say(phrase(language, "done"));
      }
    }
    this.set({ joined: this.feed.joined, agentBusy: hasActiveRun(projection), lastSaid });
    if (this.feed.joined) this.onPendingRequests();
  }

  private onPendingRequests(): void {
    const requests = appAtomRegistry.get(environmentThreadDetails.pendingRequestsAtom(this.thread));
    const language = getSettings().language;
    const approval =
      requests?.approvals.find((candidate) => candidate.responseCapability === "live") ?? null;
    const question = requests?.userInputs[0] ?? null;
    if (approval !== null && !this.announced.has(approval.requestId)) {
      this.announced.add(approval.requestId);
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
  }

  private async onUtterance(utterance: Utterance): Promise<void> {
    this.set({ sending: true, hearing: null });
    let text = utterance.text;
    const { openAiKey, language } = getSettings();
    if (openAiKey !== null && utterance.audioUri !== null) {
      try {
        text =
          (await transcribeUtterance({
            apiKey: openAiKey,
            uri: utterance.audioUri,
            speechStartedMs: utterance.speechStartedMs,
            language,
          })) || text;
      } catch {
        // No reach or a rejected key: the on-device transcript is good enough to send.
      }
    }
    deleteRecording(utterance.audioUri);
    text = text.trim();
    if (this.disposed) return;
    if (text) await this.handleSpoken(text);
    this.set({ sending: false });
  }

  private async handleSpoken(text: string): Promise<void> {
    const command = spokenCommand(text);
    if (command === "quiet") {
      this.speaker.stop();
      return;
    }
    if (this.snapshot.approval !== null && command !== null) {
      this.respondToApproval(command === "approve" ? "accept" : "decline");
      return;
    }
    const question = this.snapshot.question;
    const only = question?.questions.length === 1 ? question.questions[0] : undefined;
    if (only !== undefined) {
      const answer =
        matchOption(text, only.options) ?? (only.allowCustomAnswer === false ? null : text);
      if (answer !== null) {
        this.answerQuestion(answer);
        return;
      }
    }
    await this.send(text);
  }

  private async send(text: string): Promise<void> {
    const { environmentId, threadId } = this.thread;
    const language = getSettings().language;
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      this.say(phrase(language, "notAllowed"));
      return;
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
      this.say(phrase(language, "sent"));
    } catch {
      this.say(phrase(language, "sendFailed"));
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
