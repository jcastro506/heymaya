/** §15.7 layer 2: notes and rules from what they say, once each, never invented here. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

describe("remember", () => {
  it("a note is appended once; the same words again confirm it instead of duplicating", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    expect(await t.mutation(internal.agent.remember.addNote, { creatorId, text: "training for Chicago in October", kind: "life", expiresDays: 60 })).toEqual({ added: true });
    expect(await t.mutation(internal.agent.remember.addNote, { creatorId, text: "Training for chicago in october", kind: "life" })).toEqual({ added: false });
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    expect(c?.notes).toHaveLength(1);
    expect(c?.notes[0].confirmedAt).toBeTypeOf("number");
    expect(c?.notes[0].expiresHint).toBeTypeOf("number");
  });

  it("a rule in their words lands as an active directive, once", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    expect(await t.mutation(internal.agent.remember.addRule, { creatorId, verbatim: "never suggest dance trends" })).toEqual({ added: true });
    expect(await t.mutation(internal.agent.remember.addRule, { creatorId, verbatim: "Never suggest dance trends" })).toEqual({ added: false });
    // Live 2026-09-09: "keep running as texture" and "running stays the main thing" both sat active. The newer one retires the older.
    expect(await t.mutation(internal.agent.remember.addRule, { creatorId, verbatim: "running stays the main thing", supersedesRule: "never suggest dance trends" })).toEqual({ added: true, superseded: true });
    const active = (await t.run((ctx) => ctx.db.query("directives").collect())).filter((d) => d.active).map((d) => d.verbatim);
    expect(active).toEqual(["running stays the main thing"]);
    const rules = await t.run((ctx) => ctx.db.query("directives").collect());
    expect(rules.map((r) => [r.verbatim, r.active])).toEqual([["never suggest dance trends", false], ["running stays the main thing", true]]);
  });
});
