/**
 * When she texts first (docs/CREATOR_REACH_OUT.md, 2026-10-09). The first tester found her annoying:
 * fifteen reasons to text, each on its own timer, under one cap half of them skipped. Now every
 * proactive text has a lane, and each lane a budget, held inside `messages.send` so no path can skip it.
 *
 *   asked   what they asked for (routines, booked-session reminders, the Sunday plan, the review): no budget
 *   setup   her hello, first read and onboarding notices, in the first days: no budget
 *   theirs  their own stuff today (a shoot, a missed one, how'd it go, their post popping, a brand reply): 2 a day
 *   hers    what she thought of (an idea, a callback, a milestone, a nudge): their pace, from day one
 *
 * Quiet hours, their pause and the phone rail still apply to every lane. Pure; one definition.
 */
import { dayKeyInZone } from "./cadence";

export type Lane = "asked" | "setup" | "theirs" | "hers";
export type Pace = "less" | "normal" | "more";

export const REACH_OUT = {
  /** Their own stuff today, a day. */
  theirsPerDay: 2,
  /** What she starts outside what they asked for, a day, all lanes. */
  startedPerDay: 3,
  /** Onboarding notices (hello, the first glance, the favorites offer) count as setup this long after pairing. */
  setupMs: 3 * 86_400_000,
} as const;

const ASKED = new Set(["routine", "reminder", "plan", "review"]);
const SETUP = new Set(["hello", "first_read", "cover", "status"]);
const THEIRS = new Set(["morning", "shoot_today", "missed", "checkin", "saw_it", "post_read", "event_today", "partnership", "calendar"]);

/** Pure: the lane a text is in. `status` and `cover` are setup only in the first days; after that they are hers. */
export function laneFor(kind: string | undefined, sinceSetupMs: number | null): Lane {
  const k = kind ?? "";
  if (ASKED.has(k)) return "asked";
  if (k === "hello" || k === "first_read") return "setup";
  if (SETUP.has(k) && sinceSetupMs !== null && sinceSetupMs >= 0 && sinceSetupMs < REACH_OUT.setupMs) return "setup";
  if (THEIRS.has(k)) return "theirs";
  return "hers";
}

export interface Sent { ts: number; kind?: string }

/**
 * Pure: why this proactive text must wait, or null when it may go. `sent` is what she started in the last
 * three days (direction out, proactive), any lane.
 */
export function reachOutHold(input: { kind: string | undefined; now: number; timezone: string; pairedAt?: number; pace?: Pace; sent: Sent[] }): string | null {
  const { now, timezone, pairedAt } = input;
  const since = (ts: number) => (pairedAt ? ts - pairedAt : null);
  const lane = laneFor(input.kind, since(now));
  if (lane === "asked" || lane === "setup") return null;
  const today = dayKeyInZone(now, timezone);
  const counted = input.sent.map((m) => ({ ...m, lane: laneFor(m.kind, since(m.ts)) })).filter((m) => m.lane === "theirs" || m.lane === "hers");
  const todays = counted.filter((m) => dayKeyInZone(m.ts, timezone) === today);
  if (todays.length >= REACH_OUT.startedPerDay) return `she's already texted first ${todays.length} times today`;
  if (lane === "theirs") {
    const n = todays.filter((m) => m.lane === "theirs").length;
    return n >= REACH_OUT.theirsPerDay ? `${n} texts about their day already` : null;
  }
  // No quiet start (2026-10-21, operator): the first days are when someone's most curious; three silent days lost a tester.
  const hers = counted.filter((m) => m.lane === "hers");
  const pace = input.pace ?? "normal";
  if (pace === "less") return hers.some((m) => now - m.ts < 3 * 86_400_000) ? "they asked for fewer texts (one every few days)" : null;
  const herToday = hers.filter((m) => dayKeyInZone(m.ts, timezone) === today).length;
  const allowed = pace === "more" ? 2 : 1;
  return herToday >= allowed ? `already texted them something of hers today (${herToday} of ${allowed})` : null;
}
