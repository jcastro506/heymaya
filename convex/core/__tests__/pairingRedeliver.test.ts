/**
 * Her first read can be written before they ever text (they skipped "Text Maya", or the line wasn't
 * set up yet); its delivery gives up after a day. Pairing later hands it over again, once, on both
 * pairing paths, and never re-sends a read that already reached them (2026-09-30, staging).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import type { Id } from "../../_generated/dataModel";

const redeliveries = (t: ReturnType<typeof convexTest>, c: Id<"creators">) => t.run(async (ctx) => (await ctx.db.query("jobs").collect()).filter((j) => j.creatorId === c && j.idempotencyKey.startsWith("redeliver:")));

describe("pairing after her first read", () => {
  it.each(["imessage", "telegram"] as const)("%s: an undelivered read is handed over again, once", async (surface) => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, `rd-${surface}`, { phone: "+15555550111", channel: { kind: surface, paired: false }, pairingToken: "tok", pairingExpiresAt: Date.now() + 60_000 }));
    const read = await t.run((ctx) => ctx.db.insert("messages", { creatorId: c, direction: "out", surface, body: "went through everything.", ts: Date.now() - 86_400_000, dedupeKey: `first_read:${c}`, kind: "first_read", deliveryError: "no phone number paired for this account" }));
    if (surface === "imessage") await t.mutation(internal.core.pairing.claimPairingByPhone, { token: "tok", phone: "+15555550111" });
    else await t.mutation(internal.core.pairing.claimPairing, { token: "tok", chatId: "789" });
    const jobs = await redeliveries(t, c);
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0].payloadJson!)).toEqual({ messageId: read });
  });

  it("a read that already reached them is not sent again; nobody else's read is touched", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "rd-done", { phone: "+15555550112", channel: { kind: "imessage", paired: false }, pairingToken: "tok2", pairingExpiresAt: Date.now() + 60_000 }));
    const other = await t.run((ctx) => seedCreator(ctx, "rd-other", { phone: "+15555550113", channel: { kind: "imessage", paired: false } }));
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", { creatorId: c, direction: "out", surface: "imessage", body: "read", ts: Date.now(), dedupeKey: `first_read:${c}`, kind: "first_read", deliveredAt: Date.now() });
      await ctx.db.insert("messages", { creatorId: other, direction: "out", surface: "imessage", body: "theirs", ts: Date.now(), dedupeKey: `first_read:${other}`, kind: "first_read", deliveryError: "no phone number paired for this account" });
    });
    await t.mutation(internal.core.pairing.claimPairingByPhone, { token: "tok2", phone: "+15555550112" });
    expect(await redeliveries(t, c)).toHaveLength(0);
    expect(await redeliveries(t, other)).toHaveLength(0);
  });
});
