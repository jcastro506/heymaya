/**
 * The first-week simulation (plan: the MVP path, never run end to end until now). Brand-new
 * creators sign up with REAL handles and live their first week, compressed, so we can see what a
 * new TikTok or Instagram creator actually gets: the catalogue read and dossier, pairing by text,
 * the hello, the first read, the first ideas, the first week plan, and the first Sunday review.
 * Not to be confused with `scout/firstWeek.ts`, which is the product's own first-week ledger.
 *
 * How it stays real:
 * - THE REAL ONBOARDING PATH. Each creator is made by `startCreator` (the web form's function), so
 *   the real `ingest_catalogue` job is queued and the fleet's minute drain runs it. The admired
 *   screen runs the real `suggestFor` and adds its top picks the way the app's add does. Pairing is
 *   the phone door: their number on the row (as `setPhone` writes it), a one-shot token, and the
 *   real `claimPairingByPhone` with the START text recorded as `handleText` records it. Nothing is
 *   sent to a vendor: the number is fictional (555-01xx) and never registered on the line.
 * - DAY 0 IN REAL TIME. Signup, the read, pairing, the hello, the first read, the plan the read
 *   schedules 20 minutes later and the scout it schedules 30 minutes later all run on the real clock.
 * - DAYS 1..N BY AGEING THE WORLD (livingSim's technique, its helpers): every row the creator owns
 *   moves one day into the past, then the same per-creator functions the crons fan out to run in a
 *   fixed order (`dayPlan`). Sunday is the simulated Sunday (the signup weekday is a parameter).
 * - A CREATOR ACTOR, in their own caption voice, replies sometimes and taps buttons through the
 *   phone path's menu matching.
 * - MEASURED FROM ROWS. Every timestamp in the report is read from the creator's rows, which all
 *   age together, so an offset from `createdAt` is simulated time.
 *
 * Isolation: every creator is `eval-run:fw-<run>:<i>` (no delivery, `messages.send` suppresses it;
 * no fleet job, `pairedRows` skips `isEval`); every mutation here refuses anything else.
 * Cost: the catalogue read is capped for the sim (watched posts are 10 credits each); a run stops
 * itself at `maxCredits` ScrapeCreators credits. See docs/FIRST_WEEK_SIM.md.
 */
