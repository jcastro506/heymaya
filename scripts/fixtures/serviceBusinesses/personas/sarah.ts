/**
 * Persona B — Sarah, the 8-truck plumber (Pro $149 target).
 * Source: docs/SPRINT_PLAN_SERVICE_V0.md § 4.
 *
 * Anchor traits the loader test asserts:
 *   - 6-15 truck bracket (specifically 8 trucks)
 *   - Plumbing service type
 *   - Housecall Pro CRM with MAX-plan warning surfaced
 *   - Pro plan
 *   - 1 GBP location
 *   - FB-active (we mark it via reviewer-name density on FB platform)
 *   - professional-efficient tone
 */

import { makeBusiness } from "../factories/business";
import type { FixtureBusiness } from "../types";

export function makeSarah(rootSeed: number | string): FixtureBusiness {
  // makeBusiness's HCP warning logic relies on a chance roll; we override
  // explicitly to null so Sarah's HCP IS on MAX (the spec says she uses
  // Jobber OR HCP — we land HCP+MAX). This shape is what the planService
  // tests exercise on Pro.
  const fixture = makeBusiness(rootSeed, /* idx */ 101, {
    persona: "sarah",
    serviceType: "plumbing",
    sizeBracket: "6-15",
    cityIdx: 3, // Naperville — suburban, growth market
    plan: "pro",
    crmProvider: "hcp",
    hcpWarning: null,
    gbpLocationCount: 1,
    surname: "Brookline",
    slug: "sarah-brookline-plumbing",
    voiceEnabled: false,
  });
  // Sarah is FB-active — bump the share of FB-platform reviews so the
  // "active FB" loader test has something to detect.
  for (let i = 0; i < fixture.reviews.length; i++) {
    if (i % 4 === 0) fixture.reviews[i].platform = "fb";
  }
  return fixture;
}
