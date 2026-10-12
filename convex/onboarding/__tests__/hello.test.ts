/**
 * Her first texts (2026-10-02): a pause with the typing dots, a greeting written for this person, the
 * save-her-number ask, then the goal question; their name handled with care; her read never beats it.
 */
import { normalCase } from "../../core/messages";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { cleanNamePart, namesFromIdentity } from "../../lib/personName";
import { fallbackGreeting, greetingOk, helloParts, HELLO_PACE } from "../hello";
import { partGapMs } from "../../core/imessage";
import { nameLine } from "../../agent/context";
import { introBody, saveContactLine } from "../conversation";
import { callModel } from "../../core/llm";

vi.mock("../../core/llm", async (orig) => ({ ...(await orig<typeof import("../../core/llm")>()), callModel: vi.fn() }));

describe("names (pure)", () => {
  it("keeps real names, fixes their case, and refuses anything that isn't one", () => {
    expect(cleanNamePart("adina")).toBe("Adina");
    expect(cleanNamePart("KEVIN")).toBe("Kevin");
    expect(cleanNamePart("mary-jane")).toBe("Mary-Jane");
    expect(cleanNamePart("DeShawn")).toBe("DeShawn");
    expect(cleanNamePart("Adina Williams")).toBe("Adina");
    for (const bad of ["kevin_0connor_", "adinawilliamsss1", "a@b.com", "k.o", "12", "", "user", "null", "x".repeat(40), undefined, null, 5]) expect(cleanNamePart(bad as never), String(bad)).toBeNull();
  });
  it("reads first and last from a sign-in; never a handle or an email", () => {
    expect(namesFromIdentity({ givenName: "Adina", familyName: "Williams" })).toEqual({ firstName: "Adina", lastName: "Williams" });
    expect(namesFromIdentity({ name: "kevin o'connor" })).toEqual({ firstName: "Kevin", lastName: "O'Connor" });
    expect(namesFromIdentity({ name: "kevin_0connor_" })).toEqual({});
    expect(namesFromIdentity({})).toEqual({});
  });
  it("her context says it once and never invites a guess", () => {
    expect(nameLine({ firstName: "Adina", lastName: "Williams" })).toMatch(/Their name: Adina Williams\. Use their first name rarely/);
    expect(nameLine({})).toMatch(/Their name: unknown \(don't guess one from their handle/);
  });
});

describe("the greeting (pure)", () => {
  it("fits when it's one short line that says it's her, with the name we know", () => {
    expect(greetingOk("hey Adina, it's Maya! so glad you're here", "Adina")).toBe(true);
    expect(greetingOk("hey, it's maya. really glad you're here 👋", null)).toBe(true);
  });
  it("refuses a question, a dash, two emoji, a number, a vendor, a name she wasn't given, or a missing name she was", () => {
    const base = "hey adina, it's maya. so glad you're here";
    expect(greetingOk(base, "Adina")).toBe(true);
    for (const bad of [base + " ok?", base.replace(", ", " — "), base + " 🎉🎉", base + " 5", base + " on tiktok", base.padEnd(140, "x"), base + "\nmore"]) expect(greetingOk(bad, "Adina"), bad).toBe(false);
    expect(greetingOk(base, null), "invented a name").toBe(false);
    expect(greetingOk("hey, it's maya. so glad you're here", "Adina"), "dropped their name").toBe(false);
    expect(greetingOk("hey adina, so glad you're here", "Adina"), "never said who she is").toBe(false);
  });
  it("the written lines pass their own check, with and without a name, and differ by person", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) { expect(greetingOk(fallbackGreeting("Adina", seed), "Adina")).toBe(true); expect(greetingOk(fallbackGreeting(null, seed), null)).toBe(true); }
    expect(new Set(["a", "b", "c", "d", "e", "f"].map((s) => fallbackGreeting(null, s))).size).toBeGreaterThan(1);
  });
  it("her intro: the greeting, she's on their posts, how to talk to her, save her as Maya; no question (2026-10-09)", () => {
    const parts = helloParts("hey Adina, it's Maya! so glad you're here", false);
    expect(parts).toHaveLength(4);
    expect(parts.slice(1, 3)).toEqual(introBody(false));
    expect(parts[1]).toMatch(/going through your posts right now/);
    expect(parts[2]).toMatch(/text me like you'd text a friend/);
    expect(parts[3]).toBe(saveContactLine());
    expect(parts[3]).toMatch(/save this number as Maya/);
    expect(parts.join(" ")).not.toContain("?");
    for (const p of parts) expect(p.length, p).toBeLessThan(200);
    expect(helloParts("hi", false, true)[1]).not.toMatch(/going through your posts right now/);
  });
  it("typing pauses fit the next bubble: quick for a short one, a few seconds for a long one, capped", () => {
    expect(partGapMs("ok")).toBe(1_100);
    expect(partGapMs("x".repeat(80))).toBe(2_900);
    expect(partGapMs("x".repeat(500))).toBe(4_500);
    expect(HELLO_PACE.baseMs).toBeGreaterThanOrEqual(8_000);
  });
});

describe("on rows", () => {
  const paired = (t: ReturnType<typeof convexTest>, suffix: string, over: Record<string, unknown> = {}) => t.run((ctx) => seedCreator(ctx, suffix, { channel: { paired: true, pairedAt: Date.now() - 30_000, kind: "imessage" }, ...over }));
  const hellos = (t: ReturnType<typeof convexTest>, c: string) => t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => String(m.creatorId) === c && m.dedupeKey?.startsWith("hello:")));

  it("her greeting, when it's good, goes out with their name; once; asking nothing", async () => {
    const t = convexTest(schema, modules);
    const c = await paired(t, "h1", { firstName: "Adina" });
    vi.mocked(callModel).mockResolvedValueOnce({ ok: true, content: "hey Adina! it's maya 👋" } as Awaited<ReturnType<typeof callModel>>);
    expect(await t.action(internal.onboarding.hello.send, { creatorId: c })).toMatchObject({ sent: true, fromModel: true });
    expect(await t.action(internal.onboarding.hello.send, { creatorId: c })).toMatchObject({ sent: false, reason: "already said hello" });
    const [row] = await hellos(t, c);
    expect(row.body.split("\n---\n")[0]).toBe("Hey Adina! It's maya 👋");
    expect(row.body).toContain(normalCase(saveContactLine()));
    expect(row).toMatchObject({ awaitingAnswer: false, proactive: true, kind: "hello" });
  });

  it("a bad greeting, a failing model or no name never silences her: the written line goes", async () => {
    const t = convexTest(schema, modules);
    const bad = await paired(t, "h2", { firstName: "Adina" });
    vi.mocked(callModel).mockResolvedValueOnce({ ok: true, content: "hey adina!!! so excited — what are your goals?" } as Awaited<ReturnType<typeof callModel>>);
    expect(await t.action(internal.onboarding.hello.send, { creatorId: bad })).toMatchObject({ sent: true, fromModel: false });
    const boom = await paired(t, "h3");
    vi.mocked(callModel).mockRejectedValueOnce(new Error("provider down"));
    expect(await t.action(internal.onboarding.hello.send, { creatorId: boom })).toMatchObject({ sent: true, fromModel: false });
    for (const c of [bad, boom]) { const [row] = await hellos(t, c); expect(greetingOk(row.body.split("\n---\n")[0], c === bad ? "Adina" : null)).toBe(true); }
  });

  it("not before they're paired; her read waits while it's on its way and not after; nobody else's hello counts", async () => {
    const t = convexTest(schema, modules);
    const unpaired = await t.run((ctx) => seedCreator(ctx, "h4", { channel: { paired: false, kind: "imessage" } }));
    expect(await t.action(internal.onboarding.hello.send, { creatorId: unpaired })).toMatchObject({ sent: false, reason: "not paired" });
    const c = await paired(t, "h5");
    const other = await paired(t, "h6");
    expect(await t.query(internal.onboarding.hello.pending, { creatorId: c, now: Date.now() })).toBe(true);
    vi.mocked(callModel).mockResolvedValueOnce({ ok: false, reason: "x" } as Awaited<ReturnType<typeof callModel>>);
    await t.action(internal.onboarding.hello.send, { creatorId: other });
    expect(await t.query(internal.onboarding.hello.pending, { creatorId: c, now: Date.now() }), "theirs went; mine still waits").toBe(true);
    expect(await t.query(internal.onboarding.hello.pending, { creatorId: other, now: Date.now() })).toBe(false);
    expect(await t.query(internal.onboarding.hello.pending, { creatorId: c, now: Date.now() + HELLO_PACE.pendingWindowMs + 1 }), "never holds her read for good").toBe(false);
  });

  it("what they tell her to call them is saved only from their own message", async () => {
    const t = convexTest(schema, modules);
    const c = await paired(t, "h7");
    const msg = await t.run((ctx) => ctx.db.insert("messages", { creatorId: c, direction: "in", surface: "imessage", body: "call me Jay lol", ts: Date.now() }));
    expect(await t.mutation(internal.agent.remember.setFirstName, { creatorId: c, sourceMessageId: msg, name: "Priya", epoch: 0 }), "a name nobody typed").toBe(false);
    expect(await t.mutation(internal.agent.remember.setFirstName, { creatorId: c, sourceMessageId: msg, name: "Jay", epoch: 0 })).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(c)))?.firstName).toBe("Jay");
  });

  it("sign-in names land on the account at signup, never overwriting what they said", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity({ subject: "user_names1", email: "a@b.co", givenName: "Adina", familyName: "Williams" } as never);
    const r = await as.mutation(api_ensure(), { timezone: "UTC" });
    const row = await t.run(async (ctx) => (await ctx.db.query("creators").collect()).find((x) => x.clerkUserId === "user_names1"));
    expect(r.ok).toBe(true);
    expect(row).toMatchObject({ firstName: "Adina", lastName: "Williams" });
    await t.run((ctx) => ctx.db.patch(row!._id, { firstName: "Addie" }));
    await as.mutation(api_ensure(), { timezone: "UTC" });
    expect((await t.run((ctx) => ctx.db.get(row!._id)))?.firstName, "what they asked to be called wins").toBe("Addie");
  });
});

import { api } from "../../_generated/api";
function api_ensure() { return api.onboarding.start.ensureCreator; }
