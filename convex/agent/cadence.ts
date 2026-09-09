/**
 * The human cadence (plan §24, Sprint 7). The things a person who works with you says that
 * ask nothing: a line in the morning when there is something to say, "how'd it go?" the
 * evening after a shoot, "thursday didn't happen" the morning after, a viewer's reaction
 * when they post, "you alright?" when they go quiet. Code finds the reasons from rows and
 * holds the rails; the writer says them in her voice; silence when the reasons are empty.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { deliverNow } from "../core/scheduler";
import { dayKeyInZone } from "../core/cadence";
import { REGISTRY } from "./registry";
import { buildPrefix, producedStamp } from "./context";
import { critique } from "./critic";
import { pickMilestone } from "./history";
import { localHourMinute } from "../scout/gate";
import { THRESHOLDS } from "../config/thresholds";

export const CADENCE = {
  morningHour: 8,
  quietHourLocal: 18,
  /** "how'd it go" fires in this window after a film block ends. */
  howDidItGoAfterMs: 90 * 60_000,
  howDidItGoUntilMs: 6 * 60 * 60_000,
  /** A post older than this is not "when they post"; the review will see it. */
  sawItMaxAgeMs: 36 * 60 * 60_000,
  quietAfterDays: 7,
  streakWeeks: 3,
} as const;

export const MORNING_SKILL = `morning (one line, only because there is something)
When: it is morning on their clock and code found something true about today: a shoot on the calendar, something of theirs on the calendar, a milestone, or a block yesterday that did not happen.
The judgment: say it the way a friend texts in the morning. One or two short lines, under 45 words, every fact from the list you were given and nothing else. A shoot today gets the time and the hook. A missed block gets named plainly with no guilt ("thursday didn't happen") and the question is whether to put it back; the buttons carry that, so end on the question. A milestone gets one honest sentence, no confetti. No question when nothing needs deciding. No "good morning" as filler; the line IS the good morning.
Output the text only.`;

export const SAW_IT_SKILL = `saw it (a viewer's line when they post)
When: they posted and you watched it; you have the card and the caption.
The judgment: react as a viewer first, one line, under 30 words: the moment that landed, named from the card. No numbers of any kind, no advice, no question, no "great job". If the card says the post is thin, say the one thing you liked and stop.
Output the text only.`;

export const QUIET_SKILL = `quiet (they have gone quiet)
When: they have not written in a week and you have sent several things. You do not know why.
The judgment: one warm line, under 30 words, that asks nothing they have to answer: you are still around, no pressure, and if the prefix carries something of theirs worth calling back (a race, a trip, a bit), one clause on it. Never "just checking in", never a guilt trip, never a list of what they missed. At most one question mark and it must not require an answer.
Output the text only.`;

/* -------------------------------------------------------------------------- */
/* Pure                                                                        */
/* -------------------------------------------------------------------------- */

export interface Reason { kind: "shoot_today" | "event_today" | "missed" | "milestone" | "streak"; text: string; blockId?: Id<"calendarBlocks">; milestoneKey?: string }

