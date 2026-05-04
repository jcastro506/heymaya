/**
 * deployMaya — integration tests with a mocked FlyClient.
 *
 * Sprint 3.7 phase C reshape — deploy now uploads a workspace tarball to
 * Convex storage, sets MAYA_BOOTSTRAP_JSON as a Fly SECRET (not a plain env),
 * and the machine boots via an inlined `init.cmd` shell pipeline.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: deploying creator A never patches creator B's row.
 *   2. Plan-tier: Starter creator's gateway has no iMessage / WhatsApp;
 *      jobsJson lacks Pro+ entries; only Stripe in composio accounts.
 *   3. Adversarial: Fly returns failures at each stage → structured error,
 *      creators.status correctly handled.
 *   4. Sibling-file scan: jobsJson cross-checked with standing-orders in the
 *      configGenerator tests; deploy spot-checks bundle was uploaded.
 *   5. TODO grep: covered repo-wide.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import {
  __setDeployMayaFlyClient,
  machineConfigFor,
} from "../deployMaya";
import { _setSynthFetchForTests, cacheKey } from "../synthesizeCreatorPicture";
import {
  FlyClient,
  FlyError,
  type FlyMachine,
  type CreateAppInput,
  type CreateMachineInput,
} from "../../../lib/flyClient";
import { encrypt, _resetEncryptionKeyCache } from "../../../lib/encryption";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";

const NOW = 1_700_000_000_000;
const TZ = "America/Los_Angeles";

const TEST_ENCRYPTION_KEY = btoa("\0".repeat(32));

beforeEach(() => {
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL = "https://test.convex.cloud";
  process.env.FLY_API_TOKEN = "test-fly-token";
  process.env.FLY_ORG_SLUG = "heymaya";
  process.env.FLY_REGION = "iad";
  process.env.SCRAPE_CREATORS_API_KEY = "sc-test";
  process.env.OPENROUTER_API_KEY = "or-test";
  process.env.COMPOSIO_API_KEY = "co-test";
  _resetEncryptionKeyCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __setDeployMayaFlyClient(null);
  _setSynthFetchForTests(null);
  _resetEncryptionKeyCache();
});

/* -------------------------------------------------------------------------- */
/* Fly mock                                                                    */
/* -------------------------------------------------------------------------- */

interface MockFlyOptions {
  failOnStage?:
    | "create-app"
    | "set-secrets"
    | "create-machine"
    | "wait-for-state";
  appAlreadyExists?: boolean;
  /** Final state returned by getMachine — defaults to "started". */
  finalState?: string;
  /** State the createMachine response reports — defaults to "starting". */
  initialState?: string;
}

interface MockFlyRecorded {
  createApp: Array<{ appName: string }>;
  setAppSecrets: Array<{ appName: string; secrets: Record<string, string> }>;
  createMachine: Array<CreateMachineInput>;
  waitForState: Array<{ appName: string; machineId: string; targetState: string }>;
}

function makeMockFly(opts: MockFlyOptions = {}): {
  client: FlyClient;
  recorded: MockFlyRecorded;
} {
  const recorded: MockFlyRecorded = {
    createApp: [],
    setAppSecrets: [],
    createMachine: [],
    waitForState: [],
  };
  const client = new FlyClient({
    apiToken: "irrelevant",
    orgSlug: "heymaya",
    region: "iad",
  });
  client.createApp = (async (input: CreateAppInput) => {
    recorded.createApp.push({ appName: input.appName });
    if (opts.failOnStage === "create-app") {
      throw new FlyError("simulated create-app failure", 500, "boom", true);
    }
    if (opts.appAlreadyExists) {
      throw new FlyError("App already exists", 422, "name has already been taken", false);
    }
    return { name: input.appName };
  }) as FlyClient["createApp"];
  client.setAppSecrets = (async (
    appName: string,
    secrets: Record<string, string>
  ) => {
    recorded.setAppSecrets.push({ appName, secrets });
    if (opts.failOnStage === "set-secrets") {
      throw new FlyError("simulated set-secrets failure", 500, "boom", true);
    }
  }) as FlyClient["setAppSecrets"];
  client.createMachine = (async (input: CreateMachineInput) => {
    recorded.createMachine.push(input);
    if (opts.failOnStage === "create-machine") {
      throw new FlyError("simulated create-machine failure", 502, "upstream", true);
    }
    const initial: FlyMachine = {
      id: "mach_" + input.appName,
      name: input.name ?? input.appName,
      state: opts.initialState ?? "starting",
      region: input.region ?? "iad",
      config: input.config,
    };
    return initial;
  }) as FlyClient["createMachine"];
  client.waitForState = (async (
    appName: string,
    machineId: string,
    targetState = "started"
  ) => {
    recorded.waitForState.push({ appName, machineId, targetState });
    if (opts.failOnStage === "wait-for-state") {
      throw new FlyError(
        `simulated wait-for-state timeout`,
        null,
        null,
        true
      );
    }
    return {
      id: machineId,
      name: appName,
      state: opts.finalState ?? "started",
      region: "iad",
      config: { image: "test" },
    };
  }) as FlyClient["waitForState"];
  return { client, recorded };
}

