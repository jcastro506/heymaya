import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { captureStyle, personalHistoryFor } from "../personalHistory";
import { selectRelevantCallbacks, type Callback } from "../callbacks";
import { ensureSeparated } from "../../taste/separation";

const day = 86_400_000;

describe("personal continuity", () => {
  it("rebuilds legacy mixed scores without treating a flop as a dislike", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "split", { affinities: [{ key: "format:vlog", kind: "format", score: -2, n: 2 }], taste: { text: "hates vlogs", version: 1, updatedAt: 1, eventsSeen: 2 } }));
    await t.run(async (ctx) => {
      await ctx.db.insert("tasteEvents", { creatorId, kind: "heart", weight: 1, features: ["format:vlog"], at: Date.now() });
      await ctx.db.insert("tasteEvents", { creatorId, kind: "outcome_flop", weight: -3, features: ["format:vlog"], at: Date.now() });
      const clean = await ensureSeparated(ctx, (await ctx.db.get(creatorId))!);
      expect(clean.affinities[0].score).toBe(1);
      expect(clean.performanceAffinities![0].score).toBe(-3);
      expect(clean.taste).toBeUndefined();
      expect((await ensureSeparated(ctx, clean)).affinities).toEqual(clean.affinities);
    });
  });

  it("keeps dated style examples from separate periods and freezes each snapshot", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "style"));
    const now = Date.now();
    await t.run(async (ctx) => {
      for (const [at, caption] of [[now - 60 * day, "quiet morning"], [now, "A much longer caption describing the afternoon by the river today"]] as const) {
        for (let i = 1; i <= 5; i++) await ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: `${at}-${i}`, url: `https://tiktok.com/${at}/${i}`, createTime: at - i * day, contentType: "video", hashtags: [], caption, metrics: { views: 100, likes: 1, comments: 0, shares: 0 }, metricsAsOf: at, source: "scrape" });
        await captureStyle(ctx, creatorId, at);
        await captureStyle(ctx, creatorId, at);
      }
      const rows = await ctx.db.query("personalRecords").collect();
      expect(rows).toHaveLength(2);
      expect(rows[0].facts?.medianWords).toBe(2);
      expect(rows[1].facts!.medianWords).toBeGreaterThan(8);
      const context = await personalHistoryFor(ctx, creatorId);
      expect(context).toContain("quiet morning");
      expect(context).toContain("afternoon by the river");
      expect(context).toContain("post ");
    });
  });

  it("stores the user's reason, rejects invented quotes, and reads commitment state from the action", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "decision"));
    const sourceMessageId = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", body: "I'll film the vlog Friday because it takes less editing", ts: Date.now() }));
    const blockId = await t.run((ctx) => ctx.db.insert("calendarBlocks", { creatorId, kind: "film", start: Date.now() + day, end: Date.now() + day + 3_600_000, title: "vlog", status: "confirmed", consentAt: Date.now(), createdAt: Date.now() }));
    const args = { creatorId, sourceMessageId, kind: "commitment" as const, quote: "I'll film the vlog Friday", reason: "it takes less editing", blockId: String(blockId), epoch: 0 };
    expect(await t.mutation(internal.agent.remember.recordExperience, { ...args, quote: "I hate all tutorials" })).toBe(false);
    expect(await t.mutation(internal.agent.remember.recordExperience, args)).toBe(true);
    expect(await t.mutation(internal.agent.remember.recordExperience, args)).toBe(false);
    let context = await t.run((ctx) => personalHistoryFor(ctx, creatorId));
    expect(context).toContain("booked for");
    expect(context).toContain("less editing");
    await t.run((ctx) => ctx.db.patch(blockId, { status: "deleted" }));
    context = await t.run((ctx) => personalHistoryFor(ctx, creatorId));
    expect(context).toContain("cancelled");
    expect(context).not.toContain("booked for");
  });

  it("does not claim an unlinked promise is scheduled", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "promise"));
    const sourceMessageId = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", body: "I'll film the vlog", ts: Date.now() }));
    await t.mutation(internal.agent.remember.recordExperience, { creatorId, sourceMessageId, kind: "commitment", quote: "I'll film the vlog", epoch: 0 });
    expect(await t.run((ctx) => personalHistoryFor(ctx, creatorId))).toContain("no linked scheduled action");
  });

  it("suppresses repeated unrelated callbacks but answers a direct reference", () => {
    const dog: Callback = { kind: "world", line: "fluffy dog chasing pigeons", why: "world" };
    const ceramics: Callback = { kind: "note", line: "ceramics class starts tomorrow", why: "upcoming" };
    expect(selectRelevantCallbacks([dog, ceramics], "ceramics plans", ["the fluffy dog chasing pigeons!"])).toEqual([ceramics]);
    expect(selectRelevantCallbacks([dog], "", ["the fluffy dog chasing pigeons!"])).toEqual([]);
    expect(selectRelevantCallbacks([dog], "that dog clip", ["the fluffy dog chasing pigeons!"])).toEqual([dog]);
  });

  it("forgetting invalidates descendants, repeated sources, and stale background writes", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "forget-tree", { dossier: { persona: { world: "sister films everything" } }, dossierPrevious: { stale: true }, taste: { text: "sister films everything", version: 1, updatedAt: 1, eventsSeen: 1 } }));
    const sourceMessageId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", body: "my sister films everything", ts: Date.now() });
      await ctx.db.insert("messages", { creatorId, direction: "out", surface: "telegram", body: "my sister films everything — you said", deliveredAt: Date.now(), ts: Date.now() });
      await ctx.db.patch(creatorId, { notes: [{ id: "n", text: "my sister films everything", kind: "fact", at: Date.now(), sourceMessageId: id }] });
      await ctx.db.insert("directives", { creatorId, kind: "rule", verbatim: "my sister films everything", active: true, source: "chat", sourceMessageId: id, createdAt: Date.now() });
      await ctx.db.insert("tasteEvents", { creatorId, messageId: id, kind: "reply_pos", weight: 1, features: ["topic:sister"], at: Date.now() });
      return id;
    });
    await t.mutation(internal.agent.remember.recordExperience, { creatorId, sourceMessageId, kind: "effort", quote: "my sister films everything", epoch: 0 });
    await t.mutation(internal.agent.commands.apply, { creatorId, command: "forget" });
    await t.mutation(internal.onboarding.ingest.writeDossier, { creatorId, dossier: { resurrected: true }, mode: "thin", epoch: 0 });
    await t.mutation(internal.taste.profile.store, { creatorId, text: "resurrected", eventsSeen: 1, epoch: 0 });
    const creator = await t.run((ctx) => ctx.db.get(creatorId));
    expect(creator?.dossier).toBeUndefined();
    expect(creator?.dossierPrevious).toBeUndefined();
    expect(creator?.taste).toBeUndefined();
    expect(creator?.memoryEpoch).toBe(1);
    expect(creator?.affinities).toEqual([]);
    expect((await t.run((ctx) => ctx.db.query("directives").collect()))[0].active).toBe(false);
    expect(await t.query(internal.agent.memory.personal, { creatorId, query: "sister" })).toEqual([]);
    expect(await t.query(internal.agent.memory.conversations, { creatorId, query: "sister" })).toEqual([]);
  });
});