const fmtTime = (e: number, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(e).toLowerCase().replace(":00", "");
const hookOf = (title: string) => title.replace(/^(film|edit|post)( \(experiment\))?: /, "");

/** The morning's reasons, from rows. Pure. Empty means silence. */
export function morningReasons(input: {
  now: number;
  timezone: string;
  blocks: Array<{ _id: Id<"calendarBlocks">; kind: string; start: number; end: number; title: string; status: string; filmedAt?: number; missedAt?: number; consentAt?: number }>;
  events: Array<{ title: string; start: number; class: string; status: string; allDay: boolean }>;
  milestone: { key: string; line: string } | null;
  streakWeeks: number;
  said: string[];
}): Reason[] {
  const { now, timezone } = input;
  const today = dayKeyInZone(now, timezone);
  const yesterday = dayKeyInZone(now - 86_400_000, timezone);
  const out: Reason[] = [];
  for (const b of input.blocks) {
    if (b.status === "deleted" || !b.consentAt) continue;
    const day = dayKeyInZone(b.start, timezone);
    if (day === today && b.start > now && (b.kind === "film" || b.kind === "post")) out.push({ kind: "shoot_today", text: `${b.kind === "film" ? "filming" : "posting"} today at ${fmtTime(b.start, timezone)}: ${hookOf(b.title)}`, blockId: b._id });
    if (day === yesterday && b.kind === "film" && b.end < now && !b.filmedAt && !b.missedAt) out.push({ kind: "missed", text: `yesterday's block (${hookOf(b.title)}, ${fmtTime(b.start, timezone)}) did not happen; ask whether to put it back`, blockId: b._id });
  }
  for (const e of input.events) {
    if (e.status !== "active" || e.class === "private" || e.class === "routine") continue;
    if (dayKeyInZone(e.start, timezone) === today) out.push({ kind: "event_today", text: `on their calendar today: ${e.title}${e.allDay ? "" : ` at ${fmtTime(e.start, timezone)}`}` });
  }
  if (input.milestone) out.push({ kind: "milestone", text: input.milestone.line, milestoneKey: input.milestone.key });
  const streakKey = `streak:${CADENCE.streakWeeks}w`;
  if (input.streakWeeks >= CADENCE.streakWeeks && !input.said.includes(streakKey)) out.push({ kind: "streak", text: `${input.streakWeeks} weeks in a row on their own plan; say it once`, milestoneKey: streakKey });
  const order: Reason["kind"][] = ["shoot_today", "missed", "event_today", "milestone", "streak"];
  return out.sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind)).slice(0, 3);
}

/** Weeks in a row, ending last week, where they posted at least their planned number. Pure. */
export function streakWeeks(input: { now: number; timezone: string; postsPerWeek: number | null; postTimes: number[] }): number {
  if (!input.postsPerWeek || input.postsPerWeek <= 0) return 0;
  const week = 7 * 86_400_000;
  let n = 0;
  for (let w = 1; w <= 12; w++) {
    const end = input.now - (w - 1) * week;
    const start = end - week;
    const count = input.postTimes.filter((t) => t >= start && t < end).length;
    if (count >= input.postsPerWeek) n += 1; else break;
  }
  return n;
}

/** 8 on their clock, or the hour their quiet hours end when that is later ("no messages before 10am" means the morning line is at 10). Pure. */
export function morningHourFor(quiet: { start: string; end: string } | undefined): number {
  const end = Number((quiet?.end ?? "07:00").split(":")[0]);
  return Number.isFinite(end) && end > CADENCE.morningHour ? end : CADENCE.morningHour;
}

/** Followers crossing a round number, once each. Pure. */
export function followerMilestone(followers: number | null, said: string[]): { key: string; line: string } | null {
  if (followers === null) return null;
  const crossed = [1_000_000, 100_000, 10_000, 1_000].find((n) => followers >= n);
  if (!crossed) return null;
  const key = `followers:${crossed}`;
  if (said.includes(key)) return null;
  return { key, line: `you crossed ${crossed >= 1_000_000 ? "a million" : `${crossed / 1000}k`} followers. that's people choosing to see more of you.` };
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

export const dueNow = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, a): Promise<Array<{ creatorId: Id<"creators">; touch: "morning" | "quiet" }>> => {
    const creators = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    const out: Array<{ creatorId: Id<"creators">; touch: "morning" | "quiet" }> = [];
    for (const c of creators) {
      if (!c.channel.paired || c.plan.status === "paused" || c.plan.status === "canceled" || c.plan.status === "deleting" || c.plan.status === "onboarding") continue;
      const { hour } = localHourMinute(a.now, c.timezone);
      if (hour === morningHourFor(c.quietHours)) out.push({ creatorId: c._id, touch: "morning" });
      if (hour === CADENCE.quietHourLocal) out.push({ creatorId: c._id, touch: "quiet" });
    }
    return out;
  },
});

