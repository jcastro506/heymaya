/**
 * Channels — connected is not the same as can-post.
 *
 * Fixtures are shaped from the REAL `GET /v1/accounts` response captured live
 * on 2026-08-04, not from the spec's examples. The spec says what the fields
 * are; the live response is what actually arrives.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { readAccount } from "../channels";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 4, 12, 0, 0);
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** The live shape, trimmed to the fields that carry meaning. */
function account(over: Record<string, unknown> = {}) {
  return {
    _id: "6a7276dad0fe733d1a2d25e0",
    platform: "twitter",
    isActive: true,
    enabled: true,
    needsReconnection: false,
    platformStatus: "active",
    permissions: [
      "tweet.moderate.write",
      "offline.access",
      "tweet.write",
      "users.read",
      "tweet.read",
    ],
    metadata: { profileData: { username: "HeyMaya751997" } },
    ...over,
  };
}

describe("CONNECTED IS NOT THE SAME AS CAN-POST", () => {
  it("a healthy X account is connected", () => {
    const health = readAccount(account());
    expect(health).toEqual({
      channel: "x",
      zernioAccountId: "6a7276dad0fe733d1a2d25e0",
      handle: "HeyMaya751997",
      connected: true,
    });
  });

  it("⭐ MISSING `tweet.write` IS NOT CONNECTED", () => {
    // The silent one. Authenticates, lists, looks perfect, cannot publish —
    // and without this check it surfaces as a publish failure at the worst
    // moment instead of a connection problem at the obvious one.
    const health = readAccount(
      account({ permissions: ["tweet.read", "users.read", "offline.access"] })
    );
    expect(health?.connected).toBe(false);
    expect(health?.reason).toMatch(/tweet\.write/);
  });

  it("needsReconnection wins over everything else", () => {
    const health = readAccount(account({ needsReconnection: true }));
    expect(health?.connected).toBe(false);
    expect(health?.reason).toMatch(/re-authorised/i);
  });

  it("a disabled connection is reported as such", () => {
    expect(readAccount(account({ enabled: false }))?.connected).toBe(false);
    expect(readAccount(account({ isActive: false }))?.connected).toBe(false);
  });

  it("a platform-side suspension carries its reason", () => {
    const health = readAccount(
      account({
        platformStatus: "suspended",
        platformStatusReason: "policy violation",
      })
    );
    expect(health?.connected).toBe(false);
    expect(health?.reason).toMatch(/suspended/);
    expect(health?.reason).toMatch(/policy violation/);
  });

  it("`twitter` maps to `x`", () => {
    expect(readAccount(account())?.channel).toBe("x");
  });

  it("a platform we don't sell is ignored, not mangled", () => {
    expect(readAccount(account({ platform: "pinterest" }))).toBeNull();
  });

  it("an account with no id is ignored", () => {
    expect(readAccount(account({ _id: undefined }))).toBeNull();
  });

  it("platforms with no write-permission rule aren't blocked by one", () => {
    // Only X has a documented write scope in our map. Inventing one for the
    // others would reject healthy connections.
    const ig = readAccount(account({ platform: "instagram", permissions: [] }));
    expect(ig?.connected).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

async function seedCustomer(t: ReturnType<typeof convexTest>): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: "u_sync",
      email: "sync@example.com",
      channelPreference: "telegram",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

function stubAccounts(body: unknown, status = 200) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

describe("THE ROWS ARE DERIVED FROM ZERNIO, NOT ASSERTED", () => {
  it("a sync creates the channel row", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t);
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    stubAccounts({ accounts: [account()] });

    const res = await t.action(internal.maya.channels.syncChannels, { customerId });
    expect(res.ok).toBe(true);

    const rows = (await t.run((ctx) =>
      ctx.db.query("channels").collect()
    )) as Doc<"channels">[];
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("x");
    expect(rows[0].status).toBe("connected");
    expect(rows[0].zernioAccountId).toBe("6a7276dad0fe733d1a2d25e0");
    // The switch opens closed. Going autonomous is the founder's call.
    expect(rows[0].postingMode).toBe("show_me_first");
  });

  it("⭐ A CONNECTION THAT WENT AWAY IS MARKED, NOT LEFT LOOKING FINE", async () => {
    // The founder revokes access in X's settings and nothing tells us. A row
    // that still says "connected" means she keeps trying to post through a
    // grant that no longer exists.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t);
    vi.stubEnv("ZERNIO_API_KEY", "test-key");

    stubAccounts({ accounts: [account()] });
    await t.action(internal.maya.channels.syncChannels, { customerId });

    stubAccounts({ accounts: [account({ needsReconnection: true })] });
    await t.action(internal.maya.channels.syncChannels, { customerId });

    const rows = (await t.run((ctx) =>
      ctx.db.query("channels").collect()
    )) as Doc<"channels">[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("error");
    expect(rows[0].failureReason).toMatch(/re-authorised/i);
  });

  it("a re-sync updates rather than duplicating", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t);
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    stubAccounts({ accounts: [account()] });

    await t.action(internal.maya.channels.syncChannels, { customerId });
    await t.action(internal.maya.channels.syncChannels, { customerId });

    const rows = await t.run((ctx) => ctx.db.query("channels").collect());
    expect(rows).toHaveLength(1);
  });

  it("⭐ AN UNREADABLE RESPONSE IS AN ERROR, NOT AN EMPTY LIST", async () => {
    // Same rule as publishing. If a contract change parsed as "no accounts",
    // a sync would silently disconnect every channel the customer has.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t);
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    stubAccounts({ data: { items: [] } });

    const res = await t.action(internal.maya.channels.syncChannels, { customerId });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unrecognised/i);

    const rows = await t.run((ctx) => ctx.db.query("channels").collect());
    expect(rows).toEqual([]);
  });

  it("an unconfigured vendor is named", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t);
    const res = await t.action(internal.maya.channels.syncChannels, { customerId });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/isn't configured/i);
  });
});