import { v } from "convex/values";
import { internalAction, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { parseJson } from "../agent/opinion";
import { CRITIC_TIMEOUT_MS } from "../agent/critic";
import { TABLES_BY_CREATOR } from "../account/deletion";
import { applyIdeaAct } from "../core/ideaActs";
import { startCreator } from "../onboarding/start";
import { addTracked } from "../agent/manage";
import { PAIRING_TTL_MS } from "../core/pairing";
import { menuLine, menuPick } from "../core/imessage";
import { normalizePhone } from "../integrations/claw/client";
import { READ_SETTLE_MS, localHourMinute } from "../scout/gate";
import { MIN_DAYS_BEFORE_REVIEW } from "../review/weekly";
import { actorPromptFor, ageCreatorTable, CREATOR_INDEX, rng } from "./livingSim";
import { clip } from "../lib/clip";
import { armReplay } from "./replay";
import { productBeats, roleOf, runBeat, summariseChecks, type Check } from "./productScript";

const D = 86_400_000;
const MIN = 60_000;

// ------------------------------------------------------------------ who, and the knobs

export interface Subject { tiktok?: string; instagram?: string; timezone?: string; note?: string }

/**
 * ⚠️ DEFAULT SUBJECTS — SWAP FREELY. Real public accounts, chosen for spread, not vetted live:
 * 2 TikTok-only, 3 Instagram-only, 3 on both; small and large; eight different lanes. The two small
 * runners come from our recorded vendor fixtures; the rest are well-known public creators. A handle
 * already held by another creator on the deployment (a scenario persona, an earlier run) is refused
 * by the real signup rule and reported as a named failure; `preflight` shows which before you start.
 */
export const DEFAULT_SUBJECTS: Subject[] = [
  { tiktok: "cam.luyckx", note: "TikTok only, small, running" },
  { instagram: "stephpiruns", note: "Instagram only, small, running" },
  { instagram: "minimalistbaker", note: "Instagram only, large, recipes" },
  { tiktok: "hankgreen1", note: "TikTok only, large, science" },
  { tiktok: "thekoreanvegan", instagram: "thekoreanvegan", note: "both, large, food + storytelling" },
  { tiktok: "plantkween", instagram: "plantkween", note: "both, mid, plants" },
  { instagram: "leoniehanne", note: "Instagram only, large, fashion" },
  { tiktok: "brittany_broski", instagram: "brittany_broski", note: "both, large, comedy" },
];

export const FW_DEFAULTS = {
  days: 7,
  /** Watched posts in the catalogue read (10 credits each; a real signup watches up to 40). */
  watchCap: 2,
  /** Transcribed posts in the catalogue read (1 credit each; a real signup does up to 40). */
  transcriptCap: 6,
  /** Suggested accounts they "pick" on the admired screen (the app asks for three). */
  admired: 3,
  /** Signup to texting START: the time it takes to walk through the app's remaining screens. */
  pairAfterMs: 3 * MIN,
  /** Day 0 ends at the first read + the settle window + 5 min, or at this, whichever is first. */
  day0MaxMs: 90 * MIN,
  /** ScrapeCreators credits for the whole run; at this the run stops itself and says so. */
  maxCredits: 600,
  /** The simulated signup weekday (0 Sunday … 6 Saturday). Monday puts the first Sunday on day 6. */
  signupWeekday: 1,
  seed: 11,
  /**
   * Zero ScrapeCreators credits (eval/replay.ts): every read is answered from the deployment's read
   * cache, a read never cached is a named failure, and the ceiling drops to 1 credit, so a single paid
   * read stops the run and says so. Subjects default to accounts the cache can onboard.
   */
  replay: false,
  /** "product": the scripted week that exercises everything else (eval/productScript.ts). */
  script: "none",
} as const;

const TICK_MS = MIN;
const STEP_GAP_MS = 4_000;
/** Longer than any one step (an action's limit is 10 minutes): a step still running at this is dead. */
const STEP_TIMEOUT_MS = 11 * MIN;
/** Wait at most this long for their jobs to settle before ageing the world anyway. */
const SETTLE_WAIT_MS = 10 * MIN;

export const FW_PREFIX = "eval-run:fw-";
export const subjectFor = (runId: string, i: number) => `eval-run:${runId}:${i}`;
export const isFirstWeekSubject = (clerkUserId: string | undefined) => (clerkUserId ?? "").startsWith(FW_PREFIX);

// ------------------------------------------------------------------ pure parts

/** Pure: a fictional North American number (555-0100…0199 are reserved for fiction) per run and creator. */
export function phoneFor(runId: string, i: number): string {
  let h = 0;
  for (const ch of runId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  let npa = 201 + (h % 780); // 201…980
  if (npa % 100 === 11) npa += 1; // N11 codes are not area codes
  return `+1${npa}5550${100 + (i % 100)}`; // NPA 555 01XX
}

/** Real zones across the world; each creator gets one that is daytime when the run starts. */
export const ZONES = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo", "Europe/London", "Europe/Berlin", "Africa/Lagos", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"] as const;

/**
 * Pure: `n` timezones, varied, each between 09:00 and 16:59 local at `now`. The run takes a few
 * real hours and Maya's rails read the real clock, so a creator whose simulated week ran at 03:00
 * their time would measure quiet hours, not Maya. Deterministic for a given `now`.
 */
export function timezonesFor(n: number, now: number): string[] {
  const awake = ZONES.filter((z) => { const { hour } = localHourMinute(now, z); return hour >= 9 && hour < 17; });
  const pool = awake.length ? awake : [...ZONES];
  return Array.from({ length: n }, (_, i) => pool[i % pool.length]);
}

export type Step = "age" | "expireQuestions" | "sampler" | "sweep" | "morning" | "scout" | "actor" | "invite" | "scoutAfternoon" | "howDidItGo" | "review" | "weekPlan" | "quiet" | "actorEvening" | "snapshot" | `beat:${string}`;

/** Pure: the simulated weekday of day `d` (0 Sunday). */
export function weekdayOf(d: number, signupWeekday: number): number {
  return (((signupWeekday + d) % 7) + 7) % 7;
}

/**
 * Pure: one simulated day, in the order the crons would reach a creator on their clock. The world
 * ages first; the morning line, the scout, their reply; the day-two invitation; a second scout pass
 * (the hourly scout gets more than one chance a day); the evening: the shoot check, and on Sunday the
 * review (morning, once they've been here five days, as `dueForReview` requires) and the next week's
 * plan (18:00); the quiet check; their evening reply; the snapshot.
 */
export function dayPlan(d: number, opts: { signupWeekday: number; script?: "none" | "product" }): Step[] {
  const sunday = weekdayOf(d, opts.signupWeekday) === 0;
  // The product script's moments run after the morning: she has spoken, and they answer.
  const beats: Step[] = opts.script === "product" ? productBeats(d).map((b) => `beat:${b}` as Step) : [];
  return [
    "age", "expireQuestions", "sampler", "sweep", "morning", "scout", "actor", ...beats,
    ...(d === 1 ? (["invite"] as Step[]) : []),
    ...(sunday && d >= MIN_DAYS_BEFORE_REVIEW ? (["review"] as Step[]) : []),
    "scoutAfternoon", "howDidItGo",
    ...(sunday ? (["weekPlan"] as Step[]) : []),
    "quiet", "actorEvening", "snapshot",
  ];
}

/** Pure: which platform an idea's inspiration came from, from its link (or the own post it rhymes with). */
export function inspirationPlatform(links: string[], ownPostPlatform?: string | null): "tiktok" | "instagram" | "own_tiktok" | "own_instagram" | "unknown" {
  for (const l of links) {
    if (/tiktok\.com/i.test(l)) return "tiktok";
    if (/instagram\.com/i.test(l)) return "instagram";
  }
  if (ownPostPlatform === "tiktok") return "own_tiktok";
  if (ownPostPlatform === "instagram") return "own_instagram";
  return "unknown";
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const hours = (ms: number | null | undefined) => (ms === null || ms === undefined ? null : Math.round((ms / 3_600_000) * 10) / 10);

// ------------------------------------------------------------------ state (syncState rows; no new table)

type CreatorSlot = { i: number; subject: string; handles: { tiktok?: string; instagram?: string }; timezone: string; note?: string; creatorId?: Id<"creators">; error?: string };
type Opts = { days: number; watchCap: number; transcriptCap: number; admired: number; pairAfterMs: number; day0MaxMs: number; maxCredits: number; signupWeekday: number; seed: number; replay: boolean; script: "none" | "product" };
export type RunState = { runId: string; startedAt: number; opts: Opts; creators: CreatorSlot[]; stopped?: string };
type Cursor = { phase: "signup" | "day" | "judge" | "done"; d: number; k: number; attempt: number; since: number };
type Ev = { name: string; simMs: number; detail?: string };
export type CreatorLog = {
  i: number; createdRealAt: number; cursor: Cursor; events: Ev[];
  admiredDone?: boolean; pairedDone?: boolean; actorSeenAt: number; turns: number; waitedSince?: number;
  steps: Array<{ d: number; step: string; result: string; ms: number }>;
  actor: Array<{ d: number; said: string[]; acts: string[]; heard: string[] }>;
  failures: Array<{ d: number; step: string; error: string }>;
  snapshots: Array<{ d: number; snap: unknown }>;
  judged?: unknown;
  /** The product script's checks (eval/productScript.ts): each promise, kept or not, from rows. */
  checks?: Check[];
};

const stateKey = (runId: string) => `fw:${runId}:state`;
const logKey = (runId: string, i: number) => `fw:${runId}:c:${String(i).padStart(2, "0")}`;

async function writeKey(ctx: MutationCtx, key: string, value: unknown): Promise<void> {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", key)).unique();
  const json = JSON.stringify(value);
  if (row) await ctx.db.patch(row._id, { value: json, updatedAt: Date.now() });
  else await ctx.db.insert("syncState", { key, value: json, updatedAt: Date.now() });
}
async function readKey<T>(ctx: QueryCtx | MutationCtx, key: string): Promise<T | null> {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", key)).unique();
  return row ? (JSON.parse(row.value) as T) : null;
}

export const readState = internalQuery({ args: { runId: v.string() }, handler: async (ctx, a): Promise<RunState | null> => await readKey<RunState>(ctx, stateKey(a.runId)) });
export const readLog = internalQuery({ args: { runId: v.string(), i: v.number() }, handler: async (ctx, a): Promise<CreatorLog | null> => await readKey<CreatorLog>(ctx, logKey(a.runId, a.i)) });

/** Keys under `fw:` only, and the run must exist (or be the one being created). */
export const writeRun = internalMutation({
  args: { runId: v.string(), state: v.optional(v.any()), i: v.optional(v.number()), log: v.optional(v.any()) },
  handler: async (ctx, a): Promise<null> => {
    if (!/^fw-[a-z0-9]+$/.test(a.runId)) throw new Error("not a first-week run id");
    if (a.state) await writeKey(ctx, stateKey(a.runId), a.state);
    if (a.i !== undefined && a.log) await writeKey(ctx, logKey(a.runId, a.i), a.log);
    return null;
  },
});

/** Merge a patch into one creator's log (arrays in `append` are appended, bounded). */
export const patchLog = internalMutation({
  args: { runId: v.string(), i: v.number(), set: v.optional(v.any()), append: v.optional(v.any()) },
  handler: async (ctx, a): Promise<CreatorLog | null> => {
    const log = await readKey<CreatorLog>(ctx, logKey(a.runId, a.i));
    if (!log) return null;
    const next = { ...log, ...((a.set ?? {}) as Partial<CreatorLog>) } as CreatorLog & Record<string, unknown>;
    for (const [k, xs] of Object.entries((a.append ?? {}) as Record<string, unknown[]>)) {
      const prev = (next[k] as unknown[] | undefined) ?? [];
      next[k] = [...prev, ...xs].slice(-400);
    }
    await writeKey(ctx, logKey(a.runId, a.i), next);
    return next;
  },
});

async function fwCreator(ctx: MutationCtx, creatorId: Id<"creators">): Promise<Doc<"creators">> {
  const c = (await ctx.db.get(creatorId)) as Doc<"creators"> | null;
  if (!c || !isFirstWeekSubject(c.clerkUserId)) throw new Error("only a first-week simulation creator");
  return c;
}

// ------------------------------------------------------------------ mutations (all refuse anything but a sim creator)

/** Screen 1 through checkout: the real start path, then a trial on the tier their handles need. */
export const createOne = internalMutation({
  args: { runId: v.string(), i: v.number(), handles: v.object({ tiktok: v.optional(v.string()), instagram: v.optional(v.string()) }), timezone: v.string(), watchCap: v.number(), transcriptCap: v.number(), replay: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ ok: boolean; creatorId?: Id<"creators">; error?: string }> => {
    const subject = subjectFor(a.runId, a.i);
    if (!isFirstWeekSubject(subject)) throw new Error("not a first-week subject");
    const r = await startCreator(ctx, { subject, email: `${subject.replace(/[^a-z0-9-]/gi, "-")}@eval.invalid`, handles: a.handles, timezone: a.timezone, ingestCaps: { watchCap: a.watchCap, transcriptCap: a.transcriptCap } });
    if (!r.ok || !r.creatorId) return { ok: false, error: r.error ?? "signup refused" };
    const creatorId = r.creatorId as Id<"creators">;
    const c = await fwCreator(ctx, creatorId);
    // Replay is armed in the same transaction that queued the catalogue read, so no read of theirs can
    // reach the vendor first. A refusal undoes the signup (the mutation throws): never a paid run by accident.
    if (a.replay) {
      const armed = await armReplay(ctx, [creatorId], a.runId);
      if (!armed.ok) throw new Error(`replay refused: ${armed.reason}`);
    }
    // Checkout: a trial (no Stripe row, nothing charged), one account on solo, both on duo.
    const both = Boolean(c.handles.tiktok && c.handles.instagram);
    await ctx.db.patch(creatorId, { plan: { ...c.plan, status: "trialing", tier: both ? "duo" : "solo" }, updatedAt: Date.now() });
    return { ok: true, creatorId };
  },
});

/** The admired screen: the picks they tap, added the way the app's `admired.add` adds them. */
export const addAdmired = internalMutation({
  args: { creatorId: v.id("creators"), picks: v.array(v.object({ platform: v.union(v.literal("tiktok"), v.literal("instagram")), handle: v.string(), why: v.optional(v.string()) })) },
  handler: async (ctx, a): Promise<{ added: string[]; refused: string[] }> => {
    await fwCreator(ctx, a.creatorId);
    const added: string[] = [], refused: string[] = [];
    for (const p of a.picks) {
      const existing = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"trackedAccounts">[];
      const r = await addTracked(ctx as never, a.creatorId, p.platform, p.handle, existing, { addedBy: "suggested", why: p.why });
      (r.ok ? added : refused).push(`${p.platform}:@${p.handle}${r.ok ? "" : ` (${r.error ?? "refused"})`}`);
    }
    return { added, refused };
  },
});

/**
 * The phone door, up to the text: their number on the row as `setPhone` writes it (without
 * registering it on the vendor's line: it is fictional) and the one-shot token the pairing screen
 * mints. The action then claims it through the real `claimPairingByPhone`.
 */
export const preparePairing = internalMutation({
  args: { creatorId: v.id("creators"), phone: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; token?: string; error?: string }> => {
    const c = await fwCreator(ctx, a.creatorId);
    const phone = normalizePhone(a.phone);
    if (!phone) return { ok: false, error: "the simulated number did not normalize" };
    const holders = (await ctx.db.query("creators").withIndex("by_phone", (q) => q.eq("phone", phone)).collect()) as Doc<"creators">[];
    if (holders.some((h) => h._id !== c._id && !isFirstWeekSubject(h.clerkUserId))) return { ok: false, error: "the simulated number belongs to a creator outside the simulation" };
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const now = Date.now();
    await ctx.db.patch(a.creatorId, { phone, messageConsentAt: now, channel: { paired: false, kind: "imessage" }, pairingToken: token, pairingExpiresAt: now + PAIRING_TTL_MS, updatedAt: now });
    return { ok: true, token };
  },
});

export const ageTable = internalMutation({
  args: { creatorId: v.id("creators"), table: v.string(), delta: v.number() },
  handler: async (ctx, a): Promise<number> => await ageCreatorTable(ctx, await fwCreator(ctx, a.creatorId), a.table, a.delta),
});

export const actOnIdea = internalMutation({
  args: { creatorId: v.id("creators"), ideaId: v.id("ideas"), act: v.union(v.literal("save"), v.literal("pass")) },
  handler: async (ctx, a): Promise<boolean> => {
    await fwCreator(ctx, a.creatorId);
    return (await applyIdeaAct(ctx, a.creatorId, a.ideaId, a.act, { origin: "app" })).ok;
  },
});

// ------------------------------------------------------------------ reads

/** What has happened so far for one creator, from rows (all indexed). */
export type Observed = { createdAt: number; paired: boolean; dossier: boolean; dossierVersion: number; ingest: Array<{ status: string; attempts: number; error: string | null }>; busy: string[]; hello: boolean; firstReadCreatedAt: number | null; firstIdea: boolean; posts: { tiktok: number; instagram: number } };
export const observe = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Observed | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const dedupe = async (key: string) => (await ctx.db.query("messages").withIndex("by_creator_and_dedupe", (q) => q.eq("creatorId", a.creatorId).eq("dedupeKey", key)).first()) as Doc<"messages"> | null;
    const jobs = (await ctx.db.query("jobs").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(300)) as Doc<"jobs">[];
    const ingest = jobs.filter((j) => j.kind === "ingest_catalogue").sort((x, y) => x.createdAt - y.createdAt);
    const firstRead = await dedupe(`first_read:${a.creatorId}`);
    const firstIdea = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("asc").first()) as Doc<"ideas"> | null;
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(1000)) as Doc<"ownPosts">[];
    return {
      createdAt: c.createdAt,
      paired: c.channel.paired,
      dossier: Boolean(c.dossier),
      dossierVersion: c.dossierVersion ?? 0,
      ingest: ingest.map((j) => ({ status: j.status, attempts: j.attempts, error: j.lastError ?? null })),
      busy: jobs.filter((j) => j.status === "running" || (j.status === "queued" && j.kind !== "deliver_message")).map((j) => `${j.kind}:${j.status}`),
      hello: Boolean(await dedupe(`hello:${a.creatorId}`)),
      firstReadCreatedAt: firstRead?._creationTime ?? null,
      firstIdea: Boolean(firstIdea),
      posts: { tiktok: posts.filter((p) => p.platform === "tiktok").length, instagram: posts.filter((p) => p.platform === "instagram").length },
    };
  },
});

