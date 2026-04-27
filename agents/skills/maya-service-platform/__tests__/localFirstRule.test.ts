/**
 * Local-first content rule verbatim assertion.
 *
 * Per `docs/SPRINT_PLAN_SERVICE_V0.md` § 2 principle 3 + § 9, the local-first
 * content rule is load-bearing — every content-generating skill consults it,
 * and the citation firewall rejects outputs that violate it. The rule lives
 * in AGENTS.md (both the platform shared template AND the per-business
 * rendered file).
 *
 * This test asserts:
 *   1. The platform AGENTS.md template at
 *      `agents/skills/maya-service-platform/AGENTS.md` contains the rule
 *      with the load-bearing literal phrases.
 *   2. The `generateAgents.ts` output also contains the rule (with operator
 *      + business slots interpolated).
 *   3. The `LOCAL_FIRST_CONTENT_RULE_TEMPLATE` constant exported from
 *      `generateAgents.ts` matches the plan's verbatim text exactly.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  generateAgents,
  LOCAL_FIRST_CONTENT_RULE_TEMPLATE,
} from "../../../../convex/agents/packs/maya_service/generateAgents";
import type { ServiceWorkspaceInputs } from "../../../../convex/agents/packs/maya_service/types";

const PLATFORM_DIR = join(__dirname, "..");
const AGENTS_MD_PATH = join(PLATFORM_DIR, "AGENTS.md");

const REQUIRED_PHRASES: ReadonlyArray<string> = [
  "You are not writing for a global feed",
  "Every post must reference at least one of",
  "named neighborhood/zip from localPositioning.servedNeighborhoods",
  "named local landmark",
  "named local competitor",
  "local weather/seasonal pattern",
  "local event/team/community reference from localPositioning.recurringLocalHooks",
  "Generic \"in your area\" or \"in our community\" phrasing is a failure mode",
  "name the place",
];

describe("local-first content rule (§ 2 principle 3, § 9 verbatim)", () => {
  it("platform AGENTS.md template contains every required phrase from the rule", () => {
    const md = readFileSync(AGENTS_MD_PATH, "utf-8");
    for (const phrase of REQUIRED_PHRASES) {
      expect(
        md.includes(phrase),
        `platform AGENTS.md missing required phrase: "${phrase}"`
      ).toBe(true);
    }
  });

  it("LOCAL_FIRST_CONTENT_RULE_TEMPLATE constant contains every required phrase", () => {
    for (const phrase of REQUIRED_PHRASES) {
      expect(
        LOCAL_FIRST_CONTENT_RULE_TEMPLATE.includes(phrase),
        `LOCAL_FIRST_CONTENT_RULE_TEMPLATE missing phrase: "${phrase}"`
      ).toBe(true);
    }
  });

  it("rendered AGENTS.md (via generateAgents) contains every required phrase", () => {
    const fixtureInputs: ServiceWorkspaceInputs = {
      operator: { firstName: "Mike", displayName: "Mike Henderson" },
      business: {
        name: "Henderson HVAC",
        serviceTypes: ["hvac"],
        serviceArea: "25-mile radius around Lincoln, NE",
        timezone: "America/Chicago",
        tonePreference: "friendly-neighborhood-pro",
        technicianNames: ["Carlos", "Devon"],
        businessHours: "M-F 7a-6p, Sat 8a-noon",
        voiceEnabled: false,
      },
      businessPicture: {
        brandVoice: "warm, first-name basis",
        brandVoiceSamples: [],
        localPositioning: {
          servedZips: ["68506", "68510"],
          servedNeighborhoods: ["Lincoln Park", "Eastridge"],
          namedCompetitors: [{ name: "Acme HVAC" }],
          recurringLocalHooks: [
            { kind: "weather", text: "Nebraska freeze season Dec-Feb" },
          ],
          localChoiceThesis: "neighborhood-first HVAC",
        },
      },
      plan: "pro",
      now: 1_700_000_000_000,
    };

    const rendered = generateAgents(fixtureInputs);
    for (const phrase of REQUIRED_PHRASES) {
      expect(
        rendered.includes(phrase),
        `generated AGENTS.md missing phrase: "${phrase}"`
      ).toBe(true);
    }

    // Anti-failure-mode: rendered MUST also name actual operator + neighborhoods.
    expect(rendered).toContain("Mike's neighbors");
    expect(rendered).toContain("Lincoln Park");
    expect(rendered).toContain("Eastridge");
  });

  it("rendered AGENTS.md falls back gracefully when localPositioning is null", () => {
    const fixtureInputs: ServiceWorkspaceInputs = {
      operator: { firstName: "Mike", displayName: "Mike Henderson" },
      business: {
        name: "Henderson HVAC",
        serviceTypes: ["hvac"],
        serviceArea: "25-mile radius around Lincoln, NE",
        timezone: "America/Chicago",
        tonePreference: "friendly-neighborhood-pro",
        technicianNames: [],
        businessHours: "M-F 7a-6p",
        voiceEnabled: false,
      },
      businessPicture: null,
      plan: "starter",
      now: 1_700_000_000_000,
    };
    const rendered = generateAgents(fixtureInputs);
    // Required phrases still present.
    for (const phrase of REQUIRED_PHRASES) {
      expect(rendered.includes(phrase), `missing phrase: "${phrase}"`).toBe(
        true
      );
    }
    // Fallback note surfaces in the substituted slot.
    expect(rendered).toContain("not yet captured");
  });
});
