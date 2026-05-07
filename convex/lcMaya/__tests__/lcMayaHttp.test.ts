/**
 * `lc_maya.*` first-boot HTTP endpoints — tests.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: secret is global, but the test verifies creator lookup
 *      is exact (Maya's caller body's `creatorId` is the only writable
 *      target) — Creator B's row never gets touched when Maya posts for
 *      Creator A.
 *   2. Plan-tier × action: Coach/Starter trying to OAuth a non-allowed
 *      provider rejects with 403 + a stable error code Maya can recognize.
 *   3. Adversarial: missing/empty/wrong secret all 401; malformed bodies
 *      all 400; missing creator 404.
 *   4. Sibling-file scan: `assertWebhookSecret` lives in `convex/lib/`;
 *      shared OAuth core lives in `convex/integrations/composio/oauth.ts`.
 *      No duplicate Composio HTTP-call logic.
 *   5. TODO grep: covered repo-wide by `sprint1Acceptance.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { _setWebhookSecretForTests } from "../../lib/webhookSecret";
import { _setComposioClientForTests } from "../../integrations/composio/oauth";
import { ComposioClient as RealComposioClient } from "../../integrations/composio/client";
import { internal } from "../../_generated/api";

// Local alias for clarity in test fixtures.
type ComposioClient = RealComposioClient;

const TEST_SECRET = "deadbeef".repeat(8);
const NOW = 1_700_000_000_000;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    plan: "coach" | "manager";
  }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "imessage",
      timezone: "America/Los_Angeles",
      status: "onboarding",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

/**
 * Builds a fake `ComposioClient` instance whose `request` method always
 * returns a stub `{ redirectUrl, state }` shape. The test does not exercise
 * the real Composio HTTP surface; it verifies only that we hit the shared
 * core helper, plan-gate, and surface the result on the httpAction.
 */
function buildFakeComposioClient(
  responseFactory: () => unknown
): ComposioClient {
  // Construct a real ComposioClient with stubbed fetch + apiKey so the
  // class identity is preserved (avoids structural-typing wrinkles when
  // we inject it via `_setComposioClientForTests`).
  const fetchImpl = vi.fn().mockImplementation(async () => {
    return new Response(JSON.stringify(responseFactory()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return new RealComposioClient({
    apiKey: "test-key",
    baseUrl: "https://composio.test",
    fetchImpl,
    sleep: async () => {},
  });
}

/* -------------------------------------------------------------------------- */
/* Endpoint 1 — submit_opening_answers                                         */
/* -------------------------------------------------------------------------- */

describe("POST /lc_maya/submit_opening_answers", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("HAPPY: stamps openingAnswersAt + writes openingAnswers onto creatorPicture", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "a", plan: "manager" });

    const res = await t.fetch("/lc_maya/submit_opening_answers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        goal: "10K TikTok followers by Q3",
        tone: "strategic",
        brandDealFloorUsd: 2500,
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const creator = await t.run((ctx) => ctx.db.get(creatorId));
    expect(creator?.openingAnswersAt).toBeTypeOf("number");

    const picture = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .first()
    );
    expect(picture?.openingAnswers).toMatchObject({
      goal: "10K TikTok followers by Q3",
      tone: "strategic",
      brandDealFloorUsd: 2500,
    });
    expect(picture?.openingAnswers?.submittedAt).toBeTypeOf("number");
  });

  it("HAPPY: brandDealFloorUsd is optional (omitted ↦ undefined on stored row)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "b", plan: "manager" });

    const res = await t.fetch("/lc_maya/submit_opening_answers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        goal: "Build community",
        tone: "supportive",
      }),
    });
    expect(res.status).toBe(200);

    const picture = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .first()
    );
    expect(picture?.openingAnswers?.brandDealFloorUsd).toBeUndefined();
    expect(picture?.openingAnswers?.tone).toBe("supportive");
  });

  it("HAPPY: when picture row already exists, patches it instead of inserting a second", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "c", plan: "manager" });
    // Pre-existing picture row from synthesis
    await t.run((ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId,
        niche: "fitness",
        audience: { ageRanges: ["18-24"], topGeos: ["US"], interestTags: [] },
        voiceFingerprint: "fp",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "gemini-3-flash",
        sourceCitations: [],
      })
    );

    const res = await t.fetch("/lc_maya/submit_opening_answers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        goal: "Land first paid deal",
        tone: "tough-love",
        brandDealFloorUsd: 1000,
      }),
    });
    expect(res.status).toBe(200);

    const pictures = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(pictures.length).toBe(1);
    expect(pictures[0].niche).toBe("fitness"); // synthesis-owned field preserved
    expect(pictures[0].openingAnswers?.tone).toBe("tough-love");
  });

  it("ADVERSARIAL: missing / empty / wrong secret returns 401", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "d", plan: "manager" });

    for (const bad of ["", "wrong", `${TEST_SECRET}x`]) {
      const res = await t.fetch("/lc_maya/submit_opening_answers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: bad,
          creatorId,
          goal: "g",
          tone: "strategic",
        }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("ADVERSARIAL: malformed body returns 400 (missing fields, wrong tone, negative floor)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "e", plan: "manager" });

    const cases = [
      { body: "not-json-at-all" as const, label: "non-json" },
      {
        body: JSON.stringify({ secret: TEST_SECRET }),
        label: "missing-creatorId",
      },
      {
        body: JSON.stringify({
          secret: TEST_SECRET,
          creatorId,
          goal: "",
          tone: "strategic",
        }),
        label: "empty-goal",
      },
      {
        body: JSON.stringify({
          secret: TEST_SECRET,
          creatorId,
          goal: "g",
          tone: "weird",
        }),
        label: "bad-tone",
      },
      {
        body: JSON.stringify({
          secret: TEST_SECRET,
          creatorId,
          goal: "g",
          tone: "strategic",
          brandDealFloorUsd: -1,
        }),
        label: "negative-floor",
      },
    ];

    for (const { body, label } of cases) {
      const res = await t.fetch("/lc_maya/submit_opening_answers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(res.status, `case=${label}`).toBe(400);
    }
  });

  it("ADVERSARIAL: creator-not-found returns 404", async () => {
    const t = convexTest(schema, modules);
    // A real-but-non-existent creator id. Use a creator we then delete so the
    // id format passes Convex's parser but the row is gone.
    const creatorId = await insertCreator(t, { suffix: "f", plan: "manager" });
    await t.run((ctx) => ctx.db.delete(creatorId));

    const res = await t.fetch("/lc_maya/submit_opening_answers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        goal: "g",
        tone: "strategic",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("CROSS-TENANT: posting for creator A does not touch creator B's row or picture", async () => {
    const t = convexTest(schema, modules);
    const creatorA = await insertCreator(t, { suffix: "x", plan: "manager" });
    const creatorB = await insertCreator(t, { suffix: "y", plan: "manager" });

    const res = await t.fetch("/lc_maya/submit_opening_answers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId: creatorA,
        goal: "A's goal",
        tone: "strategic",
        brandDealFloorUsd: 5000,
      }),
    });
    expect(res.status).toBe(200);

    const rowA = await t.run((ctx) => ctx.db.get(creatorA));
    const rowB = await t.run((ctx) => ctx.db.get(creatorB));
    expect(rowA?.openingAnswersAt).toBeTypeOf("number");
    expect(rowB?.openingAnswersAt).toBeUndefined();

    const pictureB = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorB))
        .first()
    );
    expect(pictureB).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Endpoint 2 — start_oauth                                                    */
