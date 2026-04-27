/**
 * wikiProjections — Convex storage layer tests.
 *
 * Mandatory five test categories per § 14:
 *   1. Cross-tenant isolation — Business A's vault never visible to B.
 *   2. Plan-tier × action — wiki itself is plan-agnostic per § 9.5; we
 *      assert that gating; mutation-level gating lives in the HQ-UI
 *      agent's query layer.
 *   3. Adversarial inputs — malformed vaultPath (path traversal, leading
 *      slash, length bombs), oversized claim, invalid confidence, missing
 *      provenance for non-report kinds.
 *   4. Sibling-file scan — covered in skill-wiki-integration.test.ts.
 *   5. TODO grep — covered by repo-wide grep.
 *
 * Plus wiki-specific:
 *   - CRUD round-trip: applyProjection upserts, listProjections returns,
 *     getProjection finds, removeProjection soft-deletes.
 *   - Provenance integrity: empty provenance rejected for non-report kinds.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { modules } from "../tests/_modules";
import type { Id } from "./_generated/dataModel";

const NOW = 1_700_000_000_000;

async function insertBusiness(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; planTier?: "starter" | "pro" | "studio" }
): Promise<Id<"businesses">> {
  const accountId = await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `op_${opts.suffix}`,
      email: `${opts.suffix}@svc.test`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "starter",
      accountType: "service-business",
      createdAt: NOW,
    })
  );
  return await t.run((ctx) =>
    ctx.db.insert("businesses", {
      accountId,
      name: `Business ${opts.suffix}`,
      serviceTypes: ["hvac"],
      planTier: opts.planTier ?? "pro",
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
}

const VALID_PROVENANCE = [
  {
    sourceId: "operator-onboarding:Q9",
    path: "$.namedCompetitors[0]",
    weight: 0.95,
    note: "Operator-named competitor",
  },
];

/* -------------------------------------------------------------------------- */
/* CRUD round-trip                                                             */
/* -------------------------------------------------------------------------- */

describe("wikiProjections.applyProjection (upsert)", () => {
  it("inserts a new row with valid inputs", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    const id = await t.mutation(internal.wikiProjections.applyProjection, {
      businessId,
      vaultPath: "entities/competitors/joes-hvac",
      kind: "entity",
      claim: "Joe's HVAC is a named local competitor.",
      provenance: VALID_PROVENANCE,
      confidence: 0.95,
    });
    expect(id).toBeTruthy();
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.vaultPath).toBe("entities/competitors/joes-hvac");
    expect(row?.kind).toBe("entity");
    expect(row?.confidence).toBe(0.95);
    expect(row?.archivedAt).toBeUndefined();
  });

  it("upserts (re-applies) — same vaultPath updates, doesn't duplicate", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    const first = await t.mutation(internal.wikiProjections.applyProjection, {
      businessId,
      vaultPath: "concepts/local-positioning",
      kind: "concept",
      claim: "First version",
      provenance: VALID_PROVENANCE,
      confidence: 0.7,
    });
    const second = await t.mutation(internal.wikiProjections.applyProjection, {
      businessId,
      vaultPath: "concepts/local-positioning",
      kind: "concept",
      claim: "Second version",
      provenance: VALID_PROVENANCE,
      confidence: 0.8,
    });
    expect(first).toBe(second);
    const row = await t.run((ctx) => ctx.db.get(first));
    expect(row?.claim).toBe("Second version");
    expect(row?.confidence).toBe(0.8);
  });

  it("re-apply un-archives a previously soft-deleted row", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await t.mutation(internal.wikiProjections.applyProjection, {
      businessId,
      vaultPath: "concepts/x",
      kind: "concept",
      claim: "v1",
      provenance: VALID_PROVENANCE,
      confidence: 0.5,
    });
    await t.mutation(internal.wikiProjections.removeProjection, {
      businessId,
      vaultPath: "concepts/x",
    });
    const id = await t.mutation(internal.wikiProjections.applyProjection, {
      businessId,
      vaultPath: "concepts/x",
      kind: "concept",
      claim: "v2",
      provenance: VALID_PROVENANCE,
      confidence: 0.6,
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.archivedAt).toBeUndefined();
    expect(row?.claim).toBe("v2");
  });
});

