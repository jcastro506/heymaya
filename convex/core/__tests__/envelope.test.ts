import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { unwrapModelEnvelope } from "../envelope";
import { HELLO } from "../pairing";

describe("a person never receives a JSON envelope (live 2026-09-06)", () => {
  it("unwraps a message field, leaves prose alone, refuses an envelope with nothing to say", () => {
    expect(unwrapModelEnvelope('{"message": "zero posts this week.", "experimentVerdict": "none"}')).toEqual({ text: "zero posts this week.", unwrapped: true });
    expect(unwrapModelEnvelope("plain text, with {braces} inside")).toEqual({ text: "plain text, with {braces} inside", unwrapped: false });
    expect(() => unwrapModelEnvelope('{"experimentVerdict": "none"}')).toThrow(/no message field/);
  });

  it("the one function that writes messages enforces it", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const r = await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: '{"message": "hello there", "rungOverride": null}', dedupeKey: "env:1", proactive: true, kind: "review" });
    const row = await t.run(async (ctx) => await ctx.db.get(r.messageId));
    expect(row?.body).toBe("hello there");
    await expect(t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: '{"verdict": "x"}', dedupeKey: "env:2", proactive: true })).rejects.toThrow(/no message field/);
  });
});

describe("first contact", () => {
  it("pairing before the first read says hello once; pairing after it says nothing extra", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", {}));
    const b = await t.run((ctx) => seedCreator(ctx, "b", {}));
    await t.run(async (ctx) => {
      await ctx.db.patch(a, { pairingToken: "tok-a", pairingExpiresAt: Date.now() + 60_000 });
      await ctx.db.patch(b, { pairingToken: "tok-b", pairingExpiresAt: Date.now() + 60_000 });
      await ctx.db.insert("messages", { creatorId: b, direction: "out", surface: "telegram", body: "the read", ts: Date.now(), dedupeKey: `first_read:${b}`, kind: "first_read" });
    });
    expect((await t.mutation(internal.core.pairing.claimPairing, { token: "tok-a", chatId: "111" })).paired).toBe(true);
    expect((await t.mutation(internal.core.pairing.claimPairing, { token: "tok-b", chatId: "222" })).paired).toBe(true);
    const rows = await t.run(async (ctx) => await ctx.db.query("messages").collect());
    expect(rows.filter((m) => m.creatorId === a && m.body === HELLO).length).toBe(1);
    expect(rows.filter((m) => m.creatorId === b && m.body === HELLO).length).toBe(0);
    expect(HELLO).toMatch(/maya/);
  });
});
