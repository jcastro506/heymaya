import { v } from "convex/values";
import { action, internalQuery, query, type ActionCtx, type MutationCtx } from "../_generated/server";
import { internalMutation, mutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { creatorForIdentity } from "../core/identity";
import { encrypt, decrypt } from "../lib/encryption";
import { exchangeCode, refreshAccessToken, revokeToken } from "../integrations/google/calendar";
import { active, partnershipsOpen } from "./store";
import { providerBase } from "./providerConfig";
import { email, Draft, Opportunity } from "./contracts";

type Tokens = { access: string; refresh: string; expiresAt: number };
/**
 * Connecting Gmail by a link in a text (2026-10-21). On the deals plan, when she has a pitch ready and their Gmail
 * isn't connected, her text carries a one-time link: tap, pick the Google account, done. No website sign-in (the
 * link IS the credential: one use, 24 hours, one creator), so it works from Messages on a phone.
 *
 * Send only, plus their address: `gmail.send` is a sensitive scope (Google review, no security audit), where
 * reading mail is restricted (a paid audit). Replies are theirs to tell her or forward until reading is added.
 */
export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.send"];
export const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const LINK_TTL_MS = 24 * 3_600_000;

function appBase(): string {
  return (process.env.APP_URL ?? "https://hey-maya.ai").replace(/\/+$/, "");
}

/** The redirect Google sends them back to: the website's public /g/callback on this deployment's site. */
export function gmailRedirectUri(env: Record<string, string | undefined> = process.env): string {
  return env.GMAIL_REDIRECT_URI || `${(env.APP_URL || "https://hey-maya.ai").replace(/\/+$/, "")}/g/callback`;
}

/** Pure: Google's consent page for one link token. */
export function consentUrl(token: string, env: Record<string, string | undefined> = process.env): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID ?? "", redirect_uri: gmailRedirectUri(env), response_type: "code", scope: SCOPES.join(" "), state: token, access_type: "offline", prompt: "consent", include_granted_scopes: "false" }).toString();
  return url.toString();
}

/** One link, one creator, 24 hours: what she puts in a text and what the app's button opens. */
export async function mintConnectLink(ctx: MutationCtx, creatorId: Id<"creators">, now = Date.now()): Promise<string> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
  await ctx.db.insert("oauthStates", { creatorId, provider: "gmail", token, createdAt: now, expiresAt: now + LINK_TTL_MS });
  return `${appBase()}/g/${token}`;
}

/** The app's "Connect Gmail": the same link, for the signed-in creator. */
export const connect = mutation({ args: {}, handler: async (ctx): Promise<string> => {
  const c = await creatorForIdentity(ctx);
  if (!c) throw new Error("Sign in first");
  await active(ctx, c._id);
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error("Email connection is not configured");
  return await mintConnectLink(ctx, c._id);
} });

/** In chat ("connect my gmail"): who it's connected as, or a fresh one-time link. */
export const chatLink = internalMutation({ args: { creatorId: v.id("creators") }, handler: async (ctx, a): Promise<string> => {
  await active(ctx, a.creatorId);
  const row = await ctx.db.query("partnershipMailboxes").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).unique();
  if (row) return `already connected: ${row.email}. pitches send from there after they approve each one.`;
  if (!process.env.GOOGLE_CLIENT_ID) return "connecting Gmail isn't available yet; their pitches still go as a link that opens in their Gmail.";
  return `a one-time link for them to connect Gmail (works once, for 24 hours; send-only, you never read their mail, so replies are theirs to tell you or forward): ${await mintConnectLink(ctx, a.creatorId)}\nput the link on its own line, exactly as written.`;
} });

/** The website's /g/<token>: where to send them, or why not. Reads only; the token is spent at the callback. */
export const linkTarget = query({ args: { token: v.string() }, handler: async (ctx, a): Promise<{ ok: true; url: string } | { ok: false; reason: "expired" | "used" | "unknown" | "unavailable" }> => {
  const row = await ctx.db.query("oauthStates").withIndex("by_token", (q) => q.eq("token", a.token)).unique();
  if (!row || row.provider !== "gmail") return { ok: false, reason: "unknown" };
  if (row.claimedAt) return { ok: false, reason: "used" };
  if (row.expiresAt <= Date.now()) return { ok: false, reason: "expired" };
  if (!process.env.GOOGLE_CLIENT_ID) return { ok: false, reason: "unavailable" };
  return { ok: true, url: consentUrl(a.token) };
} });