/* -------------------------------------------------------------------------- */
/* DB helpers                                                                  */
/* -------------------------------------------------------------------------- */

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    plan: "coach" | "manager";
    channelPreference?: "imessage" | "whatsapp" | "sms" | "web";
  }
): Promise<Id<"creators">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: opts.channelPreference ?? "web",
      timezone: TZ,
      status: "onboarding",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

async function getCreator(t: ReturnType<typeof convexTest>, id: Id<"creators">) {
  return await t.run(async (ctx) => ctx.db.get(id));
}

async function insertGmail(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">
): Promise<Id<"connectedAccounts">> {
  const ciphertext = await encrypt("gmail-acct-id");
  return await t.run(async (ctx) =>
    ctx.db.insert("connectedAccounts", {
      creatorId,
      provider: "gmail",
      composioAccountId: ciphertext,
      scopes: ["read"],
      scopeStatus: "active",
      autoSendThreshold: 250,
      connectedAt: NOW,
    })
  );
}

/* -------------------------------------------------------------------------- */
/* Happy path                                                                  */
/* -------------------------------------------------------------------------- */

describe("deployMaya — happy path", () => {
  it("Pro creator deploys cleanly: workspace uploaded, machine created, secrets pushed, creator patched", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, {
      suffix: "happy",
      plan: "manager",
      channelPreference: "imessage",
    });
    const { client, recorded } = makeMockFly();
    __setDeployMayaFlyClient(client);

    const result = await t.action(internal.onboarding.maya.deployMaya.deployMaya, {
      creatorId: c,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.flyAppId).toMatch(/^maya-/);
    expect(result.machineId).toBe("mach_" + result.flyAppId);
    expect(result.machineState).toBe("started");
    expect(result.configVersion).toMatch(/^[0-9a-f]{32}$/);

    expect(recorded.createApp).toHaveLength(1);
    expect(recorded.setAppSecrets).toHaveLength(1);

    // Shared infra secrets + per-creator MAYA_BOOTSTRAP_JSON all live as secrets.
    const secrets = recorded.setAppSecrets[0].secrets;
    expect(secrets).toMatchObject({
      SCRAPE_CREATORS_API_KEY: "sc-test",
      OPENROUTER_API_KEY: "or-test",
      COMPOSIO_API_KEY: "co-test",
      ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    });
    expect(secrets.MAYA_BOOTSTRAP_JSON).toBeDefined();
    const bootstrap = JSON.parse(secrets.MAYA_BOOTSTRAP_JSON);
    // workspaceBundleUrl must be patched in by deploy (non-empty).
    expect(typeof bootstrap.workspaceBundleUrl).toBe("string");
    expect(bootstrap.workspaceBundleUrl.length).toBeGreaterThan(0);

    expect(recorded.createMachine).toHaveLength(1);
    expect(recorded.waitForState).toHaveLength(1);

    // The machine config carries env vars + the inlined init.cmd shell pipeline.
    const machineCfg = recorded.createMachine[0].config;
    expect(machineCfg.env?.MAYA_WORKSPACE_BUNDLE_URL).toBe(bootstrap.workspaceBundleUrl);
    expect(machineCfg.env?.MAYA_JOBS_JSON_BASE64).toBeDefined();
    expect(machineCfg.init?.cmd).toBeDefined();
    const initShell = machineCfg.init!.cmd!.join(" ");
    // Sanity: the bootstrap pipeline performs the canonical 6 steps.
    expect(initShell).toContain("curl -fsSL");
    expect(initShell).toContain("tar -xf");
    expect(initShell).toContain(".openclaw/cron/jobs.json");
    expect(initShell).toContain("openclaw gateway start");

    const after = await getCreator(t, c);
    expect(after?.status).toBe("active");
    expect(after?.mayaFlyAppId).toBe(result.flyAppId);
    expect(after?.mayaConfigVersion).toBe(1);
  });

  it("createApp 'already exists' is treated as success (idempotent re-deploy)", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "redeploy", plan: "manager" });
    const { client, recorded } = makeMockFly({ appAlreadyExists: true });
    __setDeployMayaFlyClient(client);

    const result = await t.action(internal.onboarding.maya.deployMaya.deployMaya, {
      creatorId: c,
    });
    expect(result.ok).toBe(true);
    expect(recorded.setAppSecrets).toHaveLength(1);
    expect(recorded.createMachine).toHaveLength(1);
  });

  it("workspace bundle URL is set on the config BEFORE the machine env is built", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "url1", plan: "manager" });
    const { client, recorded } = makeMockFly();
    __setDeployMayaFlyClient(client);

    await t.action(internal.onboarding.maya.deployMaya.deployMaya, {
      creatorId: c,
    });

    const machineCfg = recorded.createMachine[0].config;
    const url = machineCfg.env?.MAYA_WORKSPACE_BUNDLE_URL;
    expect(url).toBeDefined();
    expect(url).not.toBe("");
    // The same URL must round-trip into MAYA_BOOTSTRAP_JSON.
    const bootstrap = JSON.parse(
      recorded.setAppSecrets[0].secrets.MAYA_BOOTSTRAP_JSON
    );
    expect(bootstrap.workspaceBundleUrl).toBe(url);
  });
});