/** Her proactive messages and new ideas since a real moment (`_creationTime` survives ageing). */
export const unseenFromMaya = internalQuery({
  args: { creatorId: v.id("creators"), since: v.number() },
  handler: async (ctx, a): Promise<{ messages: Array<{ id: string; kind: string; text: string; buttons: string[] }>; ideas: Array<{ id: Id<"ideas">; hook: string }>; newest: number }> => {
    const msgs = (await ctx.db.query("messages").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(60)) as Doc<"messages">[];
    const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(20)) as Doc<"ideas">[];
    const fresh = msgs.filter((m) => m._creationTime > a.since && m.direction === "out" && m.proactive).reverse();
    return {
      messages: fresh.map((m) => ({ id: m._id, kind: m.kind ?? "", text: clip(m.body, 700), buttons: (m.buttons ?? []).map((b) => b.label) })),
      ideas: ideas.filter((x) => x._creationTime > a.since).map((x) => ({ id: x._id, hook: clip((x.version as { hook?: string } | undefined)?.hook ?? x.messageText, 160) })),
      newest: Math.max(a.since, ...msgs.map((m) => m._creationTime)),
    };
  },
});

/** A creator's own recent captions (either platform), for the actor's voice. */
export const captionsOf = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<string> => {
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(15)) as Doc<"ownPosts">[];
    return posts.map((p) => `- [${p.platform}] ${clip(p.caption.split("\n")[0], 160)}`).join("\n");
  },
});

/** ScrapeCreators credits the run has spent: its creators' ledger rows (indexed), plus unattributed rows since it began. */
export const runCredits = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<{ attributed: number; unattributedInWindow: number; total: number }> => {
    const s = await readKey<RunState>(ctx, stateKey(a.runId));
    if (!s) return { attributed: 0, unattributedInWindow: 0, total: 0 };
    let attributed = 0;
    for (const c of s.creators) {
      if (!c.creatorId) continue;
      const rows = (await ctx.db.query("costEvents").withIndex("by_creator_at", (q) => q.eq("creatorId", c.creatorId)).take(5000)) as Doc<"costEvents">[];
      attributed += rows.filter((r) => r.vendor === "scrapecreators").reduce((n, r) => n + r.units, 0);
    }
    // Reads made without a creator (the lane sweep) land here; so does anything else on the deployment. Conservative.
    const window = (await ctx.db.query("costEvents").withIndex("by_at", (q) => q.gte("at", s.startedAt)).take(4000)) as Doc<"costEvents">[];
    const unattributedInWindow = window.filter((r) => !r.creatorId && r.vendor === "scrapecreators").reduce((n, r) => n + r.units, 0);
    return { attributed, unattributedInWindow, total: attributed + unattributedInWindow };
  },
});

// ------------------------------------------------------------------ the run

const optsV = {
  days: v.optional(v.number()), watchCap: v.optional(v.number()), transcriptCap: v.optional(v.number()), admired: v.optional(v.number()),
  pairAfterMs: v.optional(v.number()), day0MaxMs: v.optional(v.number()), maxCredits: v.optional(v.number()), signupWeekday: v.optional(v.number()), seed: v.optional(v.number()),
  replay: v.optional(v.boolean()), script: v.optional(v.union(v.literal("none"), v.literal("product"))),
};

/** Pure: the run's options, defaults filled and bounds enforced. */
export function resolveOpts(a: Partial<Opts>): Opts {
  const o = { ...FW_DEFAULTS, ...Object.fromEntries(Object.entries(a).filter(([, x]) => x !== undefined)) } as Opts;
  if (!Number.isInteger(o.days) || o.days < 1 || o.days > 14) throw new Error("days must be 1–14");
  if (o.signupWeekday < 0 || o.signupWeekday > 6) throw new Error("signupWeekday is 0 (Sunday) … 6");
  if (o.maxCredits < 50 && !o.replay) throw new Error("maxCredits under 50 cannot onboard anyone");
  // Replay spends nothing: one credit is already a failure, and it stops the run.
  if (o.replay) o.maxCredits = 1;
  return { ...o, watchCap: Math.max(0, Math.min(40, o.watchCap)), transcriptCap: Math.max(0, Math.min(40, o.transcriptCap)), admired: Math.max(0, Math.min(6, o.admired)) };
}

/**
 * Pure: ScrapeCreators credits a run is expected to spend, per creator and in total, from the knobs.
 * Per creator: the account-type check (1 a platform), the catalogue pages (2 a platform), transcripts
 * (1 each), watched posts (10 each, `post.info`), the admired suggestions (~10 a platform: searches and
 * shortlist reads) and the first roster sample (1 an account); then the week: the lane sweep once
 * (~16: 8 keywords × 2 platforms, cached a day) and ~6 a day (roster samples, scout lookups, replies).
 * An upper-middle estimate, not a bound; `maxCredits` is the bound. `needed` is what the run can spend.
 */
export function estimateCredits(subjects: Subject[], o: Opts): { perCreator: number[]; total: number; needed: number } {
  if (o.replay) return { perCreator: subjects.map(() => 0), total: 0, needed: 0 };
  const perCreator = subjects.map((sub) => {
    const platforms = (sub.tiktok ? 1 : 0) + (sub.instagram ? 1 : 0);
    const onboarding = platforms * 1 + platforms * 2 + o.transcriptCap + 10 * o.watchCap + (o.admired > 0 ? 10 * platforms : 0) + o.admired;
    const week = 16 + 6 * o.days;
    return onboarding + week;
  });
  const total = perCreator.reduce((x, y) => x + y, 0);
  return { perCreator, total, needed: Math.min(total, o.maxCredits) };
}

const subjectsV = v.optional(v.array(v.object({ tiktok: v.optional(v.string()), instagram: v.optional(v.string()), timezone: v.optional(v.string()), note: v.optional(v.string()) })));

/** The estimate for a run you are about to start (the same numbers `start` checks the balance against). */
export const estimate = internalQuery({
  args: { handles: subjectsV, ...optsV },
  handler: async (_ctx, a): Promise<{ perCreator: number[]; total: number; needed: number; maxCredits: number }> => {
    const { handles, ...rest } = a;
    const o = resolveOpts(rest);
    return { ...estimateCredits(handles?.length ? handles : DEFAULT_SUBJECTS, o), maxCredits: o.maxCredits };
  },
});

/** Pure: refuse to start when the vendor balance can't cover what the run may spend. Unknown is a refusal. */
export function balanceRefusal(balance: number | null, needed: number): string | null {
  if (balance === null) return "could not read the ScrapeCreators credit balance (vendor.credits); not starting blind";
  if (balance < needed) return `ScrapeCreators balance is ${balance} credits; this run may spend ${needed} (lower maxCredits, use fewer creators, or top up)`;
  return null;
}

/** Which subjects are free to sign up here: a handle another creator holds is refused by the real signup rule. */
export const preflight = internalQuery({
  args: { handles: subjectsV },
  handler: async (ctx, a): Promise<Array<{ i: number; handles: string; free: boolean; heldBy?: string }>> => {
    const out: Array<{ i: number; handles: string; free: boolean; heldBy?: string }> = [];
    for (const [i, s] of (a.handles ?? DEFAULT_SUBJECTS).entries()) {
      let heldBy: string | undefined;
      for (const platform of ["tiktok", "instagram"] as const) {
        const h = s[platform]?.trim().replace(/^@/, "").toLowerCase();
        if (!h) continue;
        const c = (await ctx.db.query("creators").withIndex(platform === "tiktok" ? "by_tiktok" : "by_instagram", (q) => q.eq(platform === "tiktok" ? "handles.tiktok" : "handles.instagram", h)).first()) as Doc<"creators"> | null;
        if (c) heldBy = isFirstWeekSubject(c.clerkUserId) ? `an earlier first-week run (${c.clerkUserId.split(":")[1]}); clear it` : /^eval/.test(c.clerkUserId) ? `eval creator ${c.clerkUserId}` : "a real account";
      }
      out.push({ i, handles: [s.tiktok && `tiktok:@${s.tiktok}`, s.instagram && `instagram:@${s.instagram}`].filter(Boolean).join(" "), free: !heldBy, ...(heldBy ? { heldBy } : {}) });
    }
    return out;
  },
});

