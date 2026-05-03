/**
 * Persona A — Mike, the 1-truck HVAC owner (Starter $99 target).
 * Source: docs/SPRINT_PLAN_SERVICE_V0.md § 4.
 *
 * Anchor traits the loader test asserts:
 *   - Solo (1 truck)
 *   - HVAC service type
 *   - No CRM (`crmConnections[0].provider === "none"`)
 *   - Starter plan
 *   - GBP claimed ~1.5 years ago (gradual review growth)
 *   - iMessage channel preference (iPhone)
 *   - friendly-neighborhood tone
 */

import { makeBusiness } from "../factories/business";
import type { FixtureBusiness } from "../types";

const ONE_DAY = 24 * 60 * 60 * 1000;

export function makeMike(rootSeed: number | string): FixtureBusiness {
  return makeBusiness(rootSeed, /* idx */ 100, {
    persona: "mike",
    serviceType: "hvac",
    sizeBracket: "solo",
    cityIdx: 6, // Boise — small-metro feel that matches "drowning in marketing he doesn't do"
    plan: "starter",
    crmProvider: "none",
    hcpWarning: null,
    gbpLocationCount: 1,
    surname: "Hansen",
    slug: "mike-hansen-hvac",
    // ~1.5 years on GBP — captures Mike's "gradual review growth" trait
    claimedAtOffsetMs: 547 * ONE_DAY,
    voiceEnabled: false,
  });
}