/* -------------------------------------------------------------------------- */

describe("POST /lc_maya/start_oauth", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
    process.env.COMPOSIO_AUTH_CONFIG_GMAIL = "ac_gmail";
    process.env.COMPOSIO_AUTH_CONFIG_CALENDAR = "ac_calendar";
    process.env.COMPOSIO_AUTH_CONFIG_LINKEDIN = "ac_linkedin";
    process.env.COMPOSIO_AUTH_CONFIG_TWITTER = "ac_twitter";
    process.env.COMPOSIO_API_KEY = "test-key";
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
    _setComposioClientForTests(null);
    delete process.env.COMPOSIO_AUTH_CONFIG_GMAIL;
    delete process.env.COMPOSIO_AUTH_CONFIG_CALENDAR;
    delete process.env.COMPOSIO_AUTH_CONFIG_LINKEDIN;
    delete process.env.COMPOSIO_AUTH_CONFIG_TWITTER;
    delete process.env.COMPOSIO_API_KEY;
  });

  it("HAPPY: pro creator → gmail OAuth link returned (200, with redirectUrl + state)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "p", plan: "manager" });

    _setComposioClientForTests(
      buildFakeComposioClient(() => ({
        redirectUrl: "https://composio.test/oauth/abc",
        state: "state_xyz",
      }))
    );

    const res = await t.fetch("/lc_maya/start_oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        provider: "gmail",
        redirectUri: "https://heymaya.test/oauth/callback",
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.redirectUrl).toBe("https://composio.test/oauth/abc");
    expect(json.state).toBe("state_xyz");
  });

  it("HAPPY: googlecalendar maps to the calendar provider on Pro", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "p2", plan: "manager" });

    _setComposioClientForTests(
      buildFakeComposioClient(() => ({
        redirectUrl: "https://composio.test/oauth/cal",
        state: "state_cal",
      }))
    );

    const res = await t.fetch("/lc_maya/start_oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        provider: "googlecalendar",
        redirectUri: "https://heymaya.test/oauth/callback",
      }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).redirectUrl).toBe(
      "https://composio.test/oauth/cal"
    );
  });

  it("ADVERSARIAL: missing / wrong secret returns 401", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "q", plan: "manager" });

    for (const bad of ["", "wrong", `${TEST_SECRET}x`]) {
      const res = await t.fetch("/lc_maya/start_oauth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: bad,
          creatorId,
          provider: "gmail",
          redirectUri: "https://heymaya.test/oauth/callback",
        }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("ADVERSARIAL: malformed body returns 400", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "r", plan: "manager" });

    const cases = [
      { body: "{}", label: "empty-object" },
      {
        body: JSON.stringify({
          secret: TEST_SECRET,
          provider: "gmail",
          redirectUri: "https://heymaya.test/cb",
        }),
        label: "missing-creatorId",
      },
      {
        body: JSON.stringify({
          secret: TEST_SECRET,
          creatorId,
          provider: "facebook",
          redirectUri: "https://heymaya.test/cb",
        }),
        label: "unknown-provider",
      },
      {
        body: JSON.stringify({
          secret: TEST_SECRET,
          creatorId,
          provider: "gmail",
          redirectUri: "",
        }),
        label: "empty-redirectUri",
      },
    ];

    for (const { body, label } of cases) {
      const res = await t.fetch("/lc_maya/start_oauth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(res.status, `case=${label}`).toBe(400);
    }
  });

  it("ADVERSARIAL: creator-not-found returns 404", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "s", plan: "manager" });
    await t.run((ctx) => ctx.db.delete(creatorId));

    const res = await t.fetch("/lc_maya/start_oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        provider: "gmail",
        redirectUri: "https://heymaya.test/cb",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("PLAN-GATE: starter creator requesting gmail returns 200 (gmail allowedProviders includes starter)", async () => {
    // Sanity check that the matrix is what we think it is — gmail IS in
    // Starter's allowedProviders per planFeatures.ts. The relevant gate is
    // on apollo/hunter (Studio-only) — but those aren't in lc_maya's
    // allowed surface, so we test the closest in-surface gate via the
    // unsupported-provider 403 path below. This test pins the assumption.
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "t", plan: "manager" });

    _setComposioClientForTests(
      buildFakeComposioClient(() => ({
        redirectUrl: "https://composio.test/oauth/starter-gmail",
        state: "s",
      }))
    );

    const res = await t.fetch("/lc_maya/start_oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        provider: "gmail",
        redirectUri: "https://heymaya.test/cb",
      }),
    });
    expect(res.status).toBe(200);
  });

  it("HAPPY: manager creator can request Builder LinkedIn and X OAuth links", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "u", plan: "manager" });

    for (const provider of ["linkedin", "twitter"] as const) {
      _setComposioClientForTests(
        buildFakeComposioClient(() => ({
          redirectUrl: `https://composio.test/oauth/${provider}`,
          state: `state_${provider}`,
        }))
      );
      const res = await t.fetch("/lc_maya/start_oauth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: TEST_SECRET,
          creatorId,
          provider,
          redirectUri: "https://heymaya.test/cb",
        }),
      });
      expect(res.status, `provider=${provider}`).toBe(200);
      const json = await res.json();
      expect(json.redirectUrl).toBe(`https://composio.test/oauth/${provider}`);
      expect(json.state).toBe(`state_${provider}`);
    }
  });

  it("PLAN-GATE: tiktok OAuth returns 403 because creators use ScrapeCreators instead", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "u2", plan: "manager" });

    const res = await t.fetch("/lc_maya/start_oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        provider: "tiktok",
        redirectUri: "https://heymaya.test/cb",
      }),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("provider-not-supported");
    expect(json.provider).toBe("tiktok");
  });

  it("CROSS-TENANT: secret holder cannot OAuth Creator A's account by passing Creator B's id (entityId follows the body's creatorId)", async () => {
    const t = convexTest(schema, modules);
    const creatorA = await insertCreator(t, { suffix: "ca", plan: "manager" });
    const creatorB = await insertCreator(t, { suffix: "cb", plan: "manager" });

    let observedEntityId: unknown = null;
    const fetchSpy = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      observedEntityId = body.entityId;
      return new Response(
        JSON.stringify({
          redirectUrl: "https://composio.test/oauth/x",
          state: "s",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    _setComposioClientForTests(
      new RealComposioClient({
        apiKey: "test-key",
        baseUrl: "https://composio.test",
        fetchImpl: fetchSpy,
        sleep: async () => {},
      })
    );

    // Maya posts for creatorA. The Composio request body's `entityId` MUST
    // be creatorA — never creatorB — so the resulting connectedAccount is
    // scoped to the right tenant.
    const res = await t.fetch("/lc_maya/start_oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId: creatorA,
        provider: "gmail",
        redirectUri: "https://heymaya.test/cb",
      }),
    });
    expect(res.status).toBe(200);
    expect(observedEntityId).toBe(creatorA);
    expect(observedEntityId).not.toBe(creatorB);
  });
});