export const morningInputs = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ creator: Doc<"creators">; blocks: Doc<"calendarBlocks">[]; events: Doc<"calendarEvents">[]; milestone: { key: string; line: string } | null; said: string[]; streak: number } | null> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!creator) return null;
    const from = a.now - 2 * 86_400_000, to = a.now + 86_400_000;
    const blocks = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("start", from).lte("start", to)).collect()) as Doc<"calendarBlocks">[];
    const events = (await ctx.db.query("calendarEvents").withIndex("by_creator_start", (q) => q.eq("creatorId", a.creatorId).gte("start", a.now - 86_400_000).lte("start", to)).collect()) as Doc<"calendarEvents">[];
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("createTime", a.now - 13 * 7 * 86_400_000)).collect()) as Doc<"ownPosts">[];
    const snaps = (await ctx.db.query("followerSnapshots").withIndex("by_creator_day", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(4)) as Doc<"followerSnapshots">[];
    const mi = await ctx.runQuery(internal.agent.history.milestoneInputs, { creatorId: a.creatorId });
    const said = creator.milestonesSaid ?? [];
    const followers = snaps.length ? snaps.reduce((s, r) => s + r.followers, 0) : null;
    const milestone = followerMilestone(followers, said) ?? (mi ? pickMilestone(mi) : null);
    const postsPerWeek = (creator.dossier as { cadence?: { postsPerWeek?: number } } | undefined)?.cadence?.postsPerWeek ?? null;
    return { creator, blocks, events, milestone, said, streak: streakWeeks({ now: a.now, timezone: creator.timezone, postsPerWeek, postTimes: posts.map((p) => p.createTime) }) };
  },
});

/** A confirmed film block that ended unfilmed in the window, not yet asked. */
export const shootToAskAbout = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<Doc<"calendarBlocks"> | null> => {
    const blocks = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("start", a.now - 12 * 3_600_000).lte("start", a.now)).collect()) as Doc<"calendarBlocks">[];
    return blocks.find((b) => b.kind === "film" && b.status !== "deleted" && b.consentAt && !b.filmedAt && !b.missedAt && a.now - b.end >= CADENCE.howDidItGoAfterMs && a.now - b.end <= CADENCE.howDidItGoUntilMs && !(b.touches ?? []).includes("howdidit")) ?? null;
  },
});

export const markMissed = internalMutation({
  args: { creatorId: v.id("creators"), blockId: v.id("calendarBlocks") },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const b = (await ctx.db.get(a.blockId)) as Doc<"calendarBlocks"> | null;
    if (!b || b.creatorId !== a.creatorId) return { ok: false };
    await ctx.db.patch(a.blockId, { missedAt: Date.now() });
    return { ok: true };
  },
});

export const forYouCountThisWeek = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<number> => {
    const rows = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.now - 7 * 86_400_000)).collect()) as Doc<"messages">[];
    return rows.filter((m) => m.direction === "out" && m.kind === "for_you").length;
  },
});

/* -------------------------------------------------------------------------- */
/* The touches                                                                */
/* -------------------------------------------------------------------------- */

async function railsOk(ctx: { runQuery: (ref: never, a: never) => Promise<unknown> }, creatorId: Id<"creators">, now: number): Promise<{ ok: boolean; reason?: string }> {
  const r = (await (ctx as unknown as { runQuery: (ref: typeof internal.scout.gate.railsOnly, a: { creatorId: Id<"creators">; now: number }) => Promise<{ ok: boolean; reason?: string } | null> }).runQuery(internal.scout.gate.railsOnly, { creatorId, now }));
  return r ?? { ok: false, reason: "creator not found" };
}

export const runAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const now = Date.now();
    const due = await ctx.runQuery(internal.agent.cadence.dueNow, { now });
    for (const d of due) await ctx.scheduler.runAfter(0, d.touch === "morning" ? internal.agent.cadence.morning : internal.agent.cadence.quiet, { creatorId: d.creatorId });
    // The evening question runs on its own window, every hour, for everyone paired.
    await ctx.scheduler.runAfter(0, internal.agent.cadence.howDidItGoAll, {});
    return { scheduled: due.length };
  },
});