describe("wikiProjections.applyInitialPages (bulk write)", () => {
  it("writes all pages in one mutation", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    const out = await t.mutation(internal.wikiProjections.applyInitialPages, {
      businessId,
      pages: [
        {
          vaultPath: "entities/competitors/c1",
          kind: "entity" as const,
          claim: "competitor 1",
          provenance: VALID_PROVENANCE,
          confidence: 0.9,
        },
        {
          vaultPath: "concepts/local-positioning",
          kind: "concept" as const,
          claim: "positioning",
          provenance: VALID_PROVENANCE,
          confidence: 0.9,
        },
        {
          vaultPath: "reports/seed",
          kind: "report" as const,
          claim: "seed",
          provenance: [],
          confidence: 1.0,
        },
      ],
    });
    expect(out.written).toBe(3);
    const all = await t.query(api.wikiProjections.listProjections, {
      businessId,
    });
    expect(all).toHaveLength(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Cross-tenant isolation                                                      */
/* -------------------------------------------------------------------------- */

describe("wikiProjections cross-tenant isolation", () => {
  it("Business A's pages never appear in Business B's list", async () => {
    const t = convexTest(schema, modules);
    const businessA = await insertBusiness(t, { suffix: "a" });
    const businessB = await insertBusiness(t, { suffix: "b" });
    await t.mutation(internal.wikiProjections.applyProjection, {
      businessId: businessA,
      vaultPath: "entities/competitors/secret",
      kind: "entity",
      claim: "Secret to A",
      provenance: VALID_PROVENANCE,
      confidence: 0.9,
    });
    const aList = await t.query(api.wikiProjections.listProjections, {
      businessId: businessA,
    });
    const bList = await t.query(api.wikiProjections.listProjections, {
      businessId: businessB,
    });
    expect(aList).toHaveLength(1);
    expect(bList).toHaveLength(0);
  });

  it("getProjection by vaultPath returns null when called with wrong businessId", async () => {
    const t = convexTest(schema, modules);
    const businessA = await insertBusiness(t, { suffix: "a" });
    const businessB = await insertBusiness(t, { suffix: "b" });
    await t.mutation(internal.wikiProjections.applyProjection, {
      businessId: businessA,
      vaultPath: "concepts/secret",
      kind: "concept",
      claim: "A's concept",
      provenance: VALID_PROVENANCE,
      confidence: 0.9,
    });
    const fromB = await t.query(api.wikiProjections.getProjection, {
      businessId: businessB,
      vaultPath: "concepts/secret",
    });
    expect(fromB).toBeNull();
    const fromA = await t.query(api.wikiProjections.getProjection, {
      businessId: businessA,
      vaultPath: "concepts/secret",
    });
    expect(fromA?.claim).toBe("A's concept");
  });

  it("vaultPath collision across businesses doesn't leak claims", async () => {
    const t = convexTest(schema, modules);
    const businessA = await insertBusiness(t, { suffix: "a" });
    const businessB = await insertBusiness(t, { suffix: "b" });
    await t.mutation(internal.wikiProjections.applyProjection, {
      businessId: businessA,
      vaultPath: "concepts/shared-name",
      kind: "concept",
      claim: "A's text",
      provenance: VALID_PROVENANCE,
      confidence: 0.9,
    });
    await t.mutation(internal.wikiProjections.applyProjection, {
      businessId: businessB,
      vaultPath: "concepts/shared-name",
      kind: "concept",
      claim: "B's text",
      provenance: VALID_PROVENANCE,
      confidence: 0.9,
    });
    const a = await t.query(api.wikiProjections.getProjection, {
      businessId: businessA,
      vaultPath: "concepts/shared-name",
    });
    const b = await t.query(api.wikiProjections.getProjection, {
      businessId: businessB,
      vaultPath: "concepts/shared-name",
    });
    expect(a?.claim).toBe("A's text");
    expect(b?.claim).toBe("B's text");
  });
});

/* -------------------------------------------------------------------------- */
/* List + kind filter                                                          */
/* -------------------------------------------------------------------------- */

describe("wikiProjections.listProjections", () => {
  it("filters by kind", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await t.mutation(internal.wikiProjections.applyProjection, {
      businessId,
      vaultPath: "entities/competitors/c1",
      kind: "entity",
      claim: "x",
      provenance: VALID_PROVENANCE,
      confidence: 0.9,
    });
    await t.mutation(internal.wikiProjections.applyProjection, {
      businessId,
      vaultPath: "concepts/c1",
      kind: "concept",
      claim: "y",
      provenance: VALID_PROVENANCE,
      confidence: 0.9,
    });
    const entities = await t.query(api.wikiProjections.listProjections, {
      businessId,
      kindFilter: "entity",
    });
    const concepts = await t.query(api.wikiProjections.listProjections, {
      businessId,
      kindFilter: "concept",
    });
    expect(entities).toHaveLength(1);
    expect(concepts).toHaveLength(1);
    expect(entities[0].kind).toBe("entity");
    expect(concepts[0].kind).toBe("concept");
  });

  it("excludes archived rows by default; includes when asked", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await t.mutation(internal.wikiProjections.applyProjection, {
      businessId,
      vaultPath: "concepts/keep",
      kind: "concept",
      claim: "keep",
      provenance: VALID_PROVENANCE,
      confidence: 0.9,
    });
    await t.mutation(internal.wikiProjections.applyProjection, {
      businessId,
      vaultPath: "concepts/drop",
      kind: "concept",
      claim: "drop",
      provenance: VALID_PROVENANCE,
      confidence: 0.9,
    });
    await t.mutation(internal.wikiProjections.removeProjection, {
      businessId,
      vaultPath: "concepts/drop",
    });
    const live = await t.query(api.wikiProjections.listProjections, {
      businessId,
    });
    const all = await t.query(api.wikiProjections.listProjections, {
      businessId,
      includeArchived: true,
    });
    expect(live).toHaveLength(1);
    expect(all).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Adversarial inputs                                                          */
/* -------------------------------------------------------------------------- */

describe("wikiProjections adversarial inputs", () => {
  it("rejects vaultPath with leading slash", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await expect(
      t.mutation(internal.wikiProjections.applyProjection, {
        businessId,
        vaultPath: "/entities/foo",
        kind: "entity",
        claim: "x",
        provenance: VALID_PROVENANCE,
        confidence: 0.5,
      })
    ).rejects.toThrow(/vaultPath/);
  });

  it("rejects vaultPath with path traversal", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await expect(
      t.mutation(internal.wikiProjections.applyProjection, {
        businessId,
        vaultPath: "entities/../../../etc/passwd",
        kind: "entity",
        claim: "x",
        provenance: VALID_PROVENANCE,
        confidence: 0.5,
      })
    ).rejects.toThrow(/vaultPath/);
  });

  it("rejects empty vaultPath", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await expect(
      t.mutation(internal.wikiProjections.applyProjection, {
        businessId,
        vaultPath: "",
        kind: "entity",
        claim: "x",
        provenance: VALID_PROVENANCE,
        confidence: 0.5,
      })
    ).rejects.toThrow(/vaultPath/);
  });

  it("rejects oversized claim", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    const huge = "x".repeat(40_000);
    await expect(
      t.mutation(internal.wikiProjections.applyProjection, {
        businessId,
        vaultPath: "entities/foo",
        kind: "entity",
        claim: huge,
        provenance: VALID_PROVENANCE,
        confidence: 0.5,
      })
    ).rejects.toThrow(/claim exceeds/);
  });

  it("rejects empty claim", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await expect(
      t.mutation(internal.wikiProjections.applyProjection, {
        businessId,
        vaultPath: "entities/foo",
        kind: "entity",
        claim: "",
        provenance: VALID_PROVENANCE,
        confidence: 0.5,
      })
    ).rejects.toThrow(/non-empty/);
  });

  it("rejects invalid confidence (>1)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await expect(
      t.mutation(internal.wikiProjections.applyProjection, {
        businessId,
        vaultPath: "entities/foo",
        kind: "entity",
        claim: "x",
        provenance: VALID_PROVENANCE,
        confidence: 1.5,
      })
    ).rejects.toThrow(/confidence/);
  });

  it("rejects invalid confidence (<0)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await expect(
      t.mutation(internal.wikiProjections.applyProjection, {
        businessId,
        vaultPath: "entities/foo",
        kind: "entity",
        claim: "x",
        provenance: VALID_PROVENANCE,
        confidence: -0.1,
      })
    ).rejects.toThrow(/confidence/);
  });

  it("rejects empty provenance for non-report kinds", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await expect(
      t.mutation(internal.wikiProjections.applyProjection, {
        businessId,
        vaultPath: "entities/foo",
        kind: "entity",
        claim: "x",
        provenance: [],
        confidence: 0.5,
      })
    ).rejects.toThrow(/provenance entry/);
  });

  it("ALLOWS empty provenance for report kinds (seed pages)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    const id = await t.mutation(internal.wikiProjections.applyProjection, {
      businessId,
      vaultPath: "reports/seed",
      kind: "report",
      claim: "Empty report seed",
      provenance: [],
      confidence: 1.0,
    });
    expect(id).toBeTruthy();
  });

  it("rejects provenance entry with bad weight", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await expect(
      t.mutation(internal.wikiProjections.applyProjection, {
        businessId,
        vaultPath: "entities/foo",
        kind: "entity",
        claim: "x",
        provenance: [
          { sourceId: "x", path: "$.x", weight: 99 },
        ],
        confidence: 0.5,
      })
    ).rejects.toThrow(/weight/);
  });
});

