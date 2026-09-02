/**
 * Own-account connections through Zernio (plan §6 Sprint 4, §12, §16.5 step 3).
 * One Zernio profile per creator, persisted on the connections row the moment it is
 * created, so an account can never land on the Default profile. The OAuth kickoff
 * is Zernio's; the webhook (account.connected / account.disconnected) is the
 * authoritative path for attach and detach, and a reconcile after the redirect
 * covers a missed delivery. Analytics are probed into vendorHealth before any
 * product code depends on their shape. Publishing does not exist here.
 */

import { v } from "convex/values";
import { action, httpAction, internalAction, internalMutation, internalQuery, query, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { creatorForIdentity } from "../core/identity";
import { accountsHealth, connectUrl, createProfile, deleteAccount, deleteProfile, listAccounts, postAnalytics, verifySignature, zernioClient, ZERNIO_SIGNATURE_HEADER, ZernioError, subscribeWebhook, type ZernioAccount } from "../integrations/zernio";

function client() {
  return zernioClient(process.env.ZERNIO_API_KEY ?? "");
}

const PLATFORM = v.union(v.literal("tiktok"), v.literal("instagram"));

export const connection = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Doc<"connections"> | null> =>
    (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).eq("provider", "zernio")).first()) as Doc<"connections"> | null,
});

export const byProfile = internalQuery({
  args: { zernioProfileId: v.string() },
  handler: async (ctx, a): Promise<Doc<"connections"> | null> =>
    (await ctx.db.query("connections").filter((q) => q.and(q.eq(q.field("provider"), "zernio"), q.eq(q.field("zernioProfileId"), a.zernioProfileId))).first()) as Doc<"connections"> | null,
});

export const meForConnect = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ creatorId: Id<"creators">; plan: string; label: string } | null> => {
    const c = await creatorForIdentity(ctx);
    return c ? { creatorId: c._id, plan: c.plan.status, label: c.handles.tiktok ?? c.handles.instagram ?? c.email } : null;
  },
});

/** The profile id is persisted before the redirect ever happens (2026-06-07 bug: it was not). */
export const ensureProfileRow = internalMutation({
  args: { creatorId: v.id("creators"), zernioProfileId: v.string() },
  handler: async (ctx, a): Promise<Id<"connections">> => {
    const existing = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).eq("provider", "zernio")).first()) as Doc<"connections"> | null;
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { zernioProfileId: a.zernioProfileId, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("connections", { creatorId: a.creatorId, provider: "zernio", status: "attention", zernioProfileId: a.zernioProfileId, zernioAccounts: [], detail: "no account attached yet", updatedAt: now });
  },
});

/** Accounts as Zernio reports them become the row; status follows needsReconnect, never a token date. */
export const applyAccounts = internalMutation({
  args: { creatorId: v.id("creators"), accounts: v.array(v.object({ accountId: v.string(), platform: v.string(), username: v.union(v.string(), v.null()), needsReconnect: v.boolean(), canFetchAnalytics: v.boolean() })), detail: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ status: Doc<"connections">["status"] }> => {
    const conn = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).eq("provider", "zernio")).first()) as Doc<"connections"> | null;
    if (!conn) return { status: "disconnected" };
    const accounts = a.accounts.filter((x) => x.platform === "tiktok" || x.platform === "instagram").map((x) => ({ accountId: x.accountId, platform: x.platform as "tiktok" | "instagram", canFetchAnalytics: x.canFetchAnalytics, needsReconnect: x.needsReconnect, username: x.username ?? undefined }));
    const status: Doc<"connections">["status"] = accounts.length === 0 ? "attention" : accounts.some((x) => x.needsReconnect) ? "needs_reconnect" : "connected";
    await ctx.db.patch(conn._id, { zernioAccounts: accounts, status, detail: a.detail ?? (accounts.length === 0 ? "no account attached yet" : accounts.some((x) => x.needsReconnect) ? "an account needs reconnecting" : undefined), lastSyncedAt: Date.now(), updatedAt: Date.now() });
    return { status };
  },
});

/** Settings: the connect button. Paid plans only (§19.2: connections are not a trial feature). */
export const startConnect = action({
  args: { platform: PLATFORM },
  handler: async (ctx, a): Promise<{ ok: true; url: string } | { ok: false; reason: string }> => {
    const me = await ctx.runQuery(internal.connections.zernio.meForConnect, {});
    if (!me) return { ok: false, reason: "no account" };
    if (me.plan !== "active" && me.plan !== "comped") return { ok: false, reason: "connections open when the trial ends" };
    if (!process.env.ZERNIO_API_KEY) return { ok: false, reason: "not configured" };
    const c = client();
    let conn = await ctx.runQuery(internal.connections.zernio.connection, { creatorId: me.creatorId });
    let profileId = conn?.zernioProfileId;
    if (!profileId) {
      try {
        profileId = (await createProfile(c, `maya:${me.creatorId}`)).id;
      } catch (e) {
        return { ok: false, reason: e instanceof ZernioError ? `zernio ${e.status}` : "profile failed" };
      }
      await ctx.runMutation(internal.connections.zernio.ensureProfileRow, { creatorId: me.creatorId, zernioProfileId: profileId });
      conn = await ctx.runQuery(internal.connections.zernio.connection, { creatorId: me.creatorId });
    }
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    try {
      const { authUrl } = await connectUrl(c, a.platform, profileId, `${appUrl}/app/settings?connect=back`);
      return { ok: true, url: authUrl };
    } catch (e) {
      return { ok: false, reason: e instanceof ZernioError ? `zernio ${e.status}` : "connect failed" };
    }
  },
});