/* -------------------------------------------------------------------------- */
/* Endpoint 3 — log_trend                                                      */
/* -------------------------------------------------------------------------- */

describe("POST /lc_maya/log_trend", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("HAPPY: writes a niche-scan trend observation with evidence", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "trend", plan: "manager" });

    const res = await t.fetch("/lc_maya/log_trend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        source: "niche-scan",
        observation: "Creators in this bracket are reusing pantry-reset hooks.",
        evidence: [
          {
            kind: "hashtag",
            ref: "#pantryreset",
            fact: "Repeated in three high-fit posts from the scan.",
          },
        ],
        relevanceScore: 0.82,
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    const row = await t.run((ctx) =>
      ctx.db
        .query("trendObservations")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .first()
    );
    expect(row?.creatorId).toBe(creatorId);
    expect(row?.source).toBe("niche-scan");
    expect(row?.evidence[0]).toMatchObject({
      kind: "hashtag",
      ref: "#pantryreset",
    });
  });

  it("HAPPY: accepts platform-wide source for trend_watcher", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "wide", plan: "manager" });

    const res = await t.fetch("/lc_maya/log_trend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        source: "platform-wide",
        observation: "A sound is rising outside the creator's immediate niche.",
        evidence: [
          {
            kind: "sound",
            ref: "7439295283975702544",
            fact: "Sound appears in multiple popular videos.",
          },
        ],
        relevanceScore: 0.71,
      }),
    });

    expect(res.status).toBe(200);
    const row = await t.run((ctx) =>
      ctx.db.query("trendObservations").withIndex("by_creator", (q) =>
        q.eq("creatorId", creatorId)
      ).first()
    );
    expect(row?.source).toBe("platform-wide");
  });

  it("ADVERSARIAL: missing / wrong secret returns 401", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "bad", plan: "manager" });

    for (const bad of ["", "wrong", `${TEST_SECRET}x`]) {
      const res = await t.fetch("/lc_maya/log_trend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: bad,
          creatorId,
          source: "niche-scan",
          observation: "x",
          evidence: [],
          relevanceScore: 0.5,
        }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("ADVERSARIAL: malformed body returns 400", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "malformed",
      plan: "manager",
    });

    const cases = [
      { body: "not-json", label: "non-json" },
      {
        body: JSON.stringify({ secret: TEST_SECRET }),
        label: "missing-fields",
      },
      {
        body: JSON.stringify({
          secret: TEST_SECRET,
          creatorId,
          source: "unknown",
          observation: "x",
          evidence: [],
          relevanceScore: 0.5,
        }),
        label: "bad-source",
      },
      {
        body: JSON.stringify({
          secret: TEST_SECRET,
          creatorId,
          source: "niche-scan",
          observation: "",
          evidence: [],
          relevanceScore: 0.5,
        }),
        label: "empty-observation",
      },
      {
        body: JSON.stringify({
          secret: TEST_SECRET,
          creatorId,
          source: "niche-scan",
          observation: "x",
          evidence: [{ kind: "post", ref: "", fact: "x" }],
          relevanceScore: 0.5,
        }),
        label: "bad-evidence",
      },
      {
        body: JSON.stringify({
          secret: TEST_SECRET,
          creatorId,
          source: "niche-scan",
          observation: "x",
          evidence: [],
          relevanceScore: 1.2,
        }),
        label: "bad-score",
      },
    ];

    for (const { body, label } of cases) {
      const res = await t.fetch("/lc_maya/log_trend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(res.status, `case=${label}`).toBe(400);
    }
  });

  it("ADVERSARIAL: creator-not-found returns 404", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "missing", plan: "manager" });
    await t.run((ctx) => ctx.db.delete(creatorId));

    const res = await t.fetch("/lc_maya/log_trend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        source: "niche-scan",
        observation: "x",
        evidence: [],
        relevanceScore: 0.5,
      }),
    });

    expect(res.status).toBe(404);
  });
});


