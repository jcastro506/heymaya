/**
 * K1: the whole deals job, from nothing to a saved draft, for three different creators, on the REAL model
 * and the REAL partnership code. Two modes:
 *
 * - `fakes` (local deployment, EVAL_FAKES=1): the deals world's fake market, fake Tavily and fake Gmail.
 *   Each persona starts with no deals rows: the lane's paid posts → the weekly offer → "yes, look into
 *   <brand>" → research and a verdict → the kit → a per-brand link → a pitch (or application answers)
 *   saved as a DRAFT awaiting the exact SEND code. Nothing is sent: the fake Gmail's count is checked.
 * - `real` (a non-production deployment, real Tavily, no mailbox connected): the same story against
 *   the real web ("find me brands paying creators like me") with drafts only. With no mailbox, sending
 *   is impossible by construction. The report is for a person to read: would you send this?
 *
 * Personas: Sam (running, sponsorship), Priya (skincare, UGC, an application) and Leo (home cooking,
 * gifting and affiliate). Fixtures are `eval:partnership:deals:e2e:` creators with no phone, chat or
 * handles (so no fleet job ever reads a vendor for them).
 *
 *   npx convex run eval/dealsE2E:run '{}'                   # fakes, all three (local)
 *   npx convex run eval/dealsE2E:run '{"mode":"real"}'      # real research, drafts only (dev)
 *   npx convex run eval/dealsE2E:report '{}'
 */
