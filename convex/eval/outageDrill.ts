/**
 * The outage drill (docs/OUTAGE_DRILL.md). Principle 5: nothing fails silently; every job produces
 * a result or a named failure that reaches the creator (when they are waiting) or the operator.
 * This proves it cell by cell, fault × flow, on the real code paths:
 *
 * - FAULTS come from eval/faults.ts: a thin guard at each vendor boundary, on only for this drill's
 *   own creators, never in production, and cleared after every cell.
 * - CREATORS: one isolated eval creator per scenario (`eval-run:drill-…`, never paired to a person,
 *   so nothing is delivered), with a TikTok AND an Instagram handle and watched accounts on both.
 *   Its own daily cap, signals and messages, so one scenario can't starve the next.
 * - FLOWS are the real functions: a text turn and two "why did this blow up <link>" turns and a
 *   camera-roll draft go through the real converse queue (enqueue → drain → runJob → dead letter);
 *   the scout, the sampler, the sweep, the connected-analytics sync, a web search and a partnership
 *   email send are called as their crons and tools call them.
 * - EACH CELL RECORDS, from rows: did it end (result / named failure / retry, never stuck or
 *   silent)? if the creator was waiting, did they hear something honest, and never a fake success?
 *   did the operator get a health row or a dead letter? was anything sent twice? was a failed read
 *   cached, or a thing marked wrongly (an account retired, a signal dropped, a metric "not
 *   available")? Then a verdict per cell in `report {runId}`.
 *
 * Run (dev): `eval/outageDrill:start {}`; read `eval/outageDrill:report {"runId"}`; `eval/outageDrill:stop {"runId"}` aborts.
 */
import { v } from "convex/values";
import { internalAction, internalQuery, type ActionCtx, type MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { fetchMedia } from "../integrations/gemini/client";
import { Draft, Opportunity } from "../partnerships/contracts";
import { FAULTS, faultsEnabled, VENDOR_OF, type Fault } from "./faults";
import { mimeMessageId } from "./fakes";
import { clip } from "../lib/clip";

// ------------------------------------------------------------------ the plan (pure)

export const FLOWS = ["scout", "sampler", "sweep", "analytics", "web_search", "email_send", "text", "tiktok_link", "instagram_link", "finish"] as const;
export type Flow = (typeof FLOWS)[number];

/** A person is waiting on these: silence is a failure even if the operator knows. */
export const WAITING: ReadonlySet<Flow> = new Set(["text", "tiktok_link", "instagram_link", "finish", "email_send"]);
/** Fleet jobs: nobody is waiting, so a failure must reach the operator. */
export const FLEET: ReadonlySet<Flow> = new Set(["scout", "sampler", "sweep", "analytics"]);

/** Every single fault, plus a bad day with one failure at every vendor at once. */
export const SCENARIOS: Record<string, Fault[]> = {
  ...Object.fromEntries(FAULTS.map((f) => [f, [f]])),
  bad_day: ["scrape_402", "gemini_overload", "writer_5xx", "classifier_timeout", "zernio_5xx", "tavily_5xx", "gmail_5xx"],
};

/** Which flows can reach each vendor. A cell outside this is noise (the fault can't fire), so it isn't run unless asked. */
const REACHES: Record<string, Flow[]> = {
  scrapecreators: ["scout", "sampler", "sweep", "text", "tiktok_link", "instagram_link", "finish"],
  gemini: ["tiktok_link", "instagram_link", "finish"],
  writer: ["scout", "text", "tiktok_link", "instagram_link", "finish"],
  classifier: ["text"],
  zernio: ["analytics"],
  tavily: ["web_search"],
  gmail: ["email_send"],
};

/** Pure: the flows a scenario runs, in an order that keeps one flow from blocking the next (the scout before any turn leaves a question open). */
export function flowsFor(scenario: string, all = false): Flow[] {
  const faults = SCENARIOS[scenario] ?? [];
  if (all || faults.length > 1) return [...FLOWS];
  const reach = new Set(faults.flatMap((f) => REACHES[f.startsWith("writer_") ? "writer" : f.startsWith("classifier_") ? "classifier" : VENDOR_OF[f]] ?? []));
  return FLOWS.filter((f) => reach.has(f));
}

export interface Cell {
  scenario: string;
  flow: Flow;
  faults: Fault[];
  /** Did an injected fault actually fire during this cell? */
  reached: boolean;
  hits: Record<string, number>;
  ended: "result" | "named_failure" | "retry" | "stuck" | "silent" | "skipped";
  endDetail: string;
  waiting: boolean;
  /** What the creator was told about this flow (kind, dedupe key, first words). */
  heard: Array<{ kind: string; key: string; head: string }>;
  fakeSuccess: string[];
  operator: { deadJobs: string[]; health: string[]; failedModelCalls: number };
  duplicates: string[];
  badCache: string[];
  wrongMarks: string[];
  ms: number;
}

export interface Verdict { pass: boolean | null; why: string[] }

/** Pure: one cell's verdict. `null` = not applicable (skipped, or the fault never fired). */
export function judgeCell(c: Cell): Verdict {
  if (c.ended === "skipped") return { pass: null, why: [`skipped: ${c.endDetail}`] };
  if (!c.reached) return { pass: null, why: [`fault not reached (${c.ended}: ${c.endDetail.slice(0, 80)})`] };
  const why: string[] = [];
  if (c.ended === "stuck") why.push("the job never finished (still running)");
  if (c.ended === "silent") why.push("the job left no result and no named failure");
  if (c.waiting && c.heard.length === 0) why.push("they were waiting and heard nothing");
  why.push(...c.fakeSuccess.map((f) => `fake success: ${f}`));
  why.push(...c.duplicates.map((d) => `sent twice: ${d}`));
  why.push(...c.badCache.map((b) => `cached wrongly: ${b}`));
  why.push(...c.wrongMarks.map((m) => `marked wrongly: ${m}`));
  const operatorSaw = c.operator.deadJobs.length > 0 || c.operator.health.length > 0;
  // Out of credits stops every read at once and only the operator can fix it: every cell that hit it must reach them.
  if (Object.keys(c.hits).some((k) => k.startsWith("scrape_402")) && !c.operator.health.some((h) => h.startsWith("scrapecreators/credit-balance"))) why.push("ScrapeCreators was out of credits and the operator was not told");
  if (FLEET.has(c.flow) && c.ended === "named_failure" && !operatorSaw && c.heard.length === 0) why.push("a fleet job failed and neither the creator nor the operator was told");
  return { pass: why.length === 0, why };
}

/** Pure: the matrix, scenario × flow → "PASS" / "FAIL: …" / "n/a: …". */
export function matrixOf(cells: Cell[]): { summary: { pass: number; fail: number; na: number }; matrix: Record<string, Record<string, string>> } {
  const matrix: Record<string, Record<string, string>> = {};
  const summary = { pass: 0, fail: 0, na: 0 };
  for (const c of cells) {
    const vd = judgeCell(c);
    (matrix[c.scenario] ??= {})[c.flow] = vd.pass === null ? `n/a: ${vd.why[0]}` : vd.pass ? "PASS" : `FAIL: ${vd.why.join("; ")}`;
    if (vd.pass === null) summary.na++;
    else if (vd.pass) summary.pass++;
    else summary.fail++;
  }
  return { summary, matrix };
}

// ------------------------------------------------------------------ state

interface World {
  ownTiktok: string;
  ownInstagram: string;
  watched: { tiktok: string[]; instagram: string[] };
  keywords: string[];
  tiktokLink: string | null;
  instagramLink: string | null;
  videoFileId: Id<"_storage"> | null;
  videoReal: boolean;
  notes: string[];
}
interface State {
  runId: string;
  startedAt: number;
  finishedAt?: number;
  stopped?: boolean;
  turnMode: "queue" | "inline";
  plan: Array<{ scenario: string; flow: Flow }>;
  world: World;
  creators: Record<string, Id<"creators">>;
  mailboxCreators: Record<string, Id<"creators">>;
}
const stateKey = (runId: string) => `drill:${runId}:state`;
const cellKey = (runId: string, i: number) => `drill:${runId}:cell:${String(i).padStart(3, "0")}`;
const CELL_GAP_MS = 2_000;
const TURN_WAIT_MS = 300_000;

async function put(ctx: { db: MutationCtx["db"] }, key: string, value: unknown): Promise<void> {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", key)).unique();
  const json = JSON.stringify(value);
  if (row) await ctx.db.patch(row._id, { value: json, updatedAt: Date.now() });
  else await ctx.db.insert("syncState", { key, value: json, updatedAt: Date.now() });
}

export const readState = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<State | null> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", stateKey(a.runId))).unique();
    return row ? (JSON.parse(row.value) as State) : null;
  },
});
export const writeState = internalMutation({ args: { runId: v.string(), state: v.any() }, handler: async (ctx, a): Promise<null> => { await put(ctx, stateKey(a.runId), a.state); return null; } });
export const writeCell = internalMutation({ args: { runId: v.string(), i: v.number(), cell: v.any() }, handler: async (ctx, a): Promise<null> => { await put(ctx, cellKey(a.runId, a.i), a.cell); return null; } });

