import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { creatorForIdentity } from "../core/identity";
import { encrypt, decrypt } from "../lib/encryption";
import { exchangeCode, refreshAccessToken, revokeToken } from "../integrations/google/calendar";
import { active } from "./store";
import { email, Draft, Opportunity } from "./contracts";

type Tokens = { access: string; refresh: string; expiresAt: number };
const SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"];
export const connect = mutation({ args: {}, handler: async (ctx): Promise<string> => {
  const c = await creatorForIdentity(ctx);
  if (!c) throw new Error("Sign in first");
  await active(ctx, c._id);
  if (!process.env.GMAIL_REDIRECT_URI || !process.env.GOOGLE_CLIENT_ID) throw new Error("Email connection is not configured");
  const token = crypto.randomUUID();
  await ctx.db.insert("oauthStates", { creatorId: c._id, provider: "gmail", token, createdAt: Date.now(), expiresAt: Date.now() + 900000 });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: process.env.GMAIL_REDIRECT_URI, response_type: "code", scope: SCOPES.join(" "), state: token, access_type: "offline", prompt: "consent" }).toString();
  return url.toString();
} });
export const claim = internalMutation({ args: { state: v.string(), subject: v.string() }, handler: async (ctx, a) => {
  const row = await ctx.db.query("oauthStates").withIndex("by_token", q => q.eq("token", a.state)).unique();
  if (!row || row.provider !== "gmail" || row.claimedAt || row.expiresAt <= Date.now()) throw new Error("Invalid email connection request");
  const c = await active(ctx, row.creatorId);
  if (c.clerkUserId !== a.subject) throw new Error("Email connection belongs to another session");
  await ctx.db.patch(row._id, { claimedAt: Date.now() });
  return c._id;
} });
export const exchange = action({ args: { state: v.string(), code: v.string() }, handler: async (ctx, a): Promise<{ email: string }> => {
  const auth = await ctx.auth.getUserIdentity();
  if (!auth) throw new Error("Sign in first");
  const creatorId = await ctx.runMutation(internal.partnerships.mailbox.claim, { state: a.state, subject: auth.subject });
  const t = await exchangeCode({ code: a.code, redirectUri: process.env.GMAIL_REDIRECT_URI!, clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! });
  if (!t.refresh_token || !SCOPES.every(s => t.scope?.split(" ").includes(s))) { await revokeToken(t.access_token).catch(() => undefined); throw new Error("Email read and send permissions are both required"); }
  const result = await gmail(t.access_token, "profile");
  const address = email.parse(result.emailAddress);
  const tokenRef = await encrypt(JSON.stringify({ access: t.access_token, refresh: t.refresh_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 }));
  await ctx.runMutation(internal.partnerships.mailbox.store, { creatorId, email: address, tokenRef });
  return { email: address };
} });
export const store = internalMutation({ args: { creatorId: v.id("creators"), email: v.string(), tokenRef: v.string() }, handler: async (ctx, a) => {
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
  return { connected: !!row, email: row?.email ?? null, attention: row?.attention ?? null, available: (process.env.PARTNERSHIP_PILOT_CREATOR_IDS ?? "").split(",").map(s => s.trim()).includes(c._id), sendingEnabled: process.env.PARTNERSHIP_EMAIL_SEND_ENABLED === "true" };
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
export async function gmail(token: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
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