import { v } from "convex/values";
import { internalAction, internalQuery, type ActionCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { clip } from "../lib/clip";
import { kitUrl } from "../partnerships/kitPage";
import { pitchProblems } from "../partnerships/pitch";
import { byKey, inventedNumbers, LANE_POSTS, numbersIn, OWN_POSTS, ownPostUrl, WATCHED, worldPage } from "./dealsWorldData";
import { E2E_BRANDS, PERSONAS, personaByKey, personaPostUrl, type Persona } from "./dealsE2EData";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const PREFIX = "eval:partnership:deals:e2e:";
const LATEST = "eval:deals_e2e:latest";
const reportKey = (runId: string) => `eval:deals_e2e:${runId}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Mode = "fakes" | "real";

/** Pure: why this deployment can't run this mode, or null. `real` never runs where the fakes are on, or in production. */
export function modeProblem(mode: Mode, env: Record<string, string | undefined>): string | null {
  if (mode === "fakes") {
    if (env.EVAL_FAKES !== "1" || env.ENVIRONMENT_NAME !== "local") return "fakes mode runs only on a local deployment with EVAL_FAKES=1";
    return null;
  }
  const name = (env.ENVIRONMENT_NAME ?? "").toLowerCase();
  if (!name) return "ENVIRONMENT_NAME is unset (real mode must know it isn't production)";
  if (/^prod/.test(name)) return "real mode never runs in production";
  if (env.EVAL_FAKES === "1") return "real mode needs the fakes OFF (EVAL_FAKES is 1)";
  if (!env.TAVILY_API_KEY) return "real mode needs TAVILY_API_KEY for brand research";
  if (env.TAVILY_BASE_URL || env.GMAIL_BASE_URL) return "real mode needs TAVILY_BASE_URL and GMAIL_BASE_URL unset (they point research and mail at the fakes)";
  return null;
}

export interface PersonaResult {
  persona: string;
  said: Array<{ who: "creator" | "maya" | "code"; text: string }>;
  checks: Array<{ name: string; ok: boolean; why: string }>;
  brand: { name: string; domain: string; verdict: string; route: string; evidence: string[] } | null;
  kit: { variant: string | null; leads: string[]; idea: string | null };
  draft: { channel: string; subject: string; body: string; answers: Array<{ label: string; answer: string }>; status: string } | null;
  sent: number;
  ok: boolean;
}
interface Report { runId: string; mode: Mode; status: "running" | "complete" | "failed"; startedAt: number; finishedAt?: number; personas: PersonaResult[]; note: string }

// ------------------------------------------------------------------ fixture (guarded)

async function fixture(ctx: { db: { get: (id: Id<"creators">) => Promise<unknown> } }, id: Id<"creators">): Promise<Doc<"creators">> {
  const c = (await ctx.db.get(id)) as Doc<"creators"> | null;
  if (!c || !c.clerkUserId.startsWith(PREFIX) || c.telegramChatId || c.phone) throw new Error("e2e fixture required");
  return c;
}

export const createPersona = internalMutation({ args: { persona: v.string(), mode: v.union(v.literal("fakes"), v.literal("real")) }, handler: async (ctx, a): Promise<Id<"creators">> => {
  const problem = modeProblem(a.mode, process.env);
  if (problem) throw new Error(problem);
  const p = personaByKey(a.persona);
  const now = Date.now();
  return ctx.db.insert("creators", {
    clerkUserId: `${PREFIX}${a.mode}:${p.key}:${now}`, email: `${p.key}@eval.invalid`, handles: {},
    ownership: "unverified", niche: p.niche, timezone: "UTC", quietHours: { start: "00:00", end: "00:00" }, tone: "friend", mode: "newCreator",
    dossierVersion: 0, notes: [], affinities: [], experiments: [], channel: { paired: false },
    plan: { status: "comped", tier: "partner", founding: false }, createdAt: now, conversationalOnboardingAt: now,
  } as never);
} });

/** Their posts and followers; in fakes mode also the lane (watched accounts, their paid posts). */
export const seedPersona = internalMutation({ args: { creatorId: v.id("creators"), persona: v.string(), lane: v.boolean() }, handler: async (ctx, a): Promise<{ posts: number; lanePosts: number }> => {
  await fixture(ctx, a.creatorId);
  const p = personaByKey(a.persona);
  const now = Date.now();
  const posts = p.key === "sam" ? OWN_POSTS.map((x) => ({ ...x, url: ownPostUrl(x.postId) })) : p.posts.map((x) => ({ ...x, url: personaPostUrl(p, x.postId) }));
  const platform = p.key === "sam" ? "tiktok" : p.platform;
  for (const x of posts) {
    await ctx.db.insert("ownPosts", { creatorId: a.creatorId, platform, postId: x.postId, url: x.url, createTime: now - x.daysAgo * DAY, contentType: "video", caption: x.caption, hashtags: [], metrics: { views: x.views, likes: x.likes, comments: Math.round(x.likes / 12), shares: Math.round(x.likes / 20) }, metricsAsOf: now, source: "scrape" } as never);
  }
  await ctx.db.insert("followerSnapshots", { creatorId: a.creatorId, platform, accountId: `e2e_${p.key}`, day: new Date(now).toISOString().slice(0, 10), followers: p.followers, at: now });
  let lanePosts = 0;
  if (a.lane) {
    const watched = p.key === "sam" ? WATCHED : p.watched;
    const lane = p.key === "sam" ? LANE_POSTS : p.lanePosts;
    for (const w of watched) await ctx.db.insert("trackedAccounts", { creatorId: a.creatorId, platform: w.platform, handle: w.handle, addedBy: "creator", baselineN: 0, status: "active", createdAt: now } as never);
    for (const l of lane) {
      for (const e of await ctx.db.query("observations").withIndex("by_post", (q) => q.eq("platform", l.platform).eq("postId", l.postId)).collect()) await ctx.db.delete(e._id);
      const createTime = now - l.daysAgo * DAY;
      await ctx.db.insert("observations", { platform: l.platform, postId: l.postId, authorHandle: l.author, url: `https://www.${l.platform}.com/@${l.author}/video/${l.postId}`, createTime, sampledAt: createTime + 6 * HOUR, ageHours: 6, views: l.views, likes: Math.round(l.views / 20), comments: 10, shares: 5, keywords: [], source: "account.posts", paidPromotion: l.paid, mentions: l.mentions } as never);
      lanePosts++;
    }
  }
  return { posts: posts.length, lanePosts };
} });

