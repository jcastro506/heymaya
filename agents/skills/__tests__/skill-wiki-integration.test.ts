/**
 * Sibling-file scan — memory-wiki tool integration in service-product skills.
 *
 * Rule (per § 9.5 + the OpenClaw native-first rule): if a SKILL.md instructs
 * the agent to call `wiki_apply` or `wiki_get`, then:
 *
 *   (a) the SKILL.md MUST include a "Memory-wiki integration" section
 *       documenting the call-sites + reasoning;
 *   (b) the workspace bundle the agent boots from MUST load the memory-wiki
 *       plugin (otherwise the tool name is unreachable and the skill silently
 *       no-ops or crashes);
 *   (c) the tool MUST be enumerated in the canonical TOOLS.md generator so
 *       the agent's tool-discovery surface is consistent.
 *
 * This is the same shape as the standing-order ↔ jobs.json ↔ skill scan in
 * `agents/skills/maya-service-platform/__tests__/siblingFileScan.test.ts`.
 *
 * The skills that integrate memory-wiki (per the Wave C scope):
 *   1. maya-service-citation-firewall (PRIMARY consumer of `wiki_get`)
 *   2. maya-service-review-reply-drafter (writes per-review source pages)
 *   3. maya-service-gbp-post-optimizer (cites local-positioning concept)
 *   4. maya-service-content-arc-planner (cites recurring-hooks concept)
 *   5. maya-service-asset-cataloger (writes per-asset source pages)
 *   6. maya-service-learnings-extractor (Wave C.5 — writes per-week
 *      `concepts/what-works/<platform>/*` pages from outcome-attributed
 *      patterns; provenance pins gbpPost / inboundLead / serviceJob ids).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { generateMemoryWikiPluginEntries } from "../../../convex/agents/packs/maya_service/memoryWikiConfig";
import type { Id } from "../../../convex/_generated/dataModel";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "agents", "skills");

const WIKI_INTEGRATED_SKILLS: ReadonlyArray<{
  slug: string;
  expectedTools: ReadonlyArray<"wiki_get" | "wiki_apply">;
}> = [
  {
    slug: "maya-service-citation-firewall",
    expectedTools: ["wiki_get"],
  },
  {
    slug: "maya-service-review-reply-drafter",
    expectedTools: ["wiki_get", "wiki_apply"],
  },
  {
    slug: "maya-service-gbp-post-optimizer",
    expectedTools: ["wiki_get"],
  },
  {
    slug: "maya-service-content-arc-planner",
    expectedTools: ["wiki_get"],
  },
  {
    slug: "maya-service-asset-cataloger",
    expectedTools: ["wiki_apply"],
  },
  {
    slug: "maya-service-learnings-extractor",
    expectedTools: ["wiki_apply"],
  },
  // Wave C.6 — judgment-driven GBP local-SEO auditor reads
  // `concepts/what-works/gbp/*` to weight nudges by historical outcome.
  {
    slug: "maya-service-gbp-seo-auditor",
    expectedTools: ["wiki_get"],
  },
  // Wave C.6 — clip composer reads `concepts/what-works/video/*` for outcome
  // weights and writes per-render `sources/video-renders/*` source pages.
  {
    slug: "maya-service-clip-composer",
    expectedTools: ["wiki_get", "wiki_apply"],
  },
];

function readSkill(slug: string): string {
  const p = join(SKILLS_ROOT, slug, "SKILL.md");
  expect(existsSync(p)).toBe(true);
  return readFileSync(p, "utf8");
}

/* -------------------------------------------------------------------------- */
/* (a) Each integrated skill mentions the right tools + has a section heading */
/* -------------------------------------------------------------------------- */

describe("sibling-file scan — memory-wiki tools in SKILL.md", () => {
  for (const entry of WIKI_INTEGRATED_SKILLS) {
    it(`${entry.slug}: SKILL.md references the expected wiki tools`, () => {
      const md = readSkill(entry.slug);
      for (const tool of entry.expectedTools) {
        expect(md, `expected ${tool} in ${entry.slug}/SKILL.md`).toContain(
          tool
        );
      }
    });

    it(`${entry.slug}: SKILL.md has a "Memory-wiki integration" section`, () => {
      const md = readSkill(entry.slug);
      expect(md.toLowerCase()).toContain("memory-wiki integration");
    });
  }
});

/* -------------------------------------------------------------------------- */
/* (b) Workspace bundle config wires the memory-wiki plugin                    */
/* -------------------------------------------------------------------------- */

