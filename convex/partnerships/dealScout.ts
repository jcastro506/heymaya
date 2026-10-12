/**
 * The deal scout (2026-10-12): who could pay THIS creator, for what, right now. Code gathers where money is moving
 * in their lane (TikTok Shop products selling, brands running video ads, ads made with creators, brands paying the
 * creators they watch) and where they are (their numbers); she judges the fit and picks at most three, in plain
 * words. The result is one candidate for the editor's daily pick (core/editor), never a text on its own. Research
 * and outreach start only when they say yes, through the existing partnership tools.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { AdLead, ShopProduct } from "../integrations/scrapeCreators/platforms/commerce";
import type { LaneBrand } from "./signals";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { buildPrefix } from "../agent/context";
import { critique, tooLong } from "../agent/critic";
import { clip } from "../lib/clip";
import { weekKey } from "./kit";

export type Stage = "starter" | "nano" | "micro" | "mid" | "large";
export type DealType = "ugc" | "affiliate" | "gifting" | "sponsorship" | "ambassador" | "event";

/** Pure: where they are, from their own numbers, and what usually pays at that size. */
export function stageOf(input: { followers: number | null; normalViews: number | null }): { stage: Stage; focus: DealType[]; guidance: string } {
  const f = input.followers ?? (input.normalViews !== null ? input.normalViews * 3 : 0);
  if (f < 1_000) return { stage: "starter", focus: ["ugc", "affiliate", "gifting"], guidance: "Brands don't pay a small account for reach yet; they pay for content. Lead with UGC (paid videos the brand runs on its own channels: their craft and on-camera ease are the product, not their followers), product seeding, and TikTok Shop affiliate commissions where they're eligible. Pitch the content they'd make, never their audience size." };
  if (f < 10_000) return { stage: "nano", focus: ["ugc", "affiliate", "gifting", "sponsorship"], guidance: "UGC and affiliate first; small paid posts with niche brands that fit them closely. A gifted collab is a step to paid, never the goal if they want income. Their engagement and how close their audience is to the brand matter more than size." };
  if (f < 100_000) return { stage: "micro", focus: ["sponsorship", "ambassador", "ugc", "affiliate"], guidance: "Paid sponsored posts and ambassador programs are realistic now; UGC still pays and can be priced higher. Lead with their audience fit and their best posts, priced from their own numbers (never a market rate as fact)." };
  if (f < 1_000_000) return { stage: "mid", focus: ["sponsorship", "ambassador", "event"], guidance: "Paid campaigns, multi-post and long-term deals, events. Brands will ask for audience demographics and usage terms; agencies may be the route." };
  return { stage: "large", focus: ["sponsorship", "ambassador", "event"], guidance: "Campaigns and long-term partnerships, usually through agencies or brand partnership teams; terms (usage, exclusivity) matter as much as the fee." };
}

export interface Lead { brand: string; key: string; signals: string[]; score: number; url: string | null }

/** Pure: brands with money moving in their lane, merged across sources, strongest first. Known and excluded brands drop out. */
export function leadsFrom(input: { products: ShopProduct[]; ads: AdLead[]; laneBrands: LaneBrand[]; known: string[]; excluded: string[] }): Lead[] {
  const norm = (s: string) => s.toLowerCase().replace(/^@/, "").replace(/\b(ltd|inc|llc|co|official|shop|store|us)\b\.?/g, "").replace(/[^a-z0-9]+/g, "");
  const skip = new Set([...input.known, ...input.excluded].map(norm));
  const by = new Map<string, Lead>();
  const add = (brand: string, signal: string, score: number, url: string | null) => {
    const key = norm(brand);
    if (!key || key.length < 2 || skip.has(key)) return;
    const cur = by.get(key) ?? { brand, key, signals: [], score: 0, url };
    if (!cur.signals.includes(signal)) { cur.signals.push(signal); cur.score += score; }
    // The plainest name wins ("Darn Tough" over "Darn Tough Inc").
    if (brand.length < cur.brand.length) cur.brand = brand;
    cur.url ??= url;
    by.set(key, cur);
  };
  for (const b of input.laneBrands) add(b.handle, `paid ${b.creators.length > 1 ? `${b.creators.length} creators` : "a creator"} you watch this month (#ad)`, 3, null);
  for (const a of input.ads) add(a.advertiser, a.withCreator ? "running ads made with creators" : `running video ads in your space (${a.platform === "meta" ? "Instagram/Facebook" : "TikTok"})${a.text ? `: "${clip(a.text, 90)}"` : ""}`, a.withCreator ? 3 : a.platform === "meta" ? 2 : 1.5, a.url);
  for (const p of input.products) if (p.shop) add(p.shop, `selling on TikTok Shop in your space: ${clip(p.title, 70)}${p.sold ? ` (${p.sold.toLocaleString("en-US")} sold${p.price ? `, ${p.price}` : ""})` : ""}`, (p.sold ?? 0) >= 1_000 ? 2 : 1, p.url);
  return [...by.values()].sort((a, b) => b.score - a.score).slice(0, 12);
}

