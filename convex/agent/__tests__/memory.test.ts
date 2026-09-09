/** §15.7 (4): memory rows are scoped by creator even when fetched by id; recall phrasing is recognised. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

const vec = (seed: number) => Array.from({ length: 768 }, (_, i) => Math.sin(seed + i));

describe("memory", () => {
  it("upsert is keyed by (creator, ref); byIds never returns another creator's row", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { notes: [{ id: "idea_1", text: "the shoe rack list, edited", kind: "fact", at: Date.now() }] }));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" } }));
    const id1 = await t.mutation(internal.agent.memory.upsert, { creatorId: a, kind: "note", refId: "idea_1", text: "the shoe rack list", embedding: vec(1) });
    const id1again = await t.mutation(internal.agent.memory.upsert, { creatorId: a, kind: "note", refId: "idea_1", text: "the shoe rack list, edited", embedding: vec(2) });
    expect(id1again).toBe(id1);
    const idB = await t.mutation(internal.agent.memory.upsert, { creatorId: b, kind: "note", refId: "n_1", text: "b's note", embedding: vec(3) });
    expect(await t.run((ctx) => ctx.db.query("memories").collect())).toHaveLength(2);
    if (!id1 || !idB) throw new Error("fixture did not persist");
    const rows = await t.query(internal.agent.memory.byIds, { creatorId: a, ids: [id1, idB] });
    expect(rows.map((r) => r.text)).toEqual(["the shoe rack list, edited"]);
  });

  it("text remains searchable without embeddings and expired facts are excluded", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "lex", { notes: [
      { id: "live", text: "filming ceramics", kind: "fact", at: Date.now() },
      { id: "old", text: "ceramics trip", kind: "life", at: 1, expiresHint: 2 },
    ] }));
    for (const refId of ["live", "old"]) await t.mutation(internal.agent.memory.upsert, { creatorId, kind: "note", refId, text: `ceramics ${refId}` });
    const rows = await t.query(internal.agent.memory.lexical, { creatorId, query: "ceramics" });
    expect(rows.map((r) => r.refId)).toEqual(["live"]);
  });

  it("forget removes the search copy and excludes its original message from recall", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "forget"));
    const sourceMessageId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", body: "my sister films ceramics", ts: Date.now() });
      await ctx.db.patch(creatorId, { notes: [{ id: "n", text: "sister films ceramics", kind: "fact", at: Date.now(), sourceMessageId: id }] });
      return id;
    });
    const memoryId = await t.mutation(internal.agent.memory.upsert, { creatorId, kind: "note", refId: "n", text: "sister ceramics", embedding: vec(1) });
    await t.mutation(internal.agent.commands.apply, { creatorId, command: "forget" });
    expect(await t.query(internal.agent.memory.lexical, { creatorId, query: "ceramics" })).toEqual([]);
    expect(await t.query(internal.agent.memory.conversations, { creatorId, query: "ceramics" })).toEqual([]);
    expect(await t.mutation(internal.agent.remember.addNote, { creatorId, sourceMessageId, text: "sister films ceramics", kind: "fact" })).toEqual({ added: false });
    expect(memoryId && await t.run((ctx) => ctx.db.get(memoryId))).toBeNull();
  });

  it("retrieves an old conversation with context, excluding other users, undelivered messages and expired history", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "archive"));
    const b = await t.run((ctx) => seedCreator(ctx, "other", { clerkUserId: "other" }));
    const ts = Date.now() - 90 * 86_400_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", { creatorId: a, direction: "out", surface: "telegram", body: "want to try a ceramics series?", ts, deliveredAt: ts });
      await ctx.db.insert("messages", { creatorId: a, direction: "in", surface: "telegram", body: "yes, but no tutorials", ts: ts + 1 });
      await ctx.db.insert("messages", { creatorId: b, direction: "in", surface: "telegram", body: "ceramics SECRET", ts });
      await ctx.db.insert("messages", { creatorId: a, direction: "out", surface: "telegram", body: "ceramics UNSENT", ts: ts + 2 });
      await ctx.db.insert("messages", { creatorId: a, direction: "in", surface: "telegram", body: "ceramics EXPIRED", ts: Date.now() - 366 * 86_400_000 });
    });
    const rows = await t.query(internal.agent.memory.conversations, { creatorId: a, query: "ceramics" });
    const text = rows.map((r) => r.text).join("\n");
    expect(text).toContain("no tutorials");
    expect(text).not.toMatch(/SECRET|UNSENT|EXPIRED/);
  });

  it("late embedding results cannot overwrite an edited memory", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "race"));
    const id = await t.mutation(internal.agent.memory.upsert, { creatorId, kind: "note", refId: "n", text: "old" });
    if (!id) throw new Error("missing fixture");
    await t.mutation(internal.agent.memory.upsert, { creatorId, kind: "note", refId: "n", text: "new" });
    expect(await t.mutation(internal.agent.memory.finishEmbedding, { id, text: "old", embedding: vec(1) })).toBe(false);
    expect((await t.run((ctx) => ctx.db.get(id)))?.embedding).toBeUndefined();
  });

  it("a sourced correction retires the previous note and rejects another user's source", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "correction", { notes: [{ id: "old", text: "lives in London", kind: "fact", at: 1 }] }));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "b" }));
    const sourceMessageId = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", body: "I moved to Paris", ts: Date.now() }));
    const bad = await t.mutation(internal.agent.remember.addNote, { creatorId: b, text: "Paris", kind: "fact", sourceMessageId });
    expect(bad.added).toBe(false);
    await t.mutation(internal.agent.remember.addNote, { creatorId, text: "lives in Paris", kind: "fact", sourceMessageId, supersedesNoteId: "old" });
    const creator = await t.run((ctx) => ctx.db.get(creatorId));
    expect(creator?.notes.find((n) => n.id === "old")?.tombstonedAt).toBeTypeOf("number");
  });

});