// ------------------------------------------------------------------ the drill's creators (guarded)

const isDrill = (c: Doc<"creators"> | null): c is Doc<"creators"> => Boolean(c && /^(eval-run:|eval:partnership:)drill-/.test(c.clerkUserId) && !c.telegramChatId && !c.phone);
async function drillCreator(ctx: { db: MutationCtx["db"] }, id: Id<"creators">): Promise<Doc<"creators">> {
  const c = (await ctx.db.get(id)) as Doc<"creators"> | null;
  if (!isDrill(c)) throw new Error("only an outage-drill creator");
  return c;
}

/** One isolated creator per scenario: both platforms, watched accounts on both, never a person. */
export const createCreator = internalMutation({
  args: { runId: v.string(), scenario: v.string(), world: v.any(), mailbox: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<Id<"creators">> => {
    const w = a.world as World;
    const clerkUserId = a.mailbox ? `eval:partnership:drill-${a.runId}-${a.scenario}` : `eval-run:drill-${a.runId}-${a.scenario}`;
    const existing = await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId)).first();
    if (existing) return existing._id;
    const now = Date.now();
    const id = await ctx.db.insert("creators", {
      clerkUserId,
      email: `drill-${a.runId}-${a.scenario}@eval.invalid`,
      handles: a.mailbox ? {} : { tiktok: w.ownTiktok, instagram: w.ownInstagram },
      ownership: "unverified",
      niche: "running and marathon training",
      timezone: "UTC",
      quietHours: { start: "00:00", end: "00:00" },
      tone: "friend",
      mode: "full",
      dossier: { keywords: w.keywords, persona: { summary: "a runner who films training runs and race days, on TikTok and Instagram" } },
      dossierVersion: 1,
      notes: [],
      affinities: [],
      experiments: [],
      channel: { paired: false },
      plan: { status: "comped", tier: "partner", founding: false },
      createdAt: now,
      conversationalOnboardingAt: now,
    } as never);
    if (!a.mailbox) {
      for (const [platform, handles] of [["tiktok", w.watched.tiktok], ["instagram", w.watched.instagram]] as const) {
        for (const handle of handles) await ctx.db.insert("trackedAccounts", { creatorId: id, platform, handle, addedBy: "creator", baselineN: 0, status: "active", createdAt: now });
      }
    }
    return id;
  },
});

