import { v } from "convex/values";
import { z } from "zod";
import { internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { creatorForIdentity } from "../core/identity";
import { CLOSED, Draft, Evidence, Opportunity, Profile, publicUrl, followUpEligible, type OpportunityData } from "./contracts";

export async function active(ctx: QueryCtx | MutationCtx, creatorId: Id<"creators">) {
  const c = await ctx.db.get(creatorId) as Doc<"creators"> | null;
  if (!c || !["active", "trialing", "comped"].includes(c.plan.status)) throw new Error("Partnerships are unavailable for this account");
  if (!(process.env.PARTNERSHIP_PILOT_CREATOR_IDS ?? "").split(",").map(s => s.trim()).includes(creatorId)) throw new Error("Partnership access has not been enabled for this account");
  return c;
}
export async function profile(ctx: QueryCtx | MutationCtx, creatorId: Id<"creators">) {
  const r = await ctx.db.query("partnershipProfiles").withIndex("by_creator", q => q.eq("creatorId", creatorId)).unique();
  return { row: r, data: Profile.parse(r?.data ?? {}) };
}
export async function ownedOpportunity(ctx: QueryCtx | MutationCtx, creatorId: Id<"creators">, id: Id<"partnershipOpportunities">) {
  const row = await ctx.db.get(id) as Doc<"partnershipOpportunities"> | null;
  if (!row || row.creatorId !== creatorId) throw new Error("Opportunity unavailable");
  return { row, data: Opportunity.parse(row.data) };
}
export async function assertPersonalEvidence(ctx: QueryCtx | MutationCtx, creatorId: Id<"creators">, data: OpportunityData) {
  for (const e of data.assessment.creatorEvidence) {
    const table = e.kind === "post" ? "ownPosts" : e.kind === "message" ? "messages" : "personalRecords";
    const id = ctx.db.normalizeId(table, e.id);
    const r = id ? await ctx.db.get(id) : null;
    if (!r || r.creatorId !== creatorId || ("memoryExcludedAt" in r && r.memoryExcludedAt) || ("active" in r && !r.active)) throw new Error("Personal evidence is no longer available; refresh the assessment");
    const text = "body" in r ? r.body : "caption" in r ? r.caption : "text" in r ? r.text : "";
    if (!text.includes(e.quote)) throw new Error("Personal evidence changed; refresh the assessment");
  }
}
export async function event(ctx: MutationCtx, creatorId: Id<"creators">, opportunityId: Id<"partnershipOpportunities">, key: string, kind: string, text: string, at = Date.now()) {
  const old = await ctx.db.query("partnershipEvents").withIndex("by_key", q => q.eq("creatorId", creatorId).eq("key", key)).first();
  if (!old) await ctx.db.insert("partnershipEvents", { creatorId, opportunityId, key, kind, text: text.slice(0, 16000), at });
  return !old;
}
export const read = internalQuery({
  args: { creatorId: v.id("creators"), opportunityId: v.optional(v.id("partnershipOpportunities")), brandDomain: v.optional(v.string()), cursor: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await active(ctx, a.creatorId);
    if (a.opportunityId) {
      const o = await ownedOpportunity(ctx, a.creatorId, a.opportunityId);
      const page = await ctx.db.query("partnershipEvents").withIndex("by_opportunity", q => q.eq("opportunityId", a.opportunityId!)).order("desc").paginate({ cursor: a.cursor ?? null, numItems: 10 });
      const events = page.page;
      const drafts = await ctx.db.query("partnershipDrafts").withIndex("by_opportunity", q => q.eq("opportunityId", a.opportunityId!)).order("desc").take(10);
      return { opportunity: o.row, events, drafts, nextCursor: page.isDone ? null : page.continueCursor, followUpDue: followUpEligible(o.data, Date.now()) };
    }
    const opportunities = a.brandDomain ? await ctx.db.query("partnershipOpportunities").withIndex("by_brand", q => q.eq("creatorId", a.creatorId).eq("brandDomain", a.brandDomain!.toLowerCase().replace(/^www\./, ""))).paginate({ cursor: a.cursor ?? null, numItems: 20 }) : await ctx.db.query("partnershipOpportunities").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).order("desc").paginate({ cursor: a.cursor ?? null, numItems: 20 });
    return { profile: (await profile(ctx, a.creatorId)).data, opportunities: opportunities.page, nextCursor: opportunities.isDone ? null : opportunities.continueCursor };
  },
});
export const mine = query({ args: {}, handler: async (ctx) => {
  const c = await creatorForIdentity(ctx);
  if (!c) return null;
  return { profile: (await profile(ctx, c._id)).data, opportunities: await ctx.db.query("partnershipOpportunities").withIndex("by_creator", q => q.eq("creatorId", c._id)).order("desc").take(100) };
} });

