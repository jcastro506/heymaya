/** §15.7 (4): memory rows are scoped by creator even when fetched by id; recall phrasing is recognised. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { asksToRecall } from "../inbound";

const vec = (seed: number) => Array.from({ length: 768 }, (_, i) => Math.sin(seed + i));

describe("memory", () => {
  it("upsert is keyed by (creator, ref); byIds never returns another creator's row", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" } }));
    const id1 = await t.mutation(internal.agent.memory.upsert, { creatorId: a, kind: "swipe", refId: "idea_1", text: "the shoe rack list", embedding: vec(1) });
    const id1again = await t.mutation(internal.agent.memory.upsert, { creatorId: a, kind: "swipe", refId: "idea_1", text: "the shoe rack list, edited", embedding: vec(2) });
    expect(id1again).toBe(id1);
    const idB = await t.mutation(internal.agent.memory.upsert, { creatorId: b, kind: "note", refId: "n_1", text: "b's note", embedding: vec(3) });
    expect(await t.run((ctx) => ctx.db.query("memories").collect())).toHaveLength(2);
    const rows = await t.query(internal.agent.memory.byIds, { creatorId: a, ids: [id1, idB] });
    expect(rows.map((r) => r.text)).toEqual(["the shoe rack list, edited"]);
  });

  it("recognises a look back", () => {
    expect(asksToRecall("what was that idea about the shoe rack")).toBe(true);
    expect(asksToRecall("remember the one where i film at the track?")).toBe(true);
    expect(asksToRecall("did i save the mile repeat thing")).toBe(true);
    expect(asksToRecall("thoughts on this hook?")).toBe(false);
  });
});