/** Off: the watched accounts stop being "active" (the fleet sampler would read them), the kit link goes. */
export const retire = internalMutation({ args: { creatorId: v.id("creators") }, handler: async (ctx, a): Promise<null> => {
  const c = await fixture(ctx, a.creatorId);
  for (const t of (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"trackedAccounts">[]) await ctx.db.patch(t._id, { status: "removed" });
  await ctx.db.patch(a.creatorId, { plan: { ...c.plan, status: "paused" }, kitLink: undefined });
  return null;
} });

export const rows = internalQuery({ args: { creatorId: v.id("creators") }, handler: async (ctx, a) => {
  await fixture(ctx, a.creatorId);
  const opps = (await ctx.db.query("partnershipOpportunities").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"partnershipOpportunities">[];
  const drafts = (await ctx.db.query("partnershipDrafts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"partnershipDrafts">[];
  const variants = (await ctx.db.query("kitVariants").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"kitVariants">[];
  const messages = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId)).take(200)) as Doc<"messages">[];
  const own = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(50)) as Doc<"ownPosts">[];
  return {
    opps: opps.map((o) => ({ id: o._id, domain: o.brandDomain, data: o.data as { brand: string; type: string; route: string; status: string; assessment: { verdict: string }; evidence: Array<{ url: string }>; applicationFields?: Array<{ label: string }> } })),
    drafts: drafts.map((d) => ({ id: d._id, opportunityId: d.opportunityId, data: d.data as { channel: string; subject: string; body: string; answers?: Array<{ label: string; answer: string }>; status: string; createdAt: number } })),
    variants: variants.map((x) => ({ opportunityId: x.opportunityId, slug: x.slug, postUrls: x.postUrls, idea: x.idea })),
    messages: messages.map((m) => ({ id: m._id, direction: m.direction, body: m.body, dedupeKey: m.dedupeKey, ts: m.ts })),
    ownUrls: own.map((p) => p.url),
  };
} });

// ------------------------------------------------------------------ the story, per persona

interface Run { ctx: ActionCtx; creatorId: Id<"creators">; mode: Mode; said: PersonaResult["said"]; judge: boolean }

async function say(r: Run, text: string): Promise<string[]> {
  const since = Date.now();
  r.said.push({ who: "creator", text });
  const { messageId } = await r.ctx.runMutation(internal.core.messages.recordInbound, { creatorId: r.creatorId, surface: "telegram", body: text });
  try { await r.ctx.runAction(internal.agent.converse.run, { creatorId: r.creatorId, messageId }); } catch (e) { r.said.push({ who: "code", text: `[the turn threw] ${clip(String(e), 240)}` }); return []; }
  await sleep(1_500);
  const out = (await r.ctx.runQuery(internal.eval.dealsE2E.rows, { creatorId: r.creatorId })).messages.filter((m) => m.direction === "out" && m.ts >= since);
  for (const m of out) {
    r.said.push({ who: "maya", text: m.body });
    if (r.judge) await r.ctx.scheduler.runAfter(0, internal.eval.run.evaluate, { suite: "deals_e2e", skill: "reply", text: m.body, evidence: { theirMessage: text }, creatorId: r.creatorId, messageId: m.id });
  }
  return out.map((m) => m.body);
}

/** Pure: the craft a person would check in a first pitch, by the deal it's for (advisory, alongside the code's rules). */
export function craftChecks(body: string, brand: string, persona: Persona["key"]): Array<{ name: string; ok: boolean; why: string }> {
  const b = body.toLowerCase();
  const out = [
    { name: "names the brand", ok: b.includes(brand.toLowerCase().split(" ")[0]), why: `mentions ${brand}` },
    { name: "one concrete idea", ok: /\b(video|reel|tiktok|idea|concept|recipe|routine|series|shoot|clip)\b/.test(b), why: "a content idea is in it" },
    { name: "one ask", ok: (body.match(/\?/g) ?? []).length <= 1, why: "at most one question" },
  ];
  if (persona === "leo") out.push({ name: "fits a gifting/affiliate deal", ok: /\b(gift|gifted|send|sample|affiliate|code|commission|try)\b/.test(b), why: "asks for product or affiliate, not a big fee" });
  if (persona === "sam") out.push({ name: "fits a sponsorship", ok: /\b(paid|sponsor|partnership|campaign)\b/.test(b), why: "frames a paid partnership" });
  return out;
}

async function runPersona(ctx: ActionCtx, mode: Mode, key: Persona["key"], judge: boolean): Promise<PersonaResult> {
  const p = personaByKey(key);
  const creatorId = await ctx.runMutation(internal.eval.dealsE2E.createPersona, { persona: key, mode });
  const r: Run = { ctx, creatorId, mode, said: [], judge };
  const checks: PersonaResult["checks"] = [];
  const check = (name: string, ok: boolean, why: string) => checks.push({ name, ok, why });
  const sent0 = mode === "fakes" ? (await ctx.runQuery(internal.eval.fakes.box, {})).sent.length : 0;
  try {
    await ctx.runMutation(internal.eval.dealsE2E.seedPersona, { creatorId, persona: key, lane: mode === "fakes" });
    if (mode === "fakes") await ctx.runAction(internal.eval.partnershipGauntlet.connectFakeMailbox, { creatorId });
    await say(r, p.script.goal);

    // 1. Finding it: the weekly offer from the lane's paid posts (fakes), or her search of the real web.
    if (mode === "fakes") {
      await ctx.runMutation(internal.eval.partnershipGauntlet.setPlan, { creatorId, status: "comped", tier: "partner", paired: true });
      const offer = await ctx.runAction(internal.partnerships.kit.offerOne, { creatorId });
      await ctx.runMutation(internal.eval.partnershipGauntlet.setPlan, { creatorId, status: "comped", tier: "partner", paired: false });
      const text = (await ctx.runQuery(internal.eval.dealsE2E.rows, { creatorId })).messages.find((m) => (m.dedupeKey ?? "").startsWith("partner-week:"))?.body ?? "";
      r.said.push({ who: "maya", text: `[weekly offer] ${text}` });
      check("offered from the lane", offer.sent && text.includes(`@${p.brandHandle}`), `offer ${offer.sent ? "sent" : offer.reason}; names @${p.brandHandle}: ${text.includes(`@${p.brandHandle}`)}`);
      await say(r, p.script.yes);
    } else {
      await say(r, "find me brands that are paying creators like me right now, and tell me which one you'd go for");
      await say(r, "go with the one you think fits me best and look into it properly");
    }

    // 2. Deciding: a saved relationship with sources and a verdict.
    let s = await ctx.runQuery(internal.eval.dealsE2E.rows, { creatorId });
    const brand = mode === "fakes" ? [byKey, (k: string) => E2E_BRANDS.find((b) => b.key === k)!].map((f) => { try { return f(p.brandKey); } catch { return null; } }).find(Boolean)! : null;
    const opp = brand ? s.opps.find((o) => o.domain === brand.domain || o.domain.endsWith(`.${brand.domain}`)) : s.opps.at(-1);
    check("researched and saved with a verdict", Boolean(opp && opp.data.evidence.length && opp.data.assessment?.verdict), opp ? `${opp.data.brand}: ${opp.data.assessment.verdict}, ${opp.data.evidence.length} source(s)` : "nothing saved");
    if (mode === "fakes" && opp && brand) check("sources are the brand's own pages", opp.data.evidence.every((e) => Boolean(worldPage(e.url)) || e.url.includes(brand.domain)), opp.data.evidence.map((e) => e.url).join(", "));

    // 3. The kit and the draft.
    await say(r, p.script.ready);
    s = await ctx.runQuery(internal.eval.dealsE2E.rows, { creatorId });
    const hasDraft = () => s.drafts.some((d) => !opp || d.opportunityId === opp.id);
    if (!hasDraft()) { await say(r, p.script.retry); s = await ctx.runQuery(internal.eval.dealsE2E.rows, { creatorId }); }
    const d = s.drafts.filter((x) => !opp || x.opportunityId === opp.id).sort((x, y) => x.data.createdAt - y.data.createdAt).at(-1);
    const oppNow = opp ? s.opps.find((o) => o.id === opp.id) ?? opp : s.opps.at(-1);
    const variant = oppNow ? s.variants.find((x) => x.opportunityId === oppNow.id) : undefined;
    check("saved as a draft awaiting the code", d?.data.status === "draft", d ? `${d.data.channel} draft, ${d.data.status}` : "no draft");
    const kit = (await ctx.runQuery(internal.partnerships.kitTools.kitFor, { creatorId }))?.kit ?? null;
    const allowed = [...(kit?.platforms ?? []).flatMap((x) => [x.followers ?? 0, x.normalViews ?? 0, ...x.best.map((b) => b.views)]), ...(oppNow?.data.evidence ?? []).flatMap((e) => numbersIn(worldPage(e.url)?.content ?? "")), ...s.messages.filter((m) => m.direction === "in").flatMap((m) => numbersIn(m.body))];
    if (d?.data.channel === "email") {
      const lead = variant?.postUrls ?? [];
      check("per-brand kit link, leading with their own posts", Boolean(variant && lead.length && lead.every((u) => s.ownUrls.includes(u)) && d.data.body.includes(kitUrl(variant.slug))), variant ? `leads ${lead.length}; linked ${d.data.body.includes(kitUrl(variant.slug))}` : "no per-brand link");
      const problems = pitchProblems({ route: "email", firstTouch: true, brand: oppNow?.data.brand ?? "", subject: d.data.subject, body: d.data.body, kitLinks: variant ? [kitUrl(variant.slug)] : [] }, kit);
      check("keeps every pitch rule", !problems.length, problems.join("; ") || "all held");
      const invented = mode === "fakes" ? inventedNumbers(d.data.body, allowed) : [];
      check("only their numbers", !invented.length, invented.join(", ") || "none invented");
      if (p.key !== "priya") for (const c of craftChecks(d.data.body, oppNow?.data.brand ?? "", p.key)) check(`craft: ${c.name}`, c.ok, c.why);
    } else if (d?.data.channel === "application") {
      const answers = d.data.answers ?? [];
      const labels = (oppNow?.data.applicationFields ?? []).map((f) => f.label);
      check("answers only the form's questions", answers.length >= 3 && answers.every((x) => labels.includes(x.label)), `${answers.length} answers`);
      const portfolio = answers.find((x) => /portfolio|link/i.test(x.label))?.answer ?? "";
      check("portfolio is their kit or their posts", /\/k\/[a-z0-9]{8,40}/.test(portfolio) || s.ownUrls.some((u) => portfolio.includes(u)), clip(portfolio, 120) || "no portfolio answer");
      check("no invented rate", !answers.some((x) => /rate/i.test(x.label) && /\$\s?\d/.test(x.answer)), "the rate is theirs to give");
    }
    if (mode === "fakes" && p.expectRoute) check(`the route is ${p.expectRoute}`, d?.data.channel === p.expectRoute, `drafted ${d?.data.channel ?? "nothing"}`);

    // 4. Nothing went out.
    const sent = mode === "fakes" ? (await ctx.runQuery(internal.eval.fakes.box, {})).sent.length - sent0 : 0;
    check("nothing sent", sent === 0, `fake Gmail +${sent}`);
    return {
      persona: `${p.name} (${p.niche})`, said: r.said, checks,
      brand: oppNow ? { name: oppNow.data.brand, domain: oppNow.domain, verdict: oppNow.data.assessment?.verdict ?? "?", route: oppNow.data.route, evidence: oppNow.data.evidence.map((e) => e.url) } : null,
      kit: { variant: variant ? kitUrl(variant.slug) : null, leads: variant?.postUrls ?? [], idea: variant?.idea ?? null },
      draft: d ? { channel: d.data.channel, subject: d.data.subject, body: d.data.body, answers: d.data.answers ?? [], status: d.data.status } : null,
      sent, ok: checks.every((c) => c.ok),
    };
  } catch (e) {
    check("the story ran", false, clip(String(e), 300));
    return { persona: p.name, said: r.said, checks, brand: null, kit: { variant: null, leads: [], idea: null }, draft: null, sent: 0, ok: false };
  } finally {
    await ctx.runMutation(internal.eval.dealsE2E.retire, { creatorId }).catch(() => undefined);
  }
}

// ------------------------------------------------------------------ run + report

export const saveReport = internalMutation({ args: { runId: v.string(), value: v.string() }, handler: async (ctx, a): Promise<null> => {
  for (const key of [reportKey(a.runId), LATEST]) {
    const value = key === LATEST ? a.runId : a.value;
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() }); else await ctx.db.insert("syncState", { key, value, updatedAt: Date.now() });
  }
  return null;
} });
export const loadReport = internalQuery({ args: { runId: v.string() }, handler: async (ctx, a): Promise<Report | null> => {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", reportKey(a.runId))).unique();
  return row ? (JSON.parse(row.value) as Report) : null;
} });