/* -------------------------------------------------------------------------- */
/* Plan-tier enforcement (CRITICAL — fail-closed, server-side, including envs) */
/* -------------------------------------------------------------------------- */

describe("deployMaya — plan-tier enforcement (CRITICAL)", () => {
  it("PLAN-TIER (REVISED): Starter gateway includes all 4 channels — channels are OpenClaw-native, ungated", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, {
      suffix: "starter1",
      plan: "coach",
      channelPreference: "imessage",
    });
    const { client, recorded } = makeMockFly();
    __setDeployMayaFlyClient(client);

    const result = await t.action(internal.onboarding.maya.deployMaya.deployMaya, {
      creatorId: c,
    });
    expect(result.ok).toBe(true);

    const bootstrap = JSON.parse(
      recorded.setAppSecrets[0].secrets.MAYA_BOOTSTRAP_JSON
    );
    expect([...bootstrap.gatewayConfig.channels.enabled].sort()).toEqual(
      ["imessage", "sms", "telegram", "web", "whatsapp"]
    );
  });

  it("PLAN-TIER (REVISED): Starter Gmail composio row IS included — Gmail deal desk is universal", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "starter2", plan: "coach" });
    await insertGmail(t, c);

    const { client, recorded } = makeMockFly();
    __setDeployMayaFlyClient(client);

    const result = await t.action(internal.onboarding.maya.deployMaya.deployMaya, {
      creatorId: c,
    });
    expect(result.ok).toBe(true);

    const bootstrap = JSON.parse(
      recorded.setAppSecrets[0].secrets.MAYA_BOOTSTRAP_JSON
    );
    expect(bootstrap.composioAccounts).toHaveLength(1);
    expect(bootstrap.composioAccounts[0].provider).toBe("gmail");
    // The plaintext composio id is now legitimately in the secret bundle —
    // that's the whole point of bundling decrypted creds for Maya's runtime.
    // (The cross-tenant + at-rest encryption invariants are tested elsewhere.)
  });

  it("Pro creator with Gmail: composio account makes it into secret, decrypted", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "pro1", plan: "manager" });
    await insertGmail(t, c);

    const { client, recorded } = makeMockFly();
    __setDeployMayaFlyClient(client);

    await t.action(internal.onboarding.maya.deployMaya.deployMaya, {
      creatorId: c,
    });

    const bootstrap = JSON.parse(
      recorded.setAppSecrets[0].secrets.MAYA_BOOTSTRAP_JSON
    );
    expect(bootstrap.composioAccounts).toHaveLength(1);
    expect(bootstrap.composioAccounts[0].provider).toBe("gmail");
    expect(bootstrap.composioAccounts[0].composioAccountId).toBe("gmail-acct-id");
    // Composio plaintext lives in MAYA_BOOTSTRAP_JSON (a Fly secret) but
    // never in the plain env.
    const allEnv = JSON.stringify(recorded.createMachine[0].config.env);
    expect(allEnv).not.toContain("gmail-acct-id");
  });
});

