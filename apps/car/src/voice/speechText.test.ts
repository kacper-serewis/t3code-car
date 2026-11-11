import { describe, expect, it } from "vite-plus/test";

import {
  dropLeadingWords,
  isLikelyEcho,
  nextSpeakableChunk,
  splitForSpeech,
  spokenCommand,
  toSpeakableText,
  unfinishedSentenceStart,
} from "./speechText";

describe("toSpeakableText", () => {
  it("strips markdown and keeps the words", () => {
    expect(
      toSpeakableText("## Plan\n- **Eerst** de `tests` draaien\n- zie [de docs](https://x.dev)"),
    ).toBe("Plan\nEerst de tests draaien\nzie de docs");
  });

  it("summarises code blocks and drops tables", () => {
    expect(toSpeakableText("Zo:\n```ts\nconst a = 1;\n```\n| a | b |\n|---|---|\nKlaar.")).toBe(
      "Zo:\nCode overgeslagen.\nKlaar.",
    );
    expect(toSpeakableText("```\nx\n```", "en-US")).toBe("Code skipped.");
  });

  it("reads only the file name of a long path", () => {
    expect(toSpeakableText("Ik pas apps/car/src/App.tsx aan.")).toBe("Ik pas App.tsx aan.");
  });
});

describe("nextSpeakableChunk", () => {
  it("waits for a whole sentence while streaming", () => {
    expect(nextSpeakableChunk("Ik ga nu aan de sl", 0, false)).toBeNull();
    expect(nextSpeakableChunk("Ik ga aan de slag. Daarna", 0, false)).toEqual({
      chunk: "Ik ga aan de slag.",
      end: 18,
    });
  });

  it("returns the rest once the message is final", () => {
    expect(nextSpeakableChunk("Ik ga aan de slag. Daarna test ik", 18, true)).toEqual({
      chunk: " Daarna test ik",
      end: 33,
    });
    expect(nextSpeakableChunk("Klaar.", 6, true)).toBeNull();
  });

  it("never cuts inside an open code fence", () => {
    expect(nextSpeakableChunk("Kijk. ```ts\nconst a = 1. b", 0, false)).toEqual({
      chunk: "Kijk.",
      end: 5,
    });
  });
});

describe("unfinishedSentenceStart", () => {
  it("points at the sentence still being written", () => {
    expect(unfinishedSentenceStart("Eerste zin. Tweede z")).toBe(11);
    expect(unfinishedSentenceStart("Nog geen einde")).toBe(0);
  });
});

describe("splitForSpeech", () => {
  it("keeps short text whole and splits long text on sentences", () => {
    expect(splitForSpeech("Een. Twee.")).toEqual(["Een. Twee."]);
    expect(splitForSpeech("Een zin. Nog een zin. En nog een.", 20)).toEqual([
      "Een zin.",
      "Nog een zin.",
      "En nog een.",
    ]);
  });
});

describe("isLikelyEcho", () => {
  const spoken = "Ik heb de tests gedraaid en ze slagen allemaal. Zal ik nu de build starten?";

  it("recognizes the app's own words coming back", () => {
    expect(isLikelyEcho("de tests gedraaid en ze slagen", spoken)).toBe(true);
    expect(isLikelyEcho("zal ik nu de bild starten", spoken)).toBe(true);
  });

  it("lets the user's own words through", () => {
    expect(isLikelyEcho("nee wacht even met committen", spoken)).toBe(false);
    expect(isLikelyEcho("ja doe maar", spoken)).toBe(false);
    expect(isLikelyEcho("hallo", "")).toBe(false);
  });
});

describe("dropLeadingWords", () => {
  it("removes the words that were echo", () => {
    expect(dropLeadingWords("zal ik starten ja doe maar", 3)).toBe("ja doe maar");
    expect(dropLeadingWords("ja", 3)).toBe("");
  });
});

describe("spokenCommand", () => {
  it("only matches a whole utterance", () => {
    expect(spokenCommand("Ja.")).toBe("approve");
    expect(spokenCommand("Nee!")).toBe("decline");
    expect(spokenCommand("stil")).toBe("quiet");
    expect(spokenCommand("ja maar gebruik wel de andere branch")).toBeNull();
  });
});
