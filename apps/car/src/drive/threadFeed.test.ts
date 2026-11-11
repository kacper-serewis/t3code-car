import { describe, expect, it } from "vite-plus/test";

import { ThreadFeed, hasActiveRun, type FeedProjection } from "./threadFeed";

const assistant = (id: string, text: string, streaming = false, runId = "run-1") => ({
  id,
  role: "assistant" as const,
  text,
  streaming,
  runId,
});
const feed = () => new ThreadFeed(() => "nl-NL");
const said = (events: ReturnType<ThreadFeed["advance"]>) =>
  events.flatMap((event) => (event.type === "say" ? [event.text] : []));

describe("ThreadFeed", () => {
  it("joins silently: history is never read aloud", () => {
    const thread = feed();
    const history: FeedProjection = {
      messages: [assistant("m1", "Oud antwoord. Nog een zin.")],
      runs: [{ id: "run-1", status: "completed" }],
    };
    expect(thread.advance(history, false)).toEqual([]);
    expect(thread.joined).toBe(false);
    // The cached copy can be behind; what arrives until the thread is live is still history.
    const synchronized: FeedProjection = {
      messages: [
        ...history.messages,
        assistant("m2", "Gemist terwijl je weg was.", false, "run-2"),
      ],
      runs: [...history.runs, { id: "run-2", status: "completed" }],
    };
    expect(thread.advance(synchronized, true)).toEqual([]);
    expect(thread.joined).toBe(true);
    expect(thread.advance(synchronized, true)).toEqual([]);
  });

  it("reads new text sentence by sentence while it streams", () => {
    const thread = feed();
    thread.advance({ messages: [], runs: [] }, true);
    const running = [{ id: "run-1", status: "running" }];
    expect(
      thread.advance({ messages: [assistant("m1", "Ik ga aan de sl", true)], runs: running }, true),
    ).toEqual([{ type: "run-started", runId: "run-1" }]);
    expect(
      said(
        thread.advance(
          { messages: [assistant("m1", "Ik ga aan de slag. Eerst de te", true)], runs: running },
          true,
        ),
      ),
    ).toEqual(["Ik ga aan de slag."]);
    expect(
      said(
        thread.advance(
          {
            messages: [assistant("m1", "Ik ga aan de slag. Eerst de tests", false)],
            runs: running,
          },
          true,
        ),
      ),
    ).toEqual(["Eerst de tests"]);
  });

  it("reads the remarks between tool calls, not only the final answer", () => {
    const thread = feed();
    thread.advance({ messages: [], runs: [] }, true);
    const running = [{ id: "run-1", status: "running" }];
    const first = assistant("m1", "Ik kijk eerst in de code.");
    expect(said(thread.advance({ messages: [first], runs: running }, true))).toEqual([
      "Ik kijk eerst in de code.",
    ]);
    const second = assistant("m2", "Gevonden, ik pas het aan.");
    expect(said(thread.advance({ messages: [first, second], runs: running }, true))).toEqual([
      "Gevonden, ik pas het aan.",
    ]);
  });

  it("finishes the sentence that was being written when joining mid-stream", () => {
    const thread = feed();
    thread.advance(
      { messages: [assistant("m1", "Al gezegd. Halverwege de z", true)], runs: [] },
      true,
    );
    expect(
      said(
        thread.advance(
          { messages: [assistant("m1", "Al gezegd. Halverwege de zin. En", true)], runs: [] },
          true,
        ),
      ),
    ).toEqual(["Halverwege de zin."]);
  });

  it("reports how a run ended and whether the agent spoke", () => {
    const thread = feed();
    thread.advance({ messages: [], runs: [{ id: "old", status: "completed" }] }, true);
    thread.advance({ messages: [], runs: [{ id: "run-1", status: "running" }] }, true);
    expect(
      thread.advance({ messages: [], runs: [{ id: "run-1", status: "completed" }] }, true),
    ).toEqual([
      { type: "run-finished", runId: "run-1", status: "completed", spoke: false, asksUser: false },
    ]);
    // Reported once.
    expect(
      thread.advance({ messages: [], runs: [{ id: "run-1", status: "completed" }] }, true),
    ).toEqual([]);
  });

  it("skips workflow scripts and user messages", () => {
    const thread = feed();
    thread.advance({ messages: [], runs: [] }, true);
    expect(
      thread.advance(
        {
          messages: [
            { ...assistant("m1", "export const meta = {}"), workflowScript: true },
            { id: "u1", role: "user", text: "Doe iets.", streaming: false, runId: null },
          ],
          runs: [],
        },
        true,
      ),
    ).toEqual([]);
  });
});

describe("ThreadFeed questions", () => {
  const finished = (text: string) => {
    const thread = feed();
    thread.advance({ messages: [], runs: [] }, true);
    thread.advance({ messages: [], runs: [{ id: "run-1", status: "running" }] }, true);
    return thread
      .advance(
        { messages: [assistant("m1", text)], runs: [{ id: "run-1", status: "completed" }] },
        true,
      )
      .find((event) => event.type === "run-finished");
  };

  it("marks a finished run that asks the user something", () => {
    expect(finished("Er zijn twee manieren. Welke wil je?")).toMatchObject({ asksUser: true });
  });

  it("does not for a run that only reports", () => {
    expect(finished("Klaar, de tests slagen.")).toMatchObject({ asksUser: false });
  });
});

describe("hasActiveRun", () => {
  it("is true while any run has not ended", () => {
    expect(hasActiveRun({ messages: [], runs: [{ id: "a", status: "completed" }] })).toBe(false);
    expect(hasActiveRun({ messages: [], runs: [{ id: "a", status: "waiting" }] })).toBe(true);
  });
});
