/**
 * TikTok, read only (2026-11-03). A tester switched posting off on TikTok's permission screen; their reads worked,
 * but Zernio's health said "needs reconnect" (`Missing posting permissions: video.publish`) and the app kept
 * them on the connect step with the button grey. Maya never posts or reads DMs: we ask for less, and a missing
 * posting or messaging permission is not a broken connection. The shapes below are a live health row and
 * account rows from Zernio (ids changed).
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { CONNECT_SCOPES, connectUrl, onlyOptionalMissing, zernioClient } from "../../integrations/zernio";

const health = (over: Record<string, unknown> = {}) => ({
  accountId: "acc_1", platform: "tiktok", username: "tester", status: "error", canPost: false, canFetchAnalytics: true,
  tokenValid: true, needsReconnect: true, disconnectReason: null, issues: ["Missing posting permissions: video.publish"], ...over,
});
const listed = { _id: "acc_1", platform: "tiktok", username: "tester", isActive: true, needsReconnection: false, permissions: ["user.info.basic", "video.list", "video.insights", "comment.list"] };

describe("what counts as broken", () => {
  it("only posting or messaging permissions missing, on a token that still reads, is fine", () => {
    expect(onlyOptionalMissing(health())).toBe(true);
    expect(onlyOptionalMissing(health({ issues: ["Missing messaging permissions: message.list.read"] }))).toBe(true);
    expect(onlyOptionalMissing(health({ issues: ["Missing posting permissions: video.publish", "Missing posting permissions: video.upload"] }))).toBe(true);
  });
  it("anything that stops her reading is still a reconnect", () => {
    expect(onlyOptionalMissing(health({ tokenValid: false }))).toBe(false);
    expect(onlyOptionalMissing(health({ canFetchAnalytics: false }))).toBe(false);
    expect(onlyOptionalMissing(health({ disconnectReason: "revoked" }))).toBe(false);
    expect(onlyOptionalMissing(health({ issues: ["Token expired"] }))).toBe(false);
    expect(onlyOptionalMissing(health({ issues: ["Missing posting permissions: video.publish", "Missing analytics permissions: video.insights"] }))).toBe(false);
    expect(onlyOptionalMissing(health({ issues: [] }))).toBe(false);
    expect(onlyOptionalMissing({ needsReconnect: true })).toBe(false);
  });
});

describe("what we ask TikTok for", () => {
  it("the connect link asks for analytics and comments only: no DMs, no business permissions", async () => {
    const seen: string[] = [];
    const fake = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ authUrl: "https://www.tiktok.com/v2/auth/authorize?x=1", state: "s" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await connectUrl(zernioClient("k", fake, "https://zernio.test"), "tiktok", "prof_1", "https://staging.hey-maya.ai/o/billing");
    const url = new URL(seen[0]);
    expect(url.pathname).toBe("/api/v1/connect/tiktok");
    expect(url.searchParams.get("scopes")).toBe(CONNECT_SCOPES);
    expect(CONNECT_SCOPES.split(",")).not.toContain("messaging");
    expect(CONNECT_SCOPES.split(",")).not.toContain("posting");
    expect(CONNECT_SCOPES.split(",")).not.toContain("ads");
  });
});

describe("on the rows: the connection reads as connected", () => {
  let saved: string | undefined;
  beforeEach(() => { saved = process.env.ZERNIO_API_KEY; process.env.ZERNIO_API_KEY = "test-key"; });
  afterEach(() => { vi.unstubAllGlobals(); if (saved === undefined) delete process.env.ZERNIO_API_KEY; else process.env.ZERNIO_API_KEY = saved; });

  const zernio = (h: Record<string, unknown>) =>
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      const body = u.pathname.endsWith("/accounts/health") ? { summary: { total: 1 }, accounts: [h] } : u.pathname.endsWith("/accounts") ? { accounts: [listed], hasAnalyticsAccess: true } : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch);

  it("posting switched off: connected, so the app's Continue lights up", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "rr1"));
    await t.mutation(internal.connections.zernio.ensureProfileRow, { creatorId, zernioProfileId: "prof_rr1" });
    zernio(health());
    expect(await t.action(internal.connections.zernio.reconcileOne, { creatorId })).toMatchObject({ status: "connected", accounts: 1 });
    const row = await t.query(internal.connections.zernio.connection, { creatorId });
    expect(row?.zernioAccounts?.[0]).toMatchObject({ platform: "tiktok", needsReconnect: false });
  });

  it("a token that stopped working still asks them to reconnect", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "rr2"));
    await t.mutation(internal.connections.zernio.ensureProfileRow, { creatorId, zernioProfileId: "prof_rr2" });
    zernio(health({ tokenValid: false, issues: ["Token expired"] }));
    expect(await t.action(internal.connections.zernio.reconcileOne, { creatorId })).toMatchObject({ status: "needs_reconnect" });
  });
});
