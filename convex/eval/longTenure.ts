/**
 * A year with Maya, synthesised (2026-09-09). The operator's question: does she still excel for
 * someone we hold a year of memory on? The scenario creators have a rich catalogue and a thin
 * relationship, so this seeds a long-tenure twin through the real tables: the same real posts and
 * cards re-dated across twelve months, ~500 messages, ~150 ideas with taste and outcomes, notes
 * that expire, rules that supersede, decisions with reasons, commitments tied to blocks that were
 * filmed or missed, a calendar, milestones, follower growth, monthly style snapshots, and the
 * memory index. Deterministic, so a run is repeatable. Then the gauntlet asks the questions only a
 * real memory can answer, and measures the prefix, the latency and the cost per turn.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { startCreator } from "../onboarding/start";
import { subjectFor } from "./scenarios";
import { splitEvents } from "../taste/separation";
import { captureStyle } from "../agent/personalHistory";
import { buildPrefix } from "../agent/context";

const D = 86_400_000, H = 3_600_000;
export const TWIN_HANDLE = "vanessa_year";

/** mulberry32: small, deterministic. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** The year's arc: dated facts the probes will ask about. All times relative to `now`. */
export function arc(now: number) {
  const day = (d: number) => now - d * D;
  return {
    joinedAt: day(365),
    name: "Vanessa",
    dog: "Mochi",
    decisions: [
      { at: day(200), quote: "no more sunrise b-roll with quotes over it. it's not me, it looks like everyone else's feed", reason: "it looks like everyone else's feed", topic: "sunrise b-roll" },
      { at: day(140), quote: "skits take me a whole day to make and i hate every minute, not worth it even when they do numbers", reason: "they take a whole day and i hate every minute", topic: "skits", kind: "effort" as const },
      { at: day(95), quote: "i like the deadpan ones best. the ones where i just say the thing", reason: "", topic: "deadpan", kind: "preference" as const },
    ],
    rules: [
      { at: day(160), text: "never suggest dance trends", active: true },
      { at: day(120), text: "don't text me before 10am", active: false, supersededAt: day(60) },
      { at: day(60), text: "mornings are fine actually, just nothing before 8", active: true },
    ],
    commitments: [
      { at: day(90), quote: "i'll film the hostel tour on saturday", title: "film: the hostel tour", start: day(88) + 17 * H, filmed: true },
      { at: day(40), quote: "ok i'll do the 5am alarm one on friday", title: "film: the 5am alarm", start: day(38) + 17 * H, filmed: false, missed: true },
    ],
    naples: { at: day(250), hook: "flying a new york slice to naples to see if italy gets mad", multiple: 9.4 },
    sister: { at: day(300), text: "my sister films most of my stuff when she's in town" },
    marathon: { at: day(150), title: "Gold Coast Marathon", note: "gold coast marathon in july, training through june" },
    lane: { early: "running humor and race-day vlogs", now: "running stays the main thing, travel is summer texture" },
  };
}

export const twinId = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"creators"> | null> => ((await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", subjectFor(TWIN_HANDLE))).first()) as Doc<"creators"> | null)?._id ?? null,
});

/** The creator row itself, copied from the source scenario's dossier and roster. */
export const createTwin = internalMutation({
  args: { fromHandle: v.string(), now: v.number() },
  handler: async (ctx, a): Promise<{ creatorId: Id<"creators">; created: boolean }> => {
    const existing = (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", subjectFor(TWIN_HANDLE))).first()) as Doc<"creators"> | null;
    if (existing) return { creatorId: existing._id, created: false };
    const src = (await ctx.db.query("creators").withIndex("by_tiktok", (q) => q.eq("handles.tiktok", a.fromHandle)).first()) as Doc<"creators"> | null;
    if (!src) throw new Error(`no source creator @${a.fromHandle}`);
    const r = await startCreator(ctx, { subject: subjectFor(TWIN_HANDLE), email: `${subjectFor(TWIN_HANDLE)}@eval.invalid`, handles: { tiktok: TWIN_HANDLE }, timezone: src.timezone });
    if (!r.ok || !r.creatorId) throw new Error(`could not create the twin: ${r.error}`);
    const creatorId = r.creatorId as Id<"creators">;
    const A = arc(a.now);
    await ctx.db.patch(creatorId, {
      plan: { status: "paused", founding: true }, niche: A.lane.now, dossier: src.dossier, dossierVersion: src.dossierVersion, mode: src.mode, createdAt: A.joinedAt, updatedAt: a.now,
      laneConfirmedAt: A.joinedAt + 3 * D, milestonesSaid: ["months:1", "months:6", "ideas:50", "views:100000", "followers:10000", "streak:3w"],
      quietHours: { start: "22:00", end: "08:00" },
    });
    // Cancel the catalogue read the real path queued: this twin never touches the vendor.
    const jobs = (await ctx.db.query("jobs").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).collect()) as Doc<"jobs">[];
    for (const j of jobs) await ctx.db.delete(j._id);
    const tracked = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", src._id)).collect()) as Doc<"trackedAccounts">[];
    for (const t of tracked) await ctx.db.insert("trackedAccounts", { creatorId, platform: t.platform, handle: t.handle, addedBy: "creator", baselineN: t.baselineN, medianPace24h: t.medianPace24h, status: "active", createdAt: A.joinedAt });
    return { creatorId, created: true };
  },
});