/** Before the scout cell: paired (the rails need it) and one fresh breakout per platform. */
export const setupScout = internalMutation({
  args: { creatorId: v.id("creators"), links: v.array(v.string()) },
  handler: async (ctx, a): Promise<number> => {
    const c = await drillCreator(ctx, a.creatorId);
    await ctx.db.patch(a.creatorId, { channel: { ...c.channel, paired: true } });
    const tracked = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"trackedAccounts">[];
    let n = 0;
    for (const url of a.links) {
      const platform = url.includes("tiktok.com") ? "tiktok" : "instagram";
      const postId = url.match(/\/video\/(\d+)/)?.[1] ?? url.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/)?.[1] ?? `drill-${n}`;
      const t = tracked.find((x) => x.platform === platform);
      await ctx.db.insert("signals", { creatorId: a.creatorId, kind: "breakout", sourcePostIds: [postId], trackedAccountId: t?._id, score: 6.2, corroboration: { accounts: 0, soundRising: false }, verdict: "pending", url, detected: `6.2× this account's normal at 9h; ${url}`, why: `6.2× this account's normal at 9h; ${url}`, thresholdsVersion: "drill", createdAt: Date.now() } as never);
      n++;
    }
    return n;
  },
});
export const setPaired = internalMutation({
  args: { creatorId: v.id("creators"), paired: v.boolean() },
  handler: async (ctx, a): Promise<null> => {
    const c = await drillCreator(ctx, a.creatorId);
    await ctx.db.patch(a.creatorId, { channel: { ...c.channel, paired: a.paired } });
    return null;
  },
});

/** A Zernio connection for the analytics cell only (the hourly fleet pass would read it otherwise), removed after. */
export const setConnection = internalMutation({
  args: { creatorId: v.id("creators"), on: v.boolean() },
  handler: async (ctx, a): Promise<null> => {
    await drillCreator(ctx, a.creatorId);
    const rows = await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).eq("provider", "zernio")).collect();
    for (const r of rows) await ctx.db.delete(r._id);
    if (a.on) await ctx.db.insert("connections", { creatorId: a.creatorId, provider: "zernio", status: "connected", zernioProfileId: "drill-profile", zernioAccounts: [{ accountId: "drill-tt", platform: "tiktok", username: "drill", canFetchAnalytics: true, needsReconnect: false }, { accountId: "drill-ig", platform: "instagram", username: "drill", canFetchAnalytics: true, needsReconnect: false }], updatedAt: Date.now() });
    return null;
  },
});

/** An approved email pitch, ready for the real `delivery.send`, on the fixture creator's fake mailbox. */
export const setupEmail = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Id<"partnershipDrafts">> => {
    await drillCreator(ctx, a.creatorId);
    const mailbox = await ctx.db.query("partnershipMailboxes").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).unique();
    if (!mailbox) throw new Error("no fake mailbox");
    const now = Date.now();
    const evidence = [{ url: "https://northlinerunning.com/creators", excerpt: "Northline works with running creators. Pitch creators@northlinerunning.com.", checkedAt: now, kind: "extract" as const }];
    const opportunity = Opportunity.parse({ brand: "Northline Running", campaign: "creator program", type: "sponsorship", fit: "they film training runs", unknowns: [], assessment: { verdict: "recommend", goalAlignment: "paid running partnerships", contentAlignment: "training content", audienceFit: "unknown", commercialFit: "unknown", concerns: [], creatorEvidence: [{ kind: "message", id: "drill", quote: "i want paid running deals", reason: "their stated goal" }] }, eligibility: "", compensation: "", route: "email", contactEmail: "creators@northlinerunning.com", evidence, status: "shortlisted" });
    const opportunityId = await ctx.db.insert("partnershipOpportunities", { creatorId: a.creatorId, brandDomain: "northlinerunning.com", data: opportunity, updatedAt: now });
    const draft = Draft.parse({ revision: 1, channel: "email", subject: "a running creator for Northline", body: "Hi Northline team, I film my training runs. Could we talk about your creator program?", recipient: "creators@northlinerunning.com", sender: mailbox.email, mailboxGeneration: mailbox.generation, status: "approved", approvalCode: "DRILL", approvalExpiresAt: now + 3_600_000, approvedBy: "drill", createdAt: now });
    return await ctx.db.insert("partnershipDrafts", { creatorId: a.creatorId, opportunityId, data: draft, updatedAt: now });
  },
});

/** A camera-roll draft: the stored clip as their inbound file message. */
export const recordFile = internalMutation({
  args: { creatorId: v.id("creators"), fileId: v.id("_storage"), body: v.string() },
  handler: async (ctx, a): Promise<Id<"messages">> => {
    await drillCreator(ctx, a.creatorId);
    return await ctx.db.insert("messages", { creatorId: a.creatorId, direction: "in", surface: "telegram", body: a.body, kind: "file", fileId: a.fileId, fileMime: "video/mp4", ts: Date.now() } as never);
  },
});