/** Start: one persona per scheduled action (each well inside an action's time limit). */
export const run = internalAction({
  args: { mode: v.optional(v.union(v.literal("fakes"), v.literal("real"))), personas: v.optional(v.array(v.string())), judge: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ runId: string; personas: string[]; poll: string }> => {
    const mode: Mode = a.mode ?? "fakes";
    const problem = modeProblem(mode, process.env);
    if (problem) throw new Error(`not started: ${problem}`);
    const keys = (a.personas ?? PERSONAS.map((p) => p.key)).filter((k) => PERSONAS.some((p) => p.key === k));
    const runId = `e2e_${mode}_${Date.now()}`;
    if (mode === "fakes") {
      // The fake Gmail is shared with the deals world and the gauntlet: take the deals world's lock.
      const lock = await ctx.runMutation(internal.eval.dealsWorld.takeLock, { runId });
      if (!lock.ok) throw new Error(`not started: ${lock.why}`);
    }
    const r: Report = { runId, mode, status: "running", startedAt: Date.now(), personas: [], note: mode === "fakes" ? "The real model and the real partnership code against the fake market, fake Tavily and fake Gmail. Drafts only; nothing sent." : "The real model and real brand research (Tavily). No mailbox is connected, so nothing can be sent. Read the drafts: would you send them?" };
    await ctx.runMutation(internal.eval.dealsE2E.saveReport, { runId, value: JSON.stringify(r) });
    await ctx.scheduler.runAfter(0, internal.eval.dealsE2E.next, { runId, keys, index: 0, judge: a.judge !== false });
    return { runId, personas: keys, poll: `npx convex run eval/dealsE2E:report '{"runId":"${runId}"}'` };
  },
});