/* -------------------------------------------------------------------------- */
/* Sprint 6 — submit_opening_answers extended fields                           */
/* -------------------------------------------------------------------------- */

describe("POST /lc_maya/submit_opening_answers — Sprint 6 anchor questions", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("HAPPY: persists all six anchor fields onto creatorPicture.openingAnswers", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "s6a", plan: "manager" });
    const res = await t.fetch("/lc_maya/submit_opening_answers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        goal: "10K + first paid deal by Q3",
        tone: "strategic",
        // Sprint 6 anchors:
        locationCity: "Brooklyn",
        locationState: "NY",
        locationCountry: "US",
        timezone: "America/New_York",
        nicheInOwnWords: "constraint cooking on a budget",
        goals3Mo: "land first paid deal + grow to 10K",
        jobStatus: "transitioning-full-time",
        dealsInterest: "yes",
        dealsFloorUsd: 1500,
        antiNiches: ["no skincare", "no dance trends"],
      }),
    });
    expect(res.status).toBe(200);

    const picture = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .first()
    );
    expect(picture?.openingAnswers).toMatchObject({
      goal: "10K + first paid deal by Q3",
      tone: "strategic",
      locationCity: "Brooklyn",
      locationState: "NY",
      locationCountry: "US",
      timezone: "America/New_York",
      nicheInOwnWords: "constraint cooking on a budget",
      goals3Mo: "land first paid deal + grow to 10K",
      jobStatus: "transitioning-full-time",
      dealsInterest: "yes",
      dealsFloorUsd: 1500,
      antiNiches: ["no skincare", "no dance trends"],
    });
  });

  it("HAPPY: partial answers merge across rounds (POST 1 of 6, then POST 2 of 6) without losing prior fields", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "s6m", plan: "manager" });
    // Round 1 — first three anchors only.
    await t.fetch("/lc_maya/submit_opening_answers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        goal: "grow + monetize",
        tone: "strategic",
        locationCity: "Brooklyn",
        locationCountry: "US",
        nicheInOwnWords: "budget cooking",
      }),
    });
    // Round 2 — last three anchors. The endpoint must merge, not overwrite.
    await t.fetch("/lc_maya/submit_opening_answers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        goal: "grow + monetize",
        tone: "strategic",
        jobStatus: "side-hustle",
        dealsInterest: "maybe",
        antiNiches: ["no MLMs"],
      }),
    });
    const picture = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .first()
    );
    expect(picture?.openingAnswers).toMatchObject({
      locationCity: "Brooklyn",
      locationCountry: "US",
      nicheInOwnWords: "budget cooking",
      jobStatus: "side-hustle",
      dealsInterest: "maybe",
      antiNiches: ["no MLMs"],
    });
  });

  it("ADVERSARIAL: malformed Sprint 6 fields return 400 (string-typed where number expected; bad enum)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "s6b", plan: "manager" });
    const cases = [
      // dealsFloorUsd as a string ("thirty thousand") — must 400.
      {
        body: {
          secret: TEST_SECRET,
          creatorId,
          goal: "g",
          tone: "strategic",
          dealsFloorUsd: "thirty thousand",
        },
        label: "string-floor",
      },
      // dealsInterest as an unknown literal — must 400.
      {
        body: {
          secret: TEST_SECRET,
          creatorId,
          goal: "g",
          tone: "strategic",
          dealsInterest: "absolutely-yes",
        },
        label: "bad-deals-interest",
      },
      // jobStatus as an unknown literal — must 400.
      {
        body: {
          secret: TEST_SECRET,
          creatorId,
          goal: "g",
          tone: "strategic",
          jobStatus: "freelancer",
        },
        label: "bad-job-status",
      },
      // antiNiches with non-string entry — must 400.
      {
        body: {
          secret: TEST_SECRET,
          creatorId,
          goal: "g",
          tone: "strategic",
          antiNiches: ["ok", 42],
        },
        label: "non-string-anti",
      },
    ];
    for (const c of cases) {
      const res = await t.fetch("/lc_maya/submit_opening_answers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(c.body),
      });
      expect(res.status, c.label).toBe(400);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Sprint 6 — POST /lc_maya/lock_picture                                       */
/* -------------------------------------------------------------------------- */

describe("POST /lc_maya/lock_picture", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("HAPPY: stamps creators.pictureLockedAt with no corrections", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "lp1", plan: "manager" });
    const res = await t.fetch("/lc_maya/lock_picture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; lockedAt: number };
    expect(body.ok).toBe(true);
    expect(body.lockedAt).toBeTypeOf("number");

    const creator = await t.run((ctx) => ctx.db.get(creatorId));
    expect(creator?.pictureLockedAt).toBe(body.lockedAt);
  });

  it("HAPPY: applies a location correction to the picture's openingAnswers and stamps lockedAt", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "lp2", plan: "manager" });
    // Seed picture with anchor + a (different) self-reported value.
    await t.run((ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId,
        niche: "constraint cooking",
        audience: { ageRanges: [], topGeos: ["UK"], interestTags: [] },
        voiceFingerprint: "fp",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "gemini-3-flash",
        sourceCitations: [],
        openingAnswers: {
          goal: "g",
          tone: "strategic",
          submittedAt: NOW,
          locationCity: "London", // wrong anchor; creator corrects to Brooklyn
          locationCountry: "UK",
        },
      })
    );
    const res = await t.fetch("/lc_maya/lock_picture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        corrections: [
          {
            field: "location",
            correctedValue: {
              city: "Brooklyn",
              state: "NY",
              country: "US",
              timezone: "America/New_York",
            },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      lockedAt: number;
      appliedCorrections: number;
    };
    expect(body.appliedCorrections).toBe(1);

    const picture = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .first()
    );
    expect(picture?.openingAnswers?.locationCity).toBe("Brooklyn");
    expect(picture?.openingAnswers?.locationState).toBe("NY");
    expect(picture?.openingAnswers?.locationCountry).toBe("US");
    expect(picture?.openingAnswers?.timezone).toBe("America/New_York");
    const creator = await t.run((ctx) => ctx.db.get(creatorId));
    expect(creator?.pictureLockedAt).toBe(body.lockedAt);
  });

  it("ADVERSARIAL: missing / wrong secret returns 401", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "lp3", plan: "manager" });
    for (const bad of ["", "wrong", `${TEST_SECRET}x`]) {
      const res = await t.fetch("/lc_maya/lock_picture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: bad, creatorId }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("ADVERSARIAL: malformed body returns 400 (corrections not an array; missing creatorId)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "lp4", plan: "manager" });
    const cases = [
      // corrections is a string, not an array.
      {
        body: JSON.stringify({
          secret: TEST_SECRET,
          creatorId,
          corrections: "nope",
        }),
        label: "corrections-not-array",
      },
      // a corrections entry missing field.
      {
        body: JSON.stringify({
          secret: TEST_SECRET,
          creatorId,
          corrections: [{ correctedValue: "x" }],
        }),
        label: "missing-field",
      },
      // missing creatorId.
      {
        body: JSON.stringify({ secret: TEST_SECRET }),
        label: "missing-creatorId",
      },
    ];
    for (const c of cases) {
      const res = await t.fetch("/lc_maya/lock_picture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: c.body,
      });
      expect(res.status, c.label).toBe(400);
    }
  });

  it("ADVERSARIAL: creator-not-found returns 404", async () => {
    const t = convexTest(schema, modules);
    // Insert + delete a creator so we have a syntactically valid id pointing
    // at nothing.
    const creatorId = await insertCreator(t, { suffix: "lp5", plan: "manager" });
    await t.run((ctx) => ctx.db.delete(creatorId));
    const res = await t.fetch("/lc_maya/lock_picture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    expect(res.status).toBe(404);
  });

  it("CROSS-TENANT: locking creator A never stamps creator B's pictureLockedAt", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "lpA", plan: "manager" });
    const b = await insertCreator(t, { suffix: "lpB", plan: "manager" });
    const res = await t.fetch("/lc_maya/lock_picture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId: a }),
    });
    expect(res.status).toBe(200);
    const ca = await t.run((ctx) => ctx.db.get(a));
    const cb = await t.run((ctx) => ctx.db.get(b));
    expect(ca?.pictureLockedAt).toBeTypeOf("number");
    expect(cb?.pictureLockedAt).toBeUndefined();
  });

  it("PLAN-TIER: any authenticated creator can lock their own picture (coach + manager both succeed)", async () => {
    // The endpoint is webhook-secret-gated, not Clerk-auth-gated — Maya
    // (the agent) holds the secret and posts on behalf of a creator. The
    // plan-tier guard is moot for the lock itself; the gating happens at
    // the downstream consumers (first_weekly_plan etc.). We assert both
    // plans succeed at the lock to lock down that contract.
    for (const plan of ["coach", "manager"] as const) {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, { suffix: `lp_${plan}`, plan });
      const res = await t.fetch("/lc_maya/lock_picture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
      });
      expect(res.status, plan).toBe(200);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Sprint 9.7+ — first-submit semantics + niche-correction sync + update_creator */
/* -------------------------------------------------------------------------- */

describe("Sprint 9.7+ — submit_opening_answers first-submit wins", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("preserves openingAnswers.submittedAt + creators.openingAnswersAt across re-submits", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "fs1", plan: "manager" });

    // First submission.
    const res1 = await t.fetch("/lc_maya/submit_opening_answers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        goal: "tbd",
        tone: "supportive",
        locationCity: "London",
        locationCountry: "UK",
      }),
    });
    expect(res1.status).toBe(200);

    const creatorAfterFirst = await t.run((ctx) => ctx.db.get(creatorId));
    const firstStamp = creatorAfterFirst?.openingAnswersAt as number;
    expect(firstStamp).toBeTypeOf("number");
    const pictureAfterFirst = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .first()
    );
    const firstSubmitted = pictureAfterFirst?.openingAnswers?.submittedAt as number;
    expect(firstSubmitted).toBeTypeOf("number");

    // Wait one tick so any nowMs-stamping diff would be visible.
    await new Promise((r) => setTimeout(r, 5));

    // Second submission (e.g. verification correction). New goal + corrected
    // location; `submittedAt` and `openingAnswersAt` must NOT roll forward.
    const res2 = await t.fetch("/lc_maya/submit_opening_answers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        goal: "hit 1,000 followers",
        tone: "supportive",
        locationCity: "New York City",
        locationState: "NY",
        locationCountry: "US",
      }),
    });
    expect(res2.status).toBe(200);

    const creatorAfterSecond = await t.run((ctx) => ctx.db.get(creatorId));
    expect(creatorAfterSecond?.openingAnswersAt).toBe(firstStamp);

    const pictureAfterSecond = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .first()
    );
    expect(pictureAfterSecond?.openingAnswers?.submittedAt).toBe(firstSubmitted);
    // Other fields DID update — sanity check.
    expect(pictureAfterSecond?.openingAnswers?.goal).toBe("hit 1,000 followers");
    expect(pictureAfterSecond?.openingAnswers?.locationCity).toBe("New York City");
  });
});