export const start = internalAction({
  args: { handles: subjectsV, ...optsV },
  handler: async (ctx, a): Promise<{ runId: string; creators: Array<{ i: number; handles: string; timezone: string; creatorId?: string; error?: string }>; opts: Opts; credits: { balance: number | null; estimate: number; needed: number } }> => {
    const { handles, ...rest } = a;
    const opts = resolveOpts(rest);
    let subjects = handles?.length ? handles : DEFAULT_SUBJECTS;
    if (opts.replay) {
      // Only accounts whose onboarding reads are all in the cache; a named refusal otherwise.
      const cached = await ctx.runQuery(internal.eval.replay.candidates, { limit: 200 });
      const has = (platform: string, h?: string) => !h || cached.some((c) => c.platform === platform && c.handle === h.trim().replace(/^@/, "").toLowerCase());
      if (handles?.length) {
        const missing = handles.filter((h) => !has("tiktok", h.tiktok) || !has("instagram", h.instagram));
        if (missing.length) throw new Error(`replay run refused: not in the read cache: ${missing.map((m) => [m.tiktok && `tiktok:@${m.tiktok}`, m.instagram && `instagram:@${m.instagram}`].filter(Boolean).join(" ")).join(", ")}. Cached: ${cached.slice(0, 20).map((c) => `${c.platform}:@${c.handle}`).join(", ")}`);
      } else {
        const checked = await ctx.runQuery(internal.eval.firstWeek.preflight, { handles: cached.map((c) => ({ [c.platform]: c.handle })) });
        const free = checked.filter((x) => x.free);
        subjects = free.slice(0, 4).map((x) => { const c = cached[x.i]; return { [c.platform]: c.handle, note: `from the cache (${c.followers ?? "?"} followers)` } as Subject; });
        // Name who holds each one, so the operator knows exactly which earlier run to clear.
        if (subjects.length < 2) throw new Error(`replay run refused: the read cache can onboard ${subjects.length} free account(s); two are needed (one follows through, one flakes). Held: ${checked.filter((x) => !x.free).map((x) => `${x.handles} by ${x.heldBy}`).join("; ") || "none"}. Free: ${free.map((x) => x.handles).join(", ") || "none"}`);
      }
    }
    if (subjects.length > 12) throw new Error("at most 12 creators a run");
    // Credits are scarce: read the balance fresh and refuse, by name, before creating anyone.
    const est = estimateCredits(subjects, opts);
    let balance: number | null = opts.replay ? 0 : null;
    if (!opts.replay) try {
      const r = await ctx.runAction(internal.reads.read.read, { kind: "vendor.credits", params: {}, force: true });
      const c = (r.value as { credits?: unknown } | null)?.credits;
      balance = typeof c === "number" && Number.isFinite(c) ? c : null;
    } catch {
      balance = null;
    }
    const refusal = opts.replay ? null : balanceRefusal(balance, est.needed);
    if (refusal) throw new Error(`first-week run refused: ${refusal}. Estimate: ${est.total} credits for ${subjects.length} creators (${est.perCreator.join(", ")}); ceiling ${opts.maxCredits}.`);
    const now = Date.now();
    const runId = `fw-${now.toString(36)}`;
    const zones = timezonesFor(subjects.length, now);
    const creators: CreatorSlot[] = [];
    for (const [i, s] of subjects.entries()) {
      const timezone = s.timezone ?? zones[i];
      const slot: CreatorSlot = { i, subject: subjectFor(runId, i), handles: { tiktok: s.tiktok, instagram: s.instagram }, timezone, note: s.note };
      const r = await ctx.runMutation(internal.eval.firstWeek.createOne, { runId, i, handles: slot.handles, timezone, watchCap: opts.watchCap, transcriptCap: opts.transcriptCap, replay: opts.replay });
      if (r.ok && r.creatorId) slot.creatorId = r.creatorId;
      else slot.error = `signup refused: ${r.error}`;
      creators.push(slot);
    }
    const state: RunState = { runId, startedAt: now, opts, creators };
    await ctx.runMutation(internal.eval.firstWeek.writeRun, { runId, state });
    for (const c of creators) {
      const log: CreatorLog = { i: c.i, createdRealAt: Date.now(), cursor: { phase: c.creatorId ? "signup" : "done", d: 0, k: 0, attempt: 0, since: Date.now() }, events: [], actorSeenAt: 0, turns: 0, steps: [], actor: [], failures: c.error ? [{ d: 0, step: "signup", error: c.error }] : [], snapshots: [] };
      await ctx.runMutation(internal.eval.firstWeek.writeRun, { runId, i: c.i, log });
      if (c.creatorId) await ctx.scheduler.runAfter(2_000 + c.i * 3_000, internal.eval.firstWeek.signupTick, { runId, i: c.i });
    }
    // The catalogue reads are queued; the minute drain would reach them, this just saves the minute.
    await ctx.scheduler.runAfter(0, internal.core.scheduler.drainJobs, { kinds: ["ingest_catalogue"] });
    return { runId, creators: creators.map((c) => ({ i: c.i, handles: [c.handles.tiktok && `tiktok:@${c.handles.tiktok}`, c.handles.instagram && `instagram:@${c.handles.instagram}`].filter(Boolean).join(" "), timezone: c.timezone, ...(c.creatorId ? { creatorId: c.creatorId } : {}), ...(c.error ? { error: c.error } : {}) })), opts, credits: { balance, estimate: est.total, needed: est.needed } };
  },
});

/** Stop over the credit ceiling: every chain sees it before its next step and goes to the judge. */
async function overCeiling(ctx: ActionCtx, s: RunState): Promise<string | null> {
  if (s.stopped) return s.stopped;
  const credits = await ctx.runQuery(internal.eval.firstWeek.runCredits, { runId: s.runId });
  // Under replay only this run's own creators count: fleet reads elsewhere on the deployment are not this run's spend.
  const spent = s.opts.replay ? credits.attributed : credits.total;
  if (spent < s.opts.maxCredits) return null;
  const why = s.opts.replay ? `replay run spent ${spent} ScrapeCreators credit(s); a zero-credit run stops at the first` : `credit ceiling: ${credits.total} ScrapeCreators credits ≥ ${s.opts.maxCredits}`;
  const latest = await ctx.runQuery(internal.eval.firstWeek.readState, { runId: s.runId });
  if (latest && !latest.stopped) await ctx.runMutation(internal.eval.firstWeek.writeRun, { runId: s.runId, state: { ...latest, stopped: why } });
  return why;
}

function slotOf(s: RunState, i: number): CreatorSlot & { creatorId: Id<"creators"> } {
  const c = s.creators[i];
  if (!c?.creatorId) throw new Error(`creator ${i} was never created`);
  return c as CreatorSlot & { creatorId: Id<"creators"> };
}

async function event(ctx: ActionCtx, runId: string, i: number, log: CreatorLog, createdAt: number, name: string, detail?: string): Promise<void> {
  if (log.events.some((e) => e.name === name)) return;
  const ev = { name, simMs: Date.now() - createdAt, ...(detail ? { detail: clip(detail, 300) } : {}) };
  log.events.push(ev);
  await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId, i, append: { events: [ev] } });
}

/** Day 0, on the real clock, once a minute: admired picks, pairing, what has landed, their replies. */
export const signupTick = internalAction({
  args: { runId: v.string(), i: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const s = await ctx.runQuery(internal.eval.firstWeek.readState, { runId: a.runId });
    let log = await ctx.runQuery(internal.eval.firstWeek.readLog, { runId: a.runId, i: a.i });
    if (!s || !log || log.cursor.phase !== "signup") return null;
    const slot = slotOf(s, a.i);
    const stop = await overCeiling(ctx, s);
    if (stop) return await toJudge(ctx, a.runId, a.i, 0, "signup", stop);
    const elapsed = Date.now() - log.createdRealAt;
    try {
      const o = await ctx.runQuery(internal.eval.firstWeek.observe, { creatorId: slot.creatorId });
      if (!o) return await toJudge(ctx, a.runId, a.i, 0, "signup", "creator row vanished");
      // The admired screen, once their posts have started to land (as the app's screen 3 waits).
      if (!log.admiredDone && (o.posts.tiktok + o.posts.instagram > 0 || elapsed > 2 * MIN)) {
        let detail = "";
        if (s.opts.admired > 0) {
          try {
            const r = await ctx.runAction(internal.onboarding.suggest.suggestFor, { creatorId: slot.creatorId, waitMs: 60_000 });
            const picks = r.suggestions.slice(0, s.opts.admired).map((x) => ({ platform: x.platform, handle: x.handle, why: clip(x.why, 200) }));
            const added = picks.length ? await ctx.runMutation(internal.eval.firstWeek.addAdmired, { creatorId: slot.creatorId, picks }) : { added: [], refused: [] };
            detail = `${r.suggestions.length} suggested; added ${added.added.join(", ") || "none"}${added.refused.length ? `; refused ${added.refused.join(", ")}` : ""}`;
            if (!r.suggestions.length) await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, append: { failures: [{ d: 0, step: "admired", error: `no suggestions (${JSON.stringify(r.trace).slice(0, 160)})` }] } });
          } catch (e) {
            detail = `suggestions failed: ${e instanceof Error ? clip(e.message, 160) : "error"}`;
            await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, append: { failures: [{ d: 0, step: "admired", error: detail }] } });
          }
        }
        log = (await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, set: { admiredDone: true } }))!;
        await event(ctx, a.runId, a.i, log, o.createdAt, "admired", detail || "skipped (admired: 0)");
      }
      // Texting START from the pairing screen.
      if (!log.pairedDone && elapsed >= s.opts.pairAfterMs) {
        const phone = phoneFor(a.runId, a.i);
        const prep = await ctx.runMutation(internal.eval.firstWeek.preparePairing, { creatorId: slot.creatorId, phone });
        let detail = prep.error ?? "";
        if (prep.ok && prep.token) {
          const claimed = await ctx.runMutation(internal.core.pairing.claimPairingByPhone, { token: prep.token, phone: normalizePhone(phone)!, service: "iMessage" });
          if (claimed.paired) {
            await ctx.runMutation(internal.core.imessage.receiveInbound, { creatorId: slot.creatorId, body: `START ${prep.token}`, kind: "pairing", channelMessageId: `fw:${a.runId}:${a.i}:start` });
            detail = "paired by START text";
          } else detail = `pairing refused: ${claimed.reason ?? "no reason"}`;
        }
        log = (await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, set: { pairedDone: true } }))!;
        if (!/^paired/.test(detail)) await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, append: { failures: [{ d: 0, step: "pairing", error: detail }] } });
        await event(ctx, a.runId, a.i, log, o.createdAt, "pairing", detail);
      }
      // What has landed, the first time it is seen (rows are the record; these are the minute it was seen).
      const now = await ctx.runQuery(internal.eval.firstWeek.observe, { creatorId: slot.creatorId });
      if (now) {
        const ingestDone = now.ingest.find((j) => j.status === "succeeded" || j.status === "dead" || j.status === "failed");
        if (ingestDone) await event(ctx, a.runId, a.i, log, now.createdAt, "catalogue_read", `${ingestDone.status}${ingestDone.error ? `: ${ingestDone.error}` : ""}; tiktok ${now.posts.tiktok} posts, instagram ${now.posts.instagram} posts`);
        if (now.dossier) await event(ctx, a.runId, a.i, log, now.createdAt, "dossier", `version ${now.dossierVersion}`);
        if (now.hello) await event(ctx, a.runId, a.i, log, now.createdAt, "hello");
        if (now.firstReadCreatedAt) await event(ctx, a.runId, a.i, log, now.createdAt, "first_read");
        if (now.firstIdea) await event(ctx, a.runId, a.i, log, now.createdAt, "first_idea_row");
      }
      // Their replies to whatever she has said (most people answer the first messages).
      if (log.pairedDone) await actorTurn(ctx, s, a.i, log, 0, "day0", 0.9);
      // Day 0 ends once the read has settled and the plan and first scout it scheduled have fired.
      const fresh = await ctx.runQuery(internal.eval.firstWeek.observe, { creatorId: slot.creatorId });
      const settled = fresh?.firstReadCreatedAt ? Date.now() >= fresh.firstReadCreatedAt + READ_SETTLE_MS + 5 * MIN : false;
      const busy = (fresh?.busy.length ?? 0) > 0;
      const hardStop = elapsed >= s.opts.day0MaxMs + (busy ? 30 * MIN : 0);
      if ((settled && !busy) || hardStop) {
        if (!fresh?.firstReadCreatedAt) await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, append: { failures: [{ d: 0, step: "first_read", error: `no first read ${Math.round(elapsed / MIN)} min after signup (ingest: ${JSON.stringify(fresh?.ingest ?? [])})` }] } });
        if (busy) await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, append: { failures: [{ d: 0, step: "settle", error: `still busy when day 0 ended: ${fresh?.busy.join(", ")}` }] } });
        await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, set: { cursor: { phase: "day", d: 1, k: 0, attempt: 0, since: Date.now() } satisfies Cursor } });
        await ctx.scheduler.runAfter(STEP_GAP_MS, internal.eval.firstWeek.runStep, { runId: a.runId, i: a.i, d: 1, k: 0, attempt: 0 });
        return null;
      }
    } catch (e) {
      await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, append: { failures: [{ d: 0, step: "signup_tick", error: e instanceof Error ? clip(e.message, 200) : "error" }] } });
    }
    await ctx.scheduler.runAfter(TICK_MS, internal.eval.firstWeek.signupTick, a);
    return null;
  },
});

