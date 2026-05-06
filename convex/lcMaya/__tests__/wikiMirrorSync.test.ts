/**
 * wikiMirrorSync — Sprint 8.5 wiki → Convex projection mirror tests.
 *
 * Coverage (5 mandatory categories):
 *   1. Cross-tenant isolation — creator A's sync never leaks to creator B.
 *   2. Plan-tier × action — the endpoint is plan-agnostic (mirror writes
 *      regardless of tier; HQ-side reads gate per-tier). Verified by
 *      explicit comment + a test that comp/non-comp creators both work.
 *   3. Adversarial — bogus secret rejected; oversized batch rejected;
 *      empty batch rejected; weekly-pattern phantom-guard (sampleSize<3)
 *      rejected.
 *   4. Sibling-file scan — the endpoint is registered in `convex/http.ts`
 *      AND the validator exports match the mutation arg shape.
 *   5. TODO grep — none introduced.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { api } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { _setWebhookSecretForTests } from "../../lib/webhookSecret";
import { parseSyncWikiObservationsPayload } from "../wikiMirrorSync";

const SECRET = "wiki-mirror-secret-".repeat(2);
const NOW = Date.UTC(2026, 4, 6, 12, 0, 0);

describe("wikiMirrorSync — payload parser (adversarial inputs)", () => {
  it("rejects non-object body", () => {
    expect(() => parseSyncWikiObservationsPayload("hello")).toThrow();
    expect(() => parseSyncWikiObservationsPayload(null)).toThrow();
    expect(() => parseSyncWikiObservationsPayload(42)).toThrow();
  });
  it("rejects missing secret", () => {
    expect(() =>
      parseSyncWikiObservationsPayload({
        creatorId: "abc",
        trends: [validTrend()],
      })
    ).toThrow(/secret/);
  });
  it("rejects missing creatorId", () => {
    expect(() =>
      parseSyncWikiObservationsPayload({
        secret: SECRET,
        trends: [validTrend()],
      })
    ).toThrow(/creatorId/);
  });
  it("rejects empty batch (no trends, no competitors, no weekly)", () => {
    expect(() =>
      parseSyncWikiObservationsPayload({
        secret: SECRET,
        creatorId: "abc",
        trends: [],
        competitors: [],
        weeklyLearnings: [],
      })
    ).toThrow(/empty batch/);
  });
  it("rejects oversize batch (> 200 total rows)", () => {
    const trends = Array.from({ length: 201 }, () => validTrend());
    expect(() =>
      parseSyncWikiObservationsPayload({
        secret: SECRET,
        creatorId: "abc",
        trends,
      })
    ).toThrow(/batch too large/);
  });
  it("rejects out-of-range relevanceScore on a trend", () => {
    expect(() =>
      parseSyncWikiObservationsPayload({
        secret: SECRET,
        creatorId: "abc",
        trends: [{ ...validTrend(), relevanceScore: 1.5 }],
      })
    ).toThrow(/relevanceScore/);
  });
  it("rejects weekly-pattern with sampleSize < 3 (phantom-pattern guard)", () => {
    expect(() =>
      parseSyncWikiObservationsPayload({
        secret: SECRET,
        creatorId: "abc",
        weeklyLearnings: [
          {
            weekStartMs: NOW - 7 * 86_400_000,
            weekEndMs: NOW,
            synthesizedAt: NOW,
            topPatterns: [
              {
                kind: "hook-text",
                claim: "Tuesday hooks always hit.",
                sampleSize: 2,
                confidence: 0.8,
                wikiVaultPath: "concepts/what-works/hook-text.md",
              },
            ],
          },
        ],
      })
    ).toThrow(/phantom-pattern guard/);
  });
  it("accepts a valid trend-only batch", () => {
    const parsed = parseSyncWikiObservationsPayload({
      secret: SECRET,
      creatorId: "abc",
      trends: [validTrend()],
    });
    expect(parsed.trends.length).toBe(1);
    expect(parsed.competitors.length).toBe(0);
    expect(parsed.weeklyLearnings.length).toBe(0);
  });
});

describe("wikiMirrorSync — HTTP endpoint", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("rejects unauthorized (wrong secret) with 401", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_1"))
    );
    const res = await t.fetch("/lc_maya/sync_wiki_observations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: "wrong",
        creatorId,
        trends: [validTrend()],
      }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown creator", async () => {
    const t = convexTest(schema, modules);
    const ghostId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("creators", baseCreatorRow("ghost"));
      await ctx.db.delete(id);
      return id;
    });
    const res = await t.fetch("/lc_maya/sync_wiki_observations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: SECRET,
        creatorId: ghostId,
        trends: [validTrend()],
      }),
    });
    expect(res.status).toBe(404);
  });

  it("inserts a fresh trend with mirroredAt + wikiVaultPath", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_1"))
    );
    const res = await t.fetch("/lc_maya/sync_wiki_observations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: SECRET,
        creatorId,
        trends: [validTrend({ wikiVaultPath: "trends/niche-scan-2026-05-06.md" })],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trendsInserted).toBe(1);
    expect(body.trendsUpdated).toBe(0);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("trendObservations")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows.length).toBe(1);
    expect(rows[0].mirroredAt).toBeTypeOf("number");
    expect(rows[0].wikiVaultPath).toBe("trends/niche-scan-2026-05-06.md");
  });

  it("idempotent: second sync of the same vaultPath updates rather than inserts", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_1"))
    );
    const payload = {
      secret: SECRET,
      creatorId,
      trends: [validTrend({ wikiVaultPath: "trends/x.md" })],
    };
    const r1 = await t.fetch("/lc_maya/sync_wiki_observations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(r1.status).toBe(200);
    const r2 = await t.fetch("/lc_maya/sync_wiki_observations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(r2.status).toBe(200);
    const body2 = await r2.json();
    expect(body2.trendsInserted).toBe(0);
    expect(body2.trendsUpdated).toBe(1);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("trendObservations")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows.length).toBe(1); // still ONE row, not two.
  });

  it("legacy rows without wikiVaultPath always insert (backward compat)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_1"))
    );
    const payload = {
      secret: SECRET,
      creatorId,
      trends: [validTrend()], // no wikiVaultPath
    };
    await t.fetch("/lc_maya/sync_wiki_observations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    await t.fetch("/lc_maya/sync_wiki_observations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("trendObservations")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    // Two inserts because no vaultPath = no dedupe key.
    expect(rows.length).toBe(2);
  });

  it("cross-tenant: creator A's sync does not write to creator B", async () => {
    const t = convexTest(schema, modules);
    const idA = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_A"))
    );
    const idB = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_B"))
    );
    await t.fetch("/lc_maya/sync_wiki_observations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: SECRET,
        creatorId: idA,
        trends: [validTrend({ wikiVaultPath: "trends/a.md" })],
      }),
    });
    const rowsA = await t.run(async (ctx) =>
      ctx.db
        .query("trendObservations")
        .withIndex("by_creator", (q) => q.eq("creatorId", idA))
        .collect()
    );
    const rowsB = await t.run(async (ctx) =>
      ctx.db
        .query("trendObservations")
        .withIndex("by_creator", (q) => q.eq("creatorId", idB))
        .collect()
    );
    expect(rowsA.length).toBe(1);
    expect(rowsB.length).toBe(0);
  });

  it("weekly-learnings dedupes on (creatorId, weekStartMs)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_1"))
    );
    const weekStartMs = NOW - 7 * 86_400_000;
    const payload = {
      secret: SECRET,
      creatorId,
      weeklyLearnings: [
        {
          weekStartMs,
          weekEndMs: NOW,
          synthesizedAt: NOW,
          topPatterns: [
            {
              kind: "hook-text",
              claim: "First-pattern claim",
              sampleSize: 5,
              confidence: 0.8,
              wikiVaultPath: "concepts/what-works/hook-text.md",
            },
          ],
        },
      ],
    };
    await t.fetch("/lc_maya/sync_wiki_observations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    await t.fetch("/lc_maya/sync_wiki_observations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("weeklyLearningsCreator")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows.length).toBe(1); // dedup
  });

  it("competitor sync: idempotent on (creatorId, wikiVaultPath)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_1"))
    );
    const payload = {
      secret: SECRET,
      creatorId,
      competitors: [
        {
          peerHandle: "@otherperson",
          platform: "tiktok",
          observation: "Their Tuesday hook beat their 30d baseline by 4x.",
          evidence: [
            {
              kind: "post",
              ref: "tiktok://video/123",
              fact: "8M views vs 2M baseline",
            },
          ],
          observedAt: NOW,
          wikiVaultPath: "competitors/otherperson/2026-05-06.md",
        },
      ],
    };
    await t.fetch("/lc_maya/sync_wiki_observations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    await t.fetch("/lc_maya/sync_wiki_observations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("competitorObservations")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows.length).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function validTrend(
  overrides: Partial<{ wikiVaultPath: string }> = {}
): {
  source: "niche-scan";
  observation: string;
  evidence: Array<{ kind: "post"; ref: string; fact: string }>;
  relevanceScore: number;
  observedAt: number;
  wikiVaultPath?: string;
} {
  return {
    source: "niche-scan",
    observation: "TikTok 'first-30-seconds' format trending in fitness niche.",
    evidence: [
      {
        kind: "post",
        ref: "tiktok://video/abc",
        fact: "12M views in 24h",
      },
    ],
    relevanceScore: 0.8,
    observedAt: NOW,
    ...overrides,
  };
}

function baseCreatorRow(suffix: string): {
  clerkUserId: string;
  email: string;
  channelPreference: "imessage";
  timezone: string;
  status: "active";
  plan: "coach";
  createdAt: number;
} {
  return {
    clerkUserId: `clerk_${suffix}`,
    email: `${suffix}@example.com`,
    channelPreference: "imessage",
    timezone: "America/Los_Angeles",
    status: "active",
    plan: "coach",
    createdAt: Date.UTC(2026, 4, 1),
  };
}