/** After the run: paused, unpaired, no connection. The rows stay for the report. */
export const retire = internalMutation({
  args: { creatorIds: v.array(v.id("creators")) },
  handler: async (ctx, a): Promise<null> => {
    for (const id of a.creatorIds) {
      const c = await drillCreator(ctx, id);
      await ctx.db.patch(id, { channel: { ...c.channel, paired: false }, plan: { ...c.plan, status: "paused" } });
      for (const r of await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", id).eq("provider", "zernio")).collect()) await ctx.db.delete(r._id);
    }
    return null;
  },
});

// ------------------------------------------------------------------ observing (rows only)

type Snapshot = { trackedActive: number; signalsPending: number; signalsDropped: number; connectionStatus: string | null };

export const snapshot = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Snapshot> => {
    const tracked = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"trackedAccounts">[];
    const pending = await ctx.db.query("signals").withIndex("by_creator_verdict", (q) => q.eq("creatorId", a.creatorId).eq("verdict", "pending")).collect();
    const dropped = await ctx.db.query("signals").withIndex("by_creator_verdict", (q) => q.eq("creatorId", a.creatorId).eq("verdict", "dropped")).collect();
    const conn = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).eq("provider", "zernio")).first()) as Doc<"connections"> | null;
    return { trackedActive: tracked.filter((t) => t.status === "active").length, signalsPending: pending.length, signalsDropped: dropped.length, connectionStatus: conn?.status ?? null };
  },
});

export interface Observed {
  outbound: Array<{ kind: string; key: string; head: string; body: string }>;
  jobs: Array<{ id: string; kind: string; status: string; lastError: string; key: string }>;
  health: string[];
  failedModelCalls: number;
  predictions: number;
  finishes: number;
  ideas: number;
  signalsWritten: number;
  insights: Array<{ kind: string; status: string }>;
  drafts: Array<{ status: string }>;
  fakeSent: number;
  cache: Array<{ ref: string; stored: boolean; freshEmpty: boolean; error: boolean; rememberedLong: boolean }>;
}

const HEALTH_VENDORS = ["scrapecreators", "openrouter", "gemini", "zernio", "tavily", "gmail"];
function isEmptyValue(x: unknown): boolean {
  if (x === undefined || x === null) return false;
  if (Array.isArray(x)) return x.length === 0;
  const posts = (x as { posts?: unknown }).posts;
  return Array.isArray(posts) && posts.length === 0;
}

export const observe = internalQuery({
  args: { creatorIds: v.array(v.id("creators")), since: v.number(), refs: v.array(v.string()) },
  handler: async (ctx, a): Promise<Observed> => {
    const out: Observed = { outbound: [], jobs: [], health: [], failedModelCalls: 0, predictions: 0, finishes: 0, ideas: 0, signalsWritten: 0, insights: [], drafts: [], fakeSent: 0, cache: [] };
    for (const creatorId of a.creatorIds) {
      const msgs = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", creatorId).gte("ts", a.since)).take(200)) as Doc<"messages">[];
      for (const m of msgs) if (m.direction === "out") out.outbound.push({ kind: m.kind ?? "", key: m.dedupeKey ?? "", head: clip(m.body, 120), body: m.body });
      const jobs = (await ctx.db.query("jobs").withIndex("by_creator_and_createdAt", (q) => q.eq("creatorId", creatorId).gte("createdAt", a.since)).take(100)) as Doc<"jobs">[];
      for (const j of jobs) out.jobs.push({ id: j._id, kind: j.kind, status: j.status, lastError: j.lastError ?? "", key: j.idempotencyKey });
      const costs = await ctx.db.query("costEvents").withIndex("by_creator_at", (q) => q.eq("creatorId", creatorId).gte("at", a.since)).take(500);
      out.failedModelCalls += costs.filter((c) => (c as { succeeded?: boolean }).succeeded === false).length;
      out.predictions += (await ctx.db.query("predictions").withIndex("by_creator", (q) => q.eq("creatorId", creatorId).gte("createdAt", a.since)).take(50)).length;
      out.finishes += (await ctx.db.query("finishes").withIndex("by_creator", (q) => q.eq("creatorId", creatorId).gte("createdAt", a.since)).take(50)).length;
      out.ideas += (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", creatorId).gte("createdAt", a.since)).take(50)).length;
      out.signalsWritten += ((await ctx.db.query("signals").withIndex("by_creator", (q) => q.eq("creatorId", creatorId).gte("createdAt", a.since)).take(200)) as Doc<"signals">[]).filter((s) => s.thresholdsVersion !== "drill").length;
      const ins = (await ctx.db.query("accountInsights").withIndex("by_creator_kind", (q) => q.eq("creatorId", creatorId)).take(50)) as Doc<"accountInsights">[];
      for (const r of ins) if (Math.max(r.fetchedAt, r.attemptedAt ?? 0) >= a.since) out.insights.push({ kind: r.kind, status: r.status });
      const drafts = (await ctx.db.query("partnershipDrafts").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).take(20)) as Doc<"partnershipDrafts">[];
      for (const d of drafts) if (d.updatedAt >= a.since) out.drafts.push({ status: Draft.parse(d.data).status });
    }
    for (const vendor of HEALTH_VENDORS) {
      const rows = (await ctx.db.query("vendorHealth").withIndex("by_vendor_at", (q) => q.eq("vendor", vendor).gte("at", a.since)).take(50)) as Doc<"vendorHealth">[];
      for (const h of rows) if (!h.ok) out.health.push(`${h.vendor}/${h.check}`);
    }
    const box = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", "eval:fake_gmail")).unique();
    if (box) out.fakeSent = ((JSON.parse(box.value) as { sent?: Array<{ at: number; raw: string }> }).sent ?? []).filter((m) => m.at >= a.since && /maya-/.test(mimeMessageId(m.raw) ?? "")).length;
    for (const ref of a.refs) {
      const [kind, key] = [ref.slice(0, ref.indexOf("|")), ref.slice(ref.indexOf("|") + 1)];
      const row = await ctx.db.query("readCache").withIndex("by_key", (q) => q.eq("kind", kind).eq("key", key)).unique();
      if (!row) continue;
      const fresh = row.value !== undefined && row.expiresAt > Date.now();
      // A vendor outage (402/429/5xx/hang) must be retried soon; only "no such account" is worth a day (reads/cache.ts).
      const rememberedLong = row.value === undefined && Boolean(row.error) && row.expiresAt - Date.now() > 10 * 60_000;
      out.cache.push({ ref: `${kind}`, stored: (row.fetchedAt ?? 0) >= a.since, freshEmpty: fresh && isEmptyValue(row.value), error: Boolean(row.error), rememberedLong });
    }
    return out;
  },
});

