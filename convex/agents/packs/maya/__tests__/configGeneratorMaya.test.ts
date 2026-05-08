/**
 * configGeneratorMaya — unit + integration coverage.
 *
 * Sprint 3.7 phase C reshape — `MayaConfig` no longer carries channels.primary,
 * heartbeat.intervalSec, cronEnablement, or thinkingBudget.perTaskTag (those
 * are owned by OpenClaw natively now). The plan-tier matrix moved into
 * `gatewayConfig.channels` + the embedded `jobsJson`.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: creator A's config never references creator B's data.
 *   2. Plan-tier × action matrix: Starter creator's gateway has no
 *      WhatsApp/iMessage; jobsJson has only Starter-allowed entries; only
 *      Stripe in composio accounts.
 *   3. Adversarial: missing creator throws clear error; revoked composio
 *      account skipped.
 *   4. Sibling-file scan: every cron job in jobsJson maps to a standing-orders
 *      program (assembleWorkspaceBundle owns the cross-check; we just spot-check
 *      that jobsJson is non-empty + plan-correct).
 *   5. TODO grep: covered by repo-wide grep, not test-local.
 *
 * Plus the local determinism contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../../schema";
import { internal } from "../../../../_generated/api";
import {
  buildMayaConfig,
  MAYA_BOOTSTRAP_MAX_CHARS,
  type BuildInputs,
} from "../configGeneratorMaya";
import { encrypt, _resetEncryptionKeyCache } from "../../../../lib/encryption";
import { modules } from "../../../../../tests/_modules";
import type { Doc, Id } from "../../../../_generated/dataModel";

const NOW = 1_700_000_000_000;
const TZ = "America/Los_Angeles";

// 32-byte key (base64 of 32 zero bytes for predictable tests).
const TEST_ENCRYPTION_KEY = btoa("\0".repeat(32));

beforeEach(() => {
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL = "https://test.convex.cloud";
  _resetEncryptionKeyCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetEncryptionKeyCache();
  delete process.env.OPENROUTER_DEFAULT_MODEL;
  delete process.env.CLAW_MESSENGER_API_KEY;
});

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

type Plan = "coach" | "manager";

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    plan: Plan;
    channelPreference?: "imessage" | "whatsapp" | "sms" | "web";
    primaryHandle?: string;
  }
): Promise<Id<"creators">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      ...(opts.primaryHandle ? { primaryHandle: opts.primaryHandle } : {}),
      channelPreference: opts.channelPreference ?? "web",
      timezone: TZ,
      status: "onboarding",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

async function insertHandle(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  platform:
    | "tiktok"
    | "instagram"
    | "youtube"
    | "linkedin"
    | "x"
    | "threads"
    | "reddit"
    | "pinterest",
  handle: string,
  followerCount = 25_000
): Promise<Id<"creatorHandles">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("creatorHandles", {
      creatorId,
      platform,
      handle,
      verified: true,
      scrapedAt: NOW,
      followerCount,
    })
  );
}

async function insertConnectedAccount(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  provider: "gmail" | "stripe" | "calendar" | "apollo" | "hunter",
  composioPlaintext: string,
  status: "active" | "revoked" | "expired" = "active"
): Promise<Id<"connectedAccounts">> {
  const ciphertext = await encrypt(composioPlaintext);
  return await t.run(async (ctx) =>
    ctx.db.insert("connectedAccounts", {
      creatorId,
      provider,
      composioAccountId: ciphertext,
      scopes: ["read", "write"],
      scopeStatus: status,
      autoSendThreshold: provider === "gmail" ? 500 : undefined,
      connectedAt: NOW,
    })
  );
}

/* -------------------------------------------------------------------------- */
/* Pure-function tests for buildMayaConfig                                     */
/* -------------------------------------------------------------------------- */