async function toJudge(ctx: ActionCtx, runId: string, i: number, d: number, step: string, why: string): Promise<null> {
  await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId, i, set: { cursor: { phase: "judge", d, k: 0, attempt: 0, since: Date.now() } satisfies Cursor }, append: { failures: [{ d, step, error: `stopped: ${why}` }] } });
  await ctx.scheduler.runAfter(STEP_GAP_MS, internal.eval.firstWeek.judge, { runId, i });
  return null;
}

/** The creator texts back: through the phone path's recorder and menu matching, then her real turn. */
async function textAsCreator(ctx: ActionCtx, runId: string, i: number, n: number, creatorId: Id<"creators">, text: string): Promise<string> {
  const menu = await ctx.runQuery(internal.core.imessage.liveMenu, { creatorId, now: Date.now() });
  const pick = menuPick(text, menu ?? undefined);
  const since = Date.now();
  const r = await ctx.runMutation(internal.core.imessage.receiveInbound, { creatorId, body: pick ?? text, kind: pick ? "button" : "inbound", channelMessageId: `fw:${runId}:${i}:${n}` });
  if (!r.recorded || !r.messageId) return `(not recorded: ${r.reason ?? "?"})`;
  try {
    await ctx.runAction(internal.agent.converse.run, { creatorId, messageId: r.messageId });
  } catch (e) {
    return `(no reply: ${e instanceof Error ? clip(e.message, 80) : "the turn failed"})`;
  }
  const replies = await ctx.runQuery(internal.eval.converse.repliesTo, { creatorId, inboundId: r.messageId, since });
  return clip(replies.map((x) => x.text).join("\n---\n"), 600) || "(no reply row)";
}

/** One actor turn, with probability `p`, if she has said anything new. Deterministic per run, creator, day and slot. */
async function actorTurn(ctx: ActionCtx, s: RunState, i: number, log: CreatorLog, d: number, slot: string, p: number): Promise<string> {
  const slotRow = slotOf(s, i);
  const seen = await ctx.runQuery(internal.eval.firstWeek.unseenFromMaya, { creatorId: slotRow.creatorId, since: log.actorSeenAt });
  if (!seen.messages.length && !seen.ideas.length) return "nothing new";
  await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: s.runId, i, set: { actorSeenAt: seen.newest } });
  log.actorSeenAt = seen.newest;
  let slotHash = 0;
  for (const ch of slot) slotHash = (slotHash * 31 + ch.charCodeAt(0)) % 1_000;
  // Deterministic per run seed, creator, day, slot and how many turns came before (day 0 ticks every minute).
  const roll = rng(s.opts.seed * 100_003 + i * 1_009 + d * 31 + slotHash * 7 + log.actor.length * 13)();
  if (roll >= p) {
    await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: s.runId, i, append: { actor: [{ d, said: [], acts: [`ignored (${slot})`], heard: [] }] } });
    return "ignored";
  }
  const platforms = [slotRow.handles.tiktok && "TikTok", slotRow.handles.instagram && "Instagram"].filter(Boolean).join(" and ") || "TikTok";
  const voice = await ctx.runQuery(internal.eval.firstWeek.captionsOf, { creatorId: slotRow.creatorId });
  const system = `${actorPromptFor(platforms)}\nA message may carry buttons; to tap one, reply with its label exactly.\n\nYour own captions:\n${voice}`;
  const r = await callModel(ctx, { creatorId: slotRow.creatorId, purpose: "fw_actor", model: REGISTRY.writer.primary, messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({ day: d, mayaSaid: seen.messages, ideasSent: seen.ideas }) }], temperature: 0.8, maxTokens: 700, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
  const out = r.ok ? parseJson<{ replies?: Array<{ text?: string }>; ideas?: Array<{ ideaId?: string; act?: string }> }>(r.content) : null;
  const said: string[] = [], heard: string[] = [], acts: string[] = [];
  for (const rep of (out?.replies ?? []).slice(0, 2)) {
    const text = rep.text ? clip(rep.text.trim(), 400) : undefined;
    if (!text) continue;
    log.turns += 1;
    await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: s.runId, i, set: { turns: log.turns } });
    said.push(text);
    heard.push(await textAsCreator(ctx, s.runId, i, log.turns, slotRow.creatorId, text));
  }
  for (const t of (out?.ideas ?? []).slice(0, 3)) {
    const idea = seen.ideas.find((x) => x.id === t.ideaId);
    if (idea && (t.act === "save" || t.act === "pass")) {
      const ok = await ctx.runMutation(internal.eval.firstWeek.actOnIdea, { creatorId: slotRow.creatorId, ideaId: idea.id, act: t.act });
      acts.push(`${t.act} ${clip(idea.hook, 60)}${ok ? "" : " (refused)"}`);
    }
  }
  if (!r.ok) acts.push(`actor model failed: ${r.reason}`);
  await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: s.runId, i, append: { actor: [{ d, said, acts, heard }] } });
  return `${said.length} replies, ${acts.length} acts`;
}