/** Pure: a cell from what the flow returned and what the rows say. */
export function assessCell(input: { scenario: string; flow: Flow; faults: Fault[]; hits: Record<string, number>; ended: Cell["ended"]; endDetail: string; inboundId?: string; observed: Observed; before: Snapshot | null; after: Snapshot | null; ms: number; flowResult?: unknown }): Cell {
  const { observed: o, flow } = input;
  const hitFaults = new Set(Object.keys(input.hits).map((k) => k.split(":")[0]));
  const reached = input.faults.some((f) => hitFaults.has(f));
  const hitVendor = (prefix: string) => [...hitFaults].some((f) => f.startsWith(prefix));
  const keysFor: Record<Flow, (k: string) => boolean> = {
    text: (k) => Boolean(input.inboundId && k.includes(input.inboundId)),
    tiktok_link: (k) => Boolean(input.inboundId && k.includes(input.inboundId)),
    instagram_link: (k) => Boolean(input.inboundId && k.includes(input.inboundId)),
    finish: (k) => Boolean(input.inboundId && k.includes(input.inboundId)),
    email_send: (k) => /^partner-(send-result|preflight):/.test(k),
    scout: (k) => /^(scout|askstop|foryou):/.test(k),
    sampler: (k) => /^gone:/.test(k),
    sweep: () => false,
    analytics: () => false,
    web_search: () => false,
  };
  const heard = o.outbound.filter((m) => keysFor[flow](m.key) || m.key.startsWith("status:")).map((m) => ({ kind: m.kind, key: m.key, head: m.head }));
  const fakeSuccess: string[] = [];
  const writerDown = hitVendor("writer_");
  if ((flow === "tiktok_link" || flow === "instagram_link") && writerDown && o.predictions > 0) fakeSuccess.push("a prediction was written while the writer was down");
  if (flow === "finish" && (writerDown || hitVendor("gemini_")) && o.finishes > 0) fakeSuccess.push("captions were recorded without a watch or a writer");
  if (flow === "scout" && writerDown && (o.ideas > 0 || o.outbound.some((m) => m.key.startsWith("scout:")))) fakeSuccess.push("an idea went out while the writer was down");
  if (flow === "email_send" && hitVendor("gmail_")) {
    if (o.drafts.some((d) => d.status === "sent")) fakeSuccess.push("the draft was marked sent on a failed send");
    if (!o.drafts.some((d) => d.status === "unknown" || d.status === "failed")) fakeSuccess.push("the failed send was not recorded as unknown");
  }
  if (flow === "analytics" && hitVendor("zernio_") && o.insights.some((r) => r.status === "ok")) fakeSuccess.push("an insights row was written as ok during a Zernio outage");
  if ((flow === "sampler" || flow === "sweep") && hitVendor("scrape_") && o.signalsWritten > 0 && input.endDetail.includes("(all failed)")) fakeSuccess.push("signals were written from reads that all failed");
  if (flow === "web_search" && hitVendor("tavily_") && (input.flowResult as { ok?: boolean } | undefined)?.ok) fakeSuccess.push("the search said ok while Tavily was down");

  const duplicates: string[] = [];
  const seenBodies = new Map<string, number>();
  for (const m of o.outbound) seenBodies.set(`${m.kind}|${m.body}`, (seenBodies.get(`${m.kind}|${m.body}`) ?? 0) + 1);
  for (const [k, n] of seenBodies) if (n > 1) duplicates.push(`${n}× ${k.slice(0, 80)}`);
  if (o.fakeSent > 1) duplicates.push(`${o.fakeSent} emails reached the (fake) mailbox`);

  const badCache = o.cache.filter((c) => c.stored || c.freshEmpty || c.rememberedLong).map((c) => `${c.ref}: ${c.stored ? "a value was stored during the failure" : c.freshEmpty ? "a fresh empty value" : "an outage remembered like a missing account (skipped for a day)"}`);

  const wrongMarks: string[] = [];
  if (input.before && input.after) {
    if (input.after.trackedActive < input.before.trackedActive) wrongMarks.push(`${input.before.trackedActive - input.after.trackedActive} watched account(s) retired during a vendor failure`);
    if (writerDown && input.after.signalsDropped > input.before.signalsDropped) wrongMarks.push("signals were dropped because the writer was down");
    if (input.after.connectionStatus && input.after.connectionStatus !== input.before.connectionStatus) wrongMarks.push(`connection went ${input.before.connectionStatus} → ${input.after.connectionStatus}`);
  }
  if (flow === "analytics" && hitVendor("zernio_") && o.insights.some((r) => r.status === "not_available")) wrongMarks.push("a 5xx was stored as 'not available' (reads as the platform hiding it)");

  const deadJobs = o.jobs.filter((j) => j.status === "dead").map((j) => `${j.kind}: ${j.lastError.slice(0, 80)}`);
  return {
    scenario: input.scenario, flow, faults: input.faults, reached, hits: input.hits,
    ended: input.ended, endDetail: input.endDetail.slice(0, 300),
    waiting: WAITING.has(flow), heard, fakeSuccess,
    operator: { deadJobs, health: [...new Set(o.health)], failedModelCalls: o.failedModelCalls },
    duplicates, badCache, wrongMarks, ms: input.ms,
  };
}