/** Spend a link token once: whose it is. */
export const claimLink = internalMutation({ args: { state: v.string() }, handler: async (ctx, a): Promise<Id<"creators">> => {
  const row = await ctx.db.query("oauthStates").withIndex("by_token", (q) => q.eq("token", a.state)).unique();
  if (!row || row.provider !== "gmail" || row.claimedAt || row.expiresAt <= Date.now()) throw new Error("Invalid email connection request");
  await active(ctx, row.creatorId);
  await ctx.db.patch(row._id, { claimedAt: Date.now() });
  return row.creatorId;
} });

/** Their address, from Google's own answer (gmail.send alone can't read the profile). */
async function addressOf(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const r = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`Couldn't read the account's address (${r.status})`);
  const j = (await r.json()) as { email?: string; email_verified?: boolean };
  if (!j.email || j.email_verified === false) throw new Error("Google didn't confirm the address");
  return email.parse(j.email.toLowerCase());
}

/** The website's /g/callback: Google's answer for a link token. Public by design; the token is the credential. */
export const finishLink = action({ args: { state: v.string(), code: v.string() }, handler: async (ctx, a): Promise<{ email: string }> => {
  const creatorId = await ctx.runMutation(internal.partnerships.mailbox.claimLink, { state: a.state });
  const t = await exchangeCode({ code: a.code, redirectUri: gmailRedirectUri(), clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! });
  const granted = t.scope?.split(" ") ?? [];
  if (!t.refresh_token || !granted.includes("https://www.googleapis.com/auth/gmail.send")) {
    await revokeToken(t.access_token).catch(() => undefined);
    throw new Error("Permission to send email is required");
  }
  const address = await addressOf(t.access_token);
  const tokenRef = await encrypt(JSON.stringify({ access: t.access_token, refresh: t.refresh_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 }));
  await ctx.runMutation(internal.partnerships.mailbox.store, { creatorId, email: address, tokenRef, canRead: granted.includes(READ_SCOPE) });
  await ctx.runMutation(internal.partnerships.mailbox.connectedText, { creatorId, email: address });
  return { email: address };
} });

