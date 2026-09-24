import { v } from "convex/values";
import { z } from "zod";
import { internalQuery, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import type { Doc, Id } from "../_generated/dataModel";
import { creatorForIdentity } from "../core/identity";
import { APPLICATION_CHECK_IN_DAYS, CLOSED, Draft, Evidence, Opportunity, Profile, publicUrl, followUpEligible, linksProfile, type OpportunityData } from "./contracts";
import { TIERS, entitlementsFor, type Entitlements } from "../billing/tiers";

/** The operator's pilot list: a comp on top of the tier, never the gate (§26). */
export function isPilot(creatorId: string, env: Record<string, string | undefined> = process.env): boolean {
  return (env.PARTNERSHIP_PILOT_CREATOR_IDS ?? "").split(",").map(s => s.trim()).includes(creatorId);
}

/** What this creator may do in partnerships this month: the tier's allowances, or the partner tier's for a pilot comp. Pure. */
export function partnershipAllowance(c: { _id: string; plan: { status: string; tier?: string } }, env: Record<string, string | undefined> = process.env): Entitlements["partnerships"] {
  const live = ["active", "trialing", "comped"].includes(c.plan.status);
  if (!live) return { researchPerMonth: 0, opportunitiesPerMonth: 0, draftsPerMonth: 0 };
  const own = entitlementsFor(c.plan).partnerships;
  return own.opportunitiesPerMonth > 0 ? own : isPilot(c._id, env) ? TIERS.partner.partnerships : own;
}

export function partnershipsOpen(c: { _id: string; plan: { status: string; tier?: string } }, env: Record<string, string | undefined> = process.env): boolean {
  return partnershipAllowance(c, env).opportunitiesPerMonth > 0;
}

export async function active(ctx: QueryCtx | MutationCtx, creatorId: Id<"creators">) {
  const c = await ctx.db.get(creatorId) as Doc<"creators"> | null;
  if (!c || !["active", "trialing", "comped"].includes(c.plan.status)) throw new Error("Partnerships are unavailable for this account");
  if (!partnershipsOpen(c)) throw new Error("Partnerships are not on this plan");
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
/** Whether their mailbox is connected, so she reads it instead of guessing (§27). */
async function mailboxState(ctx: QueryCtx | MutationCtx, creatorId: Id<"creators">) {
  const row = await ctx.db.query("partnershipMailboxes").withIndex("by_creator", q => q.eq("creatorId", creatorId)).unique();
  return { connected: Boolean(row), email: row?.email ?? null, sendingEnabled: process.env.PARTNERSHIP_EMAIL_SEND_ENABLED === "true", needsAttention: row?.attention ?? null };
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
      return { opportunity: o.row, events, drafts, nextCursor: page.isDone ? null : page.continueCursor, followUpDue: followUpEligible(o.data, Date.now()), mailbox: await mailboxState(ctx, a.creatorId) };
    }
    const opportunities = a.brandDomain ? await ctx.db.query("partnershipOpportunities").withIndex("by_brand", q => q.eq("creatorId", a.creatorId).eq("brandDomain", a.brandDomain!.toLowerCase().replace(/^www\./, ""))).paginate({ cursor: a.cursor ?? null, numItems: 20 }) : await ctx.db.query("partnershipOpportunities").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).order("desc").paginate({ cursor: a.cursor ?? null, numItems: 20 });
    return { profile: (await profile(ctx, a.creatorId)).data, opportunities: opportunities.page, nextCursor: opportunities.isDone ? null : opportunities.continueCursor, mailbox: await mailboxState(ctx, a.creatorId) };
  },
});
// ------------------------------------------------------------ B6 §8.3: one brand, one relationship