// ------------------------------------------------------------------ running

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 240);

/** Their message through the real queue: enqueue (one attempt, so the dead letter is reached) → drain → runJob. */
async function turn(ctx: ActionCtx, creatorId: Id<"creators">, messageId: Id<"messages">, mode: "queue" | "inline"): Promise<{ ended: Cell["ended"]; detail: string }> {
  const { jobId } = await ctx.runMutation(internal.core.jobs.enqueue, { kind: "converse", idempotencyKey: `converse:${messageId}`, creatorId, payloadJson: JSON.stringify({ messageId, kind: "drill" }), maxAttempts: 1 });
  if (mode === "inline") {
    // Tests: convex-test does not run scheduled functions while an action waits, so claim and run it here.
    const claimed = await ctx.runMutation(internal.core.jobs.claimNext, { kinds: ["converse"] });
    if (claimed) await ctx.runAction(internal.core.scheduler.runJob, { jobId: claimed._id, attempt: claimed.attempts });
  }
  const deadline = Date.now() + (mode === "inline" ? 0 : TURN_WAIT_MS);
  for (;;) {
    const job = await ctx.runQuery(internal.core.jobs.byId, { jobId });
    if (!job) return { ended: "silent", detail: "the job row disappeared" };
    if (job.status === "succeeded") return { ended: "result", detail: "turn answered" };
    if (job.status === "dead" || job.status === "failed") return { ended: "named_failure", detail: job.lastError ?? "(no error kept)" };
    if (Date.now() >= deadline) return job.status === "queued" && job.attempts > 0 ? { ended: "retry", detail: job.lastError ?? "" } : { ended: job.status === "running" ? "stuck" : "silent", detail: `${job.status} after ${Math.round(TURN_WAIT_MS / 1000)}s` };
    await sleep(2_000);
  }
}

async function runFlow(ctx: ActionCtx, s: State, scenario: string, flow: Flow, creatorId: Id<"creators">): Promise<{ ended: Cell["ended"]; detail: string; inboundId?: string; result?: unknown; extraCreators?: Id<"creators">[] }> {
  const w = s.world;
  const inbound = async (body: string) => (await ctx.runMutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body })).messageId;
  switch (flow) {
    case "text": {
      const id = await inbound("what should i post this week? keep it short");
      return { ...(await turn(ctx, creatorId, id, s.turnMode)), inboundId: id };
    }
    case "tiktok_link":
    case "instagram_link": {
      const link = flow === "tiktok_link" ? w.tiktokLink : w.instagramLink;
      if (!link) return { ended: "skipped", detail: `no ${flow === "tiktok_link" ? "TikTok" : "Instagram"} link found for the world` };
      const id = await inbound(`why did this blow up ${link}`);
      return { ...(await turn(ctx, creatorId, id, s.turnMode)), inboundId: id };
    }
    case "finish": {
      if (!w.videoFileId) return { ended: "skipped", detail: "no draft video in storage" };
      const id = await ctx.runMutation(internal.eval.outageDrill.recordFile, { creatorId, fileId: w.videoFileId, body: "caption + sound for this one?" });
      return { ...(await turn(ctx, creatorId, id, s.turnMode)), inboundId: id };
    }
    case "scout": {
      const links = [w.tiktokLink, w.instagramLink].filter((x): x is string => Boolean(x));
      if (!links.length) return { ended: "skipped", detail: "no links to make signals from" };
      await ctx.runMutation(internal.eval.outageDrill.setupScout, { creatorId, links });
      try {
        const r = await ctx.runAction(internal.scout.scout.run, { creatorId });
        return { ended: r.sent ? "result" : /model failed|failed|no JSON/.test(r.reason) ? "named_failure" : "result", detail: `${r.sent ? "sent" : "not sent"}: ${r.reason}`, result: r };
      } finally {
        await ctx.runMutation(internal.eval.outageDrill.setPaired, { creatorId, paired: false });
      }
    }
    case "sampler": {
      const r = await ctx.runAction(internal.scout.sampler.run, { creatorId });
      return { ended: r.failed ? "named_failure" : "result", detail: `accounts ${r.accounts}, signals ${r.signals}, failed ${r.failed}${r.failed === r.accounts && r.accounts ? " (all failed)" : ""}, gone ${r.gone}`, result: r };
    }
    case "sweep": {
      const r = await ctx.runAction(internal.scout.sweep.run, { creatorId });
      return { ended: r.failed ? "named_failure" : "result", detail: `keywords ${r.keywords}, shapes ${r.signals}, failed ${r.failed}${r.failed === r.keywords * 2 && r.keywords ? " (all failed)" : ""}`, result: r };
    }
    case "analytics": {
      await ctx.runMutation(internal.eval.outageDrill.setConnection, { creatorId, on: true });
      try {
        const r = await ctx.runAction(internal.connections.insightsSync.syncCreator, { creatorId });
        return { ended: r.failed ? "named_failure" : "result", detail: `accounts ${r.accounts}, failed ${r.failed}`, result: r };
      } finally {
        await ctx.runMutation(internal.eval.outageDrill.setConnection, { creatorId, on: false });
      }
    }
    case "web_search": {
      const r = await ctx.runAction(internal.agent.web.search, { creatorId, query: "running shoe trends this week" });
      return { ended: r.ok ? "result" : "named_failure", detail: r.ok ? `${r.results.length} results` : r.reason, result: r };
    }
    case "email_send": {
      const mailboxCreator = s.mailboxCreators[scenario];
      if (!mailboxCreator) return { ended: "skipped", detail: "email sending needs EVAL_FAKES=1 on a local deployment (the fake Gmail)" };
      const draftId = await ctx.runMutation(internal.eval.outageDrill.setupEmail, { creatorId: mailboxCreator });
      await ctx.runAction(internal.partnerships.delivery.send, { creatorId: mailboxCreator, draftId });
      const d = await ctx.runQuery(internal.eval.outageDrill.draftStatus, { draftId });
      return { ended: d === "sent" ? "result" : d === "unknown" || d === "failed" ? "named_failure" : d === "sending" ? "stuck" : "silent", detail: `draft ${d}`, extraCreators: [mailboxCreator] };
    }
  }
}

