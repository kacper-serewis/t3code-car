import {
  nextSpeakableChunk,
  toSpeakableText,
  unfinishedSentenceStart,
  type CarLanguage,
} from "../voice/speechText";

/** The parts of a thread projection the spoken feed reads. */
export interface FeedProjection {
  readonly messages: ReadonlyArray<{
    readonly id: string;
    readonly role: "user" | "assistant" | "system";
    readonly text: string;
    readonly streaming: boolean;
    readonly runId: string | null;
    readonly workflowScript?: boolean | undefined;
  }>;
  readonly runs: ReadonlyArray<{ readonly id: string; readonly status: string }>;
}

export type FeedEvent =
  | { readonly type: "say"; readonly text: string }
  | { readonly type: "run-started"; readonly runId: string }
  | {
      readonly type: "run-finished";
      readonly runId: string;
      readonly status: string;
      /** Whether the agent said anything aloud during this run. */
      readonly spoke: boolean;
    };

const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export function hasActiveRun(projection: FeedProjection): boolean {
  return projection.runs.some((run) => !isTerminalRunStatus(run.status));
}

/**
 * Follows one thread and yields what should be said aloud. Joining is silent: everything the
 * thread already holds when it first synchronizes counts as heard, so only text the agent
 * writes afterwards is spoken, sentence by sentence while it streams, including the short
 * remarks between tool calls.
 */
export class ThreadFeed {
  private live = false;
  private readonly spokenOffsets = new Map<string, number>();
  private readonly runStatuses = new Map<string, string>();
  private readonly runsWithSpeech = new Set<string>();

  constructor(private readonly language: () => CarLanguage) {}

  get joined(): boolean {
    return this.live;
  }

  advance(projection: FeedProjection, synchronized: boolean): ReadonlyArray<FeedEvent> {
    if (!this.live) {
      this.baseline(projection);
      this.live = synchronized;
      return [];
    }
    const events: FeedEvent[] = [];
    for (const message of projection.messages) {
      if (message.role !== "assistant" || message.workflowScript) continue;
      let spoken = Math.min(this.spokenOffsets.get(message.id) ?? 0, message.text.length);
      for (
        let next = nextSpeakableChunk(message.text, spoken, !message.streaming);
        next;
        next = nextSpeakableChunk(message.text, spoken, !message.streaming)
      ) {
        spoken = next.end;
        const text = toSpeakableText(next.chunk, this.language());
        if (!text) continue;
        events.push({ type: "say", text });
        if (message.runId !== null) this.runsWithSpeech.add(message.runId);
      }
      this.spokenOffsets.set(message.id, spoken);
    }
    for (const run of projection.runs) {
      const previous = this.runStatuses.get(run.id);
      this.runStatuses.set(run.id, run.status);
      const terminal = isTerminalRunStatus(run.status);
      if (previous === undefined) {
        if (!terminal) events.push({ type: "run-started", runId: run.id });
        continue;
      }
      if (terminal && !isTerminalRunStatus(previous)) {
        events.push({
          type: "run-finished",
          runId: run.id,
          status: run.status,
          spoke: this.runsWithSpeech.has(run.id),
        });
      }
    }
    return events;
  }

  private baseline(projection: FeedProjection): void {
    for (const message of projection.messages) {
      if (message.role !== "assistant") continue;
      this.spokenOffsets.set(
        message.id,
        // A sentence still being written is read from its start once it completes.
        message.streaming ? unfinishedSentenceStart(message.text) : message.text.length,
      );
    }
    for (const run of projection.runs) this.runStatuses.set(run.id, run.status);
  }
}
