import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { seedCreator } from "../../../tests/lib/creatorRow";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 6, 3, 9, 0, 0);
const LATER = Date.UTC(2026, 6, 17, 9, 0, 0);

async function seed(t: ReturnType<typeof convexTest>, suffix: string) {
  return await t.run(async (ctx) => seedCreator(ctx, suffix, { timezone: "UTC" }));
}

async function getRow(
  t: ReturnType<typeof convexTest>,
  id: Id<"directives">
): Promise<Doc<"directives"> | null> {
  return (await t.run((ctx) => ctx.db.get(id))) as Doc<"directives"> | null;
}

describe("INVARIANT 3 — a directive is never mutated", () => {
  it("NO CODE IN convex/maya PATCHES `verbatim`", () => {
    // The enforcement, and the reason it isn't just a convention. If someone
    // adds an "edit this rule" mutation, this fails — which is the moment to
    // have the conversation, not after a founder is quoted words they never
    // said.
    const dir = join(__dirname, "..");
    const offenders: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(join(dir, file), "utf8");
      // Any `db.patch(...)` whose object literal mentions `verbatim`.
      const patches = source.match(/db\.patch\([^)]*\{[^}]*\}/g) ?? [];
      for (const patch of patches) {
        if (/\bverbatim\b/.test(patch)) offenders.push(`${file}: ${patch.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("superseding leaves the original text byte-for-byte intact", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "supersede");

    const first = await t.mutation(internal.core.directives.append, {
      creatorId,
      kind: "channel_toggle",
      verbatim: "stop posting on linkedin its dead",
      now: NOW,
    });
    const second = await t.mutation(internal.core.directives.append, {
      creatorId,
      kind: "channel_toggle",
      verbatim: "ok turn linkedin back on",
      supersedesId: first.directiveId,
      now: LATER,
    });

    const original = await getRow(t, first.directiveId);
    // Including the missing apostrophe. This is the point.
    expect(original?.verbatim).toBe("stop posting on linkedin its dead");
    expect(original?.active).toBe(false);
    expect(original?.supersededAt).toBe(LATER);
    expect(second.superseded).toBe(first.directiveId);
  });

  it("the new row points back at what it replaced", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "chain");
    const first = await t.mutation(internal.core.directives.append, {
      creatorId,
      kind: "timing_window",
      verbatim: "dont post before 9",
      now: NOW,
    });
    const second = await t.mutation(internal.core.directives.append, {
      creatorId,
      kind: "timing_window",
      verbatim: "actually make it 10",
      supersedesId: first.directiveId,
      now: LATER,
    });
    const row = await getRow(t, second.directiveId);
    expect(row?.supersedesId).toBe(first.directiveId);
  });

  it("nothing is ever deleted — forgotten rules stay quotable", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "forget");
    const { directiveId } = await t.mutation(internal.core.directives.append, {
      creatorId,
      kind: "phrase_ban",
      verbatim: "stop saying game-changer",
      now: NOW,
    });
    await t.mutation(internal.core.directives.forget, {
      creatorId,
      directiveId,
      now: LATER,
    });

    const row = await getRow(t, directiveId);
    expect(row).not.toBeNull();
    expect(row?.verbatim).toBe("stop saying game-changer");
    expect(row?.active).toBe(false);
  });

  it("CROSS-TENANT: you cannot supersede another account's rule", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "sup_a");
    const b = await seed(t, "sup_b");
    const theirs = await t.mutation(internal.core.directives.append, {
      creatorId: b,
      kind: "voice",
      verbatim: "B's rule",
      now: NOW,
    });
    const result = await t.mutation(internal.core.directives.append, {
      creatorId: a,
      kind: "voice",
      verbatim: "A trying to override B",
      supersedesId: theirs.directiveId,
      now: LATER,
    });

    expect(result.superseded).toBeNull();
    expect((await getRow(t, theirs.directiveId))?.active).toBe(true);
  });

  it("CROSS-TENANT: you cannot forget another account's rule", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "forget_a");
    const b = await seed(t, "forget_b");
    const theirs = await t.mutation(internal.core.directives.append, {
      creatorId: b,
      kind: "voice",
      verbatim: "B's rule",
      now: NOW,
    });
    const result = await t.mutation(internal.core.directives.forget, {
      creatorId: a,
      directiveId: theirs.directiveId,
    });
    expect(result.forgotten).toBe(false);
    expect((await getRow(t, theirs.directiveId))?.active).toBe(true);
  });
});

describe("the verbatim quote — what makes it worth storing", () => {
  it("keeps casing, typos and punctuation exactly as typed", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "exact");
    const messy = "  STOP posting on linkedin ,, its dead!!  ";
    const { directiveId } = await t.mutation(internal.core.directives.append, {
      creatorId,
      kind: "channel_toggle",
      verbatim: messy,
      now: NOW,
    });
    // Not trimmed, not sentence-cased, not tidied. A paraphrase is a summary
    // of a rule; the quote is proof you were listening.
    expect((await getRow(t, directiveId))?.verbatim).toBe(messy);
  });

  it("our interpretation lives in a separate field so the quote stays clean", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "interp");
    const { directiveId } = await t.mutation(internal.core.directives.append, {
      creatorId,
      kind: "channel_toggle",
      verbatim: "linkedin is dead to me",
      interpretationJson: JSON.stringify({ channel: "linkedin", enabled: false }),
      now: NOW,
    });
    const row = await getRow(t, directiveId);
    expect(row?.verbatim).toBe("linkedin is dead to me");
    expect(JSON.parse(row?.interpretationJson ?? "{}")).toEqual({
      channel: "linkedin",
      enabled: false,
    });
  });
});

describe("the three commands that always work", () => {
  it("'what rules are you following?' returns active rules, newest first", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "rules");
    for (const [i, text] of ["first rule", "second rule", "third rule"].entries()) {
      await t.mutation(internal.core.directives.append, {
        creatorId,
        kind: "voice",
        verbatim: text,
        now: NOW + i * 1000,
      });
    }
    const rules = await t.query(internal.core.directives.activeRules, {
      creatorId,
    });
    expect(rules.map((r: Doc<"directives">) => r.verbatim)).toEqual([
      "third rule",
      "second rule",
      "first rule",
    ]);
  });

  it("'forget that' takes it out of the active set but not the history", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "cmd_forget");
    const { directiveId } = await t.mutation(internal.core.directives.append, {
      creatorId,
      kind: "topic",
      verbatim: "post more about pricing",
      now: NOW,
    });
    await t.mutation(internal.core.directives.forget, { creatorId, directiveId });

    expect(
      await t.query(internal.core.directives.activeRules, { creatorId })
    ).toHaveLength(0);
    expect(
      await t.query(internal.core.directives.history, { creatorId })
    ).toHaveLength(1);
  });

  it("'why did you do X?' is answered from the stored history, not reconstructed", async () => {
    // A model asked to explain its own past behavior produces a plausible
    // story. Plausible-and-wrong is worse than "I don't know".
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "why");
    await t.mutation(internal.core.directives.append, {
      creatorId,
      kind: "timing_window",
      verbatim: "dont post before 9",
      now: NOW,
    });
    const history = await t.query(internal.core.directives.history, {
      creatorId,
      kind: "timing_window",
    });
    expect(history[0].verbatim).toBe("dont post before 9");
    expect(history[0].createdAt).toBe(NOW);
  });

  it("rules are scoped per creator", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "scope_a");
    const b = await seed(t, "scope_b");
    await t.mutation(internal.core.directives.append, {
      creatorId: b,
      kind: "voice",
      verbatim: "B's private rule",
      now: NOW,
    });
    expect(
      await t.query(internal.core.directives.activeRules, { creatorId: a })
    ).toEqual([]);
  });
});

describe("precedence — recency wins, but never silently", () => {
  it("the newest rule of a kind wins", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "precedence");
    await t.mutation(internal.core.directives.append, {
      creatorId,
      kind: "timing_window",
      verbatim: "dont post before 9",
      now: NOW,
    });
    await t.mutation(internal.core.directives.append, {
      creatorId,
      kind: "timing_window",
      verbatim: "make it 10 actually",
      now: LATER,
    });
    const { winning } = await t.query(internal.core.directives.effectiveRule, {
      creatorId,
      kind: "timing_window",
    });
    expect(winning?.verbatim).toBe("make it 10 actually");
  });

  it("and hands back what it replaced, so it can be NAMED in a clause", async () => {
    // "I moved you to 10am, which replaces the 9am you asked for in July."
    // Silently applying the newer rule is how a founder loses track of what
    // their own employee is doing.
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "named");
    const first = await t.mutation(internal.core.directives.append, {
      creatorId,
      kind: "timing_window",
      verbatim: "dont post before 9",
      now: NOW,
    });
    await t.mutation(internal.core.directives.append, {
      creatorId,
      kind: "timing_window",
      verbatim: "make it 10 actually",
      supersedesId: first.directiveId,
      now: LATER,
    });
    const { supersededChain } = await t.query(
      internal.core.directives.effectiveRule,
      { creatorId, kind: "timing_window" }
    );
    expect(supersededChain).toHaveLength(1);
    expect(supersededChain[0].verbatim).toBe("dont post before 9");
  });

  it("walks a chain of three back to the original", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "deep_chain");
    let prev: Id<"directives"> | undefined;
    for (const [i, text] of ["9am", "10am", "11am"].entries()) {
      const res = await t.mutation(internal.core.directives.append, {
        creatorId,
        kind: "timing_window",
        verbatim: text,
        supersedesId: prev,
        now: NOW + i * 86_400_000,
      });
      prev = res.directiveId;
    }
    const { winning, supersededChain } = await t.query(
      internal.core.directives.effectiveRule,
      { creatorId, kind: "timing_window" }
    );
    expect(winning?.verbatim).toBe("11am");
    expect(supersededChain.map((r: Doc<"directives">) => r.verbatim)).toEqual([
      "10am",
      "9am",
    ]);
  });

  it("kinds don't interfere — a voice rule never wins a timing question", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "kinds");
    await t.mutation(internal.core.directives.append, {
      creatorId,
      kind: "timing_window",
      verbatim: "dont post before 9",
      now: NOW,
    });
    await t.mutation(internal.core.directives.append, {
      creatorId,
      kind: "voice",
      verbatim: "stop saying game-changer",
      now: LATER,
    });
    const { winning } = await t.query(internal.core.directives.effectiveRule, {
      creatorId,
      kind: "timing_window",
    });
    expect(winning?.verbatim).toBe("dont post before 9");
  });

  it("no rule of that kind is null, not a guess", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "none");
    const { winning, supersededChain } = await t.query(
      internal.core.directives.effectiveRule,
      { creatorId, kind: "cadence" }
    );
    expect(winning).toBeNull();
    expect(supersededChain).toEqual([]);
  });
});
