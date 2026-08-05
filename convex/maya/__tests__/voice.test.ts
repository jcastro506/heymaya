import { describe, expect, it } from "vitest";
import {
  buildFewShot,
  selectExcerpts,
  diffSignals,
  foldEdits,
  NEVER_SAYS_THRESHOLD,
} from "../voice";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);

describe("diffSignals — what one edit tells us", () => {
  it("catches a phrase they refused to say", () => {
    const signals = diffSignals(
      "This game-changing tool revolutionizes migrations",
      "This tool makes migrations boring"
    );
    expect(signals.removedPhrases).toContain("revolutionizes");
    expect(signals.addedPhrases).toContain("boring");
  });

  it("notices a substantial cut, not just a trim", () => {
    const long = "We are absolutely thrilled to announce something wonderful today";
    const short = "Shipped it.";
    expect(diffSignals(long, short).substantiallyShortened).toBe(true);
  });

  it("a light tightening is NOT a rhythm signal", () => {
    // Otherwise every ordinary rewrite reads as "they want everything shorter".
    const before = "We shipped the new migration runner today";
    const after = "We shipped the migration runner today";
    expect(diffSignals(before, after).substantiallyShortened).toBe(false);
  });

  it("catches stripped punctuation", () => {
    const signals = diffSignals(
      "It works — finally! Really!",
      "It works. Finally."
    );
    expect(signals.removedPunctuation).toContain("—");
    expect(signals.removedPunctuation).toContain("!");
  });

  it("catches removed emoji", () => {
    expect(diffSignals("shipped it 🎉", "shipped it").removedEmoji).toBe(true);
    expect(diffSignals("shipped it 🎉", "shipped it 🎉").removedEmoji).toBe(false);
  });

  it("catches a lowercased opener", () => {
    expect(diffSignals("Shipped it today", "shipped it today").loweredOpener).toBe(
      true
    );
    expect(diffSignals("Shipped it", "Shipped it").loweredOpener).toBe(false);
  });

  it("an unchanged draft produces no signal", () => {
    const signals = diffSignals("identical text here", "identical text here");
    expect(signals.removedPhrases).toEqual([]);
    expect(signals.addedPhrases).toEqual([]);
    expect(signals.lengthDelta).toBe(0);
  });

  it("word reordering isn't treated as a change — it's noise, not voice", () => {
    // A character diff would light up here. A set difference over content
    // words correctly says nothing happened.
    const signals = diffSignals(
      "migrations broke overnight badly",
      "badly broke migrations overnight"
    );
    expect(signals.removedPhrases).toEqual([]);
    expect(signals.addedPhrases).toEqual([]);
  });

  it("empty before doesn't divide by zero", () => {
    expect(diffSignals("", "something").substantiallyShortened).toBe(false);
  });
});

