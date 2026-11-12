/**
 * The deals pipeline (2026-11-12). The season sim's deal-seeker stayed lukewarm: each week was a new list of brand
 * names and nothing moved, and one hotel brand was pitched ten Sundays running. Brand outreach is a numbers game,
 * so after they opt in, Maya runs it wide on her own:
 *
 *   - about PIPELINE.inFlight brands in progress at once; up to PIPELINE.newPerWeek new ones a week, each with a
 *     verified contact and a drafted first pitch;
 *   - follow-ups drafted when they fall due (5 days after the pitch was opened in Gmail, then 7 more), and the
 *     brand closed quietly after the second (delivery.closeNoResponse);
 *   - one text a week, written by code: the pitches ready to send, each a link that opens it in their Gmail.
 *
 * She never sends (operator, 2026-11-12): every pitch stops at a draft they open in Gmail and send themselves.
 * Consent is theirs, once: the message where they said yes (`creators.dealPipeline`) is the source every pipeline
 * action cites, so research, saving and drafting run through the same tools and rules as in a conversation.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation, mutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { buildPrefix } from "../agent/context";
import { investigate } from "../agent/investigate";
import { spreadDelays, HOURLY_SPREAD_MS } from "../core/fanout";
import { CLOSED, Draft, MAX_FOLLOW_UPS, Opportunity, PARTNERSHIP_SKILL } from "./contracts";
import { PITCH_PLAYBOOK } from "./pitch";
import { partnershipsOpen } from "./store";
import { sendPageUrl } from "./drafts";
import { dayKeyInZone } from "../core/cadence";
import { clip } from "../lib/clip";

const D = 86_400_000;

export const PIPELINE = {
  inFlight: 6,
  newPerWeek: 3,
  /** After the pitch is opened in Gmail; then FOLLOW_UP_AGAIN_DAYS after each follow-up. */
  followUpDays: 5,
  followUpAgainDays: 7,
} as const;

export const PIPELINE_SKILL = `deals-pipeline
They asked you to keep finding brands and drafting pitches for them. This runs on its own each week; they are not in this conversation. You draft; they send. Never say or imply anything was sent.
Steps, within the budget:
1. Follow-ups listed below: for each, draft the follow-up with partnership_draft on that opportunity (short, new value, one ask).
2. New brands, up to the number given: start from partnership_leads. Skip anything in progress, closed, or excluded. For each that genuinely fits them: find a real contact (partnership_research: the brand's own site or official profile, never a guessed address), save it (partnership_update save, with the evidence), then draft the first pitch (partnership_draft).
3. Stop. Your final answer is one line of JSON: {"done": "≤120 chars, what you did"}. Code tells them; you don't write to them.`;

/** Pure: the opportunities whose follow-up is due: opened in Gmail, no reply since, under the cap, time come. */
export function dueFollowUps(opps: Array<{ id: string; brand: string; status: string; followUpAt?: number; followUpCount: number; lastOutboundAt?: number; lastInboundAt?: number }>, now: number): Array<{ id: string; brand: string }> {
  return opps.filter((o) => o.status === "contacted" && o.followUpAt !== undefined && o.followUpAt <= now && o.followUpCount < MAX_FOLLOW_UPS && o.lastOutboundAt !== undefined && (!o.lastInboundAt || o.lastInboundAt < o.lastOutboundAt)).map((o) => ({ id: o.id, brand: o.brand }));
}

/** Pure: the week's text, written by code: what's ready, each a link that opens it in Gmail. Null when nothing is. */
export function readyText(drafts: Array<{ brand: string; link: string; followUp: boolean }>): string | null {
  if (!drafts.length) return null;
  const fresh = drafts.filter((d) => !d.followUp), follow = drafts.filter((d) => d.followUp);
  const head = [fresh.length ? `${fresh.length} new pitch${fresh.length > 1 ? "es" : ""} ready${fresh.length ? `: ${fresh.map((d) => d.brand).join(", ")}` : ""}` : "", follow.length ? `${follow.length} follow-up${follow.length > 1 ? "s" : ""} ready (${follow.map((d) => d.brand).join(", ")})` : ""].filter(Boolean).join(", and ");
  return [`${head}. each one opens in your gmail, written and addressed. read it over and hit send:`, drafts.map((d) => `${d.brand}: ${d.link}`).join("\n")].join("\n---\n");
}