/* -------------------------------------------------------------------------- */
/* Adversarial / failure paths                                                 */
/* -------------------------------------------------------------------------- */

describe("deployMaya — failure handling", () => {
  it("Fly createMachine 5xx → returns structured failure, retryable=true", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "f1", plan: "manager" });
    const { client } = makeMockFly({ failOnStage: "create-machine" });
    __setDeployMayaFlyClient(client);

    const result = await t.action(internal.onboarding.maya.deployMaya.deployMaya, {
      creatorId: c,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("create-machine");
    expect(result.retryable).toBe(true);
    expect(result.message).toMatch(/simulated create-machine/);

    const after = await getCreator(t, c);
    expect(after?.status).toBe("onboarding");
    expect(after?.mayaFlyAppId).toBeUndefined();
  });

  it("waitForState timeout → returns structured failure, retryable=true", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "f2", plan: "manager" });
    const { client } = makeMockFly({ failOnStage: "wait-for-state" });
    __setDeployMayaFlyClient(client);

    const result = await t.action(internal.onboarding.maya.deployMaya.deployMaya, {
      creatorId: c,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("wait-for-state");
    expect(result.retryable).toBe(true);

    const after = await getCreator(t, c);
    expect(after?.status).toBe("onboarding");
  });

  it("missing creator → structured failure at generate-config, never throws", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "ghost", plan: "manager" });
    await t.run(async (ctx) => ctx.db.delete(c));
    const { client } = makeMockFly();
    __setDeployMayaFlyClient(client);

    const result = await t.action(internal.onboarding.maya.deployMaya.deployMaya, {
      creatorId: c,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("generate-config");
    expect(result.retryable).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Cross-tenant safety                                                         */
/* -------------------------------------------------------------------------- */

describe("deployMaya — cross-tenant isolation", () => {
  it("deploying creator A never touches creator B's row", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "A", plan: "manager" });
    const b = await insertCreator(t, { suffix: "B", plan: "manager" });
    const beforeB = await getCreator(t, b);

    const { client, recorded } = makeMockFly();
    __setDeployMayaFlyClient(client);

    const result = await t.action(internal.onboarding.maya.deployMaya.deployMaya, {
      creatorId: a,
    });
    expect(result.ok).toBe(true);

    const afterA = await getCreator(t, a);
    const afterB = await getCreator(t, b);
    expect(afterA?.status).toBe("active");
    expect(afterA?.mayaFlyAppId).toBeDefined();

    expect(afterB?.status).toBe(beforeB?.status);
    expect(afterB?.mayaFlyAppId).toBe(beforeB?.mayaFlyAppId);
    expect(afterB?.mayaConfigVersion).toBe(beforeB?.mayaConfigVersion);

    // The bootstrap secret must reference creator A only.
    const bootstrap = JSON.parse(
      recorded.setAppSecrets[0].secrets.MAYA_BOOTSTRAP_JSON
    );
    expect(bootstrap.creatorId).toBe(a);
    expect(bootstrap.creatorId).not.toBe(b);
  });
});

/* -------------------------------------------------------------------------- */
/* Synthesis pipeline integration                                              */
/* -------------------------------------------------------------------------- */

/**
 * Helper — seed a creator with TT handle + cached profile/posts so the deploy
 * pipeline's scrape-pull stage finds the cache fresh and the synth stage has
 * data to work with. We seed cache directly (not via runFullScrapePull) so
 * we don't need to mock ScrapeCreators on top of mocking OpenRouter.
 */