/** One step of one simulated day. Each step is its own action, with a watchdog, so a dead action is a named failure, not a silent end. */
export const runStep = internalAction({
  args: { runId: v.string(), i: v.number(), d: v.number(), k: v.number(), attempt: v.number(), watchdog: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<null> => {
    const s = await ctx.runQuery(internal.eval.firstWeek.readState, { runId: a.runId });
    const log = await ctx.runQuery(internal.eval.firstWeek.readLog, { runId: a.runId, i: a.i });
    if (!s || !log) return null;
    const cur = log.cursor;
    if (cur.phase !== "day" || cur.d !== a.d || cur.k !== a.k || cur.attempt !== a.attempt) return null; // stale: the chain moved on
    const plan = dayPlan(a.d, s.opts);
    const step = plan[a.k];
    const advance = async (failure?: string, result?: string, ms = 0) => {
      const append: Record<string, unknown[]> = { steps: [{ d: a.d, step: step ?? "?", result: clip(result ?? failure ?? "", 200), ms }] };
      if (failure) append.failures = [{ d: a.d, step: step ?? "?", error: clip(failure, 200) }];
      const nextK = a.k + 1;
      const dayDone = nextK >= plan.length;
      if (dayDone && a.d >= s.opts.days) {
        await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, set: { cursor: { phase: "judge", d: a.d, k: 0, attempt: 0, since: Date.now() } satisfies Cursor }, append });
        await ctx.scheduler.runAfter(STEP_GAP_MS, internal.eval.firstWeek.judge, { runId: a.runId, i: a.i });
        return;
      }
      const next = dayDone ? { d: a.d + 1, k: 0 } : { d: a.d, k: nextK };
      await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, set: { cursor: { phase: "day", ...next, attempt: 0, since: Date.now() } satisfies Cursor }, append });
      await ctx.scheduler.runAfter(STEP_GAP_MS, internal.eval.firstWeek.runStep, { runId: a.runId, i: a.i, ...next, attempt: 0 });
    };
    if (a.watchdog) {
      // Still on this step after STEP_TIMEOUT_MS: the action died. Name it and move on.
      await advance(`step did not finish in ${STEP_TIMEOUT_MS / MIN} min (action died or timed out)`);
      return null;
    }
    if (!step) { await advance("no such step"); return null; }
    const stop = await overCeiling(ctx, s);
    if (stop) return await toJudge(ctx, a.runId, a.i, a.d, step, stop);
    const slot = slotOf(s, a.i);
    const id = slot.creatorId;

    // Ageing waits for their jobs to settle: a running job keeps its lease, but a half-written read would straddle two days.
    if (step === "age") {
      const o = await ctx.runQuery(internal.eval.firstWeek.observe, { creatorId: id });
      if (o && o.busy.length) {
        const waited = log.waitedSince || Date.now();
        if (Date.now() - waited < SETTLE_WAIT_MS) {
          if (!log.waitedSince) await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, set: { waitedSince: waited } });
          await ctx.scheduler.runAfter(30_000, internal.eval.firstWeek.runStep, { runId: a.runId, i: a.i, d: a.d, k: a.k, attempt: a.attempt });
          return null;
        }
        await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, append: { failures: [{ d: a.d, step: "age", error: `ageing with jobs still busy after ${SETTLE_WAIT_MS / MIN} min: ${o.busy.join(", ")}` }] } });
      }
      if (log.waitedSince) await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, set: { waitedSince: 0 } });
    }

    await ctx.scheduler.runAfter(STEP_TIMEOUT_MS, internal.eval.firstWeek.runStep, { ...a, watchdog: true });
    const t0 = Date.now();
    let result = "", failure: string | undefined;
    try {
      const said = (r: { sent?: boolean; reason?: string } | null | undefined) => (r ? `${r.sent ? "sent" : "held"}: ${String(r.reason ?? "")}` : "ran");
      switch (step) {
        case "age": {
          await ctx.runMutation(internal.eval.firstWeek.ageTable, { creatorId: id, table: "creators", delta: -D });
          let rows = 0;
          // Not `schedule`: the creators trigger rewrites it from the aged creator row, and ageing it again would move it twice.
          for (const table of TABLES_BY_CREATOR) if (CREATOR_INDEX[table] && table !== "schedule") rows += await ctx.runMutation(internal.eval.firstWeek.ageTable, { creatorId: id, table, delta: -D });
          result = `a day passed (${rows} rows moved)`;
          break;
        }
        case "expireQuestions": result = `expired ${(await ctx.runMutation(internal.core.messages.expireStaleQuestions, { creatorId: id })).expired}`; break;
        case "sampler": { const r = await ctx.runAction(internal.scout.sampler.run, { creatorId: id }); result = `${r.accounts} accounts, ${r.signals} breakouts, ${r.failed} failed`; if (r.failed) failure = `sampler: ${r.failed} account reads failed`; break; }
        case "sweep": { const r = await ctx.runAction(internal.scout.sweep.run, { creatorId: id }); result = `${r.keywords} keywords, ${r.signals} shapes, ${r.failed} failed`; if (r.failed) failure = `sweep: ${r.failed} searches failed`; break; }
        case "morning": result = said(await ctx.runAction(internal.agent.cadence.morning, { creatorId: id })); break;
        case "scout": case "scoutAfternoon": result = said(await ctx.runAction(internal.scout.scout.run, { creatorId: id })); break;
        case "invite": result = (await ctx.runMutation(internal.scout.firstWeek.inviteOne, { creatorId: id })).invited ? "invited" : "not sent"; break;
        case "howDidItGo": result = said(await ctx.runAction(internal.agent.cadence.howDidItGo, { creatorId: id })); break;
        case "review": result = said(await ctx.runAction(internal.review.weekly.run, { creatorId: id })); break;
        case "weekPlan": result = said(await ctx.runAction(internal.calendar.weekPlan.draft, { creatorId: id, horizon: "next_week" })); break;
        case "quiet": result = said(await ctx.runAction(internal.agent.cadence.quiet, { creatorId: id })); break;
        case "actor": result = await actorTurn(ctx, s, a.i, log, a.d, "morning", 0.6); break;
        case "actorEvening": result = await actorTurn(ctx, s, a.i, log, a.d, "evening", 0.5); break;
        default: {
          if (!step.startsWith("beat:")) { failure = `unknown step ${step}`; break; }
          const beat = step.slice(5);
          const say = async (text: string) => {
            log.turns += 1;
            await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, set: { turns: log.turns } });
            return await textAsCreator(ctx, a.runId, a.i, log.turns, id, text);
          };
          let checks: Check[];
          try {
            checks = await runBeat({ ctx, creatorId: id, i: a.i, d: a.d, role: roleOf(a.i), say, runStartedAt: s.startedAt, prior: log.checks ?? [] }, beat);
          } catch (e) {
            checks = [{ d: a.d, beat, check: `beat ${beat} ran`, ok: false, detail: e instanceof Error ? clip(e.message, 200) : "error" }];
          }
          await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, append: { checks } });
          const failed = checks.filter((c) => c.ok === false);
          result = `${checks.filter((c) => c.ok).length}/${checks.filter((c) => c.ok !== null).length} kept`;
          if (failed.length) failure = `${beat}: ${failed.map((c) => c.check).join("; ")}`;
          break;
        }
        case "snapshot": {
          const snap = await ctx.runQuery(internal.eval.livingSim.snapshot, { creatorId: id, since: Date.now() - 6 * 3_600_000 });
          await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, append: { snapshots: [{ d: a.d, snap }] } });
          result = "measured";
          break;
        }
      }
    } catch (e) {
      failure = e instanceof Error ? clip(e.message, 200) : clip(String(e), 200);
      result = `failed: ${failure}`;
    }
    await advance(failure, result, Date.now() - t0);
    return null;
  },
});

// ------------------------------------------------------------------ the judge

export const FW_JUDGE = `You judge what an assistant named Maya sent a creator in their first week: her first read of their posts, and her first ideas. You get the creator's real posts on each platform they are on (numbers and captions), what she read of them (her dossier), and each item with its source. Be strict and fair; a true fact from their posts or dossier is not invented.
For each item return:
- grounded 0-2: 2 = rests on specific things in their posts/dossier or on the linked source; 1 = partly; 0 = generic or unsupported.
- specific 0-2: 2 = could only have been written for this creator; 0 = could be sent to anyone in the niche.
- rightPlatform: "yes" if it fits the platform(s) they are actually on (an Instagram-only creator told to use a TikTok-only feature is "no"); "na" if no platform is implied.
- invented: anything stated as fact that the evidence does not support (numbers, posts, events).
- note: ≤140 chars.
Output ONLY JSON: {"items":[{"i":0,"grounded":0,"specific":0,"rightPlatform":"yes|no|na","invented":[],"note":""}]}`;

export interface JudgedItem { i: number; grounded: number; specific: number; rightPlatform: "yes" | "no" | "na"; invented: string[]; note: string }

/** Pure: the judge's answer, one verdict per item; anything malformed is null. */
export function parseJudged(content: string, n: number): Array<JudgedItem | null> {
  const out: Array<JudgedItem | null> = Array.from({ length: n }, () => null);
  const j = parseJson<{ items?: Array<Record<string, unknown>> }>(content);
  for (const x of j?.items ?? []) {
    const i = Number(x.i);
    const g = Number(x.grounded), sp = Number(x.specific);
    if (!Number.isInteger(i) || i < 0 || i >= n || ![0, 1, 2].includes(g) || ![0, 1, 2].includes(sp)) continue;
    const rp = x.rightPlatform === "yes" || x.rightPlatform === "no" || x.rightPlatform === "na" ? x.rightPlatform : "na";
    out[i] = { i, grounded: g, specific: sp, rightPlatform: rp, invented: Array.isArray(x.invented) ? x.invented.map(String).slice(0, 5) : [], note: clip(String(x.note ?? ""), 200) };
  }
  return out;
}

/** The first read and the first three ideas, with their sources. */
export const judgeInputs = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Array<{ what: string; text: string; source: unknown }>> => {
    const items: Array<{ what: string; text: string; source: unknown }> = [];
    const fr = (await ctx.db.query("messages").withIndex("by_creator_and_dedupe", (q) => q.eq("creatorId", a.creatorId).eq("dedupeKey", `first_read:${a.creatorId}`)).first()) as Doc<"messages"> | null;
    if (fr) items.push({ what: "first_read", text: clip(fr.body, 1500), source: "their posts and her dossier" });
    const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("asc").take(3)) as Doc<"ideas">[];
    for (const x of ideas) {
      const sig = x.signalId ? ((await ctx.db.get(x.signalId)) as Doc<"signals"> | null) : null;
      const own = x.rhymesWithOwnPostId ? ((await ctx.db.get(x.rhymesWithOwnPostId)) as Doc<"ownPosts"> | null) : null;
      items.push({ what: `idea${sig ? ` (${sig.kind})` : " (from their own posts)"}`, text: `${clip(x.messageText, 900)}\nhook: ${(x.version as { hook?: string } | undefined)?.hook ?? ""}\nwhy it's for you: ${x.fitWhy}`, source: { links: x.evidenceLinks, signal: sig ? { kind: sig.kind, url: sig.url, detected: sig.detected ?? sig.why } : null, rhymesWith: own ? { platform: own.platform, caption: clip(own.caption, 200), views: own.metrics.views } : null } });
    }
    return items;
  },
});