export const inputs = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ ok: false; reason: string } | { ok: true; consent: Id<"messages">; timezone: string; open: Array<{ id: string; brand: string; status: string }>; due: Array<{ id: string; brand: string }> }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return { ok: false, reason: "creator not found" };
    if (!c.dealPipeline) return { ok: false, reason: "pipeline not on" };
    if (!partnershipsOpen(c)) return { ok: false, reason: "partnerships not on their plan" };
    const p = (await ctx.db.query("partnershipProfiles").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).unique()) as Doc<"partnershipProfiles"> | null;
    if ((p?.data as { paused?: boolean } | undefined)?.paused) return { ok: false, reason: "partnerships paused" };
    const rows = (await ctx.db.query("partnershipOpportunities").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(300)) as Doc<"partnershipOpportunities">[];
    const opps = rows.map((r) => ({ id: String(r._id), ...(Opportunity.safeParse(r.data).success ? Opportunity.parse(r.data) : null) })).filter((o): o is { id: string } & ReturnType<typeof Opportunity.parse> => Boolean((o as { brand?: string }).brand));
    const open = opps.filter((o) => !CLOSED.has(o.status));
    return { ok: true, consent: c.dealPipeline.messageId, timezone: c.timezone, open: open.map((o) => ({ id: o.id, brand: o.brand, status: o.status })), due: dueFollowUps(open.map((o) => ({ id: o.id, brand: o.brand, status: o.status, followUpAt: o.followUpAt, followUpCount: o.followUpCount, lastOutboundAt: o.lastOutboundAt, lastInboundAt: o.lastInboundAt })), a.now) };
  },
});

/** Drafts this run made, with their links (shareCode → /m/<code>), and whether each is a follow-up. */
export const madeSince = internalQuery({
  args: { creatorId: v.id("creators"), since: v.number(), followUps: v.array(v.string()) },
  handler: async (ctx, a): Promise<Array<{ brand: string; link: string; followUp: boolean }>> => {
    const rows = (await ctx.db.query("partnershipDrafts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(60)) as Doc<"partnershipDrafts">[];
    const out: Array<{ brand: string; link: string; followUp: boolean }> = [];
    for (const r of rows) {
      const d = Draft.safeParse(r.data);
      if (!d.success || d.data.createdAt < a.since || d.data.status !== "draft" || !r.shareCode) continue;
      const opp = (await ctx.db.get(r.opportunityId)) as Doc<"partnershipOpportunities"> | null;
      const o = opp ? Opportunity.safeParse(opp.data) : null;
      out.push({ brand: o?.success ? o.data.brand : "a brand", link: sendPageUrl(r.shareCode), followUp: a.followUps.includes(String(r.opportunityId)) });
    }
    return out;
  },
});

/** One creator's week. Drafts only; one code-written text through the editor's daily pick. */
export const weekly = internalAction({
  args: { creatorId: v.id("creators"), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ ran: boolean; reason: string; drafts?: number }> => {
    const now = a.now ?? Date.now();
    const i = await ctx.runQuery(internal.partnerships.pipeline.inputs, { creatorId: a.creatorId, now });
    if (!i.ok) return { ran: false, reason: i.reason };
    // Two follow-ups already went unanswered and the time has come: closed quietly, as delivery does for sent mail.
    for (const o of i.open) await ctx.runMutation(internal.partnerships.delivery.closeNoResponse, { creatorId: a.creatorId, opportunityId: o.id as Id<"partnershipOpportunities"> }).catch(() => undefined);
    const need = Math.max(0, Math.min(PIPELINE.newPerWeek, PIPELINE.inFlight - i.open.length));
    if (!need && !i.due.length) return { ran: false, reason: `${i.open.length} in progress, no follow-ups due` };
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId });
    if (!g) return { ran: false, reason: "creator not found" };
    const prefix = buildPrefix({ creator: g.creator, directives: g.directives, skill: `${PARTNERSHIP_SKILL}\n${PITCH_PLAYBOOK}\n${PIPELINE_SKILL}`, personal: g.personal, voice: g.voice, history: g.history });
    const user = [
      `In progress (don't start these again): ${i.open.map((o) => `${o.brand} (${o.status})`).join(", ") || "none"}.`,
      `Follow-ups due: ${i.due.map((d) => `${d.brand} (opportunityId ${d.id})`).join(", ") || "none"}.`,
      `New brands to add this week: up to ${need}.`,
    ].join("\n");
    const started = Date.now();
    const inv = await investigate(ctx, { creatorId: a.creatorId, sourceMessageId: i.consent, partnerships: true, purpose: "deals_pipeline", prefix, user, budget: { calls: 6 + need * 4 + i.due.length * 2, credits: 12 + need * 4, deadlineAt: Date.now() + 6 * 60_000 }, temperature: 0.4, maxTokens: 1600 });
    const made = await ctx.runQuery(internal.partnerships.pipeline.madeSince, { creatorId: a.creatorId, since: started, followUps: i.due.map((d) => d.id) });
    const text = readyText(made);
    if (text) {
      const week = dayKeyInZone(now, i.timezone);
      await ctx.runMutation(internal.core.editor.notice, { creatorId: a.creatorId, now, c: { id: `pipeline:${week}`, kind: "deal", sourceKey: `pipeline:${week}`, base: 2.7, ttlMs: 5 * D, summary: clip(`pitches ready to send: ${made.map((d) => d.brand).join(", ")}`, 200), draft: { body: text }, onSent: { dealBrands: made.filter((d) => !d.followUp).map((d) => d.brand) } } });
    }
    return { ran: true, reason: `${inv.ended}; ${made.length} drafts`, drafts: made.length };
  },
});