/** The morning line: one, only because there is something. */
export const morning = internalAction({
  args: { creatorId: v.id("creators"), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ sent: boolean; reason: string }> => {
    const now = a.now ?? Date.now();
    const inp = await ctx.runQuery(internal.agent.cadence.morningInputs, { creatorId: a.creatorId, now });
    if (!inp) return { sent: false, reason: "creator not found" };
    const reasons = morningReasons({ now, timezone: inp.creator.timezone, blocks: inp.blocks, events: inp.events, milestone: inp.milestone, streakWeeks: inp.streak, said: inp.said });
    if (!reasons.length) return { sent: false, reason: "nothing to say" };
    const rails = await railsOk(ctx as never, a.creatorId, now);
    if (!rails.ok) return { sent: false, reason: rails.reason ?? "rails" };
    const day = dayKeyInZone(now, inp.creator.timezone);
    const gathered = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId });
    if (!gathered) return { sent: false, reason: "creator not found" };
    const prefix = buildPrefix({ creator: gathered.creator, directives: gathered.directives, skill: MORNING_SKILL, personal: gathered.personal, voice: gathered.voice, history: gathered.history });
    const spec = REGISTRY.writer;
    const r = await callModel(ctx, { creatorId: a.creatorId, purpose: "morning", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `True this morning (say these, nothing else):\n${reasons.map((x) => `- ${x.text}`).join("\n")}\n\nWrite the line.` }], temperature: 0.6, maxTokens: 160, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
    let text = r.ok ? r.content.trim() : "";
    if (!text) return { sent: false, reason: "no line" };
    const verdict = await critique(ctx, { creatorId: a.creatorId, kind: "reply", text, evidence: { reasons: reasons.map((x) => x.text) }, voice: {}, directives: gathered.directives.map((d) => d.verbatim) });
    if (!verdict.pass) {
      const rw = await callModel(ctx, { creatorId: a.creatorId, purpose: "morning_rewrite", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `True this morning:\n${reasons.map((x) => `- ${x.text}`).join("\n")}\n\nYour line was rejected for: ${verdict.problems.join(", ")} (${verdict.note}). Write it again, fixing exactly that. Text only.` }], temperature: 0.5, maxTokens: 160, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      if (rw.ok && rw.content.trim()) text = rw.content.trim();
    }
    const missed = reasons.find((x) => x.kind === "missed");
    const buttons = missed?.blockId ? [{ id: `missed:${missed.blockId}:rebook`, label: "put it back" }, { id: `missed:${missed.blockId}:drop`, label: "let it go" }] : undefined;
    if (buttons) await ctx.runMutation(internal.core.messages.closeOpen, { creatorId: a.creatorId });
    const sent = await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: text, dedupeKey: `morning:${day}`, proactive: true, kind: "morning", awaitingAnswer: Boolean(buttons), buttons, produced: producedStamp(spec.primary), criticSkipped: verdict.skipped === true });
    if (!sent.sent) return { sent: false, reason: "already said this morning" };
    for (const x of reasons) if (x.milestoneKey) await ctx.runMutation(internal.agent.history.markSaid, { creatorId: a.creatorId, key: x.milestoneKey });
    await deliverNow(ctx as never);
    return { sent: true, reason: reasons.map((x) => x.kind).join(",") };
  },
});

/** The evening question after a shoot. Code text: it is the same three words a friend uses. */
export const howDidItGoAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ asked: number }> => {
    const now = Date.now();
    const creators = await ctx.runQuery(internal.scout.readback.pairedCreators, {});
    let asked = 0;
    for (const c of creators) {
      const r = await ctx.runAction(internal.agent.cadence.howDidItGo, { creatorId: c.id, now });
      if (r.sent) asked += 1;
    }
    return { asked };
  },
});

