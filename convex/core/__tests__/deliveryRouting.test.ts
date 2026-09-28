/**
 * A row goes to their messenger as it is at delivery, not as it was when written (product sim,
 * 2026-09-28): the first read is written at signup, often before they give a number, and was stamped
 * "telegram"; for someone who then paired by text it would have died as "no Telegram chat". And a
 * number is never texted before its owner texts us (inbound-first): the row waits, and pairing sends it.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

const PHONE = "+15551234567";

describe("delivery routes by their messenger now", () => {
  beforeEach(() => { process.env.CLAW_FAKE = "1"; process.env.CLAW_API_KEY = "cm_live_test"; process.env.CLAW_LINE_NUMBER = "+15550009999"; });
  afterEach(() => { delete process.env.CLAW_FAKE; delete process.env.CLAW_API_KEY; delete process.env.CLAW_LINE_NUMBER; });

  it("a first read written before they gave a number waits, is never texted before pairing, and goes by text once they pair", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: false } }));
    const row = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "out", surface: "telegram", body: "your first read", dedupeKey: `first_read:x`, proactive: true, ts: Date.now() } as never)) as Id<"messages">;
    // They give a number (not yet texted us): still nothing goes to that number.
    await t.run((ctx) => ctx.db.patch(creatorId, { phone: PHONE, channel: { paired: false, kind: "imessage" } }));
    const early = await t.action(internal.core.telegram.deliverMessage, { messageId: row });
    expect(early).toMatchObject({ delivered: false, reason: "no phone number paired for this account" });
    // They text START: paired. The same row now goes by text.
    await t.run((ctx) => ctx.db.patch(creatorId, { channel: { paired: true, kind: "imessage", pairedAt: Date.now() } }));
    const now = await t.action(internal.core.telegram.deliverMessage, { messageId: row });
    expect(now.delivered, now.reason).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(row)))?.deliveredAt).toBeTypeOf("number");
  });

  it("a Telegram creator's rows still go to Telegram, and web rows stay web (sibling coherence)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "b", { channel: { paired: true, kind: "telegram" } }));
    const row = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "out", surface: "imessage", body: "x", ts: Date.now() } as never)) as Id<"messages">;
    const target = await t.query(internal.core.telegram.deliveryTarget, { messageId: row });
    expect(target?.surface).toBe("telegram");
    const web = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "out", surface: "web", body: "y", ts: Date.now() } as never)) as Id<"messages">;
    expect((await t.query(internal.core.telegram.deliveryTarget, { messageId: web }))?.surface).toBe("web");
  });
});