/** Weekly: one action per creator who turned it on, spread over the hour. From schedule rows only. */
export const due = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"creators">[]> => {
    const rows = (await ctx.db.query("schedule").withIndex("by_paired_status", (q) => q.eq("paired", true)).collect()) as Doc<"schedule">[];
    return rows.filter((r) => !r.isEval && r.dealPipeline && ["active", "trialing", "comped"].includes(r.status) && partnershipsOpen({ _id: r.creatorId, plan: { status: r.status, tier: r.tier } })).map((r) => r.creatorId);
  },
});

export const runAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ creators: number }> => {
    const ids = await ctx.runQuery(internal.partnerships.pipeline.due, {});
    const delays = spreadDelays(ids.length, HOURLY_SPREAD_MS);
    for (let k = 0; k < ids.length; k++) await ctx.scheduler.runAfter(delays[k], internal.partnerships.pipeline.weekly, { creatorId: ids[k] });
    return { creators: ids.length };
  },
});

/** On or off, from their own message (the tool partnership_pipeline). That message is the standing consent. */
export const setConsent = internalMutation({
  args: { creatorId: v.id("creators"), messageId: v.id("messages"), on: v.boolean() },
  handler: async (ctx, a): Promise<{ ok: boolean; body: string }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    const m = (await ctx.db.get(a.messageId)) as Doc<"messages"> | null;
    if (!c || !m || m.creatorId !== a.creatorId || m.direction !== "in") return { ok: false, body: "only in answer to their own message" };
    if (a.on && !partnershipsOpen(c)) return { ok: false, body: "brand deals aren't on their plan" };
    await ctx.db.patch(a.creatorId, { dealPipeline: a.on ? { messageId: a.messageId, at: Date.now() } : undefined, updatedAt: Date.now() });
    return { ok: true, body: a.on ? `on: each week you find up to ${PIPELINE.newPerWeek} new brands, keep about ${PIPELINE.inFlight} going, and draft pitches and follow-ups they send from their Gmail. you never send.` : "off: no more weekly pitches; what's in progress stays in Deals" };
  },
});

/**
 * The send page's "Open in Gmail" (app/m/[code]): the pitch is on its way out, so the brand is contacted and the
 * follow-up clock starts. Opening a follow-up counts it. Idempotent per draft. They may still not send; the worst
 * case is a follow-up drafted for one they didn't, which they simply don't send.
 */
export const opened = mutation({
  args: { code: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    if (!/^[a-f0-9]{24}$/.test(a.code)) return { ok: false };
    const row = (await ctx.db.query("partnershipDrafts").withIndex("by_share_code", (q) => q.eq("shareCode", a.code)).unique()) as Doc<"partnershipDrafts"> | null;
    if (!row) return { ok: false };
    const d = Draft.safeParse(row.data);
    // Opened once counts once. Status stays "draft": "approved" is what the Gmail sender acts on (delivery.ts), and
    // she never sends; they do, from their own Gmail.
    if (!d.success || d.data.channel !== "email" || d.data.status !== "draft" || d.data.openedAt) return { ok: false };
    const opp = (await ctx.db.get(row.opportunityId)) as Doc<"partnershipOpportunities"> | null;
    const o = opp ? Opportunity.safeParse(opp.data) : null;
    if (!opp || !o?.success || CLOSED.has(o.data.status)) return { ok: false };
    const now = Date.now();
    const followUp = o.data.status === "contacted" && o.data.lastOutboundAt !== undefined;
    await ctx.db.patch(row._id, { data: Draft.parse({ ...d.data, openedAt: now }), updatedAt: now });
    await ctx.db.patch(opp._id, { data: Opportunity.parse({ ...o.data, status: "contacted", lastOutboundAt: now, followUpBasis: "no_reply", followUpCount: followUp ? o.data.followUpCount + 1 : 0, followUpAt: now + (followUp ? PIPELINE.followUpAgainDays : PIPELINE.followUpDays) * D }), updatedAt: now });
    return { ok: true };
  },
});