/* -------------------------------------------------------------------------- */
/* removeProjection (soft-delete)                                              */
/* -------------------------------------------------------------------------- */

describe("wikiProjections.removeProjection", () => {
  it("soft-deletes by setting archivedAt", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await t.mutation(internal.wikiProjections.applyProjection, {
      businessId,
      vaultPath: "concepts/x",
      kind: "concept",
      claim: "x",
      provenance: VALID_PROVENANCE,
      confidence: 0.9,
    });
    const out = await t.mutation(internal.wikiProjections.removeProjection, {
      businessId,
      vaultPath: "concepts/x",
    });
    expect(out.archived).toBe(true);
    const live = await t.query(api.wikiProjections.listProjections, {
      businessId,
    });
    expect(live).toHaveLength(0);
  });

  it("idempotent — removing non-existent returns archived=false", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    const out = await t.mutation(internal.wikiProjections.removeProjection, {
      businessId,
      vaultPath: "concepts/never-existed",
    });
    expect(out.archived).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Plan-tier × action — wiki itself is plan-agnostic                           */
/* -------------------------------------------------------------------------- */

describe("wikiProjections plan-tier", () => {
  it("storage layer is plan-agnostic — Starter, Pro, Studio all write equally", async () => {
    const t = convexTest(schema, modules);
    for (const plan of ["starter", "pro", "studio"] as const) {
      const businessId = await insertBusiness(t, {
        suffix: `t-${plan}`,
        planTier: plan,
      });
      const id = await t.mutation(internal.wikiProjections.applyProjection, {
        businessId,
        vaultPath: "entities/competitors/c1",
        kind: "entity",
        claim: "competitor",
        provenance: VALID_PROVENANCE,
        confidence: 0.9,
      });
      expect(id).toBeTruthy();
    }
  });
});