export const next = internalAction({
  args: { runId: v.string(), keys: v.array(v.string()), index: v.number(), judge: v.boolean() },
  handler: async (ctx, a): Promise<null> => {
    const r = await ctx.runQuery(internal.eval.dealsE2E.loadReport, { runId: a.runId });
    if (!r || r.status !== "running") return null;
    r.personas.push(await runPersona(ctx, r.mode, a.keys[a.index] as Persona["key"], a.judge));
    const last = a.index + 1 >= a.keys.length;
    if (last) { r.status = "complete"; r.finishedAt = Date.now(); }
    await ctx.runMutation(internal.eval.dealsE2E.saveReport, { runId: a.runId, value: JSON.stringify(r) });
    if (last) { if (r.mode === "fakes") await ctx.runMutation(internal.eval.dealsWorld.releaseLock, { runId: a.runId }); }
    else await ctx.scheduler.runAfter(0, internal.eval.dealsE2E.next, { ...a, index: a.index + 1 });
    return null;
  },
});

/** The run: per persona, what happened, every check, the brand and verdict, the kit link, and the draft to read. */
export const report = internalQuery({ args: { runId: v.optional(v.string()), full: v.optional(v.boolean()) }, handler: async (ctx, a): Promise<unknown> => {
  const runId = a.runId ?? (await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", LATEST)).unique())?.value;
  if (!runId) return { error: "no e2e run yet: npx convex run eval/dealsE2E:run '{}'" };
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", reportKey(runId))).unique();
  if (!row) return { error: `no report for ${runId}` };
  const r = JSON.parse(row.value) as Report;
  return {
    runId, mode: r.mode, status: r.status, note: r.note,
    summary: r.personas.map((p) => `${p.persona}: ${p.checks.filter((c) => c.ok).length}/${p.checks.length}${p.ok ? " ✓" : ""}`),
    failed: r.personas.flatMap((p) => p.checks.filter((c) => !c.ok).map((c) => `${p.persona} · ${c.name}: ${c.why}`)),
    personas: r.personas.map((p) => ({ ...p, said: a.full ? p.said : p.said.slice(-10) })),
  };
} });