export const judge = internalAction({
  args: { runId: v.string(), i: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const s = await ctx.runQuery(internal.eval.firstWeek.readState, { runId: a.runId });
    const log = await ctx.runQuery(internal.eval.firstWeek.readLog, { runId: a.runId, i: a.i });
    if (!s || !log || log.cursor.phase !== "judge") return null;
    const slot = slotOf(s, a.i);
    let judged: unknown = null;
    try {
      const items = await ctx.runQuery(internal.eval.firstWeek.judgeInputs, { creatorId: slot.creatorId });
      if (items.length) {
        const truth = await ctx.runQuery(internal.eval.expertBench.postsByPlatform, { creatorId: slot.creatorId });
        const messages = [
          { role: "system" as const, content: FW_JUDGE },
          { role: "user" as const, content: `The creator is on: ${JSON.stringify(slot.handles)}\n\nTheir posts and her dossier (the ground truth):\n${JSON.stringify(truth).slice(0, 40000)}\n\nItems to judge:\n${JSON.stringify(items.map((x, i) => ({ i, ...x })))}` },
        ];
        const spec = REGISTRY.critic;
        let r = await callModel(ctx, { creatorId: slot.creatorId, purpose: "fw_judge", model: spec.primary, messages, temperature: 0, maxTokens: 2000, timeoutMs: CRITIC_TIMEOUT_MS * 2, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
        // A reasoning model can spend the whole budget thinking and return nothing; that is a retry, not a verdict.
        if (!r.ok || !/\{[\s\S]*\}/.test(r.content)) r = await callModel(ctx, { creatorId: slot.creatorId, purpose: "fw_judge_fallback", model: spec.fallback, messages, temperature: 0, maxTokens: 2000, timeoutMs: CRITIC_TIMEOUT_MS * 2, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
        const verdicts = r.ok ? parseJudged(r.content, items.length) : items.map(() => null);
        judged = items.map((x, i) => ({ what: x.what, text: clip(x.text, 400), verdict: verdicts[i] }));
      } else judged = [];
    } catch (e) {
      judged = { error: e instanceof Error ? clip(e.message, 200) : "judge failed" };
    }
    await ctx.runMutation(internal.eval.firstWeek.patchLog, { runId: a.runId, i: a.i, set: { judged, cursor: { phase: "done", d: log.cursor.d, k: 0, attempt: 0, since: Date.now() } satisfies Cursor } });
    return null;
  },
});

// ------------------------------------------------------------------ the report

export type CreatorReport = {
  checks?: Check[];
  i: number; handles: { tiktok?: string; instagram?: string }; timezone: string; note?: string; creatorId: string | null; phase: string; dayReached: number;
  timeline: Array<{ what: string; atHours: number | null; detail?: string }>;
  catalogue: { status: string | null; attempts: number; error: string | null; postsRead: { tiktok: number; instagram: number }; readFrom: unknown; doneAtHours: number | null };
  dossierAtHours: number | null; helloAtHours: number | null; firstReadAtHours: number | null;
  firstIdeaTextedAtHours: number | null; firstPlanAtHours: number | null; firstIdeaAnyAtHours: number | null;
  ideasWeek1: { total: number; texted: number; byInspiration: Record<string, number> };
  weekPlans: Array<{ atHours: number; key: string }>; sundayReviewAtHours: number | null;
  instagram: { hasInstagram: boolean; instagramOnly: boolean; igPostsRead: number; igGroundedIdeas: number; gotIgGroundedIdea: boolean };
  failures: Array<{ d: number; step: string; error: string }>;
  cost: { modelUsd: number; scrapeCredits: number; scrapeUsd: number; otherUsd: number; simOverheadUsd: number; byKind: Record<string, number> };
  judged: unknown; actorTurns: number; stepsRun: number;
};

/** One creator's report, all from their rows (indexed reads; bounded well under the query limits). */
export const creatorReport = internalQuery({
  args: { runId: v.string(), i: v.number() },
  handler: async (ctx, a): Promise<CreatorReport | null> => {
    const s = await readKey<RunState>(ctx, stateKey(a.runId));
    const log = await readKey<CreatorLog>(ctx, logKey(a.runId, a.i));
    const slot = s?.creators[a.i];
    if (!s || !slot) return null;
    const base = { i: a.i, handles: slot.handles, timezone: slot.timezone, note: slot.note };
    const c = slot.creatorId ? ((await ctx.db.get(slot.creatorId)) as Doc<"creators"> | null) : null;
    if (!c || !slot.creatorId) {
      return { ...base, creatorId: null, phase: "never started", dayReached: 0, timeline: [], catalogue: { status: null, attempts: 0, error: slot.error ?? null, postsRead: { tiktok: 0, instagram: 0 }, readFrom: null, doneAtHours: null }, dossierAtHours: null, helloAtHours: null, firstReadAtHours: null, firstIdeaTextedAtHours: null, firstPlanAtHours: null, firstIdeaAnyAtHours: null, ideasWeek1: { total: 0, texted: 0, byInspiration: {} }, weekPlans: [], sundayReviewAtHours: null, instagram: { hasInstagram: Boolean(slot.handles.instagram), instagramOnly: Boolean(slot.handles.instagram && !slot.handles.tiktok), igPostsRead: 0, igGroundedIdeas: 0, gotIgGroundedIdea: false }, failures: log?.failures ?? [{ d: 0, step: "signup", error: slot.error ?? "no creator" }], cost: { modelUsd: 0, scrapeCredits: 0, scrapeUsd: 0, otherUsd: 0, simOverheadUsd: 0, byKind: {} }, judged: null, actorTurns: 0, stepsRun: 0 };
    }
    const id = slot.creatorId;
    const t0 = c.createdAt;
    const at = (ts: number | null | undefined) => (ts === null || ts === undefined ? null : hours(ts - t0));
    const msgs = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", id)).take(800)) as Doc<"messages">[];
    const out = msgs.filter((m) => m.direction === "out");
    const byKey = (k: string) => out.find((m) => m.dedupeKey === k) ?? null;
    const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", id)).take(300)) as Doc<"ideas">[];
    const weekIdeas = ideas.filter((x) => x.createdAt - t0 <= 8 * D);
    const byInspiration: Record<string, number> = {};
    let igGrounded = 0;
    for (const x of weekIdeas) {
      const sig = x.signalId ? ((await ctx.db.get(x.signalId)) as Doc<"signals"> | null) : null;
      const own = x.rhymesWithOwnPostId ? ((await ctx.db.get(x.rhymesWithOwnPostId)) as Doc<"ownPosts"> | null) : null;
      const p = inspirationPlatform([...(sig?.url ? [sig.url] : []), ...x.evidenceLinks], own?.platform ?? null);
      byInspiration[p] = (byInspiration[p] ?? 0) + 1;
      if (p === "instagram" || p === "own_instagram") igGrounded++;
    }
    const texted = weekIdeas.filter((x) => x.messageId || x.sentAt || x.surfacedAt).sort((x, y) => (x.sentAt ?? x.surfacedAt ?? x.createdAt) - (y.sentAt ?? y.surfacedAt ?? y.createdAt));
    const firstTexted = texted[0] ? texted[0].sentAt ?? texted[0].surfacedAt ?? texted[0].createdAt : null;
    const plans = out.filter((m) => m.kind === "plan").sort((x, y) => x.ts - y.ts);
    const review = out.filter((m) => m.kind === "review").sort((x, y) => x.ts - y.ts)[0] ?? null;
    const jobs = (await ctx.db.query("jobs").withIndex("by_creator", (q) => q.eq("creatorId", id)).take(400)) as Doc<"jobs">[];
    const ingest = jobs.filter((j) => j.kind === "ingest_catalogue").sort((x, y) => x.createdAt - y.createdAt);
    const ingestDone = ingest.find((j) => j.status === "succeeded") ?? ingest[ingest.length - 1] ?? null;
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", id)).take(1000)) as Doc<"ownPosts">[];
    const postsRead = { tiktok: posts.filter((p) => p.platform === "tiktok").length, instagram: posts.filter((p) => p.platform === "instagram").length };
    const costs = (await ctx.db.query("costEvents").withIndex("by_creator_at", (q) => q.eq("creatorId", id)).take(8000)) as Doc<"costEvents">[];
    const cost = { modelUsd: 0, scrapeCredits: 0, scrapeUsd: 0, otherUsd: 0, simOverheadUsd: 0, byKind: {} as Record<string, number> };
    for (const r of costs) {
      if (/^fw_/.test(r.kind)) { cost.simOverheadUsd += r.costUsd; continue; } // the actor and the judge are the simulation, not Maya
      if (r.vendor === "scrapecreators") { cost.scrapeCredits += r.units; cost.scrapeUsd += r.costUsd; }
      else if (r.vendor === "openrouter" || r.vendor === "gemini" || r.vendor === "groq") cost.modelUsd += r.costUsd;
      else cost.otherUsd += r.costUsd;
      const k = r.kind.split(":")[0];
      cost.byKind[k] = Math.round(((cost.byKind[k] ?? 0) + r.costUsd) * 10_000) / 10_000;
    }
    for (const k of ["modelUsd", "scrapeUsd", "otherUsd", "simOverheadUsd"] as const) cost[k] = Math.round(cost[k] * 10_000) / 10_000;
    const ev = (name: string) => log?.events.find((e) => e.name === name) ?? null;
    const dossierAt = ev("dossier")?.simMs ?? (c.dossierDiff?.version === 1 ? c.dossierDiff.at - t0 : null);
    const failures = [
      ...(log?.failures ?? []),
      ...jobs.filter((j) => (j.status === "failed" || j.status === "dead") && j.kind !== "deliver_message").map((j) => ({ d: Math.max(0, Math.floor((j.updatedAt - t0) / D)), step: `job:${j.kind}`, error: (j.lastError ?? j.status).slice(0, 200) })),
      ...(log?.steps ?? []).filter((x) => x.result.startsWith("failed:") && !(log?.failures ?? []).some((f) => f.d === x.d && f.step === x.step)).map((x) => ({ d: x.d, step: x.step, error: x.result })),
    ];
    const hello = byKey(`hello:${id}`), firstRead = byKey(`first_read:${id}`), pending = byKey(`first_read_pending:${id}`);
    const firstPlanAt = plans[0]?.ts ?? null;
    const anyIdea = [firstTexted, firstPlanAt].filter((x): x is number => x !== null);
    const timeline = [
      { what: "signed up", atHours: 0 as number | null },
      ...(log?.events ?? []).filter((e) => ["admired", "pairing"].includes(e.name)).map((e) => ({ what: e.name, atHours: hours(e.simMs), detail: e.detail })),
      { what: `catalogue read ${ingestDone?.status ?? "not run"}`, atHours: ev("catalogue_read") ? hours(ev("catalogue_read")!.simMs) : at(ingestDone && ingestDone.status !== "queued" && ingestDone.status !== "running" ? ingestDone.updatedAt : null), detail: `tiktok ${postsRead.tiktok}, instagram ${postsRead.instagram} posts` },
      { what: "dossier built", atHours: hours(dossierAt) },
      { what: "hello", atHours: at(hello?.ts) },
      ...(pending ? [{ what: "\"reading your posts\" (read not ready at pairing)", atHours: at(pending.ts) }] : []),
      { what: "first read", atHours: at(firstRead?.ts) },
      { what: "first week plan", atHours: at(firstPlanAt) },
      { what: "first idea texted", atHours: at(firstTexted) },
      ...plans.slice(1).map((p) => ({ what: "week plan (next week)", atHours: at(p.ts) as number | null })),
      { what: "Sunday review", atHours: at(review?.ts) },
    ].filter((x) => x.atHours !== null || ["first read", "first idea texted", "Sunday review", "hello", "dossier built"].includes(x.what));
    return {
      ...base, creatorId: id, phase: log?.cursor.phase ?? "?", dayReached: log?.cursor.d ?? 0, timeline,
      catalogue: { status: ingestDone?.status ?? null, attempts: ingestDone?.attempts ?? 0, error: ingestDone?.lastError ?? null, postsRead, readFrom: (c.dossier as { readFrom?: unknown } | undefined)?.readFrom ?? null, doneAtHours: ev("catalogue_read") ? hours(ev("catalogue_read")!.simMs) : null },
      dossierAtHours: hours(dossierAt), helloAtHours: at(hello?.ts), firstReadAtHours: at(firstRead?.ts),
      firstIdeaTextedAtHours: at(firstTexted), firstPlanAtHours: at(firstPlanAt), firstIdeaAnyAtHours: anyIdea.length ? at(Math.min(...anyIdea)) : null,
      ideasWeek1: { total: weekIdeas.length, texted: texted.length, byInspiration },
      weekPlans: plans.map((p) => ({ atHours: at(p.ts) ?? 0, key: p.dedupeKey ?? "" })), sundayReviewAtHours: at(review?.ts),
      instagram: { hasInstagram: Boolean(c.handles.instagram), instagramOnly: Boolean(c.handles.instagram && !c.handles.tiktok), igPostsRead: postsRead.instagram, igGroundedIdeas: igGrounded, gotIgGroundedIdea: igGrounded > 0 },
      failures, cost, judged: log?.judged ?? null, actorTurns: log?.turns ?? 0, stepsRun: log?.steps.length ?? 0,
      checks: log?.checks ?? [],
    };
  },
});

export type FleetSummary = {
  creators: number; started: number; onboarded: number; finished: number;
  medianHoursToFirstIdeaAny: number | null; medianHoursToFirstIdeaTexted: number | null;
  pctIdeaWithin24h: number | null; pctTextedIdeaWithin24h: number | null; pctFirstReadWithin1h: number | null;
  pctWeekPlan: number | null; pctSundayReview: number | null;
  instagram: { creatorsWithInstagram: number; withIgGroundedIdeas: number; pct: number | null; instagramOnly: number; instagramOnlyWithIgGroundedIdeas: number };
  failures: Array<{ i: number; d: number; step: string; error: string }>;
  costPerOnboardedCreator: { modelUsd: number | null; scrapeCredits: number | null; totalUsd: number | null };
  judge: { items: number; meanGrounded: number | null; meanSpecific: number | null; wrongPlatform: number; withInvented: number };
  /** The product script's promises across the fleet (empty for a plain first-week run). */
  promises: Array<{ check: string; passed: number; failed: number; na: number }>;
};

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

/** Pure: the fleet summary from the per-creator reports. */
export function summarise(reports: CreatorReport[]): FleetSummary {
  const started = reports.filter((r) => r.creatorId);
  const onboarded = started.filter((r) => r.firstReadAtHours !== null);
  const within = (x: number | null, h: number) => x !== null && x <= h;
  const ig = started.filter((r) => r.instagram.hasInstagram);
  const igOnly = started.filter((r) => r.instagram.instagramOnly);
  const judgedItems = started.flatMap((r) => (Array.isArray(r.judged) ? (r.judged as Array<{ verdict: JudgedItem | null }>) : [])).map((x) => x.verdict).filter((x): x is JudgedItem => Boolean(x));
  const perCreatorUsd = onboarded.map((r) => r.cost.modelUsd + r.cost.scrapeUsd + r.cost.otherUsd);
  return {
    creators: reports.length, started: started.length, onboarded: onboarded.length, finished: started.filter((r) => r.phase === "done").length,
    medianHoursToFirstIdeaAny: median(started.map((r) => r.firstIdeaAnyAtHours).filter((x): x is number => x !== null)),
    medianHoursToFirstIdeaTexted: median(started.map((r) => r.firstIdeaTextedAtHours).filter((x): x is number => x !== null)),
    pctIdeaWithin24h: pct(started.filter((r) => within(r.firstIdeaAnyAtHours, 24)).length, started.length),
    pctTextedIdeaWithin24h: pct(started.filter((r) => within(r.firstIdeaTextedAtHours, 24)).length, started.length),
    pctFirstReadWithin1h: pct(started.filter((r) => within(r.firstReadAtHours, 1)).length, started.length),
    pctWeekPlan: pct(started.filter((r) => r.weekPlans.length > 0).length, started.length),
    pctSundayReview: pct(started.filter((r) => r.sundayReviewAtHours !== null).length, started.length),
    instagram: { creatorsWithInstagram: ig.length, withIgGroundedIdeas: ig.filter((r) => r.instagram.gotIgGroundedIdea).length, pct: pct(ig.filter((r) => r.instagram.gotIgGroundedIdea).length, ig.length), instagramOnly: igOnly.length, instagramOnlyWithIgGroundedIdeas: igOnly.filter((r) => r.instagram.gotIgGroundedIdea).length },
    failures: reports.flatMap((r) => r.failures.map((f) => ({ i: r.i, ...f }))),
    costPerOnboardedCreator: { modelUsd: mean(onboarded.map((r) => r.cost.modelUsd)), scrapeCredits: mean(onboarded.map((r) => r.cost.scrapeCredits)), totalUsd: mean(perCreatorUsd) },
    judge: { items: judgedItems.length, meanGrounded: mean(judgedItems.map((x) => x.grounded)), meanSpecific: mean(judgedItems.map((x) => x.specific)), wrongPlatform: judgedItems.filter((x) => x.rightPlatform === "no").length, withInvented: judgedItems.filter((x) => x.invented.length > 0).length },
    promises: summariseChecks(started.flatMap((r) => r.checks ?? [])),
  };
}

/** The run: a timeline per creator and the fleet summary. Partial while it runs. */
export const report = internalAction({
  args: { runId: v.string(), verbose: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ runId: string; startedAt: string | null; stopped: string | null; opts: Opts | null; credits: { attributed: number; unattributedInWindow: number; total: number }; fleet: FleetSummary; creators: CreatorReport[] }> => {
    const s = await ctx.runQuery(internal.eval.firstWeek.readState, { runId: a.runId });
    if (!s) throw new Error(`no first-week run ${a.runId}`);
    const creators: CreatorReport[] = [];
    // One query per creator: each reads only that creator's rows, through their indexes.
    for (const c of s.creators) { const r = await ctx.runQuery(internal.eval.firstWeek.creatorReport, { runId: a.runId, i: c.i }); if (r) creators.push(r); }
    const credits = await ctx.runQuery(internal.eval.firstWeek.runCredits, { runId: a.runId });
    return { runId: a.runId, startedAt: new Date(s.startedAt).toISOString(), stopped: s.stopped ?? null, opts: s.opts, credits, fleet: summarise(creators), creators: a.verbose ? creators : creators.map((c) => ({ ...c, judged: Array.isArray(c.judged) ? (c.judged as Array<{ what: string; verdict: unknown }>).map((x) => ({ what: x.what, verdict: x.verdict })) : c.judged })) };
  },
});

/** Per creator, the day-by-day: steps run, what the actor said, the daily snapshot. For digging into one creator. */
export const days = internalQuery({
  args: { runId: v.string(), i: v.number() },
  handler: async (ctx, a): Promise<CreatorLog | null> => await readKey<CreatorLog>(ctx, logKey(a.runId, a.i)),
});

/**
 * Her words from a run, for people to rate (is she fun, warm, encouraging, cheesy?). Every line she
 * sent each creator, with what they had just said, in order; the iMessage menu line is shown as it is
 * delivered, since that is what a person reads. Sim creators of this run only.
 */
export const voice = internalQuery({
  args: { runId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, a): Promise<Array<{ i: number; handle: string; day: number; kind: string; theySaid: string | null; mayaSaid: string }>> => {
    const s = await readKey<RunState>(ctx, stateKey(a.runId));
    if (!s) return [];
    const out: Array<{ i: number; handle: string; day: number; kind: string; theySaid: string | null; mayaSaid: string }> = [];
    for (const slot of s.creators) {
      if (!slot.creatorId) continue;
      const c = (await ctx.db.get(slot.creatorId)) as Doc<"creators"> | null;
      if (!c || !isFirstWeekSubject(c.clerkUserId)) continue;
      const rows = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", slot.creatorId!)).take(600)) as Doc<"messages">[];
      let last: string | null = null;
      for (const m of rows) {
        if (m.direction === "in") { last = m.kind === "pairing" ? null : clip(m.body, 280); continue; }
        const menu = m.buttons?.length ? ` ${menuLine(m.buttons)}` : "";
        out.push({ i: slot.i, handle: slot.handles.tiktok ?? slot.handles.instagram ?? "?", day: Math.max(0, Math.floor((m.ts - c.createdAt) / D)), kind: m.kind ?? "reply", theySaid: last, mayaSaid: clip(`${m.body}${menu}`, 900) });
        last = null;
      }
    }
    return out.slice(0, a.limit ?? 200);
  },
});

// ------------------------------------------------------------------ cleanup

/**
 * Remove one run's creators and every row they own (through each table's creator index, 400 rows
 * a call), so their real handles are free for the next run. Sim creators only; call until done.
 */
export const clearPage = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<{ deleted: number; done: boolean }> => {
    if (!/^fw-[a-z0-9]+$/.test(a.runId)) throw new Error("not a first-week run id");
    const s = await readKey<RunState>(ctx, stateKey(a.runId));
    if (!s) return { deleted: 0, done: true };
    let deleted = 0;
    for (const slot of s.creators) {
      if (!slot.creatorId) continue;
      const c = (await ctx.db.get(slot.creatorId)) as Doc<"creators"> | null;
      if (!c) continue;
      if (!isFirstWeekSubject(c.clerkUserId)) throw new Error("refusing to delete a creator outside the simulation");
      for (const table of TABLES_BY_CREATOR) {
        const index = CREATOR_INDEX[table];
        if (!index || table === "schedule") continue; // the creator's delete trigger removes its schedule row
        const q = ctx.db.query(table) as unknown as { withIndex: (i: string, f: (q: { eq: (k: string, v: unknown) => unknown }) => unknown) => { take: (n: number) => Promise<Array<{ _id: never }>> } };
        const rows = await q.withIndex(index, (x) => x.eq("creatorId", c._id)).take(400 - deleted);
        for (const r of rows) { await ctx.db.delete(r._id); deleted++; }
        if (deleted >= 400) return { deleted, done: false };
      }
      await ctx.db.delete(c._id);
      deleted++;
      if (deleted >= 400) return { deleted, done: false };
    }
    return { deleted, done: true };
  },
});

export const clear = internalAction({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<{ deleted: number }> => {
    const st = await ctx.runQuery(internal.eval.firstWeek.readState, { runId: a.runId });
    const ids = (st?.creators ?? []).map((c) => c.creatorId).filter((x): x is Id<"creators"> => Boolean(x));
    if (ids.length) await ctx.runMutation(internal.eval.replay.disarm, { creatorIds: ids });
    let deleted = 0;
    for (let n = 0; n < 200; n++) {
      const r = await ctx.runMutation(internal.eval.firstWeek.clearPage, { runId: a.runId });
      deleted += r.deleted;
      if (r.done) break;
    }
    return { deleted };
  },
});
