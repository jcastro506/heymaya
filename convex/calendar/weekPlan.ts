/**
 * The Sunday plan (plan Sprint 4b). She drafts the week as rows, says it in one message,
 * and books all of it on one tap. Nothing reaches a calendar without the tap: `book` is
 * the consent, per block, through the same `confirm` every other block uses.
 *
 * The message is composed by code, not by a model: it is a list of times and hooks, and a
 * model asked to restate five times gets one wrong. Her voice is in the framing line only.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { buildPostTimeModel } from "./postTime";
import { draftWeek, editMinutesFor, pickIdeas, type Slot } from "./planning";
import { localDateKey } from "./time";
import { localHourMinute } from "../scout/gate";

const WEEKDAY: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
/** Sunday, on their clock, after the review has had its hour. */
export const PLAN_HOUR_LOCAL = 18;

export const inputsFor = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a) => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!creator) return null;
    const tz = creator.timezone;
    const dossier = creator.dossier as { cadence?: { postsPerWeek?: number; filmingDays?: string[]; bestHoursLocal?: number[] }; fingerprint?: { medianCutSeconds?: number | "unknown" } } | undefined;
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(60)) as Doc<"ownPosts">[];
    const model = buildPostTimeModel(posts.map((p) => ({ createTime: p.createTime, multiple: p.multiple ?? null })), tz);
    const horizon = a.now + 9 * 86_400_000;
    const events = (await ctx.db.query("calendarEvents").withIndex("by_creator_start", (q) => q.eq("creatorId", a.creatorId).gte("start", a.now - 86_400_000).lte("start", horizon)).take(200)) as Doc<"calendarEvents">[];
    const blocks = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("start", a.now - 86_400_000)).take(200)) as Doc<"calendarBlocks">[];
    const ideas = (await ctx.db.query("ideas").withIndex("by_creator_status", (q) => q.eq("creatorId", a.creatorId).eq("status", "sent")).order("desc").take(40)) as Doc<"ideas">[];
    const hearted = (await ctx.db.query("ideas").withIndex("by_creator_status", (q) => q.eq("creatorId", a.creatorId).eq("status", "hearted")).order("desc").take(40)) as Doc<"ideas">[];
    const experiment = creator.experiments.filter((e) => !(e as { result?: string }).result).slice(-1)[0]?.text ?? null;
    const medianCut = dossier?.fingerprint?.medianCutSeconds;
    return {
      timezone: tz,
      postsPerWeek: dossier?.cadence?.postsPerWeek ?? 2,
      filmDays: (dossier?.cadence?.filmingDays ?? []).map((d) => WEEKDAY[d.slice(0, 3).toLowerCase()]).filter((n): n is number => typeof n === "number"),
      filmHour: creator.preferredSendHour ?? null,
      editMinutes: editMinutesFor({ medianCutSeconds: typeof medianCut === "number" ? medianCut : null }, creator.noEditBlock),
      busy: [
        ...events.filter((e) => e.status === "active" && !e.allDay).map((e) => ({ start: e.start, end: e.end })),
        ...blocks.filter((b) => b.status !== "deleted").map((b) => ({ start: b.start, end: b.end })),
      ],
      model,
      ideas: [...hearted, ...ideas].map((i) => ({
        ideaId: String(i._id),
        hook: ((i.version as { hook?: string } | undefined)?.hook ?? i.messageText.slice(0, 80)).slice(0, 90),
        // "saved" is a tap on an idea; it lives as `savedAt`, not as a status.
        status: i.savedAt ? "saved" : i.status,
        savedAt: i.savedAt ?? null,
        sentAt: i.sentAt ?? null,
      })),
      experiment,
      alreadyPlanned: blocks.some((b) => b.planKey === planKeyFor(a.now, tz) && b.status !== "deleted"),
    };
  },
});

export function planKeyFor(now: number, tz: string): string {
  return `week:${localDateKey(now, tz)}`;
}

export const write = internalMutation({
  args: { creatorId: v.id("creators"), planKey: v.string(), slots: v.any() },
  handler: async (ctx, a): Promise<{ blockIds: Id<"calendarBlocks">[] }> => {
    const now = Date.now();
    const ids: Id<"calendarBlocks">[] = [];
    for (const s of a.slots as Slot[]) {
      const ideaId = s.ideaId ? (s.ideaId as Id<"ideas">) : undefined;
      const title = (s.experiment ? `film (experiment): ${s.hook}` : `film: ${s.hook}`).slice(0, 80);
      ids.push(await ctx.db.insert("calendarBlocks", { creatorId: a.creatorId, kind: "film", start: s.film.start, end: s.film.end, title, ideaId, planKey: a.planKey, status: "proposed", createdAt: now }));
      if (s.edit) ids.push(await ctx.db.insert("calendarBlocks", { creatorId: a.creatorId, kind: "edit", start: s.edit.start, end: s.edit.end, title: `edit: ${s.hook}`.slice(0, 80), ideaId, planKey: a.planKey, status: "proposed", createdAt: now }));
      ids.push(await ctx.db.insert("calendarBlocks", { creatorId: a.creatorId, kind: "post", start: s.post.at, end: s.post.at + 15 * 60_000, title: `post: ${s.hook}`.slice(0, 80), ideaId, planKey: a.planKey, status: "proposed", createdAt: now }));
    }
    return { blockIds: ids };
  },
});