export const howDidItGo = internalAction({
  args: { creatorId: v.id("creators"), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ sent: boolean; reason: string }> => {
    const now = a.now ?? Date.now();
    const block = await ctx.runQuery(internal.agent.cadence.shootToAskAbout, { creatorId: a.creatorId, now });
    if (!block) return { sent: false, reason: "no shoot to ask about" };
    const rails = await railsOk(ctx as never, a.creatorId, now);
    if (!rails.ok) return { sent: false, reason: rails.reason ?? "rails" };
    const hook = hookOf(block.title).replace(/^the\s+/i, "");
    await ctx.runMutation(internal.core.messages.closeOpen, { creatorId: a.creatorId });
    const sent = await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: `how'd the ${hook} shoot go?`, dedupeKey: `howdidit:${block._id}`, proactive: true, kind: "checkin", awaitingAnswer: true, buttons: [{ id: `shot:${block._id}:yes`, label: "filmed it" }, { id: `shot:${block._id}:no`, label: "didn't happen" }] });
    await ctx.runMutation(internal.calendar.reminders.touched, { blockId: block._id, touch: "howdidit" });
    if (!sent.sent) return { sent: false, reason: "already asked" };
    await deliverNow(ctx as never);
    return { sent: true, reason: "asked" };
  },
});

/** A viewer's line when they post: from the readback, within the hour of noticing. */
export const sawIt = internalAction({
  args: { creatorId: v.id("creators"), ownPostId: v.id("ownPosts"), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ sent: boolean; reason: string }> => {
    const now = a.now ?? Date.now();
    const post = await ctx.runQuery(internal.agent.cadence.postWithCard, { creatorId: a.creatorId, ownPostId: a.ownPostId });
    if (!post) return { sent: false, reason: "not their post" };
    if (now - post.createTime > CADENCE.sawItMaxAgeMs) return { sent: false, reason: "not new" };
    const rails = await railsOk(ctx as never, a.creatorId, now);
    if (!rails.ok) return { sent: false, reason: rails.reason ?? "rails" };
    const gathered = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId });
    if (!gathered) return { sent: false, reason: "creator not found" };
    const prefix = buildPrefix({ creator: gathered.creator, directives: gathered.directives, skill: SAW_IT_SKILL, personal: gathered.personal, voice: gathered.voice, history: gathered.history });
    const spec = REGISTRY.writer;
    const r = await callModel(ctx, { creatorId: a.creatorId, purpose: "saw_it", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `They just posted. Caption: ${JSON.stringify(post.caption.slice(0, 300))}\nWhat you saw (the card): ${JSON.stringify(post.card ?? "no card; react to the caption only")}\n\nOne line, as a viewer.` }], temperature: 0.7, maxTokens: 120, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
    let text = r.ok ? r.content.trim() : "";
    if (!text) return { sent: false, reason: "no line" };
    // No numbers of any kind: a viewer does not open with a count.
    if (/\d/.test(text)) {
      const rw = await callModel(ctx, { creatorId: a.creatorId, purpose: "saw_it_rewrite", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `Your line had a number in it. A viewer does not open with a count. Say the moment you liked, no digits. Text only.\n\nYour line: ${text}` }], temperature: 0.5, maxTokens: 120, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      text = rw.ok && rw.content.trim() && !/\d/.test(rw.content) ? rw.content.trim() : "";
      if (!text) return { sent: false, reason: "could not say it without a number" };
    }
    const sent = await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: text, dedupeKey: `sawit:${a.ownPostId}`, proactive: true, kind: "saw_it", links: [post.url], produced: producedStamp(spec.primary) });
    if (!sent.sent) return { sent: false, reason: "already said" };
    await deliverNow(ctx as never);
    return { sent: true, reason: "said" };
  },
});

export const postWithCard = internalQuery({
  args: { creatorId: v.id("creators"), ownPostId: v.id("ownPosts") },
  handler: async (ctx, a): Promise<{ createTime: number; caption: string; url: string; card: unknown } | null> => {
    const p = (await ctx.db.get(a.ownPostId)) as Doc<"ownPosts"> | null;
    if (!p || p.creatorId !== a.creatorId) return null;
    const read = (await ctx.db.query("ownPostReads").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(50)) as Doc<"ownPostReads">[];
    const card = read.find((r) => r.ownPostId === a.ownPostId)?.card ?? null;
    return { createTime: p.createTime, caption: p.caption, url: p.url, card };
  },
});