/** The catalogue: the source's real posts and cards, re-dated across the year, oldest first. */
export const copyPosts = internalMutation({
  args: { creatorId: v.id("creators"), fromHandle: v.string(), now: v.number() },
  handler: async (ctx, a): Promise<{ posts: number; cards: number }> => {
    const src = (await ctx.db.query("creators").withIndex("by_tiktok", (q) => q.eq("handles.tiktok", a.fromHandle)).first()) as Doc<"creators"> | null;
    if (!src) return { posts: 0, cards: 0 };
    const posts = ((await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", src._id)).collect()) as Doc<"ownPosts">[]).sort((x, y) => x.createTime - y.createTime);
    const reads = (await ctx.db.query("ownPostReads").withIndex("by_creator", (q) => q.eq("creatorId", src._id)).collect()) as Doc<"ownPostReads">[];
    const cardFor = new Map(reads.map((r) => [String(r.ownPostId), r]));
    const r = rng(7);
    let cards = 0;
    const n = posts.length;
    for (let i = 0; i < n; i++) {
      const p = posts[i];
      // Spread across the year with a little jitter; the newest lands in the last week.
      const createTime = a.now - Math.round(((n - 1 - i) / Math.max(1, n - 1)) * 350 * D) - Math.floor(r() * 2 * D);
      const { _id, _creationTime, creatorId: _c, ...rest } = p;
      void _id; void _creationTime; void _c;
      const id = await ctx.db.insert("ownPosts", { ...rest, creatorId: a.creatorId, postId: `${p.postId}-y`, url: `${p.url}?y=1`, createTime, metricsAsOf: createTime + 2 * D, embedding: undefined, embeddedText: undefined } as never);
      const card = cardFor.get(String(p._id));
      if (card) { await ctx.db.insert("ownPostReads", { creatorId: a.creatorId, ownPostId: id, card: card.card, depth: card.depth, produced: card.produced, createdAt: createTime + 3 * H } as never); cards++; }
    }
    return { posts: n, cards };
  },
});

/** A year of ideas, taste and outcomes, and the conversations around them. Chunked by month. */
export const seedMonth = internalMutation({
  args: { creatorId: v.id("creators"), now: v.number(), month: v.number() },
  handler: async (ctx, a): Promise<{ ideas: number; messages: number }> => {
    const r = rng(100 + a.month);
    const A = arc(a.now);
    const monthStart = A.joinedAt + a.month * 30 * D;
    const formats = ["talking-head", "list", "pov", "vlog", "text-on-screen", "skit", "reaction"] as const;
    const topics = ["running", "hostel life", "solo travel", "brisbane", "marathon training", "rest days", "gear"] as const;
    const hooks = ["the 5am face, five seconds", "km vs miles, one take", "the shoe rack list", "hostel kitchen at 6am", "rest day guilt, deadpan", "the split i lied about", "what a long run costs in snacks", "the bus to the start line"] as const;
    let ideas = 0, messages = 0;
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("createTime", monthStart).lte("createTime", monthStart + 30 * D)).collect()) as Doc<"ownPosts">[];
    for (let w = 0; w < 4; w++) {
      const weekStart = monthStart + w * 7 * D;
      const perWeek = 2 + Math.floor(r() * 2);
      for (let k = 0; k < perWeek; k++) {
        const at = weekStart + Math.floor(r() * 5) * D + 8 * H + k * 3 * H;
        const format = pick(r, formats), topic = pick(r, topics), hook = pick(r, hooks);
        const roll = r();
        const status: Doc<"ideas">["status"] = roll < 0.25 ? "posted" : roll < 0.45 ? "hearted" : roll < 0.6 ? "passed" : "expired";
        const saved = roll >= 0.6 && roll < 0.7;
        const features = { format, topics: [topic], tone: format === "skit" ? "ironic" : "deadpan", lengthBucket: pick(r, ["<15", "15-30", "30-60"] as const), sound: pick(r, ["none", "original"] as const), source: "breakout" };
        const messageText = `@${pick(r, ["andi.renay", "runwithcarly", "aliabdaal"] as const)} is at ${(2 + r() * 6).toFixed(1)}× their normal with a ${format} on ${topic}. your version: ${hook}. want the shot list?`;
        const ideaId = await ctx.db.insert("ideas", { creatorId: a.creatorId, evidenceLinks: [`https://www.tiktok.com/@x/video/${Math.floor(at / 1000)}`], fit: "yes", fitWhy: `${format} is theirs`, version: { hook, onScreenText: hook.split(",")[0], lengthSec: 20, sound: "" }, messageText, produced: { skillVersion: "year", model: "seed", thresholdsVersion: "seed" }, features, status, sentAt: at, savedAt: saved ? at + 2 * H : undefined, postedAt: status === "posted" ? at + 2 * D : undefined, matchedPostId: status === "posted" && posts.length ? pick(r, posts)._id : undefined, matchConfidence: status === "posted" ? "likely" : undefined, createdAt: at } as never);
        ideas++;
        const out = await ctx.db.insert("messages", { creatorId: a.creatorId, direction: "out", surface: "telegram", kind: "scout", body: messageText, dedupeKey: `year:idea:${ideaId}`, proactive: true, ideaId, deliveredAt: at + 5_000, ts: at });
        void out; messages++;
        const keys = [`format:${format}`, `topic:${topic.replace(/\s+/g, "-")}`, `tone:${features.tone}`, `length:${features.lengthBucket}`, `sound:${features.sound}`, "source:breakout"];
        if (status === "hearted" || status === "posted") {
          await ctx.db.insert("tasteEvents", { creatorId: a.creatorId, ideaId, kind: "heart", weight: 1, features: keys, at: at + H });
          await ctx.db.insert("messages", { creatorId: a.creatorId, direction: "in", surface: "telegram", kind: "inbound", body: pick(r, ["love it, filming that thursday", "ok yes. the shoe rack one first", "that's the one. friday?", "haha yes. after the long run"] as const), ts: at + 2 * H }); messages++;
          await ctx.db.insert("messages", { creatorId: a.creatorId, direction: "out", surface: "telegram", kind: "reply", body: pick(r, ["thursday 5pm work? your usual hour.", "booked for friday at 5. i'll nudge you at 4:45.", "on it. saturday 9am, straight after the run."] as const), dedupeKey: `year:reply:${ideaId}`, deliveredAt: at + 2 * H + 5_000, ts: at + 2 * H + 1 }); messages++;
        }
        if (saved) await ctx.db.insert("tasteEvents", { creatorId: a.creatorId, ideaId, kind: "save", weight: 1, features: keys, at: at + H });
        if (status === "passed") {
          await ctx.db.insert("tasteEvents", { creatorId: a.creatorId, ideaId, kind: "notme", weight: -2, features: keys, at: at + H });
          await ctx.db.insert("messages", { creatorId: a.creatorId, direction: "in", surface: "telegram", kind: "inbound", body: pick(r, ["nah not me", "pass. skits kill me", "not this week"] as const), ts: at + H }); messages++;
        }
        if (status === "expired") await ctx.db.insert("tasteEvents", { creatorId: a.creatorId, ideaId, kind: "ignored", weight: -0.3, features: keys, at: at + 3 * D });
        if (status === "posted") {
          const win = r() < 0.65;
          const multiple = win ? 1.6 + r() * 4 : 0.3 + r() * 0.5;
          await ctx.db.insert("tasteEvents", { creatorId: a.creatorId, ideaId, kind: "posted", weight: 3, features: keys, at: at + 2 * D });
          await ctx.db.insert("tasteEvents", { creatorId: a.creatorId, ideaId, kind: win ? "outcome_win" : "outcome_flop", weight: win ? 3 : -1.5, features: keys, at: at + 4 * D });
          await ctx.db.patch(ideaId, { outcomeLearnedAt: at + 4 * D, outcomeMultiple: Math.round(multiple * 100) / 100 });
        }
      }
    }
    return { ideas, messages };
  },
});