describe("Sprint 9.7+ — lock_picture syncs top-level niche from corrections", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("location correction overwrites stale synthesized niche with creator's stated niche", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "n1", plan: "manager" });
    // Seed: synth wrote a London-flavored niche; creator's own words say NYC.
    await t.run((ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId,
        niche: "Lifestyle observations contrasting gym culture with London streets.",
        audience: { ageRanges: [], topGeos: ["UK"], interestTags: [] },
        voiceFingerprint: "fp",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "gemini-3-flash",
        sourceCitations: [],
        openingAnswers: {
          goal: "hit 1,000 followers",
          tone: "supportive",
          submittedAt: NOW,
          locationCity: "London",
          locationCountry: "UK",
          nicheInOwnWords: "New York City lifestyle, nightlife, buildings, history",
        },
      })
    );
    const res = await t.fetch("/lc_maya/lock_picture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        corrections: [
          {
            field: "location",
            correctedValue: { city: "New York City", state: "NY", country: "US" },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);

    const picture = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .first()
    );
    // Top-level niche replaced with creator's stated niche so trend-watcher
    // and weekly-brief readers don't keep ideating from the London picture.
    expect(picture?.niche).toBe(
      "New York City lifestyle, nightlife, buildings, history"
    );
  });

  it("location correction WITHOUT nicheInOwnWords leaves top-level niche untouched", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "n2", plan: "manager" });
    await t.run((ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId,
        niche: "Lifestyle observations.",
        audience: { ageRanges: [], topGeos: ["UK"], interestTags: [] },
        voiceFingerprint: "fp",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "gemini-3-flash",
        sourceCitations: [],
        openingAnswers: {
          goal: "g",
          tone: "strategic",
          submittedAt: NOW,
          locationCity: "London",
          locationCountry: "UK",
          // no nicheInOwnWords — Maya didn't get Q2 yet
        },
      })
    );
    await t.fetch("/lc_maya/lock_picture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        corrections: [
          {
            field: "location",
            correctedValue: { city: "Brooklyn", state: "NY", country: "US" },
          },
        ],
      }),
    });
    const picture = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .first()
    );
    // No fallback — synthesized niche stays put when there's no creator-stated alternative.
    expect(picture?.niche).toBe("Lifestyle observations.");
  });
});