/** Their text back, the moment it's connected: which address, and what happens to a pitch already waiting. */
export const connectedText = internalMutation({ args: { creatorId: v.id("creators"), email: v.string() }, handler: async (ctx, a): Promise<null> => {
  const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
  if (!c) return null;
  // A pitch drafted before they connected (handed off as a link, not yet sent): offer to send it from here.
  const drafts = (await ctx.db.query("partnershipDrafts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(10)) as Doc<"partnershipDrafts">[];
  const pending = drafts.find((r) => { const d = Draft.parse(r.data); return d.channel === "email" && d.status === "draft" && !d.sender && Date.now() - r.updatedAt < 7 * 86_400_000; });
  const opp = pending ? ((await ctx.db.get(pending.opportunityId)) as Doc<"partnershipOpportunities"> | null) : null;
  const brand = opp ? Opportunity.parse(opp.data).brand : null;
  const body = `connected: ${a.email}. pitches go straight from there now, and i'll always show you the email before anything sends.${brand ? `\n---\nwant me to send the ${brand} pitch from it? say "send the ${brand} pitch" and i'll show it to you first.` : ""}`;
  await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: c.channel.paired ? "telegram" : "web", body, dedupeKey: `gmail-connected:${a.email}:${Math.floor(Date.now() / 60_000)}`, proactive: false, kind: "status" });
  return null;
} });
export const store = internalMutation({ args: { creatorId: v.id("creators"), email: v.string(), tokenRef: v.string(), canRead: v.optional(v.boolean()) }, handler: async (ctx, a) => {
  await active(ctx, a.creatorId);
  const old = await ctx.db.query("partnershipMailboxes").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).unique();
  const value = { ...a, email: email.parse(a.email), generation: crypto.randomUUID(), updatedAt: Date.now() };
  if (old) await ctx.db.replace(old._id, value); else await ctx.db.insert("partnershipMailboxes", value);
  for (const row of await ctx.db.query("partnershipDrafts").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).collect()) {
    const d = Draft.parse(row.data);
    if (["draft", "approved"].includes(d.status)) await ctx.db.patch(row._id, { data: { ...d, status: "canceled" }, updatedAt: Date.now() });
    else if (d.sender === value.email && ["sent", "sending", "unknown"].includes(d.status)) {
      // Re-consenting to the same verified mailbox keeps history usable, but never preserves consent.
      await ctx.db.patch(row._id, { data: { ...d, mailboxGeneration: value.generation }, updatedAt: row.updatedAt });
      const opportunity = await ctx.db.get(row.opportunityId) as Doc<"partnershipOpportunities"> | null;
      if (opportunity?.creatorId === a.creatorId) {
        const o = Opportunity.parse(opportunity.data);
        if (o.mailboxGeneration === d.mailboxGeneration) await ctx.db.patch(opportunity._id, { data: { ...o, mailboxGeneration: value.generation } });
      }
    }
  }
} });
export const get = internalQuery({ args: { creatorId: v.id("creators") }, handler: async (ctx, a) => await ctx.db.query("partnershipMailboxes").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).unique() });
export const status = query({ args: {}, handler: async (ctx) => {
  const c = await creatorForIdentity(ctx);
  if (!c) return null;
  const row = await ctx.db.query("partnershipMailboxes").withIndex("by_creator", q => q.eq("creatorId", c._id)).unique();
  return { connected: !!row, email: row?.email ?? null, attention: row?.attention ?? null, available: partnershipsOpen(c), sendingEnabled: process.env.PARTNERSHIP_EMAIL_SEND_ENABLED === "true" };
} });
export const attention = internalMutation({ args: { creatorId: v.id("creators"), generation: v.string(), failed: v.boolean() }, handler: async (ctx, a) => {
  const row = await ctx.db.query("partnershipMailboxes").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).unique();
  if (row?.generation === a.generation) await ctx.db.patch(row._id, { attention: a.failed ? "Couldn’t check your email. Reconnect if this continues." : undefined });
} });
export const refreshed = internalMutation({ args: { id: v.id("partnershipMailboxes"), generation: v.string(), tokenRef: v.string() }, handler: async (ctx, a) => {
  const row = await ctx.db.get(a.id) as Doc<"partnershipMailboxes"> | null;
  if (!row || row.generation !== a.generation) throw new Error("Mailbox connection changed");
  await ctx.db.patch(row._id, { tokenRef: a.tokenRef, updatedAt: Date.now() });
} });
export async function access(ctx: ActionCtx, row: Doc<"partnershipMailboxes">): Promise<string> {
  const t = JSON.parse(await decrypt(row.tokenRef)) as Tokens;
  if (t.expiresAt > Date.now() + 60000) return t.access;
  const next = await refreshAccessToken({ refreshToken: t.refresh, clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! });
  const bundle = { access: next.access_token, refresh: next.refresh_token ?? t.refresh, expiresAt: Date.now() + (next.expires_in ?? 3600) * 1000 };
  await ctx.runMutation(internal.partnerships.mailbox.refreshed, { id: row._id, generation: row.generation, tokenRef: await encrypt(JSON.stringify(bundle)) });
  return bundle.access;
}
export async function gmail(token: string, path: string, body?: unknown, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  // GMAIL_BASE_URL: the eval fake, never set in production. `fetchImpl`: the outage drill's failing Gmail (eval/faults.ts).
  const response = await fetchImpl(`${providerBase("gmail", token === "fake-access")}/${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Gmail request failed (${response.status})`);
  const raw = await response.text();
  if (raw.length > 2000000) throw new Error("Gmail response too large");
  return JSON.parse(raw);
}
export const forget = internalMutation({ args: { creatorId: v.id("creators") }, handler: async (ctx, a) => {
  const row = await ctx.db.query("partnershipMailboxes").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).unique();
  if (row) await ctx.db.delete(row._id);
  for (const r of await ctx.db.query("partnershipDrafts").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).collect()) {
    const d = Draft.parse(r.data);
    if (["draft", "approved"].includes(d.status)) await ctx.db.patch(r._id, { data: { ...d, status: "canceled" }, updatedAt: Date.now() });
  }
} });
export async function disconnectFor(ctx: ActionCtx, creatorId: Id<"creators">) {
  const row = await ctx.runQuery(internal.partnerships.mailbox.get, { creatorId });
  // Block locally before a possibly slow network revoke.
  await ctx.runMutation(internal.partnerships.mailbox.forget, { creatorId });
  if (row) { try { const t = JSON.parse(await decrypt(row.tokenRef)) as Tokens; await revokeToken(t.refresh); } catch { /* local connection stays revoked */ } }
}
export const disconnect = action({ args: {}, handler: async (ctx) => {
  const creatorId = await ctx.runQuery(internal.calendar.oauth.meForAction, {});
  if (!creatorId) throw new Error("Sign in first");
  await disconnectFor(ctx, creatorId);
} });