/** "you alright? no pressure." Once a month at most, only when the pulse says silent for a week. */
export const quiet = internalAction({
  args: { creatorId: v.id("creators"), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ sent: boolean; reason: string }> => {
    const now = a.now ?? Date.now();
    const pulse = await ctx.runQuery(internal.review.pulse.pulseFor, { creatorId: a.creatorId, now });
    if (!pulse) return { sent: false, reason: "creator not found" };
    if (pulse.daysSinceLastReply === null || pulse.daysSinceLastReply < CADENCE.quietAfterDays || pulse.month.sent < 3) return { sent: false, reason: "not quiet" };
    const gathered = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId });
    if (!gathered) return { sent: false, reason: "creator not found" };
    const monthKey = dayKeyInZone(now, gathered.creator.timezone).slice(0, 7);
    if ((gathered.creator.milestonesSaid ?? []).includes(`quiet:${monthKey}`)) return { sent: false, reason: "asked this month" };
    const rails = await railsOk(ctx as never, a.creatorId, now);
    if (!rails.ok) return { sent: false, reason: rails.reason ?? "rails" };
    const prefix = buildPrefix({ creator: gathered.creator, directives: gathered.directives, skill: QUIET_SKILL, personal: gathered.personal, voice: gathered.voice, history: gathered.history });
    const spec = REGISTRY.writer;
    const r = await callModel(ctx, { creatorId: a.creatorId, purpose: "quiet", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `They have not written in ${pulse.daysSinceLastReply} days. Write the line.` }], temperature: 0.7, maxTokens: 120, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
    const text = r.ok ? r.content.trim() : "";
    if (!text) return { sent: false, reason: "no line" };
    const sent = await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: text, dedupeKey: `quiet:${monthKey}`, proactive: true, kind: "quiet", produced: producedStamp(spec.primary) });
    if (!sent.sent) return { sent: false, reason: "already said" };
    await ctx.runMutation(internal.agent.history.markSaid, { creatorId: a.creatorId, key: `quiet:${monthKey}` });
    await deliverNow(ctx as never);
    return { sent: true, reason: "said" };
  },
});

/** "saw this, thought of you": the scout names it on a day it has no idea; this holds the weekly count. */
export const forYou = internalAction({
  args: { creatorId: v.id("creators"), postId: v.string(), url: v.string(), line: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ sent: boolean; reason: string }> => {
    const now = a.now ?? Date.now();
    const line = a.line.replace(/[*_`#>]+/g, "").trim().slice(0, 240);
    if (!line) return { sent: false, reason: "no line" };
    const count = await ctx.runQuery(internal.agent.cadence.forYouCountThisWeek, { creatorId: a.creatorId, now });
    if (count >= THRESHOLDS.forYouPerWeek) return { sent: false, reason: `${count} this week already (cap ${THRESHOLDS.forYouPerWeek})` };
    const rails = await railsOk(ctx as never, a.creatorId, now);
    if (!rails.ok) return { sent: false, reason: rails.reason ?? "rails" };
    const body = line.includes(a.url) ? line : `${line}\n\n${a.url}`;
    const sent = await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body, dedupeKey: `foryou:${a.postId}`, proactive: true, kind: "for_you", links: [a.url] });
    if (!sent.sent) return { sent: false, reason: "already shared" };
    await deliverNow(ctx as never);
    return { sent: true, reason: "shared" };
  },
});

/** Dev only: a confirmed film block at an offset from now, so a touch can be exercised on a real chat without a calendar. */
export const devSeedBlock = internalMutation({
  args: { creatorId: v.id("creators"), startOffsetMin: v.number(), lengthMin: v.optional(v.number()), title: v.optional(v.string()) },
  handler: async (ctx, a): Promise<Id<"calendarBlocks">> => {
    const now = Date.now();
    const start = now + a.startOffsetMin * 60_000;
    return await ctx.db.insert("calendarBlocks", { creatorId: a.creatorId, kind: "film", title: a.title ?? "film: the do i regret it cut", status: "confirmed", consentAt: now - 86_400_000, touches: [], start, end: start + (a.lengthMin ?? 60) * 60_000, createdAt: now - 86_400_000 } as never);
  },
});
