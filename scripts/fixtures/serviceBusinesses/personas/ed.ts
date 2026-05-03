/**
 * Persona C — Ed, the multi-location electrical contractor (Studio $199 target).
 * Source: docs/SPRINT_PLAN_SERVICE_V0.md § 4.
 *
 * Anchor traits the loader test asserts:
 *   - 16-50 truck bracket (specifically ~30 trucks)
 *   - Electrical service type
 *   - 4 GBP locations (multi-location operator)
 *   - ServiceTitan CRM
 *   - Studio plan
 *   - voice channel ENABLED
 *   - FB-active
 *   - authoritative-expert tone
 */

import { makeBusiness } from "../factories/business";
import type { FixtureBusiness } from "../types";

export function makeEd(rootSeed: number | string): FixtureBusiness {
  const fixture = makeBusiness(rootSeed, /* idx */ 102, {
    persona: "ed",
    serviceType: "electrical",
    sizeBracket: "16-50",
    cityIdx: 1, // Austin — multi-location urban metro
    plan: "studio",
    crmProvider: "servicetitan",
    hcpWarning: null,
    gbpLocationCount: 4,
    surname: "Whitmore",
    slug: "ed-whitmore-electrical",
    voiceEnabled: true,
  });
  // Ed is FB-active — same FB-density bump as Sarah.
  for (let i = 0; i < fixture.reviews.length; i++) {
    if (i % 5 === 0) fixture.reviews[i].platform = "fb";
  }
  return fixture;
}