// No model-supplied identity or approval. This source id comes from converse, not tool arguments.
export const change = internalMutation({
  args: { creatorId: v.id("creators"), sourceMessageId: v.id("messages"), operation: v.string(), input: v.any() },
  handler: async (ctx, a): Promise<unknown> => {
    await active(ctx, a.creatorId);
    const source = await ctx.db.get(a.sourceMessageId) as Doc<"messages"> | null;
    if (!source || source.creatorId !== a.creatorId || source.direction !== "in" || source.memoryExcludedAt) throw new Error("A current user message is required");
    const p = await profile(ctx, a.creatorId);
    const now = Date.now();
    if (a.operation === "profile") {
      const data = Profile.parse({ ...p.data, ...Profile.partial().strict().parse(a.input) });
      if (p.row) await ctx.db.patch(p.row._id, { data, updatedAt: now });
      else await ctx.db.insert("partnershipProfiles", { creatorId: a.creatorId, data, updatedAt: now });
      // Any preference change invalidates pending consent, including pause/unpause.
      for (const d of await ctx.db.query("partnershipDrafts").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).collect()) {
        const draft = Draft.parse(d.data);
        if (["draft", "approved"].includes(draft.status)) await ctx.db.patch(d._id, { data: { ...draft, status: "canceled" }, updatedAt: now });
      }
      return data;
    }
    if (p.data.paused) throw new Error("Partnerships are paused");
    if (a.operation === "save") {
      const input = z.object({ opportunityId: z.string().optional(), brandDomain: z.string(), opportunity: Opportunity.omit({ status: true, threadId: true, lastInboundAt: true, lastOutboundAt: true, mailboxGeneration: true, lastMessageId: true, followUpAt: true, followUpBasis: true, deliverables: true }) }).strict().parse(a.input);
      const domain = new URL(publicUrl(`https://${input.brandDomain}`)).hostname.replace(/^www\./, "");
      const data = Opportunity.parse(input.opportunity);
      for (const e of data.assessment.creatorEvidence) {
        const table = e.kind === "post" ? "ownPosts" : e.kind === "message" ? "messages" : "personalRecords";
        const id = ctx.db.normalizeId(table, e.id);
        const record = id ? await ctx.db.get(id) : null;
        if (!record || record.creatorId !== a.creatorId || ("memoryExcludedAt" in record && record.memoryExcludedAt)) throw new Error("Fit assessment requires available evidence from this creator");
        const sourceText = e.kind === "post" && "caption" in record ? record.caption : e.kind === "message" && "body" in record ? record.body : "text" in record ? record.text : "";
        if (!sourceText.includes(e.quote)) throw new Error("Personal evidence quote must appear verbatim in the source");
        if (e.kind === "message" && "direction" in record && record.direction !== "in") throw new Error("Maya's suggestions are not evidence of the creator's preferences");
        if (e.kind === "personalRecord" && "active" in record && !record.active) throw new Error("Personal evidence was invalidated");
      }
      if (p.data.excludedBrands.some(b => domain === b.toLowerCase() || data.brand.toLowerCase() === b.toLowerCase())) throw new Error("Brand excluded by user");
      if (p.data.paidOnly && ["gifting", "affiliate"].includes(data.type)) throw new Error("This does not meet paid-only preferences");
      if (data.deadline && data.deadline <= now) throw new Error("Opportunity expired");
      const research = await ctx.db.query("partnershipResearch").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).order("desc").take(2);
      const fetched = research.flatMap(r => (r.data as Array<{ url: string; excerpt: string; checkedAt: number; kind: string }>));
      for (const e of data.evidence) {
        if (!fetched.some(f => f.url === e.url && f.checkedAt === e.checkedAt && f.kind === e.kind && f.excerpt.includes(e.excerpt)) || e.checkedAt < now - 7 * 86400000 || e.checkedAt > now) throw new Error("Evidence must come from recent research results");
      }
      // Contact address must be literally published in the cited text. It is NOT deliverability verification.
      const official = data.evidence.filter(e => new URL(e.url).hostname.replace(/^www\./, "") === domain);
      if (!official.length) throw new Error("Read the brand's official website before saving an opportunity");
      if (!official.some(e => e.kind === "extract")) throw new Error("Extract the official page; a search snippet is not sufficient");
      if (data.officialApplicationUrl && (data.route !== "application" || data.routeUrl !== data.officialApplicationUrl)) throw new Error("Use the brand's requested application route");
      for (const field of data.applicationFields) if (!data.evidence.some(e => e.kind === "extract" && e.url === field.sourceUrl && e.excerpt.includes(field.label))) throw new Error("Application fields must be visible in extracted evidence");
      if (data.contactEmail && !data.evidence.some(e => Array.from(e.excerpt.toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []).includes(data.contactEmail!) && (official.includes(e) || official.some(f => f.excerpt.includes(e.url))))) throw new Error("Email is not present in cited evidence from the brand or its linked representative");
      if (data.routeUrl && !official.some(e => e.url === data.routeUrl || e.excerpt.includes(data.routeUrl!))) throw new Error("Route must be linked by the brand's official evidence");
      if (data.route === "email" && !data.contactEmail) throw new Error("Email route requires a sourced address");
      if (["dm", "application"].includes(data.route) && !data.routeUrl) throw new Error("Route link required");
      if (data.route === "dm" && !["instagram.com", "www.instagram.com", "tiktok.com", "www.tiktok.com"].includes(new URL(data.routeUrl!).hostname)) throw new Error("DM handoff requires an Instagram or TikTok link");
      const old = await ctx.db.query("partnershipOpportunities").withIndex("by_brand", q => q.eq("creatorId", a.creatorId).eq("brandDomain", domain)).collect();
      // A second campaign belongs to the existing relationship; never silently create another cold lead.
      if (old.length) {
        if (!input.opportunityId) return { existingRelationship: old[0], instruction: "Read this relationship first. To refresh research, save with its opportunityId; relationship history is retained." };
        const existing = old.find(r => r._id === input.opportunityId);
        if (!existing) throw new Error("Opportunity does not match this brand");
        const previous = Opportunity.parse(existing.data);
        const drafts = await ctx.db.query("partnershipDrafts").withIndex("by_opportunity", q => q.eq("opportunityId", existing._id)).collect();
        if (drafts.some(d => ["sending", "unknown"].includes(Draft.parse(d.data).status))) throw new Error("Resolve the send before changing research");
        // Operational facts are preserved; refreshed research cannot reopen a rejection or reset a thread.
        const merged = Opportunity.parse({ ...previous, ...data, status: previous.status, threadId: previous.threadId, lastInboundAt: previous.lastInboundAt, lastOutboundAt: previous.lastOutboundAt, mailboxGeneration: previous.mailboxGeneration, lastMessageId: previous.lastMessageId, followUpAt: previous.followUpAt, followUpBasis: previous.followUpBasis, deliverables: previous.deliverables });
        await ctx.db.patch(existing._id, { data: merged, updatedAt: now });
        for (const d of drafts) { const draft = Draft.parse(d.data); if (["draft", "approved"].includes(draft.status)) await ctx.db.patch(d._id, { data: { ...draft, status: "canceled" }, updatedAt: now }); }
        await event(ctx, a.creatorId, existing._id, `research:${source._id}:${existing._id}`, "research_refreshed", data.fit);
        return { id: existing._id, ...merged };
      }
      if (input.opportunityId) throw new Error("No matching relationship to refresh");
      const monthly = await ctx.db.query("partnershipOpportunities").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).order("desc").take(11);
      if (monthly.filter(r => new Date(r._creationTime).toISOString().slice(0, 7) === new Date(now).toISOString().slice(0, 7)).length >= 10) throw new Error("Monthly opportunity allowance reached");
      const id = await ctx.db.insert("partnershipOpportunities", { creatorId: a.creatorId, brandDomain: domain, data, updatedAt: now });
      await event(ctx, a.creatorId, id, `discovered:${id}`, "discovered", data.fit);
      return { id, ...data };
    }
    const input = z.object({ opportunityId: z.string(), status: Opportunity.shape.status.optional(), note: z.string().min(1).max(4000), followUpAt: z.number().finite().optional(), deliverables: Opportunity.shape.deliverables.optional() }).strict().parse(a.input);
    const { row, data } = await ownedOpportunity(ctx, a.creatorId, input.opportunityId as Id<"partnershipOpportunities">);
    if (data.status === "suppressed" && input.status && input.status !== "suppressed") throw new Error("This contact is suppressed; do not resume outreach");
    const key = `user:${source._id}:${row._id}`;
    if (!await event(ctx, a.creatorId, row._id, key, "user_report", `User message ${source._id}: ${source.body}\nMaya summary: ${input.note}`)) return { unchanged: true };
    const next: OpportunityData = { ...data, ...(input.status ? { status: input.status } : {}), ...(input.deliverables ? { deliverables: input.deliverables } : {}), followUpAt: input.followUpAt, followUpBasis: input.followUpAt ? "user_requested" : undefined };
    await ctx.db.patch(row._id, { data: Opportunity.parse(next), updatedAt: now });
    // Any new report changes the facts an approval was based on.
    for (const d of await ctx.db.query("partnershipDrafts").withIndex("by_opportunity", q => q.eq("opportunityId", row._id)).collect()) {
      const draft = Draft.parse(d.data);
      if (["draft", "approved"].includes(draft.status)) await ctx.db.patch(d._id, { data: { ...draft, status: "canceled" }, updatedAt: now });
    }
    return { status: next.status, basis: "user_report", closed: CLOSED.has(next.status) };
  },
});

