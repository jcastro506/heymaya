/**
 * The partnership gauntlet's plumbing (2026-09-12). The fakes answer only with EVAL_FAKES=1;
 * the real code reaches them only through the base-url overrides; the run refuses to start
 * without them; one run at a time.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { FAKE_BRAND, mimeMessageId } from "../fakes";
import { providerBase } from "../../partnerships/providerConfig";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("the vendor fakes", () => {
  function configureFakes() {
    vi.stubEnv("EVAL_FAKES", "1");
    vi.stubEnv("ENVIRONMENT_NAME", "local");
    vi.stubEnv("CONVEX_SITE_URL", "https://fixture.convex.site");
    vi.stubEnv("GMAIL_BASE_URL", "https://fixture.convex.site/fake/gmail");
    vi.stubEnv("TAVILY_BASE_URL", "https://fixture.convex.site/fake/tavily");
  }

  it("reserves the scheduled run atomically before another start can enter", async () => {
    vi.useFakeTimers();
    configureFakes();
    const t = convexTest(schema, modules);
    expect((await t.mutation(internal.eval.partnershipGauntlet.start, {})).started).toBe(true);
    expect((await t.mutation(internal.eval.partnershipGauntlet.start, {})).started).toBe(false);
  });
  it("the fake-provider health probe uses the guarded route and synthetic token", async () => {
    configureFakes();
    const t = convexTest(schema, modules);
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await t.action(internal.eval.fakes.probe, {})).toEqual({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledWith("https://fixture.convex.site/fake/gmail/profile", expect.objectContaining({ headers: { Authorization: "Bearer fake-access" } }));
    vi.stubEnv("ENVIRONMENT_NAME", "production");
    expect((await t.action(internal.eval.fakes.probe, {})).ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates isolated fixtures and refuses to mutate a customer", async () => {
    configureFakes();
    const t = convexTest(schema, modules);
    const creatorId = await t.mutation(internal.eval.partnershipGauntlet.createFixture, {});
    const c = await t.run(ctx => ctx.db.get(creatorId));
    expect(c).toMatchObject({ handles: {}, plan: { status: "paused" }, channel: { paired: false } });
    expect(c?.phone).toBeUndefined();
    expect(c?.telegramChatId).toBeUndefined();
    await t.run(ctx => ctx.db.patch(creatorId, { clerkUserId: "customer" }));
    await expect(t.mutation(internal.eval.partnershipGauntlet.setPlan, { creatorId, status: "comped", tier: "partner", paired: true })).rejects.toThrow(/isolated/);
    await expect(t.action(internal.eval.partnershipGauntlet.connectFakeMailbox, { creatorId })).rejects.toThrow(/isolated/);
  });

  it("rejects an obsolete scheduled action without releasing another owner's lock", async () => {
    configureFakes();
    const t = convexTest(schema, modules);
    const lock = await t.mutation(internal.eval.partnershipGauntlet.takeLock, {});
    await expect(t.action(internal.eval.partnershipGauntlet.run, { lockToken: "old-run" })).rejects.toThrow(/stale run/);
    expect(await t.query(internal.eval.partnershipGauntlet.ownsLock, { token: lock.token! })).toBe(true);
  });
  it("are reached only through the overrides, and production has none", () => {
    vi.stubEnv("GMAIL_BASE_URL", "https://attacker.example/fake/gmail");
    expect(providerBase("gmail", false)).toBe("https://gmail.googleapis.com/gmail/v1/users/me");
    expect(() => providerBase("gmail", true)).toThrow();
    vi.stubEnv("EVAL_FAKES", "1");
    vi.stubEnv("ENVIRONMENT_NAME", "local");
    vi.stubEnv("CONVEX_SITE_URL", "https://fixture.convex.site");
    expect(() => providerBase("gmail", true)).toThrow(/exact fake route/);
    vi.stubEnv("GMAIL_BASE_URL", "https://fixture.convex.site/fake/gmail");
    expect(providerBase("gmail", true)).toBe("https://fixture.convex.site/fake/gmail");
    vi.stubEnv("ENVIRONMENT_NAME", "production");
    expect(() => providerBase("gmail", true)).toThrow();
    expect(FAKE_BRAND.page).toContain(FAKE_BRAND.email);
    expect(FAKE_BRAND.programUrl.startsWith(`https://${FAKE_BRAND.domain}/`)).toBe(true);
  });

  it("the fake mailbox keeps sent mail and planted replies per thread, and resets", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(internal.eval.fakes.box, {})).toEqual({ sent: [], replies: [] });
    const r = await t.mutation(internal.eval.fakes.reply, { threadId: "fake_thread_1", text: "what are your rates?" });
    expect(r.id).toBe("fake_reply_1");
    expect((await t.query(internal.eval.fakes.box, {})).replies[0]).toMatchObject({ threadId: "fake_thread_1", text: "what are your rates?" });
    await t.mutation(internal.eval.fakes.resetBox, {});
    expect(await t.query(internal.eval.fakes.box, {})).toEqual({ sent: [], replies: [] });
  });

  it("keeps concurrent fake sends and matches the actual RFC Message-ID", async () => {
    const t = convexTest(schema, modules);
    const raw = btoa("From: creator@example.com\r\nMessage-ID: <maya-draft1@heymaya.app>\r\n\r\nPitch");
    expect(mimeMessageId(raw)).toBe("<maya-draft1@heymaya.app>");
    expect(mimeMessageId("invalid")).toBeNull();
    await Promise.all([
      t.mutation(internal.eval.fakes.acceptMail, { raw }),
      t.mutation(internal.eval.fakes.acceptMail, { raw, threadId: "existing-thread" }),
    ]);
    const b = await t.query(internal.eval.fakes.box, {});
    expect(b.sent).toHaveLength(2);
    expect(new Set(b.sent.map(s => s.id)).size).toBe(2);
    expect(b.sent.some(s => s.threadId === "existing-thread")).toBe(true);
  });

  it("the run refuses without the fakes, and holds one lock at a time", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("EVAL_FAKES", "");
    await expect(t.action(internal.eval.partnershipGauntlet.run, {})).rejects.toThrow(/only against the fakes/);
    const lock = await t.mutation(internal.eval.partnershipGauntlet.takeLock, {});
    expect(lock.ok).toBe(true);
    expect((await t.mutation(internal.eval.partnershipGauntlet.takeLock, {})).ok).toBe(false);
    await t.mutation(internal.eval.partnershipGauntlet.releaseLock, { token: "wrong-owner" });
    expect((await t.mutation(internal.eval.partnershipGauntlet.takeLock, {})).ok).toBe(false);
    await t.mutation(internal.eval.partnershipGauntlet.releaseLock, { token: lock.token! });
    expect((await t.mutation(internal.eval.partnershipGauntlet.takeLock, {})).ok).toBe(true);
  });
});
