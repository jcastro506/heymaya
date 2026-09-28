/**
 * The phone channel's sending rail (X1, 2026-09-28), from Linq's Chat Health and Best Practices pages:
 * two-way engagement is the strongest signal a line has, and sending into silence is the fastest way
 * to push a chat, and then the whole line, to AT_RISK, CRITICAL and flagged. Held inside
 * `messages.send` with the daily cap, so no caller can skip it. It only ever holds PROACTIVE texts:
 * a reply to something they just said always goes.
 *
 *   opted out (keyword, or Linq refused with 2024)  → nothing, until they text again
 *   chat or line CRITICAL, or the line FLAGGED        → hold proactive until healthy
 *   chat or line AT_RISK                              → at most one proactive a day
 *   silence (their docs' back-off ladder):
 *     nothing unanswered                → normal
 *     1 unanswered                      → the next only ~a day later (a reminder for a shoot they booked may go)
 *     2 unanswered                      → the next only 3+ days later
 *     3+ unanswered                     → one last "quiet" check-in (the easy way out), then nothing
 *                                          until they write
 *
 * A shoot they booked is a commitment, not texting into silence: its reminders and "how'd it go"
 * (kinds `reminder`, `checkin`; code caps them per block) neither count toward the ladder nor wait on
 * it, as long as they have written in the last three days. After that they count like anything else,
 * so a person who has gone silent is never sent a stream of shoot texts. (Found by the product sim's
 * regression test: the ladder held "how'd it go" for the flaker, the one text the promise is about.)
 */

export type RailInput = {
  now: number;
  kind: string | undefined;
  health: string | undefined;
  lineState: { status: string | null; reputation: string | null } | null;
  optedOutAt: number | undefined;
  /** Their last inbound (any text, tap or reaction), or null if they never wrote. */
  lastInboundAt: number | null;
  /** Proactive outbounds since their last inbound, oldest first. */
  unanswered: Array<{ ts: number; kind: string | undefined }>;
  /** Proactive outbounds already sent today on their clock. */
  proactiveToday: number;
};

export const COMMITMENT_KINDS = ["reminder", "checkin"] as const;
export const PHONE_RAIL = {
  commitmentWhileWroteWithinMs: 3 * 24 * 60 * 60_000,
  firstFollowUpAfterMs: 20 * 60 * 60_000,
  secondFollowUpAfterMs: 3 * 24 * 60 * 60_000,
  atRiskPerDay: 1,
} as const;

/** Pure: null when the proactive text may go; otherwise the named reason it is held. */
export function phoneRailHold(r: RailInput): string | null {
  if (r.optedOutAt !== undefined) return "they opted out; nothing goes until they text again";
  const worst = [r.health, r.lineState?.reputation, r.lineState?.status === "FLAGGED" ? "CRITICAL" : null];
  if (worst.includes("OPTED_OUT")) return "chat is opted out";
  if (worst.includes("CRITICAL")) return "chat or line health is critical; holding proactive texts until it recovers";
  if (worst.includes("AT_RISK") && r.proactiveToday >= PHONE_RAIL.atRiskPerDay) return "chat or line health is at risk; one proactive text a day";
  const engaged = r.lastInboundAt !== null && r.now - r.lastInboundAt < PHONE_RAIL.commitmentWhileWroteWithinMs;
  const isCommitment = (kind: string | undefined) => (COMMITMENT_KINDS as readonly string[]).includes(kind ?? "");
  if (engaged && isCommitment(r.kind)) return null;
  const counted = engaged ? r.unanswered.filter((m) => !isCommitment(m.kind)) : r.unanswered;
  const k = counted.length;
  if (k === 0) return null;
  const last = counted[k - 1].ts;
  if (k === 1) {
    return r.now - last >= PHONE_RAIL.firstFollowUpAfterMs ? null : "one text unanswered; the next waits about a day";
  }
  if (k === 2) return r.now - last >= PHONE_RAIL.secondFollowUpAfterMs ? null : "two texts unanswered; the next waits a few days";
  if (r.kind === "quiet" && !counted.some((m) => m.kind === "quiet")) return null;
  return "three texts unanswered; quiet until they write";
}