const SUFFIXES = ["co.uk", "com.au", "co.nz", "co.jp", "com.br", "com.mx", "co", "com", "net", "org", "io", "shop", "store", "us", "uk", "ca", "de", "fr", "au"];
/** Pure: the brand's name as a key: lowercase letters and digits, legal suffixes dropped. */
export function brandKey(name: string): string {
  return name.toLowerCase().replace(/\b(inc|llc|ltd|co|corp|official|the|brand|shop|store)\b\.?/g, "").replace(/[^a-z0-9]/g, "");
}
/** Pure: gymshark.com, shop.gymshark.co.uk → "gymshark". */
export function domainRoot(host: string): string {
  let h = host.toLowerCase().replace(/^www\./, "");
  for (const s of SUFFIXES) if (h.endsWith(`.${s}`)) { h = h.slice(0, -(s.length + 1)); break; }
  const parts = h.split(".");
  return parts[parts.length - 1] ?? h;
}
/** Pure: is this relationship the same brand as (name, domain)? */
export function sameBrand(existing: { brandDomain: string; brand?: string }, name: string, domain: string): boolean {
  if (existing.brandDomain === domain) return true;
  if (domainRoot(existing.brandDomain) === domainRoot(domain) && domainRoot(domain).length >= 3) return true;
  const a = existing.brand ? brandKey(existing.brand) : "", b = brandKey(name);
  return a.length >= 3 && a === b;
}
/** Pure: does a research query name a brand they already have a relationship with? */
export function knownBrandIn(query: string, rows: Array<{ brandDomain: string; brand?: string }>): { brandDomain: string; brand?: string } | null {
  // Whole words only ("north face" → northface): a brand called "brand" must not match "brands".
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const grams = new Set([...words, ...words.slice(1).map((w, i) => words[i] + w)]);
  return rows.find((r) => { const k = r.brand ? brandKey(r.brand) : ""; const root = domainRoot(r.brandDomain); return (k.length >= 3 && grams.has(k)) || (root.length >= 3 && grams.has(root)); }) ?? null;
}
export const REPEAT_QUERY_DAYS = 30;

/** Before research spends a credit: a known brand, or the same query within 30 days, is answered from the record. */
export const beforeResearch = internalQuery({ args: { creatorId: v.id("creators"), query: v.optional(v.string()) }, handler: async (ctx, a): Promise<{ known: { id: string; brand: string; status: string } | null; repeatedOn: string | null }> => {
  if (!a.query) return { known: null, repeatedOn: null };
  const rows = (await ctx.db.query("partnershipOpportunities").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(200)) as Doc<"partnershipOpportunities">[];
  const hit = knownBrandIn(a.query, rows.map((r) => ({ brandDomain: r.brandDomain, brand: (r.data as { brand?: string }).brand })));
  const row = hit ? rows.find((r) => r.brandDomain === hit.brandDomain)! : null;
  const norm = a.query.toLowerCase().replace(/\s+/g, " ").trim();
  const months = (await ctx.db.query("partnershipResearch").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(2)) as Doc<"partnershipResearch">[];
  const prior = months.flatMap((m) => m.queries ?? []).find((x) => x.q === norm && x.at > Date.now() - REPEAT_QUERY_DAYS * 86_400_000);
  return { known: row ? { id: row._id, brand: (row.data as { brand?: string }).brand ?? row.brandDomain, status: (row.data as { status?: string }).status ?? "discovered" } : null, repeatedOn: prior ? new Date(prior.at).toISOString().slice(0, 10) : null };
} });

export const mine = query({ args: {}, handler: async (ctx) => {
  const c = await creatorForIdentity(ctx);
  if (!c) return null;
  return { profile: (await profile(ctx, c._id)).data, opportunities: await ctx.db.query("partnershipOpportunities").withIndex("by_creator", q => q.eq("creatorId", c._id)).order("desc").take(100) };
} });