/** After the redirect, or on a webhook: what Zernio says is what we have. */
export async function reconcileFor(ctx: ActionCtx, creatorId: Id<"creators">): Promise<{ status: string; accounts: number }> {
  const conn = await ctx.runQuery(internal.connections.zernio.connection, { creatorId });
  if (!conn?.zernioProfileId) return { status: "disconnected", accounts: 0 };
  const c = client();
  let accounts: ZernioAccount[] = [];
  try {
    accounts = await listAccounts(c, conn.zernioProfileId);
    // Health is the authority on needsReconnect; the list is the authority on which accounts exist.
    const health = await accountsHealth(c, conn.zernioProfileId).catch(() => null);
    if (health) {
      const bad = new Set(health.accounts.filter((h) => h.needsReconnect).map((h) => h.accountId));
      accounts = accounts.map((x) => ({ ...x, needsReconnect: x.needsReconnect || bad.has(x.accountId) }));
    }
  } catch (e) {
    // `accountsQueried: 0` must surface as unreadable, never as "0 new" (named test, §6 Sprint 4).
    await ctx.runMutation(internal.connections.zernio.applyAccounts, { creatorId, accounts: (conn.zernioAccounts ?? []).map((x) => ({ accountId: x.accountId, platform: x.platform, username: x.username ?? null, needsReconnect: x.needsReconnect, canFetchAnalytics: x.canFetchAnalytics })), detail: `couldn't read accounts: ${e instanceof Error ? e.message.slice(0, 80) : "error"}` });
    return { status: "unreadable", accounts: conn.zernioAccounts?.length ?? 0 };
  }
  const r = await ctx.runMutation(internal.connections.zernio.applyAccounts, { creatorId, accounts: accounts.map((x) => ({ accountId: x.accountId, platform: x.platform, username: x.username, needsReconnect: x.needsReconnect, canFetchAnalytics: x.canFetchAnalytics })) });
  return { status: r.status, accounts: accounts.length };
}

export const reconcile = action({
  args: {},
  handler: async (ctx): Promise<{ status: string; accounts: number }> => {
    const me = await ctx.runQuery(internal.connections.zernio.meForConnect, {});
    if (!me) return { status: "no account", accounts: 0 };
    return await reconcileFor(ctx, me.creatorId);
  },
});

export const status = query({
  args: {},
  handler: async (ctx): Promise<{ status: Doc<"connections">["status"]; accounts: Array<{ accountId: string; platform: string; username: string | null; needsReconnect: boolean; canFetchAnalytics: boolean }>; detail: string | null; lastSyncedAt: number | null } | null> => {
    const c = await creatorForIdentity(ctx);
    if (!c) return null;
    const conn = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", c._id).eq("provider", "zernio")).first()) as Doc<"connections"> | null;
    if (!conn) return { status: "disconnected", accounts: [], detail: null, lastSyncedAt: null };
    return { status: conn.status, accounts: (conn.zernioAccounts ?? []).map((x) => ({ accountId: x.accountId, platform: x.platform, username: x.username ?? null, needsReconnect: x.needsReconnect, canFetchAnalytics: x.canFetchAnalytics })), detail: conn.detail ?? null, lastSyncedAt: conn.lastSyncedAt ?? null };
  },
});