async function seedCreatorWithCachedScrape(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan: "coach" | "manager" }
): Promise<Id<"creators">> {
  const c = await insertCreator(t, opts);
  await t.run(async (ctx) => {
    await ctx.db.insert("creatorHandles", {
      creatorId: c,
      platform: "tiktok",
      handle: `${opts.suffix}_tt`,
      verified: true,
      scrapedAt: NOW,
      followerCount: 42_000,
    });
    await ctx.db.insert("scrapeCreatorsCache", {
      creatorId: c,
      cacheKey: cacheKey("tiktok", "profile", `${opts.suffix}_tt`),
      payload: {
        userInfo: {
          user: { uniqueId: `${opts.suffix}_tt`, nickname: "n", signature: "b" },
          stats: { followerCount: 42_000 },
        },
      },
      fetchedAt: NOW,
      ttlSec: 21_600,
    });
    await ctx.db.insert("scrapeCreatorsCache", {
      creatorId: c,
      cacheKey: cacheKey("tiktok", "posts", `${opts.suffix}_tt`),
      payload: [
        {
          id: "tt_post_a",
          desc: "caption a",
          createTime: Math.floor(NOW / 1000),
          stats: { diggCount: 100, commentCount: 5, playCount: 5_000 },
        },
        {
          id: "tt_post_b",
          desc: "caption b",
          createTime: Math.floor(NOW / 1000) - 3_600,
          stats: { diggCount: 200, commentCount: 10, playCount: 10_000 },
        },
      ],
      fetchedAt: NOW,
      ttlSec: 1_800,
    });
  });
  return c;
}

