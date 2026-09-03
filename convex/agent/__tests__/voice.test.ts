/**
 * Their voice reaches the writer as their own sentences, not as adjectives about them.
 *
 * The bug this guards: the first live creator's dossier said "punchy, self-deprecating
 * text hooks" and the model, having never seen a line she wrote, produced the median
 * TikTok caption instead of hers.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { styleFacts, voiceSection, EXEMPLAR_CAP, type VoiceLine } from "../voice";

describe("style facts are counted, not guessed", () => {
  it("counts case, length, emoji and questions, ignoring hashtags in the word count", () => {
    const s = styleFacts([
      "wait i kinda love it 🌧️ #run #Running",
      "just doing a lot of thinking #walk",
      "why does mile 3 always feel like this?",
    ], [2, 1, 0]);
    expect(s.n).toBe(3);
    expect(s.lowercaseStartPct).toBe(100);
    expect(s.emojiPct).toBe(33);
    expect(s.questionPct).toBe(33);
    // 5, 6 and 8 words once the hashtags come out, so the median is 6.
    expect(s.medianWords).toBe(6);
    expect(s.medianHashtags).toBe(1);
  });

  it("says nothing rather than guessing when there is nothing to count", () => {
    const s = styleFacts([]);
    expect(s.n).toBe(0);
    expect(s.medianWords).toBeNull();
    expect(s.lowercaseStartPct).toBeNull();
  });

  it("an uppercase, emoji-free writer reads as one", () => {
    const s = styleFacts(["Marathon training update.", "Week three of the block."]);
    expect(s.lowercaseStartPct).toBe(0);
    expect(s.emojiPct).toBe(0);
  });
});

describe("the prefix block", () => {
  const lines: VoiceLine[] = [
    { text: "wait i kinda love it", kind: "caption", multiple: 5.9 },
    { text: "mile 3 and i am rethinking everything", kind: "on-screen", multiple: 2.1 },
  ];

  it("quotes their lines verbatim, with where each came from and how it did", () => {
    const out = voiceSection({ lines, style: styleFacts(["wait i kinda love it"]) });
    expect(out).toContain('"wait i kinda love it"');
    expect(out).toContain("on-screen");
    expect(out).toContain("5.9× their normal");
  });

  it("carries the rules that make quoting mean something", () => {
    const out = voiceSection({ lines, style: styleFacts(["wait i kinda love it"]) });
    expect(out).toMatch(/could have written/i);
    expect(out, "the overlay must not explain its own joke").toMatch(/explain/i);
    expect(out, "abstract nouns are the tell").toMatch(/discipline/);
    expect(out, "a line anyone could post is the failure mode").toMatch(/any creator in this niche|word for word/i);
  });

  it("admits it cannot hear them yet rather than inventing a house style", () => {
    const out = voiceSection({ lines: [], style: styleFacts([]) });
    expect(out).toMatch(/not read enough/i);
    expect(out).not.toContain('"');
  });

  it("stays bounded so a long history cannot crowd the prompt", () => {
    expect(EXEMPLAR_CAP).toBeLessThanOrEqual(10);
  });
});

describe("every skill sees it", () => {
  it("no buildPrefix call omits voice — a new skill must not silently lose their voice", () => {
    const files = ["opinion", "converse", "profile", "moment"].map((f) => readFileSync(new URL(`../${f}.ts`, import.meta.url), "utf8"))
      .concat([
        readFileSync(new URL("../../scout/scout.ts", import.meta.url), "utf8"),
        readFileSync(new URL("../../review/weekly.ts", import.meta.url), "utf8"),
        readFileSync(new URL("../../onboarding/firstRead.ts", import.meta.url), "utf8"),
      ]);
    for (const src of files) {
      for (const call of src.match(/buildPrefix\(\{[^}]*\}\)/g) ?? []) {
        // `voice: gathered.voice` or the shorthand `voice` both count.
        expect(call, `buildPrefix without voice: ${call}`).toMatch(/\bvoice\b/);
      }
    }
  });

  it("the critic can name a generic line and a vague sound", () => {
    const critic = readFileSync(new URL("../critic.ts", import.meta.url), "utf8");
    expect(critic).toContain("generic_line");
    expect(critic).toContain("vague_sound");
    expect(critic, "the tells must be spelled out, not just named").toMatch(/pov:/);
  });
});