/** Pure: her answer, held to the leads she was given (a brand she wasn't shown is dropped, not trusted). */
export function parseDeals(raw: string, leads: Lead[]): { picks: Array<{ brand: string; type: DealType; why: string }>; message: string } {
  try {
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "") as { picks?: Array<{ brand?: unknown; type?: unknown; why?: unknown }>; message?: unknown };
    const types: DealType[] = ["ugc", "affiliate", "gifting", "sponsorship", "ambassador", "event"];
    const keys = new Map(leads.map((l) => [l.key, l]));
    const norm = (s: string) => s.toLowerCase().replace(/^@/, "").replace(/\b(ltd|inc|llc|co|official|shop|store|us)\b\.?/g, "").replace(/[^a-z0-9]+/g, "");
    const picks = (j.picks ?? []).flatMap((p) => {
      const lead = typeof p.brand === "string" ? keys.get(norm(p.brand)) : undefined;
      return lead && types.includes(p.type as DealType) ? [{ brand: lead.brand, type: p.type as DealType, why: typeof p.why === "string" ? clip(p.why, 200) : "" }] : [];
    }).slice(0, 3);
    return { picks, message: picks.length && typeof j.message === "string" ? j.message.trim() : "" };
  } catch {
    return { picks: [], message: "" };
  }
}

export const DEALS_SKILL = `deal-scout
When: weekly, deciding which brands could pay THIS creator, for what, and saying it in one text.
You're given where they are (their stage and what usually pays at that size), what they make, who watches them if known, what they've said they want or won't do, and brands with money moving in their lane right now, each with the signals behind it. Pick at most three that genuinely fit THEM: their content and style, their audience, their stage, their goals. For each, the kind of deal that fits (ugc, affiliate, gifting, sponsorship, ambassador, event) and one plain reason in their world ("you already film your morning coffee, and they're paying creators for exactly that"). Small accounts: UGC, affiliate and seeding, never "they'll sponsor you". Never a brand they excluded or a deal type they ruled out. Never invent a rate, a contact or a program you weren't given: the next step is research, which starts when they say yes. Say what the signal says and no more: "running video ads" is not "paying creators" unless the signal says the ads were made with creators or they paid creators they watch.
The message: short bubbles with a line of only --- between them, plain words, the brands by name, end with one easy ask ("want me to look into any of these?"). No stats-speak; "selling a lot on TikTok Shop" beats "24,737 units".
Output ONLY JSON: {"picks": [{"brand": "", "type": "ugc", "why": "≤200"}], "message": "the text"}`;

export const inputs = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ week: string; keywords: string[]; known: string[]; excluded: string[]; dealTypes: string[]; paidOnly: boolean; already: boolean } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const week = weekKey(Date.now(), c.timezone);
    const rows = (await ctx.db.query("partnershipOpportunities").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(200)) as Doc<"partnershipOpportunities">[];
    const p = (await ctx.db.query("partnershipProfiles").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).unique()) as Doc<"partnershipProfiles"> | null;
    const data = (p?.data ?? {}) as { excludedBrands?: string[]; dealTypes?: string[]; paidOnly?: boolean };
    const keywords = (((c.dossier as { keywords?: unknown } | undefined)?.keywords ?? []) as unknown[]).filter((k): k is string => typeof k === "string").slice(0, 2);
    return {
      week, keywords, known: rows.map((r) => (r.data as { brand?: string }).brand ?? r.brandDomain), excluded: data.excludedBrands ?? [], dealTypes: data.dealTypes ?? [], paidOnly: data.paidOnly ?? false,
      already: (c.noticed ?? []).some((n) => n.sourceKey === `deals:${week}`),
    };
  },
});

/** The leads for one creator, from cached reads (a few credits a week, shared by keyword across creators). */
export async function gatherLeads(ctx: Parameters<typeof callModel>[0], creatorId: Id<"creators">, i: { keywords: string[]; known: string[]; excluded: string[] }): Promise<Lead[]> {
  const read = async <T,>(kind: string, query: string, pick: (v: unknown) => T[]): Promise<T[]> => {
    try { return pick((await ctx.runAction(internal.reads.read.read, { kind, params: { query }, creatorId })).value); } catch { return []; }
  };
  const products: ShopProduct[] = [];
  const ads: AdLead[] = [];
  for (const kw of i.keywords) products.push(...(await read("shop.search", kw, (v) => ((v as { products?: ShopProduct[] }).products ?? []))));
  if (i.keywords[0]) {
    ads.push(...(await read("ads.meta", i.keywords[0], (v) => ((v as { ads?: AdLead[] }).ads ?? []))));
    ads.push(...(await read("ads.tiktok", i.keywords[0], (v) => ((v as { ads?: AdLead[] }).ads ?? []))));
  }
  const laneBrands = await ctx.runQuery(internal.partnerships.signals.laneBrands, { creatorId }).catch(() => [] as LaneBrand[]);
  return leadsFrom({ products, ads, laneBrands, known: i.known, excluded: i.excluded });
}