/** The week, as she'd text it. Deterministic. */
export function composeWeek(slots: Slot[], tz: string, fromHistory: boolean): string {
  const lines = slots.map((s) => {
    const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(s.film.start).toLowerCase();
    const t = (e: number) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(e).toLowerCase().replace(":00", "");
    const edit = s.edit ? `, edit ${t(s.edit.start)}` : "";
    return `${day} ${t(s.film.start)} film${edit}, post ${t(s.post.at)} — ${s.hook}${s.experiment ? " (this week's experiment)" : ""}`;
  });
  const basis = fromHistory ? "post times are your best hours from your own numbers." : "post times are a default until i've seen more of your posts.";
  return `next week, ${slots.length} post${slots.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}\n\n${basis} book it and i'll put the blocks on your calendar and check in before each one. move any of them by telling me.`;
}

export const draft = internalAction({
  args: { creatorId: v.id("creators"), now: v.optional(v.number()), force: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ sent: boolean; reason: string; planKey?: string; slots?: number }> => {
    const now = a.now ?? Date.now();
    const g = await ctx.runQuery(internal.scout.gate.railsFor, { creatorId: a.creatorId, now });
    if (!g) return { sent: false, reason: "creator not found" };
    // Paired and on a live plan; the daily cap does not apply to the week's one message.
    if (!g.creator.channel.paired) return { sent: false, reason: "not paired" };
    if (["paused", "canceled", "deleting"].includes(g.creator.plan.status)) return { sent: false, reason: `plan is ${g.creator.plan.status}` };
    const inp = await ctx.runQuery(internal.calendar.weekPlan.inputsFor, { creatorId: a.creatorId, now });
    if (!inp) return { sent: false, reason: "creator not found" };
    if (inp.alreadyPlanned && !a.force) return { sent: false, reason: "this week is already planned" };
    const picked = pickIdeas(inp.ideas, Math.max(1, Math.min(5, Math.round(inp.postsPerWeek) || 1)), inp.experiment);
    if (picked.length === 0) return { sent: false, reason: "nothing to plan with: no ideas and no experiment" };
    const slots = draftWeek({ now, timeZone: inp.timezone, postsPerWeek: inp.postsPerWeek, filmDays: inp.filmDays, filmHour: inp.filmHour, editMinutes: inp.editMinutes, busy: inp.busy, model: inp.model, ideas: picked });
    if (slots.length === 0) return { sent: false, reason: "no free time found in the week" };
    const planKey = planKeyFor(now, inp.timezone);
    await ctx.runMutation(internal.calendar.weekPlan.write, { creatorId: a.creatorId, planKey, slots });
    const body = composeWeek(slots, inp.timezone, inp.model.hours.length > 0);
    // One question for the whole week: this IS the open question, and it supersedes any other.
    await ctx.runMutation(internal.core.messages.closeOpen, { creatorId: a.creatorId });
    await ctx.runMutation(internal.core.messages.send, {
      creatorId: a.creatorId, surface: "telegram", body, dedupeKey: `plan:${planKey}`, proactive: true, kind: "plan", awaitingAnswer: true,
      buttons: [{ id: `plan:${planKey}:book`, label: "book it" }, { id: `plan:${planKey}:skip`, label: "not this week" }],
    });
    return { sent: true, reason: "planned", planKey, slots: slots.length };
  },
});

export const blocksOf = internalQuery({
  args: { creatorId: v.id("creators"), planKey: v.string() },
  handler: async (ctx, a): Promise<Doc<"calendarBlocks">[]> =>
    ((await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(300)) as Doc<"calendarBlocks">[]).filter((b) => b.planKey === a.planKey && b.status !== "deleted"),
});

/** Their tap: consent on every block, the calendar writes where connected, reminders scheduled. */
export const book = internalAction({
  args: { creatorId: v.id("creators"), planKey: v.string() },
  handler: async (ctx, a): Promise<{ booked: number; written: number; reason?: string }> => {
    const blocks = await ctx.runQuery(internal.calendar.weekPlan.blocksOf, { creatorId: a.creatorId, planKey: a.planKey });
    if (blocks.length === 0) return { booked: 0, written: 0, reason: "no plan under that key" };
    let written = 0;
    for (const b of blocks) {
      const r = await ctx.runAction(internal.calendar.blocks.confirm, { blockId: b._id });
      if (r.ok) written++;
      if (b.kind === "film" || b.kind === "post") await ctx.runAction(internal.calendar.reminders.scheduleFor, { blockId: b._id });
    }
    return { booked: blocks.length, written };
  },
});

export const skip = internalMutation({
  args: { creatorId: v.id("creators"), planKey: v.string() },
  handler: async (ctx, a): Promise<{ dropped: number }> => {
    const blocks = ((await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(300)) as Doc<"calendarBlocks">[]).filter((b) => b.planKey === a.planKey && b.status !== "deleted");
    for (const b of blocks) await ctx.db.patch(b._id, { status: "deleted" });
    return { dropped: blocks.length };
  },
});

export const due = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, a): Promise<Id<"creators">[]> => {
    const creators = (await ctx.db.query("creators").take(500)) as Doc<"creators">[];
    return creators
      .filter((c) => c.channel.paired && c.dossier)
      .filter((c) => {
        const { hour } = localHourMinute(a.now, c.timezone);
        const weekday = new Date(new Intl.DateTimeFormat("en-US", { timeZone: c.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(a.now)).getDay();
        return weekday === 0 && hour === PLAN_HOUR_LOCAL;
      })
      .map((c) => c._id);
  },
});

/** Hourly: whoever is at Sunday PLAN_HOUR_LOCAL on their own clock gets their week. */
export const runAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ due: number; planned: number }> => {
    const now = Date.now();
    const ids = await ctx.runQuery(internal.calendar.weekPlan.due, { now });
    let planned = 0;
    for (const creatorId of ids) {
      const r = await ctx.runAction(internal.calendar.weekPlan.draft, { creatorId, now });
      if (r.sent) planned++;
    }
    return { due: ids.length, planned };
  },
});