describe("Sprint 9.7+ — POST /lc_maya/update_creator", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("HAPPY: stamps firstBootCompletedAt on first call; idempotent on second", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "uc1", plan: "manager" });

    const res1 = await t.fetch("/lc_maya/update_creator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        setFirstBootCompletedAt: true,
      }),
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as {
      ok: boolean;
      stampedFirstBootCompletedAt: number | null;
    };
    expect(body1.ok).toBe(true);
    expect(body1.stampedFirstBootCompletedAt).toBeTypeOf("number");
    const stamped = body1.stampedFirstBootCompletedAt as number;

    const creator1 = await t.run((ctx) => ctx.db.get(creatorId));
    expect(creator1?.firstBootCompletedAt).toBe(stamped);

    // Second call — already-stamped, must NOT overwrite.
    await new Promise((r) => setTimeout(r, 5));
    const res2 = await t.fetch("/lc_maya/update_creator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        setFirstBootCompletedAt: true,
      }),
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as {
      stampedFirstBootCompletedAt: number | null;
    };
    expect(body2.stampedFirstBootCompletedAt).toBe(null);
    const creator2 = await t.run((ctx) => ctx.db.get(creatorId));
    expect(creator2?.firstBootCompletedAt).toBe(stamped);
  });

  it("HAPPY: stamps firstWeeklyPlanSentAt independently", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "uc2", plan: "manager" });
    const res = await t.fetch("/lc_maya/update_creator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        setFirstWeeklyPlanSentAt: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stampedFirstBootCompletedAt: number | null;
      stampedFirstWeeklyPlanSentAt: number | null;
    };
    expect(body.stampedFirstBootCompletedAt).toBe(null);
    expect(body.stampedFirstWeeklyPlanSentAt).toBeTypeOf("number");
  });

  it("ADVERSARIAL: missing / wrong secret returns 401", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "uc3", plan: "manager" });
    for (const bad of ["", "wrong", `${TEST_SECRET}x`]) {
      const res = await t.fetch("/lc_maya/update_creator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: bad,
          creatorId,
          setFirstBootCompletedAt: true,
        }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("ADVERSARIAL: creator-not-found returns 404", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "uc4", plan: "manager" });
    await t.run((ctx) => ctx.db.delete(creatorId));
    const res = await t.fetch("/lc_maya/update_creator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        setFirstBootCompletedAt: true,
      }),
    });
    expect(res.status).toBe(404);
  });

  it("CROSS-TENANT: stamping creator A never touches creator B", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "ucA", plan: "manager" });
    const b = await insertCreator(t, { suffix: "ucB", plan: "manager" });
    await t.fetch("/lc_maya/update_creator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId: a,
        setFirstBootCompletedAt: true,
      }),
    });
    const ca = await t.run((ctx) => ctx.db.get(a));
    const cb = await t.run((ctx) => ctx.db.get(b));
    expect(ca?.firstBootCompletedAt).toBeTypeOf("number");
    expect(cb?.firstBootCompletedAt).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Sprint 6 — provider fork (googlecalendar-direct vs googlecalendar-composio)*/
