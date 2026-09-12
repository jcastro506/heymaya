import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { OPENING_QUESTION, openingQuestionFor } from "../conversation";
import { personalHistoryFor } from "../../agent/personalHistory";
import { callModel } from "../../core/llm";

vi.mock("../../core/llm", () => ({ callModel: vi.fn() }));

describe("conversational onboarding", () => {
  it.each(["imessage", "telegram"] as const)("still asks once on %s when the post read finished before pairing", async (surface) => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, `early-${surface}`, { conversationalOnboardingAt: Date.now(), phone: "+15555550101", channel: { kind: surface, paired: false }, pairingToken: "early", pairingExpiresAt: Date.now() + 60_000 }));
    await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "out", surface, body: "your trail running clip has a strong opening.", ts: Date.now(), dedupeKey: `first_read:${creatorId}`, kind: "first_read" }));
    if (surface === "imessage") await t.mutation(internal.core.pairing.claimPairingByPhone, { token: "early", phone: "+15555550101" });
    else await t.mutation(internal.core.pairing.claimPairing, { token: "early", chatId: "456" });
    const rows = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(rows.filter((r) => r.body === openingQuestionFor(false))).toHaveLength(1); // §26: no plan tier means no brand deals in the opening
    expect(rows.filter((r) => r.kind === "first_read")).toHaveLength(1);
  });
  it.each(["imessage", "telegram"] as const)("pairs %s with one clear opening question on the correct channel", async (surface) => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, surface, { phone: "+15555550100", channel: { kind: surface, paired: false }, pairingToken: "hello", pairingExpiresAt: Date.now() + 60_000 }));
    if (surface === "imessage") await t.mutation(internal.core.pairing.claimPairingByPhone, { token: "hello", phone: "+15555550100" });
    else await t.mutation(internal.core.pairing.claimPairing, { token: "hello", chatId: "123" });
    const rows = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(rows.every((m) => m.surface === surface)).toBe(true);
    expect(rows.map((m) => m.body).join("\n")).toContain(openingQuestionFor(false));
    expect(rows.map((m) => m.body).join("\n").match(/\?/g)).toHaveLength(1);
    expect(rows.some((m) => m.awaitingAnswer)).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.conversationalOnboardingAt).toBeTypeOf("number");
    if (surface === "imessage") {
      await t.mutation(internal.core.pairing.claimPairingByPhone, { phone: "+15555550100" });
      expect(await t.run((ctx) => ctx.db.query("messages").collect())).toHaveLength(rows.length);
    }
  });

  it("extracts a short goal answer with the opening as context, persists it and survives ordinary feedback", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "goal"));
    const messageId = await t.run(async (ctx) => {
      await ctx.db.insert("messages", { creatorId, direction: "out", surface: "imessage", body: OPENING_QUESTION, ts: Date.now() - 1, deliveredAt: Date.now() - 1 });
      return ctx.db.insert("messages", { creatorId, direction: "in", surface: "imessage", body: "brand deals", ts: Date.now() });
    });
    vi.mocked(callModel).mockResolvedValueOnce({ ok: true, content: JSON.stringify({ note: null, rule: null, experience: { kind: "goal", quote: "brand deals" } }) } as Awaited<ReturnType<typeof callModel>>);
    await t.action(internal.agent.remember.afterTurn, { creatorId, messageId });
    expect(JSON.stringify(vi.mocked(callModel).mock.calls.at(-1)?.[1].messages)).toContain(OPENING_QUESTION);
    await t.run(async (ctx) => {
      for (let i = 0; i < 85; i++) await ctx.db.insert("personalRecords", { creatorId, kind: "preference", key: `feedback:${i}`, text: "likes this hook", active: true, at: Date.now(), sourceMessageIds: [], sourcePostIds: [], sourceNoteIds: [] });
    });
    const history = await t.run((ctx) => personalHistoryFor(ctx, creatorId));
    expect(history).toContain("brand deals");
    expect(history).toContain("stated aspiration, not consent");
    expect(await t.run((ctx) => ctx.db.query("calendarBlocks").collect())).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(messageId)))?.memoryProcessedAt).toBeTypeOf("number");
  });

  it("rejects invented and cross-user goals and excludes forgotten goal sources", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "own"));
    const other = await t.run((ctx) => seedCreator(ctx, "other"));
    const sourceMessageId = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "in", surface: "imessage", body: "post twice a week", ts: Date.now() }));
    const args = { creatorId, sourceMessageId, kind: "goal" as const, quote: "post twice a week", epoch: 0 };
    expect(await t.mutation(internal.agent.remember.recordExperience, { ...args, creatorId: other })).toBe(false);
    expect(await t.mutation(internal.agent.remember.recordExperience, { ...args, quote: "reach 100k followers" })).toBe(false);
    expect(await t.mutation(internal.agent.remember.recordExperience, args)).toBe(true);
    expect(await t.mutation(internal.agent.remember.recordExperience, args)).toBe(false);
    await t.run((ctx) => ctx.db.patch(sourceMessageId, { memoryExcludedAt: Date.now() }));
    expect(await t.run((ctx) => personalHistoryFor(ctx, creatorId))).not.toContain("post twice a week");
  });
});