export const draftStatus = internalQuery({
  args: { draftId: v.id("partnershipDrafts") },
  handler: async (ctx, a): Promise<string> => {
    const r = (await ctx.db.get(a.draftId)) as Doc<"partnershipDrafts"> | null;
    return r ? Draft.parse(r.data).status : "missing";
  },
});

/** One cell: faults on (for this scenario's creators only), the flow, faults off, the rows read. */
export const runCell = internalAction({
  args: { runId: v.string(), i: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const s = await ctx.runQuery(internal.eval.outageDrill.readState, { runId: a.runId });
    if (!s || s.stopped || a.i >= s.plan.length) {
      if (s && !s.finishedAt) await ctx.runAction(internal.eval.outageDrill.finishRun, { runId: a.runId });
      return null;
    }
    const { scenario, flow } = s.plan[a.i];
    const faults = SCENARIOS[scenario];
    let creatorId = s.creators[scenario];
    if (!creatorId) {
      creatorId = await ctx.runMutation(internal.eval.outageDrill.createCreator, { runId: s.runId, scenario, world: s.world });
      s.creators[scenario] = creatorId;
      // The email cell needs the fake Gmail, which only an isolated partnership fixture on a local deployment reaches.
      if (s.plan.some((p) => p.scenario === scenario && p.flow === "email_send") && process.env.EVAL_FAKES === "1" && process.env.ENVIRONMENT_NAME === "local") {
        const mb = await ctx.runMutation(internal.eval.outageDrill.createCreator, { runId: s.runId, scenario, world: s.world, mailbox: true });
        await ctx.runAction(internal.eval.partnershipGauntlet.connectFakeMailbox, { creatorId: mb });
        s.mailboxCreators[scenario] = mb;
      }
      await ctx.runMutation(internal.eval.outageDrill.writeState, { runId: s.runId, state: s });
    }
    const creators = [creatorId, ...(s.mailboxCreators[scenario] ? [s.mailboxCreators[scenario]] : [])];
    const before = await ctx.runQuery(internal.eval.outageDrill.snapshot, { creatorId });
    const started = Date.now();
    let outcome: Awaited<ReturnType<typeof runFlow>>;
    await ctx.runMutation(internal.eval.faults.resetHits, {});
    await ctx.runMutation(internal.eval.faults.set, { faults, creatorIds: creators, ttlMinutes: 20, runId: s.runId });
    try {
      outcome = await runFlow(ctx, s, scenario, flow, creatorId);
    } catch (e) {
      // A throw is a named failure (the message is the name), never a lost cell.
      outcome = { ended: "named_failure", detail: `threw: ${errText(e)}` };
    } finally {
      await ctx.runMutation(internal.eval.faults.clear, {});
    }
    const { hits } = await ctx.runQuery(internal.eval.faults.current, {});
    const after = await ctx.runQuery(internal.eval.outageDrill.snapshot, { creatorId });
    const observed = await ctx.runQuery(internal.eval.outageDrill.observe, { creatorIds: creators, since: started, refs: hits.refs });
    const cell = assessCell({ scenario, flow, faults, hits: hits.counts, ended: outcome.ended, endDetail: outcome.detail, inboundId: outcome.inboundId, observed, before, after, ms: Date.now() - started, flowResult: outcome.result });
    await ctx.runMutation(internal.eval.outageDrill.writeCell, { runId: s.runId, i: a.i, cell: { ...cell, verdict: judgeCell(cell) } });
    if (s.turnMode === "queue") await ctx.scheduler.runAfter(CELL_GAP_MS, internal.eval.outageDrill.runCell, { runId: s.runId, i: a.i + 1 });
    return null;
  },
});

export const finishRun = internalAction({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<null> => {
    await ctx.runMutation(internal.eval.faults.clear, {});
    const s = await ctx.runQuery(internal.eval.outageDrill.readState, { runId: a.runId });
    if (!s) return null;
    await ctx.runMutation(internal.eval.outageDrill.retire, { creatorIds: [...Object.values(s.creators), ...Object.values(s.mailboxCreators)] });
    await ctx.runMutation(internal.eval.outageDrill.writeState, { runId: a.runId, state: { ...s, finishedAt: Date.now() } });
    return null;
  },
});

