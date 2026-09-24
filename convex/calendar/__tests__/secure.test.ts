import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { atLocalHour } from "../postTime";
import { offerText } from "../secure";

const TZ = "America/New_York";
const WED_3PM = atLocalHour(Date.UTC(2026, 8, 9, 12, 0), 15, TZ);

async function creatorWithIdea(t: ReturnType<typeof convexTest>) {
  const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: TZ, channel: { paired: true }, plan: { status: "active", founding: true }, dossier: { persona: { summary: "runner" }, keywords: ["running"] } }));
  const ideaId = await t.run((ctx) => ctx.db.insert("ideas", { creatorId, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook: "the shoe rack list" }, messageText: "the shoe rack list", produced: { skillVersion: "t", model: "m", thresholdsVersion: "t" }, sentAt: WED_3PM - 3_600_000, status: "sent", createdAt: WED_3PM - 3_600_000 } as never));
  const messageId = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "out", surface: "telegram", body: "idea: the shoe rack list", ts: WED_3PM - 3_600_000, proactive: true, kind: "scout", ideaId, deliveredAt: WED_3PM - 3_600_000 }));
  return { creatorId, ideaId, messageId };
}

describe("nothing they agree to make is left without a time (2026-09-06)", () => {
  it("proposes tomorrow at their film hour, around what is already on the calendar, and never twice for one idea", async () => {
    const t = convexTest(schema, modules);
    const { creatorId, ideaId } = await creatorWithIdea(t);
    // Tomorrow 5 pm is taken.
    const tomorrow5 = atLocalHour(WED_3PM + 86_400_000, 17, TZ);
    await t.run((ctx) => ctx.db.insert("calendarEvents", { creatorId, externalId: "e1", calendarId: "c", title: "dentist", start: tomorrow5, end: tomorrow5 + 3_600_000, allDay: false, recurring: false, status: "active", class: "private", classifiedBy: "code", updatedAt: WED_3PM, createdAt: WED_3PM }));
    const p = await t.mutation(internal.calendar.secure.proposeSlot, { creatorId, ideaId, now: WED_3PM });
    expect(p).not.toBeNull();
    expect(p!.existing).toBe(false);
    expect(p!.start).toBeGreaterThan(WED_3PM);
    expect(p!.start < tomorrow5 || p!.start >= tomorrow5 + 3_600_000, "not on top of the dentist").toBe(true);
    const again = await t.mutation(internal.calendar.secure.proposeSlot, { creatorId, ideaId, now: WED_3PM });
    expect(again!.existing).toBe(true);
    expect(again!.blockId).toBe(p!.blockId);
    expect((await t.run((ctx) => ctx.db.query("calendarBlocks").collect())).length).toBe(1);
    expect(offerText(p!.start, TZ, "the shoe rack list")).toMatch(/is free for "the shoe rack list"\. block it/);
  });

  describe("through a conversation turn, on the fake model", () => {
    beforeAll(() => { process.env.MODEL_FAKE = "1"; });
    afterAll(() => { delete process.env.MODEL_FAKE; });
    afterEach(() => vi.useRealTimers());

    it("a save tap is answered with a slot and one tap to block it", async () => {
      const t = convexTest(schema, modules);
      const { creatorId, ideaId } = await creatorWithIdea(t);
      // A button tap is recorded by the Telegram webhook with kind "button"; the row is the same.
      const messageId = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", body: `idea:${ideaId}:save`, ts: WED_3PM, kind: "button" }));
      const c = await t.action(internal.agent.converse.run, { creatorId, messageId });
      expect(c.ok).toBe(true);
      const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
      const offer = out.find((m) => (m.buttons ?? []).some((b) => b.id.startsWith("block:")));
      expect(offer, "the offer with block buttons").toBeTruthy();
      expect(offer!.body).toMatch(/is free for/);
      const blocks = await t.run((ctx) => ctx.db.query("calendarBlocks").collect());
      expect(blocks.length).toBe(1);
      expect(blocks[0].ideaId).toBe(ideaId);
      expect(blocks[0].consentAt).toBeUndefined();
    });

    it("a warm reply to an idea gets the same offer, a beat after her reply", async () => {
      const t = convexTest(schema, modules);
      const { creatorId, ideaId } = await creatorWithIdea(t);
      // All timers faked: the offer is scheduled two seconds after her reply, and runAllTimers must reach it.
      vi.useFakeTimers({ now: WED_3PM });
      const { messageId } = await t.mutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: "love it, filming that tomorrow" });
      const c = await t.action(internal.agent.converse.run, { creatorId, messageId });
      expect(c.ok).toBe(true);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
      expect(out.some((m) => (m.buttons ?? []).some((b) => b.id.startsWith("block:"))), "the offer follows the reply").toBe(true);
      const blocks = await t.run((ctx) => ctx.db.query("calendarBlocks").collect());
      expect(blocks.filter((b) => b.ideaId === ideaId).length).toBe(1);
      const taste = await t.run((ctx) => ctx.db.query("tasteEvents").collect());
      expect(taste.some((e) => e.kind === "reply_pos")).toBe(true);
    });
  });
});
