/**
 * Google Calendar connect, tokens and disconnect (plan §12.5, §16.5 step 4).
 *
 * The token bundle is one AES-GCM blob in `connections.tokenRef`; the plaintext never
 * touches a row. State tokens are single-use and 15 minutes. Disconnect revokes at
 * Google, drops the bundle, and deletes every stored event, so a creator who
 * disconnects leaves nothing behind but the connection's `disconnected` status.
 */

import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { decrypt, encrypt } from "../lib/encryption";
import { creatorForIdentity } from "../core/identity";
import { buildAuthUrl, exchangeCode, listCalendars, refreshAccessToken, revokeToken, GoogleCalendarApiError } from "../integrations/google/calendar";

const STATE_TTL_MS = 15 * 60 * 1000;

interface TokenBundle { access: string; refresh?: string; expiresAt: number; scope?: string }

function mintToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export const issueState = mutation({
  args: { returnTo: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ token: string }> => {
    const c = await creatorForIdentity(ctx);
    if (!c) throw new Error("no creator for this session");
    const now = Date.now();
    const token = mintToken();
    // Only our own paths may be a return target; never an outside URL from a query string.
    const returnTo = a.returnTo && /^\/[a-z0-9/?=&_-]*$/i.test(a.returnTo) ? a.returnTo : undefined;
    await ctx.db.insert("oauthStates", { creatorId: c._id, provider: "google", token, returnTo, expiresAt: now + STATE_TTL_MS, createdAt: now });
    return { token };
  },
});

export const authUrl = query({
  args: { redirectUri: v.string(), state: v.string() },
  handler: async (_ctx, a): Promise<string> => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error("GOOGLE_CLIENT_ID not set");
    return buildAuthUrl({ clientId, redirectUri: a.redirectUri, state: a.state });
  },
});

export const claimState = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, a): Promise<{ creatorId: Id<"creators">; returnTo: string | null } | null> => {
    const row = (await ctx.db.query("oauthStates").withIndex("by_token", (q) => q.eq("token", a.token)).first()) as Doc<"oauthStates"> | null;
    const now = Date.now();
    if (!row || row.expiresAt <= now || row.claimedAt) return null;
    await ctx.db.patch(row._id, { claimedAt: now });
    return { creatorId: row.creatorId, returnTo: row.returnTo ?? null };
  },
});

/** Public by design: the single-use state token is the authentication. */
export const exchange = action({
  args: { code: v.string(), state: v.string(), redirectUri: v.string() },
  handler: async (ctx, a): Promise<{ ok: true; returnTo: string | null } | { ok: false; reason: string }> => {
    const claim = await ctx.runMutation(internal.calendar.oauth.claimState, { token: a.state });
    if (!claim) return { ok: false, reason: "bad_state" };
    const { creatorId, returnTo } = claim;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return { ok: false, reason: "not_configured" };
    let tokens;
    try {
      tokens = await exchangeCode({ code: a.code, redirectUri: a.redirectUri, clientId, clientSecret });
    } catch (e) {
      return { ok: false, reason: e instanceof GoogleCalendarApiError ? `google_${e.status}` : "exchange_threw" };
    }
    const bundle: TokenBundle = { access: tokens.access_token, refresh: tokens.refresh_token, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000, scope: tokens.scope };
    let calendars: Array<{ id: string; name: string; selected: boolean }> = [];
    try {
      const list = await listCalendars(tokens.access_token);
      // Default selection: the primary calendar only. Shared and work calendars are opt-in (§6 Sprint 3 edge cases).
      calendars = list.map((c) => ({ id: c.id, name: c.summary ?? c.id, selected: Boolean(c.primary) }));
      if (!calendars.some((c) => c.selected) && calendars[0]) calendars[0].selected = true;
    } catch {
      calendars = [{ id: "primary", name: "Primary", selected: true }];
    }
    await ctx.runMutation(internal.calendar.oauth.storeConnection, { creatorId, tokenRef: await encrypt(JSON.stringify(bundle)), calendars, keepRefresh: !tokens.refresh_token });
    await ctx.scheduler.runAfter(0, internal.calendar.sync.syncOne, { creatorId });
    return { ok: true, returnTo };
  },
});

export const storeConnection = internalMutation({
  args: { creatorId: v.id("creators"), tokenRef: v.string(), calendars: v.array(v.object({ id: v.string(), name: v.string(), selected: v.boolean() })), keepRefresh: v.boolean() },
  handler: async (ctx, a): Promise<Id<"connections">> => {
    const existing = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).eq("provider", "google_calendar")).first()) as Doc<"connections"> | null;
    const now = Date.now();
    let tokenRef = a.tokenRef;
    // Google omits the refresh token on a re-consent it considers already granted; keep the one we have.
    if (a.keepRefresh && existing?.tokenRef) {
      try {
        const old = JSON.parse(await decrypt(existing.tokenRef)) as TokenBundle;
        const fresh = JSON.parse(await decrypt(a.tokenRef)) as TokenBundle;
        if (old.refresh && !fresh.refresh) tokenRef = await encrypt(JSON.stringify({ ...fresh, refresh: old.refresh }));
      } catch {
        /* fall through with the new bundle */
      }
    }
    const patch = { provider: "google_calendar" as const, status: "connected" as const, tokenRef, calendars: a.calendars, calendarIds: a.calendars.filter((c) => c.selected).map((c) => c.id), detail: undefined, updatedAt: now };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("connections", { creatorId: a.creatorId, ...patch });
  },
});

