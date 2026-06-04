/**
 * Typed client-side analytics — Wave 3 of the data-collection sprint.
 *
 * One chokepoint for product events so the event taxonomy stays consistent
 * (PostHog funnels/retention break the moment event names drift). Import
 * `track` / `ANALYTICS_EVENTS` rather than calling posthog.capture directly.
 *
 * Safe by construction: if PostHog never initialized (no key, or SSR), every
 * call is a silent no-op.
 */

import posthog from "posthog-js";

/**
 * The locked product-event taxonomy. The onboarding funnel is ordered:
 * signup → handle_added → research_started → plan_ready → agent_deployed.
 * Adding an event means adding it here first.
 */
export const ANALYTICS_EVENTS = {
  // Onboarding funnel (client-observable steps).
  SIGNUP_STARTED: "signup_started",
  HANDLE_ADDED: "handle_added",
  ONBOARDING_SUBMITTED: "onboarding_submitted",
  PLAN_READY: "plan_ready",
  // Mission Control engagement.
  MISSION_VIEWED: "mission_viewed",
  DRAFT_APPROVED: "draft_approved",
  DRAFT_REJECTED: "draft_rejected",
  CALENDAR_CONNECT_CLICKED: "calendar_connect_clicked",
  // Billing.
  CHECKOUT_STARTED: "checkout_started",
} as const;

export type AnalyticsEvent =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/**
 * Capture a product event. No-op if PostHog isn't initialized.
 */
export function track(
  event: AnalyticsEvent,
  properties?: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  // posthog.capture is safe to call before init in newer SDKs (queues), but
  // we guard on __loaded to avoid surprises when analytics is disabled.
  if (!posthog.__loaded) return;
  posthog.capture(event, properties);
}