// No model-supplied identity or approval. This source id comes from converse, not tool arguments.
export const change = internalMutation({
  args: { creatorId: v.id("creators"), sourceMessageId: v.id("messages"), operation: v.string(), input: v.any() },
  handler: async (ctx, a): Promise<unknown> => {
    const c = await active(ctx, a.creatorId);
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
      // A bio email counts only from a profile the official site links (§8.3), never a lookalike account.
      if (data.contactEmail && !data.evidence.some(e => Array.from(e.excerpt.toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []).includes(data.contactEmail!) && (official.includes(e) || official.some(f => f.excerpt.includes(e.url)) || (e.kind === "profile" && official.some(f => f.kind === "extract" && linksProfile(f.excerpt, e.url)))))) throw new Error("Email is not present in cited evidence from the brand or its linked representative");
      if (data.routeUrl && !official.some(e => e.url === data.routeUrl || e.excerpt.includes(data.routeUrl!))) throw new Error("Route must be linked by the brand's official evidence");
      if (data.route === "email" && !data.contactEmail) throw new Error("Email route requires a sourced address");
      if (["dm", "application"].includes(data.route) && !data.routeUrl) throw new Error("Route link required");
      if (data.route === "dm" && !["instagram.com", "www.instagram.com", "tiktok.com", "www.tiktok.com"].includes(new URL(data.routeUrl!).hostname)) throw new Error("DM handoff requires an Instagram or TikTok link");
      const exact = await ctx.db.query("partnershipOpportunities").withIndex("by_brand", q => q.eq("creatorId", a.creatorId).eq("brandDomain", domain)).collect();
      // §8.3: one brand, one relationship: gymshark.com and gymshark.co.uk, or the same name, are the same brand.
      const old = exact.length ? exact : (await ctx.db.query("partnershipOpportunities").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).order("desc").take(200)).filter(r => sameBrand({ brandDomain: r.brandDomain, brand: (r.data as { brand?: string }).brand }, data.brand, domain));
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
      const cap = partnershipAllowance(c).opportunitiesPerMonth;
      const monthly = await ctx.db.query("partnershipOpportunities").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).order("desc").take(cap + 1);
      if (monthly.filter(r => new Date(r._creationTime).toISOString().slice(0, 7) === new Date(now).toISOString().slice(0, 7)).length >= cap) throw new Error("Monthly opportunity allowance reached");
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
    // Chat equals the app (§1): "i submitted it" on an application records the submission and one check-in in 14 days.
    if (next.route === "application" && next.status === "contacted" && !next.appliedAt) Object.assign(next, { appliedAt: Date.now(), applicationCheckIns: 1, applicationCheckInAt: Date.now() + APPLICATION_CHECK_IN_DAYS.afterSubmit * 86_400_000 });
    await ctx.db.patch(row._id, { data: Opportunity.parse(next), updatedAt: now });
    // Any new report changes the facts an approval was based on.
    for (const d of await ctx.db.query("partnershipDrafts").withIndex("by_opportunity", q => q.eq("opportunityId", row._id)).collect()) {
      const draft = Draft.parse(d.data);
      if (["draft", "approved"].includes(draft.status)) await ctx.db.patch(d._id, { data: { ...draft, status: "canceled" }, updatedAt: now });
    }
    return { status: next.status, basis: "user_report", closed: CLOSED.has(next.status) };
  },
});

export const reserveResearch = internalMutation({ args: { creatorId: v.id("creators"), query: v.optional(v.string()) }, handler: async (ctx, a) => {
  const c = await active(ctx, a.creatorId);
  if ((await profile(ctx, a.creatorId)).data.paused) throw new Error("Partnerships are paused");
  const month = new Date().toISOString().slice(0, 7);
  const row = await ctx.db.query("partnershipResearch").withIndex("by_month", q => q.eq("creatorId", a.creatorId).eq("month", month)).unique();
  if ((row?.calls ?? 0) >= partnershipAllowance(c).researchPerMonth) throw new Error("Monthly research allowance reached");
  const q = a.query ? [{ q: a.query.toLowerCase().replace(/\s+/g, " ").trim(), at: Date.now() }] : [];
  if (row) { await ctx.db.patch(row._id, { calls: row.calls + 1, queries: [...(row.queries ?? []), ...q].slice(-200), updatedAt: Date.now() }); return row._id; }
  return await ctx.db.insert("partnershipResearch", { creatorId: a.creatorId, month, calls: 1, data: [], queries: q, updatedAt: Date.now() });
} });
export const saveResearch = internalMutation({ args: { creatorId: v.id("creators"), id: v.id("partnershipResearch"), results: v.any() }, handler: async (ctx, a) => {
  await active(ctx, a.creatorId);
  const row = await ctx.db.get(a.id) as Doc<"partnershipResearch"> | null;
  if (!row || row.creatorId !== a.creatorId) throw new Error("Research unavailable");
  const results = z.array(Evidence).max(5).parse(a.results);
  await ctx.db.patch(row._id, { data: [...row.data, ...results].slice(-100), updatedAt: Date.now() });
} });
