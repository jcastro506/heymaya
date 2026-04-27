/**
 * generateMemorySeed — assemble the MEMORY.md initial seed for a service Maya.
 *
 * The seed is composed of:
 *   1. A header anchored to this business (operator, business name, plan).
 *   2. A `business_facts` section pulled from `BusinessLite` + onboarding.
 *   3. The matching `memorySeeds/<serviceType>.md` per the operator's
 *      first service type — domain priors, seasonal calendar, brand-safety
 *      memory, review-reply patterns.
 *   4. An `open_commitments` placeholder Maya will populate as commitments
 *      accumulate (matching creator-side convention).
 *
 * If the business has multiple service types (e.g. "hvac" + "plumbing"),
 * the PRIMARY service type's seed is loaded; secondary seeds are appended
 * with a `<!-- secondary-service-type -->` marker so dreaming can reconcile.
 *
 * The seed files are loaded via a static map (object keyed by service type).
 * Convex doesn't ship Node fs at runtime — so we inline the seeds as imports
 * via a separate accessor function that callers wire to. For this generator
 * file we accept a `seedLoader` function as input so tests can stub it.
 */

import {
  NOT_YET_PROVIDED,
  type ServiceType,
  type ServiceWorkspaceInputs,
} from "./types";

export interface MemorySeedInputs {
  operator: ServiceWorkspaceInputs["operator"];
  business: ServiceWorkspaceInputs["business"];
  businessPicture: ServiceWorkspaceInputs["businessPicture"];
  plan: ServiceWorkspaceInputs["plan"];
  now: number;
  /**
   * Loader that returns the markdown content for the service-type seed.
   * Production wires this to a static-import map (see `serviceMemorySeedLoader`
   * in the bundle assembler when Sprint 2 lands). Tests stub it directly.
   */
  seedLoader: (serviceType: ServiceType) => string;
}

export function generateMemorySeed(inputs: MemorySeedInputs): string {
  const { operator, business, businessPicture, now, seedLoader } = inputs;

  const primary = business.serviceTypes[0];
  const secondaries = business.serviceTypes.slice(1);
  if (!primary) {
    throw new Error(
      "generateMemorySeed: business.serviceTypes must contain at least one service type."
    );
  }

  const primarySeed = seedLoader(primary);
  if (!primarySeed || primarySeed.trim().length === 0) {
    throw new Error(
      `generateMemorySeed: seedLoader returned empty seed for service type '${primary}'.`
    );
  }

  const sections: string[] = [];
  sections.push("# MEMORY.md");
  sections.push("");
  sections.push(
    `Curated long-term memory for Maya / ${business.name}. Initial seed produced at workspace bootstrap (\`created: ${now}\`). OpenClaw mutates this file after first boot via dreaming + agent edits — section anchors below are the deterministic edit targets.`
  );
  sections.push("");

  sections.push("<!-- section:business_facts:start -->");
  sections.push("## Business facts");
  sections.push("");
  sections.push(`- **Operator:** ${operator.displayName}`);
  sections.push(`- **Business:** ${business.name}`);
  sections.push(`- **Service types:** ${business.serviceTypes.join(", ")}`);
  sections.push(`- **Service area:** ${business.serviceArea}`);
  sections.push(`- **Tone preference:** ${business.tonePreference}`);
  sections.push(
    `- **Brand voice fingerprint:** ${businessPicture?.brandVoice ?? NOT_YET_PROVIDED}`
  );
  sections.push("<!-- section:business_facts:end -->");
  sections.push("");

  sections.push("<!-- section:local_positioning:start -->");
  sections.push("## Local positioning");
  sections.push("");
  if (businessPicture?.localPositioning) {
    const lp = businessPicture.localPositioning;
    sections.push(
      `- **Served zips:** ${lp.servedZips.length > 0 ? lp.servedZips.join(", ") : NOT_YET_PROVIDED}`
    );
    sections.push(
      `- **Served neighborhoods:** ${lp.servedNeighborhoods.length > 0 ? lp.servedNeighborhoods.join(", ") : NOT_YET_PROVIDED}`
    );
    sections.push(
      `- **Named competitors:** ${lp.namedCompetitors.length > 0 ? lp.namedCompetitors.map((c) => c.name).join(", ") : NOT_YET_PROVIDED}`
    );
    sections.push(
      `- **Recurring local hooks:** ${lp.recurringLocalHooks.length > 0 ? lp.recurringLocalHooks.map((h) => `${h.kind}: ${h.text}`).join(" · ") : NOT_YET_PROVIDED}`
    );
    sections.push(
      `- **Local choice thesis:** ${lp.localChoiceThesis || NOT_YET_PROVIDED}`
    );
  } else {
    sections.push(`- _${NOT_YET_PROVIDED} — onboarding Q9-Q11 will fill this in._`);
  }
  sections.push("<!-- section:local_positioning:end -->");
  sections.push("");

  // Primary service-type seed (already contains its own anchored sections).
  sections.push(primarySeed.trim());
  sections.push("");

  for (const secondary of secondaries) {
    const secondarySeed = seedLoader(secondary);
    if (!secondarySeed || secondarySeed.trim().length === 0) continue;
    sections.push(`<!-- secondary-service-type: ${secondary} -->`);
    sections.push(secondarySeed.trim());
    sections.push("");
  }

  sections.push("<!-- section:open_commitments:start -->");
  sections.push("## Open commitments");
  sections.push("");
  sections.push(
    "_(none yet — Maya appends here as operator commitments accumulate; entries removed when followed-through.)_"
  );
  sections.push("<!-- section:open_commitments:end -->");
  sections.push("");

  sections.push("---");
  sections.push("");
  sections.push(`_Seed created at unix ms ${now}._`);
  sections.push("");

  return sections.join("\n");
}