/** Weekly, per partner-tier creator: the leads, her judgment, one candidate for the daily pick. `preview` returns it without saving. */
export const run = internalAction({
  args: { creatorId: v.id("creators"), preview: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ noticed: boolean; reason: string; picks?: Array<{ brand: string; type: DealType; why: string }>; message?: string; stage?: Stage }> => {
    const open = await ctx.runQuery(internal.partnerships.kit.offerInputs, { creatorId: a.creatorId });
    if (!open?.open) return { noticed: false, reason: "partnerships not on their plan" };
    const i = await ctx.runQuery(internal.partnerships.dealScout.inputs, { creatorId: a.creatorId });
    if (!i) return { noticed: false, reason: "creator not found" };
    if (i.already && !a.preview) return { noticed: false, reason: "already scouted this week" };
    // No lane keywords yet: the shop and ad searches wait, but brands paying the creators they watch still count.
    const leads = await gatherLeads(ctx, a.creatorId, i);
    if (!leads.length) return { noticed: false, reason: "no brands with money moving in their lane this week" };
    const kit = await ctx.runQuery(internal.partnerships.kitTools.kitFor, { creatorId: a.creatorId });
    const plat = kit?.kit.platforms ?? [];
    const followers = plat.reduce((m, p) => Math.max(m, p.followers ?? 0), 0) || null;
    const normalViews = plat.reduce((m, p) => Math.max(m, p.normalViews ?? 0), 0) || null;
    const st = stageOf({ followers, normalViews });
    const audience = plat.map((p) => p.audience).find(Boolean);
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId });
    if (!g) return { noticed: false, reason: "creator not found" };
    const prefix = buildPrefix({ creator: g.creator, directives: g.directives, skill: DEALS_SKILL, personal: g.personal, voice: g.voice, history: g.history });
    const facts = [
      `Their stage: ${st.stage}${followers ? ` (${followers.toLocaleString("en-US")} followers)` : ""}. ${st.guidance}`,
      `What they make: ${kit?.kit.styles.join("; ") || "see the dossier"}.`,
      audience ? `Who watches: ${[...audience.gender.map((x) => `${Math.round(x.share * 100)}% ${x.label}`), ...audience.age.slice(0, 3).map((x) => `${x.label} ${Math.round(x.share * 100)}%`)].join(", ")}.` : "Who watches: unknown.",
      `Deal types they want: ${i.dealTypes.join(", ") || "not said"}${i.paidOnly ? " (paid only)" : ""}. Excluded: ${i.excluded.join(", ") || "none"}.`,
      `Brands with money moving in their lane:\n${leads.map((l) => `- ${l.brand}: ${l.signals.join("; ")}`).join("\n")}`,
    ].join("\n");
    const r = await callModel(ctx, { creatorId: a.creatorId, purpose: "deal_scout", model: REGISTRY.writer.primary, temperature: 0.4, maxTokens: 900, apiKey: process.env.OPENROUTER_API_KEY ?? "", messages: [{ role: "system", content: prefix }, { role: "user", content: `${facts}\n\nPick at most three for them, or none.` }] });
    if (!r.ok) return { noticed: false, reason: `no judgment: ${r.reason ?? "model error"}` };
    const out = parseDeals(r.content, leads);
    if (!out.picks.length || !out.message) return { noticed: false, reason: "none fit them this week", stage: st.stage };
    const verdict = tooLong(out.message) ? { pass: false, problems: ["too_long"] } : await critique(ctx, { creatorId: a.creatorId, kind: "reply", text: out.message, evidence: { leads: leads.map((l) => ({ brand: l.brand, signals: l.signals })), stage: st.stage }, voice: {}, directives: g.directives.map((x) => x.verbatim) });
    if (!verdict.pass) return { noticed: false, reason: `held by the critic: ${verdict.problems.join(", ")}`, stage: st.stage };
    if (a.preview) return { noticed: false, reason: "preview", picks: out.picks, message: out.message, stage: st.stage };
    await ctx.runMutation(internal.core.editor.notice, { creatorId: a.creatorId, c: { id: `deals:${i.week}`, kind: "deal", sourceKey: `deals:${i.week}`, base: 2.5, ttlMs: 5 * 86_400_000, summary: `brands that could pay them (${st.stage}): ${out.picks.map((p) => `${p.brand} (${p.type})`).join(", ")}`, draft: { body: out.message } } });
    return { noticed: true, reason: "noticed for the daily pick", picks: out.picks, message: out.message, stage: st.stage };
  },
});