function fakeCreator(plan: Plan, overrides: Partial<Doc<"creators">> = {}): Doc<"creators"> {
  return {
    _id: "fake_creator_id_12345" as unknown as Id<"creators">,
    _creationTime: NOW,
    clerkUserId: "u_fake",
    email: "fake@test.com",
    channelPreference: "web",
    timezone: TZ,
    status: "onboarding",
    plan,
    createdAt: NOW,
    ...overrides,
  };
}

function emptyInputs(plan: Plan): BuildInputs {
  return {
    creator: fakeCreator(plan),
    picture: null,
    handles: [],
    connectedAccounts: [],
    decryptedComposioAccounts: new Map(),
  };
}

describe("buildMayaConfig — determinism", () => {
  it("same inputs at same `now` → bit-identical config + version", () => {
    const a = buildMayaConfig(emptyInputs("manager"), NOW);
    const b = buildMayaConfig(emptyInputs("manager"), NOW);
    expect(a.version).toBe(b.version);
    expect(JSON.stringify(a.config)).toBe(JSON.stringify(b.config));
    // Workspace bundle bytes deterministic for same input set.
    expect(a.workspaceBundleBytes.length).toBe(b.workspaceBundleBytes.length);
  });

  it("different `now` → same version (generatedAt + workspaceBundleUrl excluded from hash)", () => {
    const a = buildMayaConfig(emptyInputs("manager"), NOW);
    const b = buildMayaConfig(emptyInputs("manager"), NOW + 5000);
    expect(a.version).toBe(b.version);
    expect(a.config.generatedAt).not.toBe(b.config.generatedAt);
  });

  it("workspaceBundleUrl is empty pre-upload — version stamp does not depend on storage URL", () => {
    // The deploy pipeline patches `config.workspaceBundleUrl` AFTER calling
    // buildMayaConfig (with the URL returned by ctx.storage.getUrl). The
    // version hash is computed once, before that patch, and is what gets
    // stored on `creators.mayaConfigVersion` — so the storage URL must be
    // excluded from the hash, otherwise re-uploads would churn the version
    // even when no creator-facing config changed.
    const a = buildMayaConfig(emptyInputs("manager"), NOW);
    const b = buildMayaConfig(emptyInputs("manager"), NOW);
    expect(a.config.workspaceBundleUrl).toBe("");
    expect(b.config.workspaceBundleUrl).toBe("");
    expect(a.version).toBe(b.version);
  });

  it("different plan → different version", () => {
    const starter = buildMayaConfig(emptyInputs("coach"), NOW);
    const pro = buildMayaConfig(emptyInputs("manager"), NOW);
    expect(starter.version).not.toBe(pro.version);
  });
});

