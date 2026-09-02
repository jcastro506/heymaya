/**
 * The gate (plan §13.8, D6): the only function that decides whether anything
 * proactive reaches a creator. Rails first, each with a named reason; then the
 * ranked candidates go to the scout skill for the two judgment calls (notable,
 * fits). Every outcome writes `signals.verdict` and `signals.why`.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
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
  if (!creator.channel.paired) return { ok: false, reason: "not paired", localHour: hour, sentToday: input.sentToday };
  if (inQuietHours(now, creator.timezone, creator.quietHours ?? THRESHOLDS.quietHoursDefault)) return { ok: false, reason: "quiet hours", localHour: hour, sentToday: input.sentToday };
  if (input.sentToday >= THRESHOLDS.dailyMessageCap) return { ok: false, reason: `daily cap (${THRESHOLDS.dailyMessageCap}) reached`, localHour: hour, sentToday: input.sentToday };
  if (input.openQuestion) return { ok: false, reason: "a question is still open", localHour: hour, sentToday: input.sentToday };
  return { ok: true, localHour: hour, sentToday: input.sentToday };
}

export const railsFor = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ rails: Rails; creator: Doc<"creators">; candidates: Doc<"signals">[] } | null> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!creator) return null;
    const day = dayKeyInZone(a.now, creator.timezone);
    const recent = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(50)) as Doc<"messages">[];
    const sentToday = recent.filter((m) => m.direction === "out" && m.proactive && dayKeyInZone(m.ts, creator.timezone) === day && m.kind !== "status").length;
    const openQuestion = recent.some((m) => m.direction === "out" && m.awaitingAnswer);
    const rails = checkRails({ creator, sentToday, openQuestion, now: a.now });
    const pending = (await ctx.db.query("signals").withIndex("by_creator_verdict", (q) => q.eq("creatorId", a.creatorId).eq("verdict", "pending")).collect()) as Doc<"signals">[];
    const fresh = pending.filter((s) => a.now - s.createdAt < THRESHOLDS.breakoutMaxAgeHours * 3_600_000);
    const candidates = fresh.sort((x, y) => y.score - x.score).slice(0, THRESHOLDS.candidatesPerDay);
    return { rails, creator, candidates };
  },
});

export const setVerdicts = internalMutation({
  args: { verdicts: v.array(v.object({ signalId: v.id("signals"), verdict: v.union(v.literal("sent"), v.literal("held"), v.literal("dropped")), why: v.string() })) },
  handler: async (ctx, a): Promise<null> => {
    for (const x of a.verdicts) await ctx.db.patch(x.signalId, { verdict: x.verdict, why: x.why });
    return null;
  },
});