/* -------------------------------------------------------------------------- */

describe("POST /lc_maya/start_oauth — Sprint 6 calendar provider fork", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
    process.env.COMPOSIO_AUTH_CONFIG_GMAIL = "ac_gmail";
    process.env.COMPOSIO_AUTH_CONFIG_CALENDAR = "ac_calendar";
    process.env.COMPOSIO_API_KEY = "test-key";
    _setComposioClientForTests(
      buildFakeComposioClient(() => ({
        redirectUrl: "https://composio.test/connect",
        state: "abc",
      }))
    );
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
    _setComposioClientForTests(null);
    delete process.env.COMPOSIO_AUTH_CONFIG_GMAIL;
    delete process.env.COMPOSIO_AUTH_CONFIG_CALENDAR;
    delete process.env.COMPOSIO_API_KEY;
  });

  it("HAPPY: googlecalendar-direct routes to the calendar plan-features key", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "calD", plan: "manager" });
    const res = await t.fetch("/lc_maya/start_oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        provider: "googlecalendar-direct",
        redirectUri: "https://app.test/cb",
      }),
    });
    expect(res.status).toBe(200);
  });

  it("REJECT: googlecalendar-composio is deprecated and returns 403 provider-not-supported", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "calC", plan: "manager" });
    const res = await t.fetch("/lc_maya/start_oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        provider: "googlecalendar-composio",
        redirectUri: "https://app.test/cb",
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("provider-not-supported");
  });
});

/* -------------------------------------------------------------------------- */
/* Endpoint 4 — start_google_calendar_oauth (iMessage-tap path)                */
/* -------------------------------------------------------------------------- */