/** The arc: the named things, the rules that supersede, the decisions with reasons, the commitments and their blocks, the calendar, followers. */
export const seedArc = internalMutation({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ notes: number; rules: number; records: number; blocks: number; events: number }> => {
    const A = arc(a.now);
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators">;
    const say = async (body: string, at: number) => await ctx.db.insert("messages", { creatorId: a.creatorId, direction: "in", surface: "telegram", kind: "inbound", body, ts: at });
    const reply = async (body: string, at: number, key: string) => { await ctx.db.insert("messages", { creatorId: a.creatorId, direction: "out", surface: "telegram", kind: "reply", body, dedupeKey: `year:${key}`, deliveredAt: at + 4_000, ts: at }); };
    const notes: Doc<"creators">["notes"] = [];
    let n = 0;
    const note = async (text: string, kind: "fact" | "bit" | "life", at: number, opts: { expiresDays?: number; tombstoned?: boolean; source?: Id<"messages"> } = {}) => {
      notes.push({ id: `y_${n++}`, text, kind, at, sourceMessageId: opts.source, expiresHint: opts.expiresDays ? at + opts.expiresDays * D : undefined, tombstonedAt: opts.tombstoned ? at + 20 * D : undefined, confirmedAt: undefined } as Doc<"creators">["notes"][number]);
    };
    // Day one: the name, the dog, the sister.
    const m1 = await say("it's Vanessa. and yes that's Mochi in half of them", A.joinedAt + 20 * 60_000);
    await reply("vanessa. and mochi, noted, he's clearly the co-host.", A.joinedAt + 21 * 60_000, "hello-name");
    await note("call them Vanessa", "fact", A.joinedAt + 20 * 60_000, { source: m1 });
    await note("Mochi is the dog; in half the posts", "fact", A.joinedAt + 20 * 60_000, { source: m1 });
    const ms = await say(A.sister.text, A.sister.at);
    await note(A.sister.text, "fact", A.sister.at, { source: ms });
    await note(A.marathon.note, "life", A.marathon.at, { expiresDays: 60, source: await say(`ok real talk, ${A.marathon.note}. keep ideas short till july`, A.marathon.at) });
    await note("the 5am alarm face is a running bit", "bit", a.now - 220 * D);
    await note("hostel in brisbane through spring", "life", a.now - 180 * D, { expiresDays: 90 });
    await note("flew a slice of new york pizza to naples for the bit", "bit", A.naples.at);
    for (let i = 0; i < 30; i++) await note(pick(rng(i), ["prefers filming after a run, never before", "hates voiceover, will only talk to camera", "brother visiting in august", "shooting on the older phone this month", "training block: long runs sundays", "coffee first, always", "new shoes, the orange ones", "dropped the tripod in the river"] as const), i % 3 === 0 ? "life" : "fact", a.now - (330 - i * 10) * D, { expiresDays: i % 3 === 0 ? 45 : undefined, tombstoned: i % 7 === 0 });
    // Decisions with reasons, as their own words and as records with sources.
    let records = 0;
    for (const d of A.decisions) {
      const src = await say(d.quote, d.at);
      await reply(pick(rng(d.at), ["noted. that's off the list.", "fair. i'll stop bringing those.", "got it, deadpan it is."] as const), d.at + 60_000, `decision:${d.at}`);
      await ctx.db.insert("personalRecords", { creatorId: a.creatorId, key: `decision:${d.at}`, kind: d.kind ?? "decision", text: d.quote, reason: d.reason || undefined, sourceMessageIds: [src], sourcePostIds: [], sourceNoteIds: [], active: true, at: d.at });
      records++;
    }
    // Rules, one superseding another.
    let prev: Id<"directives"> | null = null;
    for (const rule of A.rules) {
      const src = await say(rule.text, rule.at);
      const id: Id<"directives"> = await ctx.db.insert("directives", { creatorId: a.creatorId, kind: "rule", verbatim: rule.text, active: rule.active, supersededAt: rule.supersededAt, supersedesId: rule.text.startsWith("mornings") && prev ? prev : undefined, sourceMessageId: src, source: "chat", createdAt: rule.at });
      if (rule.text.startsWith("don't text")) prev = id;
    }
    // Commitments → blocks, filmed or missed; plus a year of other blocks.
    let blocks = 0;
    for (const cm of A.commitments) {
      const src = await say(cm.quote, cm.at);
      const blockId = await ctx.db.insert("calendarBlocks", { creatorId: a.creatorId, kind: "film", start: cm.start, end: cm.start + H, title: cm.title, status: "confirmed", consentAt: cm.at + 60_000, touches: ["prep", "checkin"], filmedAt: cm.filmed ? cm.start + 30 * 60_000 : undefined, missedAt: cm.missed ? cm.start + 3 * H : undefined, createdAt: cm.at });
      await ctx.db.insert("personalRecords", { creatorId: a.creatorId, key: `commitment:${cm.at}`, kind: "commitment", text: cm.quote, sourceMessageIds: [src], sourcePostIds: [], sourceNoteIds: [], blockId, active: true, at: cm.at });
      records++; blocks++;
    }
    const r = rng(9);
    for (let w = 0; w < 50; w++) {
      const start = A.joinedAt + w * 7 * D + (2 + Math.floor(r() * 3)) * D + 17 * H;
      const filmed = r() < 0.7;
      await ctx.db.insert("calendarBlocks", { creatorId: a.creatorId, kind: "film", start, end: start + H, title: `film: ${pick(r, ["the shoe rack list", "hostel kitchen at 6am", "rest day guilt", "km vs miles", "the bus to the start line"] as const)}`, status: r() < 0.1 ? "deleted" : "confirmed", consentAt: start - 2 * D, touches: ["prep", "checkin"], filmedAt: filmed ? start + 20 * 60_000 : undefined, missedAt: filmed ? undefined : start + 4 * H, createdAt: start - 3 * D });
      blocks++;
    }
    // The calendar: races, trips, and private things she never names.
    let events = 0;
    const cal = [
      { title: A.marathon.title, at: a.now - 110 * D, cls: "filmable" as const }, { title: "Byron Bay road trip", at: a.now - 60 * D, cls: "filmable" as const }, { title: "Dentist", at: a.now - 30 * D, cls: "private" as const },
      { title: "Parkrun", at: a.now - 20 * D, cls: "routine" as const }, { title: "Sydney Marathon", at: a.now + 5 * D, cls: "filmable" as const }, { title: "Flight home", at: a.now + 40 * D, cls: "filmable" as const },
    ];
    for (const e of cal) { await ctx.db.insert("calendarEvents", { creatorId: a.creatorId, calendarId: "primary", externalId: `y-${e.title.toLowerCase().replace(/\W+/g, "-")}`, title: e.cls === "private" ? "" : e.title, start: e.at, end: e.at + 4 * H, allDay: false, recurring: e.cls === "routine", class: e.cls, classifiedBy: "code", status: "active", updatedAt: e.at, createdAt: e.at - 30 * D }); events++; }
    // Followers, monthly, growing.
    for (let m = 0; m < 12; m++) { const at = A.joinedAt + m * 30 * D; await ctx.db.insert("followerSnapshots", { creatorId: a.creatorId, platform: "tiktok", accountId: "y", day: new Date(at).toISOString().slice(0, 10), followers: 4000 + Math.round(m * 900 + (m > 8 ? 1500 : 0)), at }); }
    // The taste ledger → the two affinity arrays, by replay; the taste note in prose; the pivot as their words.
    const events2 = (await ctx.db.query("tasteEvents").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"tasteEvents">[];
    const split = splitEvents(events2);
    await ctx.db.patch(a.creatorId, { notes, affinities: split.preferences, performanceAffinities: split.performance, signalsSeparatedAt: a.now, taste: { text: "they take the deadpan talking-heads and the object-open lists almost every time; skits get a hard pass even when they do numbers; saves the hostel ones for later and rarely films them.", version: 3, updatedAt: a.now - 7 * D, eventsSeen: events2.length }, updatedAt: a.now });
    void c;
    return { notes: notes.length, rules: A.rules.length, records, blocks, events };
  },
});

