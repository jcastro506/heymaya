import { describe, expect, it } from "vitest";
import { WATCH_PROMPT } from "../watch";
import { DossierSchema } from "../../contracts/dossier";
import { SOUL } from "../../agent/soul";

describe("she watches them the way a person would (2026-09-07)", () => {
  it("the card asks for the person, not only the craft, and forbids the guesses a friend would not make", () => {
    for (const key of ["\"them\"", "\"look\"", "\"voice\"", "\"humor\"", "\"presence\"", "\"world\"", "\"cares\"", "\"aFriendWouldNotice\""]) expect(WATCH_PROMPT, key).toContain(key);
    expect(WATCH_PROMPT).toMatch(/never .*age|ethnicity|body|health/i);
  });

  it("the dossier carries the person, optionally, and still parses without it", () => {
    const base = { version: 1, rewrittenAt: "x", readFrom: { tiktokPosts: 1, instagramPosts: 0, transcripts: 0, watched: 1, sampledFromHistory: false }, persona: { summary: "s", register: "casual", onCamera: "face", whyTheyPost: "w" }, themes: [], interests: [], audience: { whoComments: "", asks: [], arguesAbout: [], evidencePostIds: [] }, formatsUsed: [], fingerprint: { opening: "unknown", medianCutSeconds: "unknown", textStyle: "", settings: [], energy: "", confidence: 0 }, voice: { sampleLines: [], avoid: [] }, works: [], doesNot: [], triedAndAbandoned: [], trajectory: { postsPerWeekTrend: "unknown", viewsTrend: "unknown", breaks: [] }, cadence: { postsPerWeek: 1, filmingDays: [], bestHoursLocal: [] }, keywords: [], mode: "thin" as const };
    expect(DossierSchema.safeParse(base).success).toBe(true);
    const withPerson = { ...base, persona: { ...base.persona, look: "hoodie, headphones round the neck, films from the bed", voice: "fast, dry, swallows the ends of sentences", humor: "self-deprecating, at his own ideas' expense", world: "the dog, the london flat, the notes app" } };
    expect(DossierSchema.safeParse(withPerson).success).toBe(true);
  });

  it("the soul says to use it like a friend, never as a list or a body description", () => {
    expect(SOUL).toMatch(/never as a list and never as a description of their body/);
  });
});
