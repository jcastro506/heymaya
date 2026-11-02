/**
 * When she texts first: ONE attention budget (2026-11-02). Before, four rules decided separately (the lanes
 * here, the editor's hold, the daily cap, the phone rail's silence ladder), and together they produced
 * eight days of nothing for a paying tester: three unanswered texts meant "quiet until they write",
 * including the Sunday plan and every deal. This is now the one place that decides, held inside
 * `messages.send` for every proactive text on every channel.
 *
 *   asked   what they asked for (routines, booked-session reminders, the plan, the review): always
 *   setup   her hello, first read and onboarding notices, in the first days: always
 *   theirs  their own stuff (a shoot today, their post, a brand reply): up to 2 a day while they're talking
 *           to her (wrote in the last 3 days); after that it's budgeted like hers
 *   hers    what she thought of: by how they've been answering
 *
 *   day one (first 24h)        two of hers: the first idea, and one later that day
 *   engaged (0–1 unanswered)   one a day at their pace ("more": two; "less": one every 3 days);
 *                              never a second while the first is unanswered, until the next day
 *   cooling (2–3 unanswered)   one every 3 days
 *   quiet (4+ unanswered)      one a week. Never zero: someone paying hears her best thing weekly
 *
 * Three started a day across everything, at most. Quiet hours, their pause, "hold on" and the line's
 * health still hold separately. Pure; one definition.
 */
import { dayKeyInZone } from "./cadence";

export type Lane = "asked" | "setup" | "theirs" | "hers";
export type Pace = "less" | "normal" | "more";

const H = 3_600_000, D = 24 * H;

export const REACH_OUT = {
  /** Their own stuff today, a day, while they're talking to her. */
  theirsPerDay: 2,
  /** What she starts outside what they asked for, a day, all lanes. */
  startedPerDay: 3,
  /** Onboarding notices (hello, the first glance, the favorites offer) count as setup this long after pairing. */
  setupMs: 3 * D,
  dayOneMs: D,
  dayOneHers: 2,
  /** They wrote this recently: they're in a conversation with her. */
  engagedMs: 3 * D,
  /** One unanswered: the next waits until about the next day. */
  afterOneUnansweredMs: 20 * H,
  coolingAt: 2,
  coolingGapMs: 3 * D,
  quietAt: 4,
  quietGapMs: 7 * D,
  lessGapMs: 3 * D,
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

/** Pure: the state of the conversation, for her and for the operator. */
export function attentionState(unanswered: number): "engaged" | "cooling" | "quiet" {
  return unanswered >= REACH_OUT.quietAt ? "quiet" : unanswered >= REACH_OUT.coolingAt ? "cooling" : "engaged";
}

/**
 * Pure: why this proactive text must wait, or null when it may go. `sent` is what she started recently
 * (direction out, proactive, at least the last three weeks); `lastInboundAt` is the last time they wrote
 * anything (a text, a tap, a reaction), or null if they never have.
 */
export function reachOutHold(input: { kind: string | undefined; now: number; timezone: string; pairedAt?: number; pace?: Pace; sent: Sent[]; lastInboundAt?: number | null }): string | null {
  const { now, timezone, pairedAt } = input;
  const since = (ts: number) => (pairedAt ? ts - pairedAt : null);
  const lane = laneFor(input.kind, since(now));
  if (lane === "asked" || lane === "setup") return null;
  const lastIn = input.lastInboundAt ?? null;
  const engaged = lastIn !== null && now - lastIn < REACH_OUT.engagedMs;
  const today = dayKeyInZone(now, timezone);
  const counted = input.sent.map((m) => ({ ...m, lane: laneFor(m.kind, since(m.ts)) })).filter((m) => m.lane === "theirs" || m.lane === "hers").sort((a, b) => a.ts - b.ts);
  const todays = counted.filter((m) => dayKeyInZone(m.ts, timezone) === today);
  if (todays.length >= REACH_OUT.startedPerDay) return `she's already texted first ${todays.length} times today`;

  // Their own stuff, while they're talking to her: two a day, on top of hers.
  if (lane === "theirs" && engaged) {
    const n = todays.filter((m) => m.lane === "theirs").length;
    return n >= REACH_OUT.theirsPerDay ? `${n} texts about their day already` : null;
  }

  const dayOneEnds = pairedAt ? pairedAt + REACH_OUT.dayOneMs : 0;
  // The budget below is for her own finds, and for their stuff once they've gone quiet.
  const budgeted = counted.filter((m) => m.lane === "hers" || !engaged);
  if (now < dayOneEnds) {
    const n = budgeted.filter((m) => m.ts >= (pairedAt ?? 0)).length;
    return n >= REACH_OUT.dayOneHers ? `day one: ${n} of hers already` : null;
  }
  const unanswered = counted.filter((m) => (lastIn === null || m.ts > lastIn) && m.ts >= dayOneEnds);
  const last = unanswered[unanswered.length - 1]?.ts ?? null;
  const state = attentionState(unanswered.length);
  if (state === "quiet") return last !== null && now - last < REACH_OUT.quietGapMs ? `${unanswered.length} texts unanswered; one a week` : null;
  if (state === "cooling") return last !== null && now - last < REACH_OUT.coolingGapMs ? `${unanswered.length} texts unanswered; one every few days` : null;
  if (unanswered.length === 1 && last !== null && now - last < REACH_OUT.afterOneUnansweredMs) return "one text unanswered; the next waits about a day";

  const pace = input.pace ?? "normal";
  if (pace === "less") return budgeted.some((m) => now - m.ts < REACH_OUT.lessGapMs) ? "they asked for fewer texts (one every few days)" : null;
  const herToday = budgeted.filter((m) => dayKeyInZone(m.ts, timezone) === today).length;
  const allowed = pace === "more" ? 2 : 1;
  return herToday >= allowed ? `already texted them something of hers today (${herToday} of ${allowed})` : null;
}