/** Monthly style snapshots across the year, from the re-dated posts. */
export const seedStyle = internalMutation({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ snapshots: number }> => {
    for (let m = 11; m >= 0; m--) await captureStyle(ctx, a.creatorId, a.now - m * 30 * D);
    return { snapshots: ((await ctx.db.query("personalRecords").withIndex("by_creator_kind", (q) => q.eq("creatorId", a.creatorId).eq("kind", "style")).collect()) as Doc<"personalRecords">[]).length };
  },
});

export const indexInputs = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Array<{ kind: "note" | "idea" | "swipe"; refId: string; text: string }>> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators">;
    const out: Array<{ kind: "note" | "idea" | "swipe"; refId: string; text: string }> = [];
    for (const n of c.notes) if (!n.tombstonedAt) out.push({ kind: "note", refId: n.id, text: n.text });
    const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"ideas">[];
    for (const i of ideas) out.push({ kind: i.savedAt ? "swipe" : "idea", refId: String(i._id), text: `${(i.version as { hook?: string }).hook ?? ""}\n${i.messageText}` });
    return out;
  },
});

/** How big her context is for this creator, in characters, and where it goes. */
export const prefixSize = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ chars: number; sections: Record<string, number> } | null> => {
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId });
    if (!g) return null;
    const prefix = buildPrefix({ creator: g.creator, directives: g.directives, skill: "", personal: g.personal, voice: g.voice, history: g.history });
    return { chars: prefix.length, sections: { personal: g.personal.length, voice: g.voice.length, history: g.history.length, notes: JSON.stringify(g.creator.notes).length, dossier: JSON.stringify(g.creator.dossier ?? {}).length, directives: g.directives.length } };
  },
});

