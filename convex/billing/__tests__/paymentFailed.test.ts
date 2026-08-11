/**
 * ⭐ `invoice.payment_failed` — tell them before the agent goes quiet.
 *
 * ⚠️ This event was not handled at all. Stripe retries a failed payment for
 * days and then deletes the subscription; `subscription.deleted` downgrades the
 * plan, and **nothing anywhere told the customer**. Their agent simply stopped,
 * with no explanation, for a reason they could have fixed in thirty seconds.
 *
 * The silent-failure class this product exists to eliminate, sitting in the
 * billing path — and exactly what §18 Sprint 10 means by "without these it is
 * not handable".
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE = readFileSync(
  join(process.cwd(), "app", "api", "billing", "stripe-webhook", "route.ts"),
  "utf8"
);
const HANDLER = readFileSync(
  join(process.cwd(), "convex", "billing", "webhook.ts"),
  "utf8"
);

describe("the route handles the event at all", () => {
  it("has a case for invoice.payment_failed", () => {
    expect(ROUTE).toContain('case "invoice.payment_failed"');
  });

  it("routes it to the notifier", () => {
    expect(ROUTE).toContain("handlePaymentFailedPublic");
  });

  /**
   * Stripe's attempt counter, so a fourth retry doesn't read like a first.
   * Without it every retry says "nothing's changed yet", which stops being
   * true.
   */
  it("passes the attempt count through", () => {
    expect(ROUTE).toContain("attempt_count");
  });
});

describe("what it does, and deliberately does not do", () => {
  /**
   * ⭐ It must not pause. A first decline is usually a temporary hold, an
   * expired card, or a bank's fraud check — pausing a working agent on attempt
   * one punishes the founder for something Stripe is about to retry
   * successfully.
   */
  it("changes no account state", () => {
    const handler = HANDLER.slice(HANDLER.indexOf("export const handlePaymentFailed"));
    const body = handler.slice(0, handler.indexOf("export const handlePaymentFailedPublic"));
    expect(body).not.toContain("db.patch");
    expect(body).not.toContain('state: "paused"');
    expect(body).not.toContain('plan: "coach"');
  });

  it("sends through the messages path, so the plain-language guard applies", () => {
    expect(HANDLER).toContain("internal.maya.messages.send");
  });

  /**
   * ⚠️ §11 — the founder bought a social media manager, not an integration.
   * "Stripe declined your card" tells them about our plumbing.
   */
  it("never names the payment vendor to the founder", () => {
    /**
     * ⚠️ Only the strings that actually reach the founder. A first attempt at
     * this matched any long quoted span and caught a type annotation — the
     * assertion has to know what it is pointing at, or it fails on the wrong
     * thing and gets loosened.
     */
    const assignment = HANDLER.slice(
      HANDLER.indexOf("const body ="),
      HANDLER.indexOf("dedupeKey: `billing:failed")
    );
    const messages = assignment.match(/"[^"]{40,}"/g) ?? [];
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) {
      expect(m.toLowerCase()).not.toContain("stripe");
      expect(m.toLowerCase()).not.toContain("invoice");
      expect(m.toLowerCase()).not.toContain("subscription");
    }
  });

  /**
   * One message per attempt, not per webhook. Stripe can deliver the same
   * event more than once, and four identical warnings read as nagging about
   * something they already know.
   */
  it("dedupes per attempt", () => {
    expect(HANDLER).toContain("billing:failed:${attempt}");
  });

  it("escalates its wording on a repeat rather than repeating itself", () => {
    const handler = HANDLER.slice(HANDLER.indexOf("export const handlePaymentFailed"));
    expect(handler).toContain("attempt <= 1");
    // The second message must not still claim nothing has changed.
    const second = handler.slice(handler.indexOf("still isn't going through"));
    expect(second.slice(0, 200)).not.toContain("Nothing's changed");
  });
});
