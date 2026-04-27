/**
 * Service product Sprint 0 — schema-shape sibling-file scan.
 *
 * The creator-side equivalent is tests/sprint1Acceptance.test.ts which
 * asserts every table with `creatorId: v.id("creators")` has a
 * `by_creator` index. This file enforces the parallel rule for the
 * service side: every table with `businessId: v.id("businesses")` MUST
 * have a `by_business` index.
 *
 * Source of truth: docs/SPRINT_PLAN_SERVICE_V0.md § 8 — "Every business-
 * scoped table indexed `by_business` on `businessId`. Cross-tenant test
 * asserts a query with mismatched `businessId` returns empty / throws."
 *
 * Sprint 0 ships only the schema-shape scan. The cron/skill/standing-order
 * sibling scan kicks in at Sprint 3 when those .md files land — its
 * acceptance criterion (per § 13 Sprint 3) reads "15/15 cron behaviors
 * pass sibling-file scan (every cron entry → standing order → skill)" and
 * that scan will live in `tests/serviceSprint3Acceptance.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname ?? __dirname, "..", "..");
const SCHEMA_PATH = join(REPO_ROOT, "convex", "schema.ts");

describe("Service Sprint 0 — schema-shape sibling-file scan", () => {
  const schemaSrc = readFileSync(SCHEMA_PATH, "utf8");
  const noComments = schemaSrc
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const tableBlocks = noComments.split(/(?=\b\w+:\s*defineTable\()/);

  it("every table with businessId field has a by_business index", () => {
    const offenders: string[] = [];
    for (const block of tableBlocks) {
      const tableNameMatch = block.match(/^(\w+):\s*defineTable\(/);
      if (!tableNameMatch) continue;
      const tableName = tableNameMatch[1];
      const hasBusinessId = /businessId:\s*v\.id\("businesses"\)/.test(block);
      if (!hasBusinessId) continue;
      const hasByBusiness = /\.index\(\s*"by_business"/.test(block);
      if (!hasByBusiness) {
        offenders.push(tableName);
      }
    }
    expect(
      offenders,
      `tables missing by_business index: ${offenders.join(", ")}`
    ).toEqual([]);
  });

  it("creators.accountType is additive (optional union), not breaking pre-migration rows", () => {
    // The accountType field MUST be optional so legacy creator rows without
    // the field still load. Grep the schema source rather than running a
    // convex-test query — this is a static-shape assertion.
    expect(schemaSrc).toMatch(
      /accountType:\s*v\.optional\(\s*v\.union\(\s*v\.literal\("creator"\),\s*v\.literal\("service-business"\)\s*\)\s*\)/
    );
  });

  it("creators.businessId is additive (optional id pointer)", () => {
    expect(schemaSrc).toMatch(
      /businessId:\s*v\.optional\(v\.id\("businesses"\)\)/
    );
  });

  it("businesses.planTier is the service-side tier enum (separate from creators.plan)", () => {
    // The service-side tier enum is co-defined with the matching creator-side
    // enum (starter / pro / studio). Both products share the literal values
    // but the enums live in DIFFERENT tables — gating logic is split between
    // convex/lib/planFeatures.ts (creator) and convex/planService.ts (service).
    expect(schemaSrc).toMatch(
      /planTier:\s*v\.optional\(\s*v\.union\(\s*v\.literal\("starter"\),\s*v\.literal\("pro"\),\s*v\.literal\("studio"\)\s*\)\s*\)/
    );
  });

  it("approvalRules has by_business_and_rule_type composite index", () => {
    // § 8 spec requires this composite index for fast (businessId, ruleType)
    // lookups when the gating layer checks "is rule X enabled for business
    // Y" — without it the gate would fall back to a full table scan.
    const approvalRulesBlock = tableBlocks.find((b) =>
      b.match(/^approvalRules:\s*defineTable\(/)
    );
    expect(approvalRulesBlock, "approvalRules table not found").toBeDefined();
    expect(approvalRulesBlock!).toMatch(
      /\.index\(\s*"by_business_and_rule_type"/
    );
  });

  it("mediaAssets has by_business_and_content_hash for hash-dedupe", () => {
    // § 10.5 hash-dedupe contract: same bytes per business = link to existing
    // row, no re-catalog cost. Requires a composite index on (businessId,
    // contentHash) for the lookup to be cheap.
    const mediaAssetsBlock = tableBlocks.find((b) =>
      b.match(/^mediaAssets:\s*defineTable\(/)
    );
    expect(mediaAssetsBlock, "mediaAssets table not found").toBeDefined();
    expect(mediaAssetsBlock!).toMatch(
      /\.index\(\s*"by_business_and_content_hash"/
    );
  });

  it("all expected service-side tables exist in the schema", () => {
    const expected = [
      "businesses",
      "businessPicture",
      "gbpLocations",
      "serviceCustomers",
      "serviceJobs",
      "gbpPosts",
      "reviews",
      "reviewRequests",
      "serviceContent",
      "inboundLeads",
      "crmConnections",
      "voiceChannels",
      "webhookEvents",
      "mediaAssets",
      "customSkills",
      "approvalRules",
    ];
    for (const tbl of expected) {
      const re = new RegExp(`\\b${tbl}:\\s*defineTable\\(`);
      expect(re.test(noComments), `missing table: ${tbl}`).toBe(true);
    }
  });
});