export const connection = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Doc<"connections"> | null> =>
    (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).eq("provider", "google_calendar")).first()) as Doc<"connections"> | null,
});

export const patchConnection = internalMutation({
  args: { id: v.id("connections"), tokenRef: v.optional(v.string()), status: v.optional(v.union(v.literal("connected"), v.literal("attention"), v.literal("needs_reconnect"), v.literal("disconnected"))), detail: v.optional(v.string()), lastSyncedAt: v.optional(v.number()) },
  handler: async (ctx, a): Promise<null> => {
    const { id, ...rest } = a;
    await ctx.db.patch(id, { ...rest, updatedAt: Date.now() });
    return null;
  },
});

/** A usable access token, refreshed if within a minute of expiry. Marks the connection when the grant is dead. */
export async function ensureAccessToken(ctx: ActionCtx, conn: Doc<"connections">): Promise<string> {
  if (conn.status !== "connected" || !conn.tokenRef) throw new Error(`calendar connection is ${conn.status}`);
  const bundle = JSON.parse(await decrypt(conn.tokenRef)) as TokenBundle;
  if (bundle.expiresAt - Date.now() > 60_000) return bundle.access;
  if (!bundle.refresh) {
    await ctx.runMutation(internal.calendar.oauth.patchConnection, { id: conn._id, status: "needs_reconnect", detail: "Google didn't give a refresh token; reconnect once." });
    throw new Error("no refresh token");
  }
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  try {
    const t = await refreshAccessToken({ refreshToken: bundle.refresh, clientId, clientSecret });
    const next: TokenBundle = { access: t.access_token, refresh: t.refresh_token ?? bundle.refresh, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000, scope: t.scope ?? bundle.scope };
    await ctx.runMutation(internal.calendar.oauth.patchConnection, { id: conn._id, tokenRef: await encrypt(JSON.stringify(next)) });
    return next.access;
  } catch (e) {
    if (e instanceof GoogleCalendarApiError && e.status === 400) {
      await ctx.runMutation(internal.calendar.oauth.patchConnection, { id: conn._id, status: "needs_reconnect", detail: "Google says the connection was revoked; reconnect from Settings." });
    }
    throw e;
  }
}

/** Settings: connected state and the calendar picker. */
export const status = query({
  args: {},
  handler: async (ctx): Promise<{ status: Doc<"connections">["status"]; calendars: Array<{ id: string; name: string; selected: boolean }>; lastSyncedAt: number | null; detail: string | null } | null> => {
    const c = await creatorForIdentity(ctx);
    if (!c) return null;
    const conn = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", c._id).eq("provider", "google_calendar")).first()) as Doc<"connections"> | null;
    if (!conn) return { status: "disconnected", calendars: [], lastSyncedAt: null, detail: null };
    return { status: conn.status, calendars: conn.calendars ?? [], lastSyncedAt: conn.lastSyncedAt ?? null, detail: conn.detail ?? null };
  },
});

export const selectCalendars = mutation({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const c = await creatorForIdentity(ctx);
    if (!c) return { ok: false };
    const conn = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", c._id).eq("provider", "google_calendar")).first()) as Doc<"connections"> | null;
    if (!conn) return { ok: false };
    const calendars = (conn.calendars ?? []).map((k) => ({ ...k, selected: a.ids.includes(k.id) }));
    await ctx.db.patch(conn._id, { calendars, calendarIds: calendars.filter((k) => k.selected).map((k) => k.id), updatedAt: Date.now() });
    // Events from a deselected calendar leave immediately; the next sync refills the selected ones.
    const rows = (await ctx.db.query("calendarEvents").withIndex("by_creator_start", (q) => q.eq("creatorId", c._id)).collect()) as Doc<"calendarEvents">[];
    for (const r of rows) if (!a.ids.includes(r.calendarId)) await ctx.db.delete(r._id);
    return { ok: true };
  },
});

/** Deletion step 4 (§16.5): revoke at Google, drop the bundle, drop every stored event. */
export const disconnect = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean }> => {
    const me = await ctx.runQuery(internal.calendar.oauth.meForAction, {});
    if (!me) return { ok: false };
    await disconnectFor(ctx, me);
    return { ok: true };
  },
});

export const meForAction = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"creators"> | null> => (await creatorForIdentity(ctx))?._id ?? null,
});

export async function disconnectFor(ctx: ActionCtx, creatorId: Id<"creators">): Promise<void> {
  const conn = await ctx.runQuery(internal.calendar.oauth.connection, { creatorId });
  if (!conn) return;
  if (conn.tokenRef) {
    try {
      const bundle = JSON.parse(await decrypt(conn.tokenRef)) as TokenBundle;
      await revokeToken(bundle.refresh ?? bundle.access);
    } catch {
      /* the bundle is dropped regardless */
    }
  }
  await ctx.runMutation(internal.calendar.oauth.forget, { creatorId });
}

export const forget = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<null> => {
    const conn = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).eq("provider", "google_calendar")).first()) as Doc<"connections"> | null;
    if (conn) await ctx.db.patch(conn._id, { status: "disconnected", tokenRef: undefined, calendars: [], calendarIds: [], detail: undefined, updatedAt: Date.now() });
    const rows = (await ctx.db.query("calendarEvents").withIndex("by_creator_start", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"calendarEvents">[];
    for (const r of rows) await ctx.db.delete(r._id);
    return null;
  },
});
