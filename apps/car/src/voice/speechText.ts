/**
 * Turns agent markdown into text a speech synthesizer can read aloud while driving,
 * and cuts streaming replies into whole sentences so speech starts before the turn ends.
 */

export type CarLanguage = "nl-NL" | "en-US";

const CODE_FENCE = /^\s*(```|~~~)/;

const PHRASES = {
  "nl-NL": {
    codeSkipped: "Code overgeslagen.",
    link: "link",
    sent: "Verstuurd.",
    done: "Klaar.",
    failed: "De beurt is mislukt.",
    stopped: "De beurt is gestopt.",
    approvalAsk: "De agent vraagt toestemming.",
    approvalHint: "Zeg ja of nee, of gebruik de knoppen.",
    approved: "Goedgekeurd.",
    declined: "Geweigerd.",
    question: "De agent heeft een vraag.",
    options: "De opties zijn:",
    questionInApp: "Deze vraag beantwoord je in de T3 Code app.",
    sendFailed: "Versturen is mislukt.",
    notAllowed: "Je mag in deze omgeving geen berichten sturen.",
  },
  "en-US": {
    codeSkipped: "Code skipped.",
    link: "link",
    sent: "Sent.",
    done: "Done.",
    failed: "The turn failed.",
    stopped: "The turn was stopped.",
    approvalAsk: "The agent asks for permission.",
    approvalHint: "Say yes or no, or use the buttons.",
    approved: "Approved.",
    declined: "Declined.",
    question: "The agent has a question.",
    options: "The options are:",
    questionInApp: "Answer this question in the T3 Code app.",
    sendFailed: "Sending failed.",
    notAllowed: "You are not allowed to send messages in this environment.",
  },
} as const;

export type SpokenPhrase = keyof (typeof PHRASES)["nl-NL"];

export function phrase(language: CarLanguage, key: SpokenPhrase): string {
  return PHRASES[language][key];
}

/** Markdown → plain spoken text. Code blocks and tables are summarised, not read. */
export function toSpeakableText(markdown: string, language: CarLanguage = "nl-NL"): string {
  const out: string[] = [];
  let inFence = false;
  for (const raw of markdown.split("\n")) {
    if (CODE_FENCE.test(raw)) {
      if (!inFence) out.push(phrase(language, "codeSkipped"));
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // Table rows and their separators are unreadable aloud.
    if (/^\s*\|.*\|\s*$/.test(raw)) continue;
    let line = raw
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "")
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, phrase(language, "link"))
      .replace(/`([^`]+)`/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/^\s*-{3,}\s*$/, "")
      .trim();
    // Long paths read terribly; keep the file name.
    line = line.replace(/(?:[\w.-]+\/){2,}([\w.-]+)/g, "$1");
    out.push(line);
  }
  return out
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function isInsideFence(text: string): boolean {
  return (text.match(/^\s*```/gm)?.length ?? 0) % 2 === 1;
}

/** Offset just past the last sentence boundary in `text` at or after `from`; -1 when none. */
function lastBoundary(text: string, from: number): number {
  const rest = text.slice(from);
  let boundary = -1;
  // Never cut inside an open code fence.
  let inFence = isInsideFence(text.slice(0, from));
  const pattern = /([.!?…:](?=\s)|\n\n|```[^\n]*\n)/g;
  for (let match = pattern.exec(rest); match; match = pattern.exec(rest)) {
    if (match[0].startsWith("```")) {
      inFence = !inFence;
      if (!inFence) boundary = match.index + match[0].length;
      continue;
    }
    if (!inFence) boundary = match.index + match[0].length;
  }
  return boundary <= 0 ? -1 : from + boundary;
}

/**
 * The next part of a streaming message that ends on a sentence boundary, starting at `spoken`.
 * Returns the raw markdown chunk and the new offset, or null when no whole sentence is ready.
 * With `final`, everything left is returned.
 */
export function nextSpeakableChunk(
  text: string,
  spoken: number,
  final: boolean,
): { readonly chunk: string; readonly end: number } | null {
  if (spoken >= text.length) return null;
  if (final) return { chunk: text.slice(spoken), end: text.length };
  const end = lastBoundary(text, spoken);
  return end < 0 ? null : { chunk: text.slice(spoken, end), end };
}

/** Where the sentence still being written starts, so joining mid-stream reads it from its start. */
export function unfinishedSentenceStart(text: string): number {
  const end = lastBoundary(text, 0);
  return end < 0 ? 0 : end;
}

/** Long chunks are split so the first words play sooner and a stop loses less. */
export function splitForSpeech(text: string, maxLength = 280): string[] {
  const parts: string[] = [];
  let current = "";
  for (const sentence of text.split(/(?<=[.!?…])\s+|\n+/)) {
    const piece = sentence.trim();
    if (!piece) continue;
    if (current && current.length + piece.length + 1 > maxLength) {
      parts.push(current);
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * True when what the microphone heard is the app's own voice coming back through the speaker:
 * most of the heard words occur, in order, in what was just spoken.
 */
export function isLikelyEcho(heard: string, recentlySpoken: string): boolean {
  const heardWords = words(heard);
  if (heardWords.length === 0) return false;
  const spokenWords = words(recentlySpoken);
  if (spokenWords.length === 0) return false;
  let matched = 0;
  let cursor = 0;
  for (const word of heardWords) {
    const index = spokenWords.indexOf(word, cursor);
    if (index >= 0) {
      matched++;
      cursor = index + 1;
    }
  }
  return matched / heardWords.length >= 0.6;
}

/** Drops the first `count` words, for a transcript that began with the app's own voice. */
export function dropLeadingWords(text: string, count: number): string {
  if (count <= 0) return text.trim();
  return text.trim().split(/\s+/).slice(count).join(" ");
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function normalizeCommand(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[.!?,]/g, "")
    .trim();
}

const YES =
  /^(ja|jawel|jazeker|yes|yep|yeah|akkoord|doe maar|ga je gang|prima|is goed|goed|oké|oke|okay|ok|approve|goedkeuren|toestaan|allow)$/;
const NO = /^(nee|neen|nope|no|niet doen|weiger|weigeren|afwijzen|deny|decline)$/;
const QUIET = /^(stil|stop|stop maar|wees stil|quiet|ssst|shh)$/;

export type SpokenCommand = "approve" | "decline" | "quiet" | null;

/** A whole utterance that is a command rather than a message for the agent. */
export function spokenCommand(transcript: string): SpokenCommand {
  const text = normalizeCommand(transcript);
  if (YES.test(text)) return "approve";
  if (NO.test(text)) return "decline";
  if (QUIET.test(text)) return "quiet";
  return null;
}