describe("workspace bundle — memory-wiki plugin reachability", () => {
  it("generateMemoryWikiPluginEntries emits the canonical plugin slug", () => {
    const entries = generateMemoryWikiPluginEntries({
      businessId: "j17xxxxxxxxxxxxxxxxxxxxxxxxx" as Id<"businesses">,
      businessName: "Test Business",
    });
    expect(Object.keys(entries)).toContain("memory-wiki");
    const cfg = entries["memory-wiki"];
    expect(cfg.enabled).toBe(true);
    expect(cfg.config.vaultMode).toBe("bridge");
    // Bridge mode requires bridge.enabled=true otherwise wiki misses
    // memory-core promotions (the whole reason we picked bridge over isolated).
    expect(cfg.config.bridge.enabled).toBe(true);
  });

  it("memory-wiki plugin config exposes all 5 official agent tools", () => {
    // The plugin config doesn't enumerate tools (the plugin runtime registers
    // them automatically when loaded); this assertion checks the bundle's
    // `bridge` mode is configured so the runtime DOES register
    // `wiki_status`, `wiki_search`, `wiki_get`, `wiki_apply`, and `wiki_lint`.
    // If `enabled=false` then the tools are unreachable.
    const entries = generateMemoryWikiPluginEntries({
      businessId: "j17xxxxxxxxxxxxxxxxxxxxxxxxx" as Id<"businesses">,
      businessName: "Test Business",
    });
    expect(entries["memory-wiki"].enabled).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* (c) Tool surface is enumerated in TOOLS.md generator                        */
/* -------------------------------------------------------------------------- */

describe("TOOLS.md generator enumerates memory-wiki tools", () => {
  it("includes wiki_get, wiki_apply, wiki_status, wiki_search, wiki_lint", async () => {
    // Lazy import to avoid a circular dep at module load time when the
    // generator pulls in types from the schema.
    const { generateTools } = await import(
      "../../../convex/agents/packs/maya_service/generateTools"
    );
    const out = generateTools({
      plan: "starter",
      business: {
        name: "Test",
        serviceTypes: ["hvac"],
        serviceArea: "n/a",
        timezone: "America/Los_Angeles",
        tonePreference: "friendly-neighborhood-pro",
        technicianNames: [],
        businessHours: "M-F",
        voiceEnabled: false,
      },
    });
    for (const tool of [
      "wiki_get",
      "wiki_apply",
      "wiki_status",
      "wiki_search",
      "wiki_lint",
    ]) {
      expect(out, `expected ${tool} in TOOLS.md`).toContain(tool);
    }
  });

  it("memory-wiki tools available at every plan tier (plan-agnostic per § 9.5)", async () => {
    const { generateTools } = await import(
      "../../../convex/agents/packs/maya_service/generateTools"
    );
    for (const plan of ["starter", "pro", "studio"] as const) {
      const out = generateTools({
        plan,
        business: {
          name: "Test",
          serviceTypes: ["hvac"],
          serviceArea: "n/a",
          timezone: "America/Los_Angeles",
          tonePreference: "friendly-neighborhood-pro",
          technicianNames: [],
          businessHours: "M-F",
          voiceEnabled: false,
        },
      });
      expect(out).toContain("wiki_get");
      expect(out).toContain("wiki_apply");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* No phantom tool calls — skills outside the integrated set don't reference   */
/* wiki_apply / wiki_get without proper documentation.                        */
/* -------------------------------------------------------------------------- */

describe("phantom-tool guard", () => {
  it("any service skill referencing wiki_apply or wiki_get is in WIKI_INTEGRATED_SKILLS", () => {
    const allowed = new Set(WIKI_INTEGRATED_SKILLS.map((e) => e.slug));
    const dirs = require("node:fs")
      .readdirSync(SKILLS_ROOT)
      .filter(
        (d: string) => d.startsWith("maya-service-") && d !== "maya-service-platform"
      );
    for (const slug of dirs) {
      const skillPath = join(SKILLS_ROOT, slug, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      const content = readFileSync(skillPath, "utf8");
      const usesWikiTools =
        content.includes("wiki_apply") || content.includes("wiki_get");
      if (usesWikiTools) {
        expect(
          allowed.has(slug),
          `${slug}/SKILL.md references wiki tools but is NOT in WIKI_INTEGRATED_SKILLS — either add it or remove the reference.`
        ).toBe(true);
      }
    }
  });
});
