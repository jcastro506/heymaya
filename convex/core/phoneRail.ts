/**
 * The phone channel's line rail (X1, 2026-09-28), from Linq's Chat Health and Best Practices pages.
 * Held inside `messages.send`, so no caller can skip it. It only ever holds PROACTIVE texts: a reply to
 * something they just said always goes.
 *
 *   opted out (keyword, or Linq refused with 2024)  → nothing, until they text again
 *   chat or line CRITICAL, or the line FLAGGED        → hold proactive until healthy
 *   chat or line AT_RISK                              → at most one proactive a day
 *
 * Texting into silence (the back-off when they stop answering) moved to the one attention budget in
 * core/reachOut (2026-11-02), for every channel: its old "three unanswered, quiet until they write" step
 * left a paying tester with eight days of nothing. The budget still backs off (every few days, then
 * weekly), which is what keeps a line healthy.
 */

export type RailInput = {
  now: number;
  kind: string | undefined;
  health: string | undefined;
  lineState: { status: string | null; reputation: string | null } | null;
  optedOutAt: number | undefined;
  /** Proactive outbounds already sent today on their clock. */
  proactiveToday: number;
};

export const PHONE_RAIL = {
  atRiskPerDay: 1,
} as const;

/** Pure: null when the proactive text may go; otherwise the named reason it is held. */
export function phoneRailHold(r: RailInput): string | null {
  if (r.optedOutAt !== undefined) return "they opted out; nothing goes until they text again";
  const worst = [r.health, r.lineState?.reputation, r.lineState?.status === "FLAGGED" ? "CRITICAL" : null];
  if (worst.includes("OPTED_OUT")) return "chat is opted out";
  if (worst.includes("CRITICAL")) return "chat or line health is critical; holding proactive texts until it recovers";
  if (worst.includes("AT_RISK") && r.proactiveToday >= PHONE_RAIL.atRiskPerDay) return "chat or line health is at risk; one proactive text a day";
  return null;
}
