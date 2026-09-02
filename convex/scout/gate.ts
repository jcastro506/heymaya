/**
 * The gate (plan §13.8, D6): the only function that decides whether anything
 * proactive reaches a creator. Rails first, each with a named reason; then the
 * ranked candidates go to the scout skill for the two judgment calls (notable,
 * fits). Every outcome writes `signals.verdict` and `signals.why`.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { rankMultiplier, tasteHint, TASTE, type Affinity } from "../taste/affinities";
import { THRESHOLDS } from "../config/thresholds";
import { dayKeyInZone } from "../core/cadence";

export interface Rails {
  ok: boolean;
  reason?: string;
  localHour: number;
  sentToday: number;
}

/** Local hour and "HH:MM" quiet-hours arithmetic in the creator's timezone. */
export function localHourMinute(now: number, timezone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour, minute };
}

export function inQuietHours(now: number, timezone: string, quiet: { start: string; end: string }): boolean {
  const { hour, minute } = localHourMinute(now, timezone);
  const cur = hour * 60 + minute;
  const [sh, sm] = quiet.start.split(":").map(Number);
  const [eh, em] = quiet.end.split(":").map(Number);
  const s = sh * 60 + sm, e = eh * 60 + em;
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e; // overnight window wraps
}

/** The rails, read from rows. Pure given its inputs. */
export function checkRails(input: { creator: Doc<"creators">; sentToday: number; openQuestion: boolean; now: number }): Rails {
  const { creator, now } = input;
  const { hour } = localHourMinute(now, creator.timezone);
  if (creator.plan.status === "paused" || creator.plan.status === "canceled" || creator.plan.status === "deleting") return { ok: false, reason: `plan is ${creator.plan.status}`, localHour: hour, sentToday: input.sentToday };
  // §19.3: past due keeps proactive for three days of grace, then it pauses; nothing is deleted.
  if (creator.plan.status === "past_due" && creator.plan.pastDueSince && now - creator.plan.pastDueSince > 3 * 86_400_000) return { ok: false, reason: "plan is past due for more than three days", localHour: hour, sentToday: input.sentToday };
  if (!creator.channel.paired) return { ok: false, reason: "not paired", localHour: hour, sentToday: input.sentToday };
  if (inQuietHours(now, creator.timezone, creator.quietHours ?? THRESHOLDS.quietHoursDefault)) return { ok: false, reason: "quiet hours", localHour: hour, sentToday: input.sentToday };
  if (input.sentToday >= THRESHOLDS.dailyMessageCap) return { ok: false, reason: `daily cap (${THRESHOLDS.dailyMessageCap}) reached`, localHour: hour, sentToday: input.sentToday };
  if (input.openQuestion) return { ok: false, reason: "a question is still open", localHour: hour, sentToday: input.sentToday };
  return { ok: true, localHour: hour, sentToday: input.sentToday };
}

export const railsFor = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ rails: Rails; creator: Doc<"creators">; candidates: Doc<"signals">[]; tasteHints: Record<string, string>; tasteDropped: Array<{ signalId: Id<"signals">; why: string }>; exploreOpen: boolean; askStop: Array<{ trackedAccountId: Id<"trackedAccounts">; handle: string }> } | null> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!creator) return null;
    const day = dayKeyInZone(a.now, creator.timezone);
    const recent = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(50)) as Doc<"messages">[];
    const sentToday = recent.filter((m) => m.direction === "out" && m.proactive && dayKeyInZone(m.ts, creator.timezone) === day && m.kind !== "status").length;
    const openQuestion = recent.some((m) => m.direction === "out" && m.awaitingAnswer);
    const rails = checkRails({ creator, sentToday, openQuestion, now: a.now });
    const pending = (await ctx.db.query("signals").withIndex("by_creator_verdict", (q) => q.eq("creatorId", a.creatorId).eq("verdict", "pending")).collect()) as Doc<"signals">[];
    const fresh: Doc<"signals">[] = [];
    for (const s of pending) {
      if (s.kind === "calendar") {
        // The calendar rail (§13.8): the event must still be filmable, active, and ≥ 2 days ahead.
        const ev = s.calendarEventId ? ((await ctx.db.query("calendarEvents").withIndex("by_creator_external", (q) => q.eq("creatorId", a.creatorId).eq("externalId", s.calendarEventId!)).first()) as Doc<"calendarEvents"> | null) : null;
        if (ev && ev.status === "active" && ev.class === "filmable" && ev.start - a.now >= 2 * 86_400_000) fresh.push(s);
        continue;
      }
      if (a.now - s.createdAt < THRESHOLDS.breakoutMaxAgeHours * 3_600_000) fresh.push(s);
    }
    // Taste (§13.10 (5)): coarse features are known now (source kind, account); re-rank by
    // affinity and drop a hard no with the reason written, so she can say why when asked.
    const now = a.now;
    const affinities = (creator.affinities ?? []) as Affinity[];
    const tasteHints: Record<string, string> = {};
    const tasteDropped: Array<{ signalId: Id<"signals">; why: string }> = [];
    const askStop: Array<{ trackedAccountId: Id<"trackedAccounts">; handle: string }> = [];
    const ranked: Array<{ s: Doc<"signals">; rank: number }> = [];
    for (const s of fresh) {
      const keys = [`source:${s.kind}`];
      if (s.trackedAccountId) {
        const t = (await ctx.db.get(s.trackedAccountId)) as Doc<"trackedAccounts"> | null;
        if (t) keys.push(`account:@${t.handle.toLowerCase()}`);
      }
      const h = tasteHint(affinities, keys, now);
      if (h.hardNo && s.kind !== "win") {
        tasteDropped.push({ signalId: s._id, why: `taste: ${h.hardNo}` });
        if (s.trackedAccountId && h.hardNo.includes("(@")) {
          const t = (await ctx.db.get(s.trackedAccountId)) as Doc<"trackedAccounts"> | null;
          if (t && t.status === "active" && !askStop.some((x) => x.trackedAccountId === t._id)) askStop.push({ trackedAccountId: t._id, handle: t.handle });
        }
        continue;
      }
      tasteHints[s._id] = h.hint;
      ranked.push({ s, rank: s.score * rankMultiplier(h.score) });
    }
    const candidates = ranked.sort((x, y) => y.rank - x.rank).slice(0, THRESHOLDS.candidatesPerDay).map((x) => x.s);
    // The explore slot (§13.10 (6)): one idea in five outside the core.
    const lastIdeas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(TASTE.exploreEvery)) as Doc<"ideas">[];
    const exploreOpen = lastIdeas.length >= TASTE.exploreEvery && !lastIdeas.some((i) => i.newForYou);
    return { rails, creator, candidates, tasteHints, tasteDropped, exploreOpen, askStop };
  },
});

export const setVerdicts = internalMutation({
  args: { verdicts: v.array(v.object({ signalId: v.id("signals"), verdict: v.union(v.literal("sent"), v.literal("held"), v.literal("dropped")), why: v.string() })) },
  handler: async (ctx, a): Promise<null> => {
    for (const x of a.verdicts) await ctx.db.patch(x.signalId, { verdict: x.verdict, why: x.why });
    return null;
  },
});
