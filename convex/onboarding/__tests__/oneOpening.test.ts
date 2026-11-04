/**
 * One opening (2026-11-03). A tester finished onboarding in the app, her read was written half an hour before
 * she texted START, and pairing then sent the four-text hello AND the waiting read: eight texts in eleven
 * seconds, Maya introducing herself twice, the read first and "what i noticed is coming right up" after it.
 * Now a waiting read IS the opening: greeting, the read without her introduction, the save-the-number ask.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { splitParts, MAX_PARTS } from "../../core/envelope";
import { openingWithRead } from "../hello";
import { saveContactLine } from "../conversation";

// The shape of the read that went out (three texts: an observation, her own intro, a question), words changed.
const READ = [
  "Ok, went through everything. That homemade costume is wild, the patience alone.",
  "I'm Maya. Basically I'm here to scroll for you every day, pull ideas worth stealing, and give you a straight opinion.",
  "I've only seen ten posts so far, so hold me loosely. Do you want to lean into the food reviews, or keep it loose?",
].join("\n\n---\n\n");

describe("the opening, pure", () => {
  it("greets with the one ask, drops her own introduction, keeps the read in order", () => {
    const parts = openingWithRead("hi Sam, it's Maya!", READ).split("\n---\n");
    expect(parts[0]).toBe(`hi Sam, it's Maya! ${saveContactLine()}`);
    expect(parts.some((p) => /^i'?m maya/i.test(p))).toBe(false);
    expect(parts[1]).toMatch(/^Ok, went through everything/);
    expect(parts[2]).toMatch(/lean into the food reviews/);
    expect(parts).toHaveLength(3);
  });
  it("a read with no introduction loses nothing", () => {
    expect(openingWithRead("hey, Maya here", "one.\n---\ntwo?").split("\n---\n")).toEqual([`hey, Maya here ${saveContactLine()}`, "one.", "two?"]);
  });
});

describe("pairing with a read waiting (the tester's sequence)", () => {
  it("one message, introduced once, greeting first, no reply menu, at most five texts, delivered once", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const c = await t.run((ctx) => seedCreator(ctx, "op1", { firstName: "Sam", phone: "+15555550131", channel: { kind: "imessage", paired: false }, pairingToken: "tok-op1", pairingExpiresAt: now + 60_000 }));
    const read = await t.run((ctx) => ctx.db.insert("messages", { creatorId: c, direction: "out", surface: "imessage", body: READ, ts: now - 29 * 60_000, dedupeKey: `first_read:${c}`, kind: "first_read", proactive: true, buttons: [{ id: "read:yes", label: "that's it" }, { id: "read:no", label: "not quite" }] }));

    expect((await t.mutation(internal.core.pairing.claimPairingByPhone, { token: "tok-op1", phone: "+15555550131" })).paired).toBe(true);

    const out = await t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => m.creatorId === c && m.direction === "out"));
    expect(out.map((m) => m.kind), "no separate hello").toEqual(["first_read"]);
    const opening = out[0];
    expect(opening._id).toBe(read);
    expect(opening.buttons ?? [], "no menu line under her question").toEqual([]);
    const texts = splitParts(opening.body);
    expect(texts.length).toBeLessThanOrEqual(MAX_PARTS);
    expect(texts[0]).toMatch(/Sam.*Maya|Maya.*Sam/);
    expect(opening.body.match(/\bi'?m maya\b/gi) ?? [], "introduced once (by the greeting)").toHaveLength(0);
    expect(opening.body).not.toMatch(/coming right up/);
    const redeliver = await t.run(async (ctx) => (await ctx.db.query("jobs").collect()).filter((j) => j.creatorId === c && j.idempotencyKey === `redeliver:${read}`));
    expect(redeliver).toHaveLength(1);

    // Texting START again changes nothing.
    await t.mutation(internal.core.pairing.claimPairingByPhone, { phone: "+15555550131" });
    const again = await t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => m.creatorId === c && m.direction === "out"));
    expect(again).toHaveLength(1);
    expect(again[0].body).toBe(opening.body);
  });

  it("cross-tenant: another person's waiting read is untouched", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const c = await t.run((ctx) => seedCreator(ctx, "op2", { phone: "+15555550132", channel: { kind: "imessage", paired: false }, pairingToken: "tok-op2", pairingExpiresAt: now + 60_000 }));
    const other = await t.run((ctx) => seedCreator(ctx, "op3", { phone: "+15555550133", channel: { kind: "imessage", paired: false } }));
    const theirs = await t.run((ctx) => ctx.db.insert("messages", { creatorId: other, direction: "out", surface: "imessage", body: READ, ts: now, dedupeKey: `first_read:${other}`, kind: "first_read" }));
    await t.mutation(internal.core.pairing.claimPairingByPhone, { token: "tok-op2", phone: "+15555550132" });
    expect((await t.run((ctx) => ctx.db.get(theirs)))!.body).toBe(READ);
  });
});
