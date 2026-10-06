/**
 * "Stop texting me first" (2026-10-06). Their own pause is its own field, never the billing status:
 * a tester texted STOP, a routine Stripe event wrote "trialing" over "paused" three days later and she
 * was texted again, then "resume" (which set a trial to "active") found nothing to undo. One definition,
 * read by the send path, the scout's rails, the week plan and the schedule rows.
 */
import type { Doc } from "../_generated/dataModel";

/** Pure: true when they asked her to stop texting first, or their subscription is paused at Stripe. */
export function pausedByThem(c: Pick<Doc<"creators">, "messagingPausedAt" | "plan">): boolean {
  return Boolean(c.messagingPausedAt) || c.plan.status === "paused";
}

/** Pure: the billing status a resume returns a legacy pause to (old stops wrote "paused" into the plan). */
export function statusAfterLegacyPause(plan: Doc<"creators">["plan"], now: number): Doc<"creators">["plan"]["status"] {
  if (!plan.stripeSubscriptionId) return "active";
  return plan.trialEndsAt && plan.trialEndsAt > now ? "trialing" : "active";
}
