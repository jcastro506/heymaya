import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { splitParts, unwrapModelEnvelope, MAX_PARTS } from "../envelope";
import { helloFor } from "../pairing";

describe("a person never receives a JSON envelope (live 2026-09-06)", () => {
  it("unwraps a message field, leaves prose alone, refuses an envelope with nothing to say", () => {
    expect(unwrapModelEnvelope('{"message": "zero posts this week.", "experimentVerdict": "none"}')).toEqual({ text: "zero posts this week.", unwrapped: true });
    // Live 2026-09-08: a fenced envelope reached the leak guard as a code block and a review became "something went wrong".
    expect(unwrapModelEnvelope('```json\n{ "message": "7 posts this week.", "experimentVerdict": "unknown" }\n```')).toEqual({ text: "7 posts this week.", unwrapped: true });
    expect(unwrapModelEnvelope("plain text, with {braces} inside")).toEqual({ text: "plain text, with {braces} inside", unwrapped: false });
    expect(() => unwrapModelEnvelope('{"experimentVerdict": "none"}')).toThrow(/no message field/);
  });

  it("the one function that writes messages enforces it", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const r = await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: '{"message": "hello there", "rungOverride": null}', dedupeKey: "env:1", proactive: true, kind: "review" });
    const row = await t.run(async (ctx) => await ctx.db.get(r.messageId!));
    expect(row?.body).toBe("Hello there");
    await expect(t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: '{"verdict": "x"}', dedupeKey: "env:2", proactive: true })).rejects.toThrow(/no message field/);
  });
});

describe("first contact", () => {
  it("pairing introduces her once, before or after her read, and asks nothing (2026-10-09)", async () => {
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
    const hello = (c: unknown) => rows.filter((m) => m.creatorId === c && m.kind === "hello");
    expect(hello(a)).toHaveLength(1);
    expect(hello(b)).toHaveLength(1);
    expect(rows.filter((m) => m.awaitingAnswer), "no survey question").toHaveLength(0);
    const parts = hello(a)[0].body.split("\n---\n");
    expect(parts).toHaveLength(4);
    expect(parts[1]).toMatch(/going through your posts right now/);
    expect(parts[2]).toMatch(/text me like you'd text a friend/i);
    expect(parts[3]).toMatch(/save this number as Maya/);
    expect(hello(b)[0].body, "her read already happened").toMatch(/already been through your posts/);
    for (const banned of ["—", "what do you most want", "AI", "assistant"]) expect(hello(a)[0].body, banned).not.toContain(banned);
  });
});

describe("several short texts from one row", () => {
  it("splits on a --- line, keeps order, caps the count, and leaves a plain body alone", () => {
    expect(splitParts("hey.\n---\nyour london clip landed.\n---\ntravel or running?")).toEqual(["hey.", "your london clip landed.", "travel or running?"]);
    expect(splitParts("one block, no separator")).toEqual(["one block, no separator"]);
    // A wall with no separator is split at its paragraphs (2026-10-02: a 1,100-character text); a short
    // message with paragraphs stays one text.
    const para = (n: number) => `${"word ".repeat(n).trim()}.`;
    const wall = [para(30), para(30), para(30), para(30)].join("\n\n");
    expect(splitParts(wall).length).toBeGreaterThan(1);
    expect(splitParts(wall).every((p) => p.length <= 320)).toBe(true);
    expect(splitParts("hey.\n\nshort one.")).toEqual(["hey.\n\nshort one."]);
    // Tiny paragraphs travel with a neighbour rather than becoming one-word bubbles.
    expect(splitParts([para(60), "ok.", para(60)].join("\n\n")).some((p) => p === "ok.")).toBe(false);
    expect(splitParts("a --- b in prose")).toEqual(["a --- b in prose"]);
    const many = Array.from({ length: 7 }, (_, i) => `t${i}`).join("\n---\n");
    expect(splitParts(many).length).toBe(MAX_PARTS);
    expect(splitParts(many)[MAX_PARTS - 1]).toContain("t6");
  });
});