export const seed = internalAction({
  args: { fromHandle: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ creatorId: Id<"creators">; created: boolean; posts: number; cards: number; ideas: number; messages: number; arc: unknown; snapshots: number; indexed: number }> => {
    const now = Date.now();
    const from = a.fromHandle ?? "vanessaalopezz";
    const { creatorId, created } = await ctx.runMutation(internal.eval.longTenure.createTwin, { fromHandle: from, now });
    if (!created) return { creatorId, created, posts: 0, cards: 0, ideas: 0, messages: 0, arc: null, snapshots: 0, indexed: 0 };
    const copied = await ctx.runMutation(internal.eval.longTenure.copyPosts, { creatorId, fromHandle: from, now });
    let ideas = 0, messages = 0;
    for (let month = 0; month < 12; month++) { const r = await ctx.runMutation(internal.eval.longTenure.seedMonth, { creatorId, now, month }); ideas += r.ideas; messages += r.messages; }
    const arcResult = await ctx.runMutation(internal.eval.longTenure.seedArc, { creatorId, now });
    const style = await ctx.runMutation(internal.eval.longTenure.seedStyle, { creatorId, now });
    // The memory index: posts through the real path, notes and ideas one by one (embeddings retry on their own).
    await ctx.runAction(internal.agent.postMemory.indexAll, { creatorId });
    await ctx.scheduler.runAfter(0, internal.eval.longTenure.indexRest, { creatorId, from: 0 });
    return { creatorId, created, posts: copied.posts, cards: copied.cards, ideas, messages, arc: arcResult, snapshots: style.snapshots, indexed: 0 };
  },
});

/** Notes and ideas into the memory index, forty at a time, re-scheduling itself; the embeddings retry on their own. */
export const indexRest = internalAction({
  args: { creatorId: v.id("creators"), from: v.number() },
  handler: async (ctx, a): Promise<{ done: number; next: number | null }> => {
    const inputs = await ctx.runQuery(internal.eval.longTenure.indexInputs, { creatorId: a.creatorId });
    const batch = inputs.slice(a.from, a.from + 40);
    for (const i of batch) await ctx.runAction(internal.agent.memory.index, { creatorId: a.creatorId, kind: i.kind, refId: i.refId, text: i.text });
    const next = a.from + 40 < inputs.length ? a.from + 40 : null;
    if (next !== null) await ctx.scheduler.runAfter(1_000, internal.eval.longTenure.indexRest, { creatorId: a.creatorId, from: next });
    return { done: batch.length, next };
  },
});