describe("buildMayaConfig — gateway config (OpenClaw-native channels + bootstrap cap)", () => {
  it("gateway leaves channels empty unless Claw Messenger is configured", () => {
    const inputs = emptyInputs("coach");
    inputs.creator.channelPreference = "imessage";
    const { config } = buildMayaConfig(inputs, NOW);
    expect(config.gatewayConfig.channels).toEqual({});
    expect(config.gatewayConfig.channels["claw-messenger"]).toBeUndefined();
  });

  it("gateway emits Claw Messenger iMessage config when CLAW_MESSENGER_API_KEY is present", () => {
    process.env.CLAW_MESSENGER_API_KEY = "cm_live_TEST_KEY";
    const { config } = buildMayaConfig(emptyInputs("manager"), NOW);
    expect(config.gatewayConfig.channels["claw-messenger"]).toEqual({
      enabled: true,
      apiKey: "cm_live_TEST_KEY",
      serverUrl: "wss://claw-messenger.onrender.com",
      preferredService: "iMessage",
      dmPolicy: "open",
    });
    expect(config.gatewayConfig.plugins).toEqual({
      allow: ["claw-messenger"],
      load: { paths: ["/data/extensions/claw-messenger"] },
      entries: {
        "claw-messenger": { enabled: true },
        acpx: { enabled: false },
        browser: { enabled: false },
        "device-pair": { enabled: false },
        "phone-control": { enabled: false },
        "talk-voice": { enabled: false },
      },
    });
    expect(config.gatewayConfig.browser).toEqual({ enabled: false });
    expect(config.gatewayConfig.discovery).toEqual({ mdns: { mode: "off" } });
    expect(config.gatewayConfig.agents.defaults.memorySearch).toEqual({
      sync: {
        onSessionStart: false,
        onSearch: false,
        watch: false,
      },
    });
  });

  it("uses the configured OpenClaw gateway token instead of letting the gateway mutate config", () => {
    process.env.OPENCLAW_GATEWAY_TOKEN = "gateway-token-test";
    const { config } = buildMayaConfig(emptyInputs("manager"), NOW);
    expect(config.gatewayConfig.gateway.auth).toEqual({
      mode: "token",
      token: "gateway-token-test",
    });
  });

  it("bootstrapMaxChars is the Maya 48K override (Sprint 11: 44K → 48K so the signal-conditional evening_recap + matching AGENTS.md voice rule fit, alongside Sprint 10 voice rules and embedded standing orders)", () => {
    const { config } = buildMayaConfig(emptyInputs("manager"), NOW);
    expect(config.gatewayConfig.agents.defaults.bootstrapMaxChars).toBe(48_000);
    expect(MAYA_BOOTSTRAP_MAX_CHARS).toBe(48_000);
  });

  it("agents.defaults.model.primary is an OpenRouter model ref", () => {
    process.env.OPENROUTER_DEFAULT_MODEL = "google/gemini-3-flash-preview-test";
    const { config } = buildMayaConfig(emptyInputs("manager"), NOW);
    expect(config.gatewayConfig.agents.defaults.model.primary).toBe(
      "openrouter/google/gemini-3-flash-preview-test"
    );
    delete process.env.OPENROUTER_DEFAULT_MODEL;
  });

  it("does not double-prefix OpenRouter model refs", () => {
    process.env.OPENROUTER_DEFAULT_MODEL = "openrouter/google/gemini-3-flash-preview";
    const { config } = buildMayaConfig(emptyInputs("manager"), NOW);
    expect(config.gatewayConfig.agents.defaults.model.primary).toBe(
      "openrouter/google/gemini-3-flash-preview"
    );
  });
});

describe("buildMayaConfig — workspace bundle + jobsJson (replaces cronEnablement)", () => {
  it("returns a non-empty workspace bundle (tarball bytes)", () => {
    const { workspaceBundleBytes } = buildMayaConfig(emptyInputs("manager"), NOW);
    // Two zero blocks at minimum (1024 bytes), plus header+content for each file.
    expect(workspaceBundleBytes.length).toBeGreaterThan(2048);
    expect(workspaceBundleBytes).toBeInstanceOf(Uint8Array);
  });

  it("Coach's jobsJson is non-empty; Manager's is at least as large (boundary is autonomy, not cron breadth)", () => {
    const manager = buildMayaConfig(emptyInputs("manager"), NOW);
    const coach = buildMayaConfig(emptyInputs("coach"), NOW);
    // Post-coach/manager migration: both tiers run the same proactive
    // cron set. Manager's exclusive autonomy (auto-send, cold pitch,
    // hook-library auto-build) lives on event/folded triggers, not
    // cron entries — so Coach and Manager often have identical
    // jobsJson. The invariant that survives: Coach must be non-empty
    // and Manager must be at least as large.
    expect(coach.config.jobsJson.jobs.length).toBeGreaterThan(0);
    expect(manager.config.jobsJson.jobs.length).toBeGreaterThanOrEqual(
      coach.config.jobsJson.jobs.length
    );
  });

  it("jobsJson is sorted by name (deterministic for diff-stability)", () => {
    const { config } = buildMayaConfig(emptyInputs("manager"), NOW);
    const names = config.jobsJson.jobs.map((j) => j.name);
    const sortedNames = [...names].sort();
    expect(names).toEqual(sortedNames);
  });

  it("workspaceBundleUrl is empty on initial build (deployMaya patches it post-upload)", () => {
    const { config } = buildMayaConfig(emptyInputs("manager"), NOW);
    expect(config.workspaceBundleUrl).toBe("");
  });
});

