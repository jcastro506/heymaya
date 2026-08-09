/**
 * ⭐ Tell research — the denylist, measured rather than assumed.
 *
 * §7.5.2 ships a hypothesis table and says so: *"a starting hypothesis, not the
 * finding."* Measured against 63 real niche posts on 2026-08-07, most of it did
 * not survive — and two entries pointed the wrong way.
 *
 * These tests hold the three properties that make the measurement trustworthy:
 * it refuses to speak at small n, it treats zero-vs-zero as agreement rather
 * than a finding, and it never reports a ratio against zero as a ratio.
 */
import { describe, expect, it } from "vitest";
import { MIN_SAMPLES, compare, measure } from "../tells";

/** Real niche posts, from `observations`. */
const HUMAN = [
  "send a screenshot of your high score and i'll send you a photo of mochi #mochiheights",
  "When you work in marketing and there is always something to take care of 🚨 join me for more tips #marketingstruggles",
  "You cannot market your way out of a building nobody wants at that price.",
  "Why does every founder think the hard part is the code? 😅",
  "shipping is easy, being seen is hard, and nobody warns you #buildinpublic",
  "What would you build if you had one free weekend? 👇",
  "spent all day on the landing page. zero signups. cool cool cool 🙃",
  "the algorithm doesn't owe you anything #contentcreator",
  "How I got my first 100 users without spending a dollar 🧵",
  "nobody tells you that marketing is a full time job on top of your full time job",
  "my analytics dashboard is just a very expensive way to feel bad 📉",
  "Ever wonder why your best post did nothing? #socialmedia",
  "built it, shipped it, tweeted it, crickets 🦗",
  "Fast, simple, and free — pick all three apparently #indiehackers",
];

/** Hers — the shape the live corpus actually has. */
const HERS = [
  "subscribe and your next deploy will work on the first try. no evidence. just vibes.",
  "For indie founders, growing on X is rarely just a writing problem.",
  "Building solo means every extra step counts. Paste a CSV, get a dashboard.",
  "when you're building alone, a CSV shouldn't become a dashboard project.",
  "Nobody warns you that shipping is the easy part and being seen is the hard one.",
  "the best marketing advice I got was to go where people are already complaining.",
  "Your pricing page is doing more selling than your homepage.",
  "I stopped writing threads and started answering replies.",
  "Analytics told me what happened. Comments told me why.",
  "the hardest part of solo founding is deciding what not to do today.",
  "Cold outreach felt gross until I only messaged people who asked first.",
  "Every founder I know has a graveyard of half-built growth experiments.",
];

describe("it refuses to speak at small n", () => {
  it("says how short it is rather than reporting a delta", () => {
    // §14.3: this product cannot run experiments at founder-scale volume. A
    // tell derived from eight posts would be written into the critic and shape
    // months of output.
    const result = compare({ human: HUMAN, hers: HERS.slice(0, 4) });
    expect(result.ok).toBe(false);
    expect(result.tells).toEqual([]);
    expect(result.detail).toContain(String(MIN_SAMPLES));
  });

  it("speaks once both sides clear the bar", () => {
    expect(compare({ human: HUMAN, hers: HERS }).ok).toBe(true);
  });
});

describe("⛔ ZERO VS ZERO IS AGREEMENT, NOT A FINDING", () => {
  it("the lexical hypothesis is retired by measurement, not by opinion", () => {
    // "delve", "tapestry", "game-changer" appear zero times in 63 real niche
    // posts AND zero times in hers. A denylist defending against a word
    // nobody uses is dead weight — but it must be RETIRED by data, not
    // deleted because someone doubted it.
    const result = compare({ human: HUMAN, hers: HERS });
    expect(result.tells.map((t) => t.feature)).not.toContain("lexical");
    expect(result.tells.map((t) => t.feature)).not.toContain("notXButY");
  });
});

describe("⭐ the tells it DOES find are absences", () => {
  it("catches what she never does, which a denylist structurally cannot", () => {
    // A denylist can only catch what is present. Her real tell is the missing
    // emoji and hashtags — invisible to every guard we had.
    const result = compare({ human: HUMAN, hers: HERS });
    const features = result.tells.map((t) => t.feature);
    expect(features).toContain("emoji");
    expect(features).toContain("hashtag");
  });

  it("⚠️ never reports a ratio against zero as a ratio", () => {
    // The first live run said "the niche uses emoji 433.2× more than she does"
    // — 4.33 divided by an epsilon. It reads as precise and is an artifact.
    const result = compare({ human: HUMAN, hers: HERS });
    for (const tell of result.tells) {
      expect(tell.detail).not.toMatch(/\d{3,}\.\d×/);
      if (tell.hers === 0) expect(tell.detail).toMatch(/never uses/);
    }
  });

  it("ranks by size, so the biggest gap is the one you read first", () => {
    const result = compare({ human: HUMAN, hers: HERS });
    const deltas = result.tells.map((t) => Math.abs(t.delta));
    expect([...deltas].sort((a, b) => b - a)).toEqual(deltas);
  });
});

describe("measure", () => {
  it("normalises per 100 words so long and short posts compare", () => {
    const short = measure("nobody #a");
    const long = measure(`nobody ${"word ".repeat(50)}#a`);
    expect(short.hashtag).toBeGreaterThan(long.hashtag);
  });

  it("reads a lowercase opener, which is her strongest signature", () => {
    expect(measure("shipping is easy").lowercaseStart).toBe(100);
    expect(measure("Shipping is easy").lowercaseStart).toBe(0);
  });

  it("an empty string measures zero rather than dividing by nothing", () => {
    const f = measure("");
    expect(Number.isFinite(f.emoji)).toBe(true);
    expect(f.meanSentenceWords).toBe(0);
  });
});