/** §16.5 step 3: every account, then the profile; the profile delete is retried once after the accounts go. */
export async function disconnectFor(ctx: ActionCtx, creatorId: Id<"creators">): Promise<string> {
  const conn = await ctx.runQuery(internal.connections.zernio.connection, { creatorId });
  if (!conn) return "not connected";
  if (!conn.zernioProfileId || !process.env.ZERNIO_API_KEY) {
    await ctx.runMutation(internal.connections.zernio.forget, { creatorId });
    return "no profile; rows dropped";
  }
  const c = client();
  let removed = 0;
  let accounts: ZernioAccount[] = [];
  try {
    accounts = await listAccounts(c, conn.zernioProfileId);
  } catch {
    accounts = (conn.zernioAccounts ?? []).map((x) => ({ accountId: x.accountId, platform: x.platform, username: x.username ?? null, needsReconnect: x.needsReconnect, canFetchAnalytics: x.canFetchAnalytics, raw: {} }));
  }
  for (const acc of accounts) {
    try {
      await deleteAccount(c, acc.accountId);
      removed++;
    } catch (e) {
      if (!(e instanceof ZernioError && e.status === 404)) throw e;
    }
  }
  let profile = "profile deleted";
  try {
    await deleteProfile(c, conn.zernioProfileId);
  } catch (e) {
    if (e instanceof ZernioError && e.status === 400) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await deleteProfile(c, conn.zernioProfileId);
      } catch (e2) {
        profile = `profile delete failed: ${e2 instanceof Error ? e2.message.slice(0, 60) : "error"}`;
      }
    } else if (!(e instanceof ZernioError && e.status === 404)) profile = `profile delete failed: ${e instanceof Error ? e.message.slice(0, 60) : "error"}`;
  }
  await ctx.runMutation(internal.connections.zernio.forget, { creatorId });
  return `${removed} account${removed === 1 ? "" : "s"} removed; ${profile}`;
}

export const disconnect = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; detail: string }> => {
    const me = await ctx.runQuery(internal.connections.zernio.meForConnect, {});
    if (!me) return { ok: false, detail: "no account" };
    return { ok: true, detail: await disconnectFor(ctx, me.creatorId) };
  },
});

export const forget = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<null> => {
    const conn = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).eq("provider", "zernio")).first()) as Doc<"connections"> | null;
    if (conn) await ctx.db.patch(conn._id, { status: "disconnected", zernioAccounts: [], zernioProfileId: undefined, detail: undefined, updatedAt: Date.now() });
    return null;
  },
});

/** The webhook: verified over the raw body, then a reconcile of whichever creator owns the profile. */
export const zernioWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!secret) return new Response("not configured", { status: 503 });
  const raw = await request.text();
  const ok = await verifySignature(raw, request.headers.get(ZERNIO_SIGNATURE_HEADER) ?? request.headers.get("x-late-signature"), secret);
  if (!ok) return new Response("bad signature", { status: 401 });
  let body: { type?: string; event?: string; data?: Record<string, unknown>; profileId?: string } = {};
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const type = body.type ?? body.event ?? "";
  const profileId = String(body.profileId ?? body.data?.profileId ?? (body.data?.account as { profileId?: string } | undefined)?.profileId ?? "");
  if (!type.startsWith("account.") || !profileId) return new Response("ignored", { status: 200 });
  const conn = await ctx.runQuery(internal.connections.zernio.byProfile, { zernioProfileId: profileId });
  if (!conn) return new Response("unknown profile", { status: 200 });
  await ctx.scheduler.runAfter(0, internal.connections.zernio.reconcileOne, { creatorId: conn.creatorId });
  return new Response("ok", { status: 200 });
});

export const reconcileOne = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ status: string; accounts: number }> => await reconcileFor(ctx, a.creatorId),
});

/** Sprint 4 opens here: read analytics for a connected account and record what came back, before anything depends on its shape. */
export const probeAnalytics = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ ok: boolean; detail: string }> => {
    const conn = await ctx.runQuery(internal.connections.zernio.connection, { creatorId: a.creatorId });
    const acc = conn?.zernioAccounts?.find((x) => x.canFetchAnalytics && !x.needsReconnect);
    if (!conn?.zernioProfileId || !acc) return { ok: false, detail: "no connected account with analytics access" };
    try {
      const raw = await postAnalytics(client(), { profileId: conn.zernioProfileId, accountId: acc.accountId, platform: acc.platform, limit: 5 });
      const detail = JSON.stringify(raw).slice(0, 900);
      await ctx.runMutation(internal.connections.zernio.recordHealth, { check: "analytics", ok: true, detail });
      return { ok: true, detail };
    } catch (e) {
      const detail = e instanceof Error ? e.message.slice(0, 300) : "error";
      await ctx.runMutation(internal.connections.zernio.recordHealth, { check: "analytics", ok: false, detail });
      return { ok: false, detail };
    }
  },
});

export const recordHealth = internalMutation({
  args: { check: v.string(), ok: v.boolean(), detail: v.string() },
  handler: async (ctx, a): Promise<null> => {
    await ctx.db.insert("vendorHealth", { vendor: "zernio", check: a.check, ok: a.ok, detail: a.detail, at: Date.now() });
    return null;
  },
});

/** Dev/operator: subscribe this deployment's webhook once. The secret is chosen here and set on the deployment by the operator. */
export const subscribeDeploymentWebhook = internalAction({
  args: { url: v.string(), secret: v.string() },
  handler: async (_ctx, a): Promise<{ id: string }> => await subscribeWebhook(client(), { name: "Maya creator", url: a.url, secret: a.secret }),
});