describe("buildMayaConfig — handles (multi-platform)", () => {
  it("creator with 3 handles → 3 handles flow through to workspace assembly (Pro)", () => {
    const inputs = emptyInputs("manager");
    inputs.handles = [
      mkHandleDoc("youtube", "@code", 100),
      mkHandleDoc("tiktok", "@dance", 200),
      mkHandleDoc("instagram", "@food", 50),
    ];
    // All three handles must flow through to the workspace USER.md content.
    // (We assert on content rather than tar byte length because the tar
    // pads to 512-byte block boundaries, so small text additions can land
    // inside the existing pad and not change the total byte count.)
    const full = buildMayaConfig(inputs, NOW);
    const userMd = extractFileFromTar(full.workspaceBundleBytes, "USER.md");
    expect(userMd).toBeTruthy();
    expect(userMd).toContain("@code");
    expect(userMd).toContain("@dance");
    expect(userMd).toContain("@food");
  });

  it("Coach creator with 3 handles → all 3 land in workspace (maxHandles=5 post-migration)", () => {
    const inputs = emptyInputs("coach");
    inputs.handles = [
      mkHandleDoc("youtube", "@a", 1),
      mkHandleDoc("tiktok", "@b", 1),
      mkHandleDoc("instagram", "@c", 1),
    ];
    const { workspaceBundleBytes } = buildMayaConfig(inputs, NOW);
    const userMd = extractFileFromTar(workspaceBundleBytes, "USER.md");
    expect(userMd).toBeTruthy();
    // All three handles should be present — no clamp at 3 (Coach=5).
    expect(userMd).toContain("@a");
    expect(userMd).toContain("@b");
    expect(userMd).toContain("@c");
  });
});

describe("buildMayaConfig — composio account gating", () => {
  it("PLAN-TIER (REVISED): Starter includes Gmail + Calendar + Stripe (Apollo/Hunter still Studio-only)", () => {
    const inputs = emptyInputs("coach");
    const idGmail = "ca_gmail" as unknown as Id<"connectedAccounts">;
    const idCalendar = "ca_calendar" as unknown as Id<"connectedAccounts">;
    const idStripe = "ca_stripe" as unknown as Id<"connectedAccounts">;
    const idApollo = "ca_apollo" as unknown as Id<"connectedAccounts">;
    inputs.connectedAccounts = [
      mkAccountDoc(idGmail, "gmail"),
      mkAccountDoc(idCalendar, "calendar"),
      mkAccountDoc(idStripe, "stripe"),
      mkAccountDoc(idApollo, "apollo"),
    ];
    inputs.decryptedComposioAccounts = new Map([
      [idGmail, "gmail-token"],
      [idCalendar, "calendar-token"],
      [idStripe, "stripe-token"],
      [idApollo, "apollo-token"],
    ]);
    const { config } = buildMayaConfig(inputs, NOW);
    const providers = config.composioAccounts.map((a) => a.provider).sort();
    expect(providers).toEqual(["calendar", "gmail", "stripe"]);
    // Apollo intentionally dropped on Starter (Studio-only).
    expect(providers).not.toContain("apollo");
  });

  it("revoked / expired accounts are dropped even on Pro tier", () => {
    const inputs = emptyInputs("manager");
    const idA = "ca_a" as unknown as Id<"connectedAccounts">;
    const idB = "ca_b" as unknown as Id<"connectedAccounts">;
    inputs.connectedAccounts = [
      mkAccountDoc(idA, "gmail", "active"),
      mkAccountDoc(idB, "calendar", "revoked"),
    ];
    inputs.decryptedComposioAccounts = new Map([
      [idA, "tok-a"],
      [idB, "tok-b"],
    ]);
    const { config } = buildMayaConfig(inputs, NOW);
    expect(config.composioAccounts.map((a) => a.provider)).toEqual(["gmail"]);
  });

  it("composio composioAccountId in config is the DECRYPTED plaintext", () => {
    const inputs = emptyInputs("manager");
    const id = "ca_x" as unknown as Id<"connectedAccounts">;
    inputs.connectedAccounts = [mkAccountDoc(id, "gmail")];
    inputs.decryptedComposioAccounts = new Map([[id, "PLAIN-COMPOSIO-ID"]]);
    const { config } = buildMayaConfig(inputs, NOW);
    expect(config.composioAccounts[0].composioAccountId).toBe("PLAIN-COMPOSIO-ID");
  });
});