/** Links and a draft video for the world, read once with no fault on (a few credits), or given. */
export const prepareWorld = internalAction({
  args: { world: v.any() },
  handler: async (ctx, a): Promise<World> => {
    const w = a.world as World;
    const firstLink = async (platform: "tiktok" | "instagram", handle: string | undefined): Promise<string | null> => {
      if (!handle) return null;
      try {
        const r = await ctx.runAction(internal.reads.read.read, { kind: "account.posts", params: { platform, handle, sort: "latest" } });
        const posts = (Array.isArray(r.value) ? r.value : ((r.value as { posts?: unknown[] } | null)?.posts ?? [])) as Array<{ url?: string | null }>;
        return posts.find((p) => p.url?.startsWith("http"))?.url ?? null;
      } catch (e) {
        w.notes.push(`no ${platform} link from @${handle}: ${errText(e).slice(0, 100)}`);
        return null;
      }
    };
    w.tiktokLink ??= await firstLink("tiktok", w.watched.tiktok[0]);
    w.instagramLink ??= await firstLink("instagram", w.watched.instagram[0]);
    if (!w.videoFileId && w.tiktokLink) {
      try {
        const info = await ctx.runAction(internal.reads.read.read, { kind: "post.info", params: { platform: "tiktok", url: w.tiktokLink } });
        const videoUrl = (info.value as { videoUrl?: string | null } | null)?.videoUrl;
        const media = videoUrl ? await fetchMedia(videoUrl) : null;
        if (media?.ok) { w.videoFileId = await ctx.storage.store(new Blob([media.bytes], { type: media.mimeType })); w.videoReal = true; }
      } catch (e) {
        w.notes.push(`no real draft video: ${errText(e).slice(0, 100)}`);
      }
    }
    // Without a real clip the Gemini-down cells still run (the fault fires before the bytes matter); the writer-down finish cell may not reach the writer.
    if (!w.videoFileId) { w.videoFileId = await ctx.storage.store(new Blob([new Uint8Array(2048)], { type: "video/mp4" })); w.videoReal = false; }
    return w;
  },
});

export const start = internalAction({
  args: {
    scenarios: v.optional(v.array(v.string())),
    /** Only these flows (default: every flow each scenario's faults can reach). */
    flows: v.optional(v.array(v.string())),
    allFlows: v.optional(v.boolean()),
    ownTiktok: v.optional(v.string()),
    ownInstagram: v.optional(v.string()),
    watchedTiktok: v.optional(v.array(v.string())),
    watchedInstagram: v.optional(v.array(v.string())),
    keywords: v.optional(v.array(v.string())),
    tiktokLink: v.optional(v.string()),
    instagramLink: v.optional(v.string()),
    /** A draft clip already in storage (skips fetching one). */
    videoFileId: v.optional(v.id("_storage")),
    /** Tests only: run each turn inline instead of waiting on the scheduled queue, and don't chain cells. */
    turnMode: v.optional(v.union(v.literal("queue"), v.literal("inline"))),
    runId: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<{ runId: string; cells: number; world: World }> => {
    if (!faultsEnabled(process.env)) throw new Error("the outage drill refuses this deployment (ENVIRONMENT_NAME unset or production)");
    const scenarios = a.scenarios ?? Object.keys(SCENARIOS);
    const unknown = scenarios.filter((x) => !SCENARIOS[x]);
    if (unknown.length) throw new Error(`unknown scenario: ${unknown.join(", ")} (known: ${Object.keys(SCENARIOS).join(", ")})`);
    const runId = a.runId ?? `drill-${Date.now()}`;
    const world = await ctx.runAction(internal.eval.outageDrill.prepareWorld, {
      world: {
        ownTiktok: a.ownTiktok ?? "drill.runner.tt", ownInstagram: a.ownInstagram ?? "drill.runner.ig",
        watched: { tiktok: a.watchedTiktok ?? ["andi.renay", "becca_foggia"], instagram: a.watchedInstagram ?? ["nike", "natgeo"] },
        keywords: a.keywords ?? ["marathon training"],
        tiktokLink: a.tiktokLink ?? null, instagramLink: a.instagramLink ?? null,
        videoFileId: a.videoFileId ?? null, videoReal: Boolean(a.videoFileId), notes: [],
      } satisfies World,
    });
    const plan = scenarios.flatMap((scenario) => flowsFor(scenario, a.allFlows).filter((flow) => !a.flows || a.flows.includes(flow)).map((flow) => ({ scenario, flow })));
    const state: State = { runId, startedAt: Date.now(), turnMode: a.turnMode ?? "queue", plan, world, creators: {}, mailboxCreators: {} };
    await ctx.runMutation(internal.eval.outageDrill.writeState, { runId, state });
    if (state.turnMode === "queue") await ctx.scheduler.runAfter(0, internal.eval.outageDrill.runCell, { runId, i: 0 });
    return { runId, cells: plan.length, world };
  },
});

/** Abort: faults off now, no further cells. */
export const stop = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const faults = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", "eval:faults")).unique();
    if (faults) await ctx.db.delete(faults._id);
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", stateKey(a.runId))).unique();
    if (row) await ctx.db.patch(row._id, { value: JSON.stringify({ ...(JSON.parse(row.value) as State), stopped: true }), updatedAt: Date.now() });
    return null;
  },
});

export const report = internalQuery({
  args: { runId: v.string(), cells: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<unknown> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", stateKey(a.runId))).unique();
    if (!row) return null;
    const s = JSON.parse(row.value) as State;
    const rows = await ctx.db.query("syncState").withIndex("by_key", (q) => q.gte("key", `drill:${a.runId}:cell:`).lt("key", `drill:${a.runId}:cell:~`)).collect();
    const cells = rows.map((r) => JSON.parse(r.value) as Cell & { verdict: Verdict });
    const { summary, matrix } = matrixOf(cells);
    return {
      runId: s.runId,
      status: s.finishedAt ? "finished" : s.stopped ? "stopped" : `running (${cells.length} of ${s.plan.length} cells)`,
      startedAt: new Date(s.startedAt).toISOString(),
      finishedAt: s.finishedAt ? new Date(s.finishedAt).toISOString() : null,
      world: { tiktokLink: s.world.tiktokLink, instagramLink: s.world.instagramLink, videoReal: s.world.videoReal, notes: s.world.notes },
      summary,
      matrix,
      failures: cells.filter((c) => c.verdict.pass === false).map((c) => ({ scenario: c.scenario, flow: c.flow, why: c.verdict.why, heard: c.heard.map((h) => `${h.kind}: ${h.head}`), operator: c.operator, ended: `${c.ended}: ${c.endDetail}` })),
      ...(a.cells ? { cells } : {}),
    };
  },
});
