/**
 * Sibling-file scan for the service-product Maya workspace.
 *
 * Per `docs/SPRINT_PLAN_SERVICE_V0.md` § 6 + § 9, the rule is:
 *   "Every entry in `jobs.json` must have a matching standing-order block
 *    in `AGENTS.md` must have a matching skill in agents/skills/maya-service-(slug)/."
 *
 * This test enforces all three legs:
 *   1. Every program in `SERVICE_STANDING_ORDERS` has a matching skill folder.
 *   2. Every program in `jobs.json` (jobs + events) has a matching standing-
 *      order entry by `entryId`.
 *   3. Every program in `SERVICE_STANDING_ORDERS` is referenced by AGENTS.md
 *      (the static template at `agents/skills/maya-service-platform/AGENTS.md`)
 *      via the `<!-- standing-order-id: $id -->` markers.
 *
 * This is the locked sibling-file-scan rule from CLAUDE.md + the service plan.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SERVICE_STANDING_ORDERS } from "../../../../convex/agents/packs/maya_service/standingOrders";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "agents", "skills");
const PLATFORM_DIR = join(SKILLS_ROOT, "maya-service-platform");
const JOBS_JSON_PATH = join(PLATFORM_DIR, "jobs.json");
const AGENTS_MD_PATH = join(PLATFORM_DIR, "AGENTS.md");

interface JobsJsonShape {
  jobs: Array<{ entryId: string; skill: string }>;
  events: Array<{ entryId: string; skill: string }>;
}

describe("sibling-file scan — service-product Maya", () => {
  it("standing orders catalog has 15 entries (§ 6)", () => {
    expect(SERVICE_STANDING_ORDERS.length).toBe(15);
  });

  it("every standing-order program has a matching skill folder", () => {
    for (const program of SERVICE_STANDING_ORDERS) {
      const skillDir = join(SKILLS_ROOT, program.skill);
      expect(
        existsSync(skillDir),
        `program '${program.id}' references skill '${program.skill}' but agents/skills/${program.skill}/ does not exist`
      ).toBe(true);

      // Each skill folder must have SKILL.md + script.ts + __tests__/.
      expect(
        existsSync(join(skillDir, "SKILL.md")),
        `${program.skill}/SKILL.md missing`
      ).toBe(true);
      expect(
        existsSync(join(skillDir, "script.ts")),
        `${program.skill}/script.ts missing`
      ).toBe(true);
      expect(
        existsSync(join(skillDir, "__tests__")),
        `${program.skill}/__tests__/ missing`
      ).toBe(true);
    }
  });

  it("every jobs.json entry has a matching standing-order program (by entryId)", () => {
    const raw = readFileSync(JOBS_JSON_PATH, "utf-8");
    const parsed = JSON.parse(raw) as JobsJsonShape;
    const standingOrderIds = new Set(SERVICE_STANDING_ORDERS.map((p) => p.id));

    for (const job of parsed.jobs) {
      expect(
        standingOrderIds.has(job.entryId),
        `jobs.json job entryId '${job.entryId}' not found in SERVICE_STANDING_ORDERS`
      ).toBe(true);
    }
    for (const event of parsed.events) {
      expect(
        standingOrderIds.has(event.entryId),
        `jobs.json event entryId '${event.entryId}' not found in SERVICE_STANDING_ORDERS`
      ).toBe(true);
    }
  });

  it("every standing-order id with kind cron|event has a jobs.json entry", () => {
    const raw = readFileSync(JOBS_JSON_PATH, "utf-8");
    const parsed = JSON.parse(raw) as JobsJsonShape;
    const jobsJsonIds = new Set([
      ...parsed.jobs.map((j) => j.entryId),
      ...parsed.events.map((e) => e.entryId),
    ]);

    for (const program of SERVICE_STANDING_ORDERS) {
      if (program.kind === "on-demand") continue;
      expect(
        jobsJsonIds.has(program.id),
        `standing-order '${program.id}' (kind=${program.kind}) missing from jobs.json`
      ).toBe(true);
    }
  });

  it("every standing-order id is referenced in the platform AGENTS.md template", () => {
    const agentsMd = readFileSync(AGENTS_MD_PATH, "utf-8");
    for (const program of SERVICE_STANDING_ORDERS) {
      const marker = `<!-- standing-order-id: ${program.id} -->`;
      expect(
        agentsMd.includes(marker),
        `AGENTS.md template missing marker '${marker}' — sibling-file scan rule from § 6 + § 9 violated`
      ).toBe(true);
    }
  });

  it("standing-order skill names map to real folders + match jobs.json skill", () => {
    const raw = readFileSync(JOBS_JSON_PATH, "utf-8");
    const parsed = JSON.parse(raw) as JobsJsonShape;
    const allEntries = [...parsed.jobs, ...parsed.events];

    for (const program of SERVICE_STANDING_ORDERS) {
      if (program.kind === "on-demand") continue;
      const jobsJsonEntry = allEntries.find((e) => e.entryId === program.id);
      expect(jobsJsonEntry).toBeDefined();
      expect(
        jobsJsonEntry!.skill,
        `standing-order '${program.id}' skill='${program.skill}' but jobs.json says '${jobsJsonEntry!.skill}'`
      ).toBe(program.skill);
    }
  });

  it("the meta-skill maya-skill-installer exists with full scaffolding", () => {
    const dir = join(SKILLS_ROOT, "maya-skill-installer");
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, "script.ts"))).toBe(true);
    expect(existsSync(join(dir, "__tests__"))).toBe(true);
  });
});