/* -------------------------------------------------------------------------- */
/* Convex action surface tests                                                 */
/* -------------------------------------------------------------------------- */

describe("generateMayaConfig — Convex action surface", () => {
  it("happy path: pulls inputs from Convex, decrypts composio, returns deploy bundle (no bytes)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "happy",
      plan: "manager",
      channelPreference: "imessage",
      primaryHandle: "@happy",
    });
    await insertHandle(t, creatorId, "tiktok", "@happy", 50_000);
    await insertHandle(t, creatorId, "instagram", "@happy_ig", 30_000);
    await insertConnectedAccount(t, creatorId, "gmail", "real-composio-id-xyz");

    const bundle = await t.action(
      internal.agents.packs.maya.configGeneratorMaya.generateMayaConfig,
      { creatorId, nowOverride: NOW }
    );
    expect(bundle.config.creatorId).toBe(creatorId);
    expect(bundle.config.plan).toBe("manager");
    expect(bundle.config.composioAccounts).toHaveLength(1);
    expect(bundle.config.composioAccounts[0].composioAccountId).toBe(
      "real-composio-id-xyz"
    );
    expect(
      "telegram" in bundle.config.gatewayConfig.channels
    ).toBe(false);
    expect(bundle.version).toMatch(/^[0-9a-f]{32}$/);
    // The action uploads the workspace tarball internally and patches the
    // URL onto the config — bytes never cross the action boundary (Convex's
    // value serializer rejects Uint8Array).
    expect(typeof bundle.config.workspaceBundleUrl).toBe("string");
    expect(bundle.config.workspaceBundleUrl.length).toBeGreaterThan(0);
    // Action return must NOT carry a Uint8Array.
    expect(
      (bundle as unknown as { workspaceBundleBytes?: unknown })
        .workspaceBundleBytes
    ).toBeUndefined();
  });

  it("missing creator → throws clear error", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "ghost", plan: "manager" });
    await t.run(async (ctx) => ctx.db.delete(creatorId));

    await expect(
      t.action(
        internal.agents.packs.maya.configGeneratorMaya.generateMayaConfig,
        { creatorId, nowOverride: NOW }
      )
    ).rejects.toThrow(/not found/);
  });

  it("cross-tenant: generating for creator A never reads creator B's handles", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "A", plan: "manager" });
    const b = await insertCreator(t, { suffix: "B", plan: "manager" });
    await insertHandle(t, a, "tiktok", "@a_only", 1);
    await insertHandle(t, b, "tiktok", "@b_only", 2);
    await insertHandle(t, b, "instagram", "@b_ig", 3);

    // Run through the Convex action — the action uploads the workspace
    // tarball and returns the URL. We then read the underlying bytes back
    // out of the convex-test in-memory storage to inspect content.
    const bundle = await t.action(
      internal.agents.packs.maya.configGeneratorMaya.generateMayaConfig,
      { creatorId: a, nowOverride: NOW }
    );
    expect(bundle.config.workspaceBundleUrl.length).toBeGreaterThan(0);

    // The URL from convex-test isn't a real HTTP-fetchable URL — pull the
    // most recent stored blob via t.run + ctx.storage.get. The convex-test
    // value serializer (also used by `t.run`'s return) rejects Uint8Array,
    // so we marshal as a plain `number[]` across the boundary.
    const byteArr = await t.run(async (ctx) => {
      const list = await ctx.db.system.query("_storage").collect();
      expect(list.length).toBeGreaterThan(0);
      const latest = list[list.length - 1];
      const blob = await ctx.storage.get(latest._id);
      if (!blob) throw new Error("storage.get returned null");
      const buf = new Uint8Array(await blob.arrayBuffer());
      return Array.from(buf);
    });
    const tarBytes = new Uint8Array(byteArr);
    const userMd = extractFileFromTar(tarBytes, "USER.md");
    expect(userMd).toContain("@a_only");
    expect(userMd).not.toContain("@b_only");
    expect(userMd).not.toContain("@b_ig");
  });

  it("Starter via Convex: gateway does not enable unused channels, Gmail/Stripe remain in composio", async () => {
    // Creator Maya uses Claw Messenger for iMessage. Telegram is intentionally
    // not enabled because readiness should reflect the channel this flow uses.
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, {
      suffix: "starter1",
      plan: "coach",
      channelPreference: "imessage",
    });
    await insertHandle(t, c, "tiktok", "@s", 5_000);
    await insertConnectedAccount(t, c, "gmail", "gmail-token-starter");
    await insertConnectedAccount(t, c, "stripe", "stripe-token");

    const bundle = await t.action(
      internal.agents.packs.maya.configGeneratorMaya.generateMayaConfig,
      { creatorId: c, nowOverride: NOW }
    );
    expect(
      "telegram" in bundle.config.gatewayConfig.channels
    ).toBe(false);
    expect(bundle.config.composioAccounts.map((a) => a.provider).sort()).toEqual(
      ["gmail", "stripe"]
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Local doc factories                                                         */
/* -------------------------------------------------------------------------- */

function mkHandleDoc(
  platform: Doc<"creatorHandles">["platform"],
  handle: string,
  followerCount: number
): Doc<"creatorHandles"> {
  return {
    _id: `h_${platform}_${handle}` as unknown as Id<"creatorHandles">,
    _creationTime: NOW,
    creatorId: "fake_creator_id_12345" as unknown as Id<"creators">,
    platform,
    handle,
    verified: true,
    scrapedAt: NOW,
    followerCount,
  };
}

function mkAccountDoc(
  id: Id<"connectedAccounts">,
  provider: Doc<"connectedAccounts">["provider"],
  status: "active" | "revoked" | "expired" = "active"
): Doc<"connectedAccounts"> {
  return {
    _id: id,
    _creationTime: NOW,
    creatorId: "fake_creator_id_12345" as unknown as Id<"creators">,
    provider,
    composioAccountId: "ignored-in-pure-builder",
    scopes: ["read"],
    scopeStatus: status,
    autoSendThreshold: undefined,
    connectedAt: NOW,
  };
}

/* -------------------------------------------------------------------------- */
/* Tar reader (for bundle inspection in tests)                                 */
/* -------------------------------------------------------------------------- */

const TEXT_DECODER = new TextDecoder();

/**
 * Tiny ustar reader used only in tests to spot-check that a given filename
 * contains expected substrings. Walks the 512-byte block headers, reads the
 * size field in octal, returns the file contents as utf-8 string.
 *
 * Returns `null` if the file is not in the tarball.
 */
function extractFileFromTar(tar: Uint8Array, target: string): string | null {
  let offset = 0;
  while (offset + 512 <= tar.length) {
    // EOF signal: an all-zero header means no more files.
    let allZero = true;
    for (let i = 0; i < 512; i++) {
      if (tar[offset + i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) return null;

    const name = readAscii(tar, offset, 100);
    const prefix = readAscii(tar, offset + 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeStr = readAscii(tar, offset + 124, 12).trim().replace(/\0+$/, "");
    const size = parseInt(sizeStr, 8);
    offset += 512;
    if (fullName === target) {
      return TEXT_DECODER.decode(tar.slice(offset, offset + size));
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return null;
}

function readAscii(buf: Uint8Array, offset: number, len: number): string {
  let end = offset;
  while (end < offset + len && buf[end] !== 0) end++;
  return TEXT_DECODER.decode(buf.slice(offset, end));
}