export const reserveResearch = internalMutation({ args: { creatorId: v.id("creators") }, handler: async (ctx, a) => {
  await active(ctx, a.creatorId);
  if ((await profile(ctx, a.creatorId)).data.paused) throw new Error("Partnerships are paused");
  const month = new Date().toISOString().slice(0, 7);
  const row = await ctx.db.query("partnershipResearch").withIndex("by_month", q => q.eq("creatorId", a.creatorId).eq("month", month)).unique();
  if ((row?.calls ?? 0) >= 40) throw new Error("Monthly research allowance reached");
  if (row) { await ctx.db.patch(row._id, { calls: row.calls + 1, updatedAt: Date.now() }); return row._id; }
  return await ctx.db.insert("partnershipResearch", { creatorId: a.creatorId, month, calls: 1, data: [], updatedAt: Date.now() });
} });
export const saveResearch = internalMutation({ args: { creatorId: v.id("creators"), id: v.id("partnershipResearch"), results: v.any() }, handler: async (ctx, a) => {
  await active(ctx, a.creatorId);
  const row = await ctx.db.get(a.id) as Doc<"partnershipResearch"> | null;
  if (!row || row.creatorId !== a.creatorId) throw new Error("Research unavailable");
  const results = z.array(Evidence).max(5).parse(a.results);
  await ctx.db.patch(row._id, { data: [...row.data, ...results].slice(-100), updatedAt: Date.now() });
} });