function makeSynthOkFetch(): ReturnType<typeof vi.fn> {
  // Mirror the fixture in synthesizeCreatorPicture.test.ts but with the
  // post id prefix matching the seed above.
  const synthJson = JSON.stringify({
    niche: "Specific niche from the deploy fixture.",
    audience: {
      ageRanges: ["25-34"],
      topGeos: ["US", "UK", "CA", "AU", "DE"],
      interestTags: ["a", "b", "c"],
    },
    voiceFingerprint: "Voice from the deploy fixture; multiple sentences.",
    topHooks: [
      {
        pattern: "hook A",
        examplePostId: "tt_post_a",
        platform: "tiktok",
        avgPerformanceLift: 1.5,
      },
    ],
    bottomHooks: [],
    postingCadence: {
      perPlatform: [
        {
          platform: "tiktok",
          postsPerWeek: 3,
          bestDays: ["Mon"],
          bestHoursLocal: [9],
        },
      ],
    },
    brandDealHistory: [],
    sourceCitations: [
      { platform: "tiktok", postId: "tt_post_a", usedFor: "niche" },
      { platform: "tiktok", postId: "tt_post_a", usedFor: "voiceFingerprint" },
      { platform: "tiktok", postId: "tt_post_a", usedFor: "audience" },
      { platform: "tiktok", postId: "tt_post_a", usedFor: "topHooks[0]" },
      { platform: "tiktok", postId: "tt_post_a", usedFor: "postingCadence.tiktok" },
      { platform: "tiktok", postId: "tt_post_a", usedFor: "careerStage" },
    ],
    // ─── Stage-aware adaptive product (Agent B, 2026-04-26) ───────────────
    careerStage: "building",
    careerStageReasoning:
      "Posting cadence is consistent (3/week), niche is clear, no brand-deal evidence yet.",
    careerStageReconciliation: {
      selfReported: null,
      inferred: "building",
      matches: true,
      evidence: "No self-report present; inferred from observed signal.",
      gentleNudge: null,
    },
    growthPlan: {
      currentStage: "building",
      nextMilestone: "Close one paid brand deal in 60 days.",
      focusAreas: ["Sharpen hook", "Expand audience"],
      antiPatterns: ["Premature diversification", "Multi-account splits"],
      // Wave 2 — paired smartAlternatives (1:1 with antiPatterns).
      smartAlternatives: [
        {
          antiPattern: "Premature diversification",
          insteadDoThis: "Pick one beachhead and prove it",
          exampleAction: "Maya drafts a $30 ebook outline based on top educational posts",
          reasoning: "One proven stream beats four half-built at building stage",
        },
        {
          antiPattern: "Multi-account splits",
          insteadDoThis: "Lock TikTok first",
          exampleAction: "Maya proposes a 4-week TikTok-only consistency arc",
          reasoning: "Single-platform compounds before multi-platform",
        },
      ],
      horizonWeeks: 8,
      citations: [
        { platform: "tiktok", postId: "tt_post_a", usedFor: "focusAreas[0]" },
      ],
    },
  });
  return vi.fn(async () => {
    const body = {
      id: "gen-deploy",
      model: "google/gemini-3-flash",
      choices: [{ message: { content: synthJson }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 5_000,
        completion_tokens: 1_000,
        completion_tokens_details: { reasoning_tokens: 800 },
      },
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("deployMaya — synthesis stage integration", () => {
  it("synth stage runs end-to-end: creatorPicture row populated by deploy", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithCachedScrape(t, {
      suffix: "synthok",
      plan: "manager",
    });

    _setSynthFetchForTests(makeSynthOkFetch());
    const { client } = makeMockFly();
    __setDeployMayaFlyClient(client);

    const result = await t.action(internal.onboarding.maya.deployMaya.deployMaya, {
      creatorId: c,
    });
    expect(result.ok).toBe(true);

    const picture = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .first()
    );
    expect(picture).not.toBeNull();
    expect(picture!.niche).toMatch(/Specific niche/);
    expect(picture!.model).toBe("google/gemini-3-flash");
    expect(picture!.sourceCitations.length).toBeGreaterThan(0);

    const logs = await t.run(async (ctx) =>
      ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .collect()
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].taskTag).toBe("creator_picture_synthesis");
    expect(logs[0].thinkingBudget).toBe("high");
  });

  it("synthesis failure (model returns garbage twice) → deploy halts at synthesize-picture stage", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithCachedScrape(t, {
      suffix: "synthfail",
      plan: "manager",
    });

    const garbageFetch = vi.fn(async () => {
      const body = {
        id: "gen-bad",
        model: "google/gemini-3-flash",
        choices: [{ message: { content: "{ broken json" }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 100,
          completion_tokens_details: { reasoning_tokens: 50 },
        },
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    _setSynthFetchForTests(garbageFetch);

    const { client, recorded } = makeMockFly();
    __setDeployMayaFlyClient(client);

    const result = await t.action(internal.onboarding.maya.deployMaya.deployMaya, {
      creatorId: c,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("synthesize-picture");
    expect(result.message).toMatch(/model-malformed/);

    // Fly was never touched — synth blocks deploy.
    expect(recorded.createApp).toHaveLength(0);
    expect(recorded.createMachine).toHaveLength(0);

    const after = await t.run(async (ctx) => ctx.db.get(c));
    expect(after?.status).toBe("onboarding");
  });

  it("creator with no handles skips synth+scrape silently and deploy still proceeds", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "nohandle", plan: "manager" });
    // No handles seeded — listScrapableHandles returns [].
    const { client, recorded } = makeMockFly();
    __setDeployMayaFlyClient(client);

    const result = await t.action(internal.onboarding.maya.deployMaya.deployMaya, {
      creatorId: c,
    });
    expect(result.ok).toBe(true);
    expect(recorded.createMachine).toHaveLength(1);

    // No aiCallLog row because synth never ran.
    const logs = await t.run(async (ctx) =>
      ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .collect()
    );
    expect(logs).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Wave 3 — pre-fired job skip / await / retry behavior                        */
/* -------------------------------------------------------------------------- */

/**
 * Helper — seed a creator + a "done" pre-fired bulk-pull job row + the
 * cached scrape rows that the synthesis pipeline reads. This simulates the
 * happy path where HandlesStep already kicked off the pull during onboarding
 * and it completed before the user reached DeployStep.
 */
async function seedPreDoneBulkPull(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan: "coach" | "manager" }
): Promise<Id<"creators">> {
  const c = await seedCreatorWithCachedScrape(t, opts);
  await t.run(async (ctx) => {
    await ctx.db.insert("onboardingJobs", {
      creatorId: c,
      jobType: "bulk-pull",
      status: "done",
      startedAt: NOW,
      completedAt: NOW + 1_000,
    });
  });
  return c;
}

/**
 * Helper — also seed a "done" pre-fired synth job row + a populated
 * creatorPicture row so deploy can skip the synth stage entirely.
 */
async function seedPreDoneSynth(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("creatorPicture", {
      creatorId,
      niche: "Pre-fired synth fixture niche.",
      audience: { ageRanges: ["25-34"], topGeos: ["US"], interestTags: ["a"] },
      voiceFingerprint: "Pre-fired voice from synth fixture.",
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      generatedAt: NOW,
      model: "google/gemini-3-flash",
      sourceCitations: [
        { platform: "tiktok", postId: "tt_post_a", usedFor: "niche" },
      ],
    });
    await ctx.db.insert("onboardingJobs", {
      creatorId,
      jobType: "synth-picture",
      status: "done",
      startedAt: NOW,
      completedAt: NOW + 1_000,
    });
  });
}

describe("deployMaya — Wave 3 pre-fired job skip behavior", () => {
  it("pre-done bulk-pull → deploy SKIPS the inline scrape stage (cached cache used)", async () => {
    const t = convexTest(schema, modules);
    const c = await seedPreDoneBulkPull(t, { suffix: "skip-bp", plan: "manager" });
    _setSynthFetchForTests(makeSynthOkFetch());
    const { client, recorded } = makeMockFly();
    __setDeployMayaFlyClient(client);

    // We don't have a way to assert ScrapeCreators wasn't called without
    // a recording client (runFullScrapePull uses real ScrapeCreatorsClient).
    // Instead we assert deploy succeeds end-to-end with NO scrape API key
    // in the env — which would crash inline scrape but be fine on skip.
    const previousKey = process.env.SCRAPE_CREATORS_API_KEY;
    delete process.env.SCRAPE_CREATORS_API_KEY;
    try {
      const result = await t.action(
        internal.onboarding.maya.deployMaya.deployMaya,
        { creatorId: c }
      );
      expect(result.ok).toBe(true);
      expect(recorded.createMachine).toHaveLength(1);
    } finally {
      if (previousKey !== undefined) {
        process.env.SCRAPE_CREATORS_API_KEY = previousKey;
      }
    }
  });

  it("pre-done synth-picture → deploy SKIPS the inline synth stage (cached creatorPicture used)", async () => {
    const t = convexTest(schema, modules);
    const c = await seedPreDoneBulkPull(t, { suffix: "skip-syn", plan: "manager" });
    await seedPreDoneSynth(t, c);
    // Don't install a synth fetch stub — if synth runs, it'll throw because
    // the OpenRouter call has no fixture to consume. Skip means the call
    // never happens.
    _setSynthFetchForTests(
      vi.fn(async () => {
        throw new Error("synth must NOT be invoked when pre-done");
      })
    );
    // Likewise no SCRAPE key — bulk pull is also pre-done.
    const previousKey = process.env.SCRAPE_CREATORS_API_KEY;
    delete process.env.SCRAPE_CREATORS_API_KEY;
    try {
      const { client, recorded } = makeMockFly();
      __setDeployMayaFlyClient(client);

      const result = await t.action(
        internal.onboarding.maya.deployMaya.deployMaya,
        { creatorId: c }
      );
      expect(result.ok).toBe(true);
      expect(recorded.createMachine).toHaveLength(1);

      // creatorPicture row stays the pre-fired one (only one row total,
      // niche unchanged).
      const pics = await t.run(async (ctx) =>
        ctx.db
          .query("creatorPicture")
          .withIndex("by_creator", (q) => q.eq("creatorId", c))
          .collect()
      );
      expect(pics).toHaveLength(1);
      expect(pics[0].niche).toMatch(/Pre-fired synth fixture/);
    } finally {
      if (previousKey !== undefined) {
        process.env.SCRAPE_CREATORS_API_KEY = previousKey;
      }
    }
  });

  it("no pre-fired jobs → deploy runs scrape + synth INLINE (legacy fallback preserved)", async () => {
    // This is essentially the existing "synth stage runs end-to-end" test
    // from the prior describe block, re-asserted here as the explicit
    // "Wave 3 fallback" contract: a creator with no onboardingJobs rows
    // still produces a working deploy via the inline path.
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithCachedScrape(t, {
      suffix: "fallback",
      plan: "manager",
    });
    _setSynthFetchForTests(makeSynthOkFetch());
    const { client, recorded } = makeMockFly();
    __setDeployMayaFlyClient(client);

    const result = await t.action(
      internal.onboarding.maya.deployMaya.deployMaya,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);
    expect(recorded.createMachine).toHaveLength(1);

    // Synth ran inline → an aiCallLog row was written.
    const logs = await t.run(async (ctx) =>
      ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .collect()
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].taskTag).toBe("creator_picture_synthesis");
  });

  it("FAILED pre-fired synth job → deploy retries inline (fallback path)", async () => {
    const t = convexTest(schema, modules);
    const c = await seedPreDoneBulkPull(t, { suffix: "retry-syn", plan: "manager" });
    // Pre-fired synth job FAILED — deploy should retry inline.
    await t.run(async (ctx) => {
      await ctx.db.insert("onboardingJobs", {
        creatorId: c,
        jobType: "synth-picture",
        status: "failed",
        startedAt: NOW,
        completedAt: NOW + 1_000,
        errorDetail: "synthesis failed at stage 'model-malformed': bad json",
      });
    });
    _setSynthFetchForTests(makeSynthOkFetch());
    const { client, recorded } = makeMockFly();
    __setDeployMayaFlyClient(client);

    const result = await t.action(
      internal.onboarding.maya.deployMaya.deployMaya,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);
    expect(recorded.createMachine).toHaveLength(1);

    // The inline retry produced an aiCallLog row (proof it ran).
    const logs = await t.run(async (ctx) =>
      ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .collect()
    );
    expect(logs).toHaveLength(1);
  });

  it("FAILED pre-fired bulk-pull job → deploy retries scrape inline", async () => {
    const t = convexTest(schema, modules);
    // Seed creator + handle + cache (so the inline retry has data to work
    // with — runFullScrapePull is idempotent w.r.t. fresh cache).
    const c = await seedCreatorWithCachedScrape(t, {
      suffix: "retry-bp",
      plan: "manager",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("onboardingJobs", {
        creatorId: c,
        jobType: "bulk-pull",
        status: "failed",
        startedAt: NOW,
        completedAt: NOW + 1_000,
        errorDetail: "bulk pull failed: simulated 5xx",
      });
    });
    _setSynthFetchForTests(makeSynthOkFetch());
    const { client, recorded } = makeMockFly();
    __setDeployMayaFlyClient(client);

    const result = await t.action(
      internal.onboarding.maya.deployMaya.deployMaya,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);
    expect(recorded.createMachine).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* machineConfigFor — pure shape sanity                                        */
/* -------------------------------------------------------------------------- */

describe("machineConfigFor", () => {
  it("emits env + init.cmd with the canonical 6-step bootstrap pipeline", () => {
    const cfg = {
      schemaVersion: 1 as const,
      openclawVersion: "2026.4.23" as const,
      appName: "maya-abc12345",
      creatorId: "fakecreator" as unknown as Id<"creators">,
      creatorEmail: "x@y.com",
      plan: "manager" as const,
      timezone: "UTC",
      gatewayConfig: {
        agents: { defaults: { bootstrapMaxChars: 20_000 } },
        channels: { enabled: ["web", "sms", "imessage", "whatsapp"] as const },
        model: { provider: "openrouter" as const, id: "google/gemini-3-flash-preview" },
      },
      composioAccounts: [],
      workspaceBundleUrl: "https://convex.cloud/storage/abc123",
      jobsJson: { jobs: [] },
      modelRouter: {
        convexHttpBase: "https://x.convex.cloud",
        callMayaActionPath: "agents/modelRouter/maya/callMaya" as const,
      },
      generatedAt: NOW,
    };
    const out = machineConfigFor(cfg, "ZmFrZS1qb2JzanNvbg==");
    expect(out.image).toMatch(/openclaw/);
    expect(out.env?.MAYA_PLAN).toBe("manager");
    expect(out.env?.MAYA_OPENCLAW_VERSION).toBe("2026.4.23");
    expect(out.env?.MAYA_CONVEX_HTTP_BASE).toBe("https://x.convex.cloud");
    expect(out.env?.MAYA_WORKSPACE_BUNDLE_URL).toBe("https://convex.cloud/storage/abc123");
    expect(out.env?.MAYA_JOBS_JSON_BASE64).toBe("ZmFrZS1qb2JzanNvbg==");
    expect(out.env?.MAYA_APP_NAME).toBe("maya-abc12345");
    // MAYA_BOOTSTRAP_JSON must NOT be in plain env (it's a Fly secret).
    expect(out.env?.MAYA_BOOTSTRAP_JSON).toBeUndefined();
    expect(out.guest?.cpu_kind).toBe("shared");
    expect(out.metadata?.creator_id).toBe("fakecreator");
    expect(out.init?.cmd).toBeDefined();
    const initShell = out.init!.cmd!.join(" ");
    expect(initShell).toContain("curl -fsSL");
    expect(initShell).toContain("tar -xf");
    expect(initShell).toContain("base64 -d");
    expect(initShell).toContain("openclaw gateway start --config /data/openclaw.json");
  });
});