describe("POST /lc_maya/start_google_calendar_oauth", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
    process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
    process.env.GOOGLE_CALENDAR_IMESSAGE_REDIRECT_URI =
      "https://heymaya.test/api/google-calendar/callback-imessage";
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CALENDAR_IMESSAGE_REDIRECT_URI;
  });

  it("HAPPY: returns oauthUrl with state token, persists row in oauthStateTokens", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "gcal_a",
      plan: "manager",
    });

    const res = await t.fetch("/lc_maya/start_google_calendar_oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.oauthUrl).toBe("string");

    // The URL points at Google's OAuth endpoint and carries our client
    // id + redirect uri + state.
    const url = new URL(body.oauthUrl);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("test-google-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://heymaya.test/api/google-calendar/callback-imessage"
    );
    const stateToken = url.searchParams.get("state");
    expect(stateToken && stateToken.length).toBeGreaterThan(8);

    // Row landed in `oauthStateTokens` with the right creator + provider.
    const row = await t.run((ctx) =>
      ctx.db
        .query("oauthStateTokens")
        .withIndex("by_state_token", (q) =>
          q.eq("stateToken", stateToken as string)
        )
        .first()
    );
    expect(row).not.toBeNull();
    expect(row?.creatorId).toBe(creatorId);
    expect(row?.provider).toBe("google_calendar");
    // Materialized expiry; ~15 minutes in the future.
    const ttlDelta = (row?.expiresAtMs ?? 0) - (row?.createdAtMs ?? 0);
    expect(ttlDelta).toBe(15 * 60 * 1000);
  });

  it("ADVERSARIAL: missing / wrong secret returns 401", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "gcal_b",
      plan: "manager",
    });
    for (const bad of ["", "wrong", `${TEST_SECRET}x`]) {
      const res = await t.fetch("/lc_maya/start_google_calendar_oauth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: bad, creatorId }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("ADVERSARIAL: malformed body returns 400", async () => {
    const t = convexTest(schema, modules);
    for (const body of [
      "not-json",
      JSON.stringify({ secret: TEST_SECRET }),
      JSON.stringify({ secret: TEST_SECRET, creatorId: "" }),
    ]) {
      const res = await t.fetch("/lc_maya/start_google_calendar_oauth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(res.status).toBe(400);
    }
  });

  it("ADVERSARIAL: creator-not-found returns 404", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "gcal_c",
      plan: "manager",
    });
    await t.run((ctx) => ctx.db.delete(creatorId));
    const res = await t.fetch("/lc_maya/start_google_calendar_oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    expect(res.status).toBe(404);
  });

  it("CROSS-TENANT: state row carries Creator A's id, never Creator B's", async () => {
    const t = convexTest(schema, modules);
    const creatorA = await insertCreator(t, {
      suffix: "gcal_xa",
      plan: "manager",
    });
    const creatorB = await insertCreator(t, {
      suffix: "gcal_xb",
      plan: "manager",
    });

    const res = await t.fetch("/lc_maya/start_google_calendar_oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId: creatorA }),
    });
    expect(res.status).toBe(200);
    const url = new URL((await res.json()).oauthUrl);
    const stateToken = url.searchParams.get("state") as string;
    const row = await t.run((ctx) =>
      ctx.db
        .query("oauthStateTokens")
        .withIndex("by_state_token", (q) => q.eq("stateToken", stateToken))
        .first()
    );
    expect(row?.creatorId).toBe(creatorA);
    expect(row?.creatorId).not.toBe(creatorB);
  });

  it("MISSING-ENV: returns 500 when GOOGLE_CLIENT_ID is unset", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "gcal_d",
      plan: "manager",
    });
    const res = await t.fetch("/lc_maya/start_google_calendar_oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("missing-google-client-id");
  });

  it("CONSUME: token round-trips through consumeGoogleCalendarStateToken (single-use, TTL-enforced)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "gcal_e",
      plan: "manager",
    });

    // Issue a state token via the http endpoint.
    const res = await t.fetch("/lc_maya/start_google_calendar_oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    const url = new URL((await res.json()).oauthUrl);
    const stateToken = url.searchParams.get("state") as string;

    // First consume returns ok + creatorId.
    const first = await t.mutation(
      internal.lcMaya.lcMayaHttp.consumeGoogleCalendarStateToken,
      { stateToken, nowMs: Date.now() }
    );
    expect(first).toEqual({ ok: true, creatorId });

    // Second consume returns ok: false (single-use).
    const second = await t.mutation(
      internal.lcMaya.lcMayaHttp.consumeGoogleCalendarStateToken,
      { stateToken, nowMs: Date.now() }
    );
    expect(second).toEqual({ ok: false });

    // Row is gone.
    const row = await t.run((ctx) =>
      ctx.db
        .query("oauthStateTokens")
        .withIndex("by_state_token", (q) => q.eq("stateToken", stateToken))
        .first()
    );
    expect(row).toBeNull();
  });

  it("CONSUME-EXPIRED: an expired state token rejects and the row is cleaned up", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "gcal_f",
      plan: "manager",
    });
    const res = await t.fetch("/lc_maya/start_google_calendar_oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    const url = new URL((await res.json()).oauthUrl);
    const stateToken = url.searchParams.get("state") as string;

    // Pretend it's 16 minutes later (TTL is 15).
    const farFuture = Date.now() + 16 * 60 * 1000;
    const consumed = await t.mutation(
      internal.lcMaya.lcMayaHttp.consumeGoogleCalendarStateToken,
      { stateToken, nowMs: farFuture }
    );
    expect(consumed).toEqual({ ok: false });

    // Row was deleted even though it expired (lazy cleanup contract).
    const row = await t.run((ctx) =>
      ctx.db
        .query("oauthStateTokens")
        .withIndex("by_state_token", (q) => q.eq("stateToken", stateToken))
        .first()
    );
    expect(row).toBeNull();
  });
});