describe("foldEdits — one edit is an edit, three is a rule", () => {
  const cut = (phrase: string) => ({
    before: `This ${phrase} tool ships fast`,
    after: "This tool ships fast",
  });

  it("promotes a phrase only after the threshold", () => {
    // Promoting after ONE removal turns an ordinary rewrite into a permanent
    // ban, and a neverSays list built that way gets long, wrong, and
    // unfalsifiable — every future draft constrained by a decision nobody made.
    const twice = foldEdits([cut("revolutionary"), cut("revolutionary")]);
    expect(twice.neverSaysCandidates).toEqual([]);

    const thrice = foldEdits([
      cut("revolutionary"),
      cut("revolutionary"),
      cut("revolutionary"),
    ]);
    expect(thrice.neverSaysCandidates).toEqual([
      { phrase: "revolutionary", timesRemoved: 3 },
    ]);
  });

  it("the threshold is 3 and is exported so nobody re-derives it", () => {
    expect(NEVER_SAYS_THRESHOLD).toBe(3);
  });

  it("ranks the most-cut phrases first, with stable ties", () => {
    const edits = [
      cut("revolutionary"),
      cut("revolutionary"),
      cut("revolutionary"),
      cut("revolutionary"),
      cut("seamless"),
      cut("seamless"),
      cut("seamless"),
    ];
    const folded = foldEdits(edits);
    expect(folded.neverSaysCandidates.map((c) => c.phrase)).toEqual([
      "revolutionary",
      "seamless",
    ]);
  });

  it("learns punctuation they consistently strip", () => {
    const edits = Array.from({ length: 3 }, () => ({
      before: "It works — really!",
      after: "It works.",
    }));
    const folded = foldEdits(edits);
    expect(folded.dislikedPunctuation).toContain("—");
    expect(folded.dislikedPunctuation).toContain("!");
  });

  it("learns they prefer shorter", () => {
    const folded = foldEdits([
      { before: "a very long sentence indeed", after: "short" },
      { before: "another long one here", after: "brief" },
      { before: "tiny", after: "a much longer rewrite than before" },
    ]);
    expect(folded.prefersShorter).toBe(true);
  });

  it("does NOT conclude they prefer shorter when they mostly expand", () => {
    const folded = foldEdits([
      { before: "short", after: "a considerably longer version" },
      { before: "brief", after: "another considerably longer version" },
    ]);
    expect(folded.prefersShorter).toBe(false);
  });

  it("learns they strip emoji", () => {
    const folded = foldEdits([
      { before: "shipped 🎉", after: "shipped" },
      { before: "done ✨", after: "done" },
    ]);
    expect(folded.dislikesEmoji).toBe(true);
  });

  it("does NOT conclude they dislike emoji when they keep them", () => {
    const folded = foldEdits([
      { before: "shipped", after: "shipped 🎉" },
      { before: "done 🎉", after: "done 🎉" },
    ]);
    expect(folded.dislikesEmoji).toBe(false);
  });

  it("no edits yields no conclusions — absence isn't a preference", () => {
    const folded = foldEdits([]);
    expect(folded.neverSaysCandidates).toEqual([]);
    expect(folded.dislikedPunctuation).toEqual([]);
    expect(folded.dislikesEmoji).toBe(false);
    expect(folded.editsSeen).toBe(0);
  });

  it("reports the sample size behind every conclusion", () => {
    expect(foldEdits([cut("x"), cut("y")]).editsSeen).toBe(2);
  });
});

describe("buildFewShot", () => {
  const edit = (n: number, changed = true) => ({
    before: `draft ${n} as she wrote it`,
    after: changed ? `draft ${n} as they sent it` : `draft ${n} as she wrote it`,
    decidedAt: NOW + n * 1000,
  });

  it("newest first — the recent correction is the one that still applies", () => {
    const shots = buildFewShot([edit(1), edit(3), edit(2)]);
    expect(shots.map((s) => s.after)).toEqual([
      "draft 3 as they sent it",
      "draft 2 as they sent it",
      "draft 1 as they sent it",
    ]);
  });

  it("drops no-op edits — they teach nothing and spend context", () => {
    // The workspace prompt budget has historically sat at zero headroom.
    const shots = buildFewShot([edit(1, false), edit(2)]);
    expect(shots).toHaveLength(1);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => edit(i));
    expect(buildFewShot(many, 5)).toHaveLength(5);
  });

  it("an approval with no edit produces no few-shot at all", () => {
    expect(buildFewShot([edit(1, false)])).toEqual([]);
  });
});

describe("selectExcerpts — source 2, free and nobody uses it", () => {
  const msg = (body: string, direction = "in", ts = NOW) => ({
    body,
    direction,
    ts,
  });

  it("collects the founder's own writing", () => {
    expect(
      selectExcerpts([
        msg("the migration runner keeps timing out on big tables, worth a post"),
      ])
    ).toHaveLength(1);
  });

  it("⭐ IGNORES HER OWN OUTBOUND — that's her voice, not theirs", () => {
    // Filtered inside the function rather than by the caller, so one
    // forgetful call site can't quietly make her converge on herself.
    expect(
      selectExcerpts([
        msg("something she wrote that is nice and long enough to pass every length check", "out"),
      ])
    ).toEqual([]);
  });

  it("drops approvals — 'post it' is a switch, not a writing sample", () => {
    expect(
      selectExcerpts([msg("ok"), msg("yes"), msg("post it"), msg("sure go ahead")])
    ).toEqual([]);
  });
});
