/**
 * Channels (channel pairing) — Sprint 6C acceptance.
 *
 * Five mandatory test categories (per docs/SPRINT_PLAN_V0.md § 10):
 *   1. Cross-tenant: Creator A cannot confirm/unpair Creator B's pairing;
 *      listPairedChannels returns only own rows.
 *   2. Plan-tier (REVISED 2026-04-26): channels are OpenClaw-native and
 *      ungated — Starter, Pro, and Studio all allowed imessage + whatsapp +
 *      sms. The `allowedByPlan` flag on listed pairings is now always true
 *      (no current plan can have a pairing that the plan disallows).
 *   3. Adversarial: malformed phone numbers all rejected; pairingId belonging
 *      to another creator rejected; missing SMS code rejected.
 *   4. Sibling-file scan + 5. TODO grep: covered repo-wide by sprint1Acceptance.
 *
 * The OpenClaw CLI is mocked via `_setOpenclawCliForTests` — no subprocess
 * is spawned anywhere in this file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";
import {
  _setOpenclawCliForTests,
  type OpenclawCliExecutor,
} from "../cliClient";

const NOW = 1_700_000_000_000;
const FAKE_FLY_APP_ID = "maya-tester";

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    plan: "starter" | "pro" | "studio";
    deployed?: boolean;
  }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: opts.plan,
      mayaFlyAppId:
        opts.deployed === false ? undefined : `${FAKE_FLY_APP_ID}-${opts.suffix}`,
      createdAt: NOW,
    })
  );
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

/**
 * Default mock CLI: pairs/confirms/unpairs successfully with stable ids so
 * tests can predict the persisted row state.
 */
function mockHappyCli(): OpenclawCliExecutor {
  return vi.fn(async (req) => {
    if (req.command === "pair") {
      const channel = argFor(req.args, "--channel") ?? "imessage";
      return {
        ok: true,
        data: {
          pairingId: `pair_${channel}_${Math.floor(Math.random() * 1e9)}`,
          qrCodeDataUrl:
            channel === "sms"
              ? undefined
              : "data:image/png;base64,iVBORw0KGgo=",
          smsConfirmationCode: channel === "sms" ? "ABCD12" : undefined,
          expiresAt: NOW + 60_000,
        },
      };
    }
    if (req.command === "confirm") {
      return {
        ok: true,
        data: { externalIdentifier: "ext_thread_123" },
      };
    }
    if (req.command === "unpair") {
      return { ok: true };
    }
    return { ok: false, stderr: "unknown command" };
  });
}

function argFor(args: ReadonlyArray<string>, flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx === args.length - 1) return undefined;
  return args[idx + 1];
}

describe("openclaw.channels — requestPairing", () => {
  beforeEach(() => {
    _setOpenclawCliForTests(mockHappyCli());
  });
  afterEach(() => {
    _setOpenclawCliForTests(null);
  });

  it("rejects unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.integrations.openclaw.channels.requestPairing, {
        channel: "sms",
        phoneNumber: "+14155551234",
      })
    ).rejects.toThrow(/not authenticated/i);
  });

  it("rejects when creator has no Maya deployed", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro", deployed: false });
    await expect(
      asUser(t, "a").action(
        api.integrations.openclaw.channels.requestPairing,
        { channel: "sms", phoneNumber: "+14155551234" }
      )
    ).rejects.toThrow(/deploy your Maya first/i);
  });

  it("PLAN-TIER (REVISED): Starter allowed imessage + whatsapp + sms — channels are ungated", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "starter", plan: "starter" });
    for (const channel of ["imessage", "whatsapp", "sms"] as const) {
      const res = await asUser(t, "starter").action(
        api.integrations.openclaw.channels.requestPairing,
        { channel, phoneNumber: "+14155551234" }
      );
      expect(res.pairingId).toMatch(new RegExp(`^pair_${channel}_`));
    }
  });

  it("PLAN-TIER: Pro allowed imessage + whatsapp + sms", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "pro", plan: "pro" });
    for (const channel of ["imessage", "whatsapp", "sms"] as const) {
      const res = await asUser(t, "pro").action(
        api.integrations.openclaw.channels.requestPairing,
        { channel, phoneNumber: "+14155551234" }
      );
      expect(res.pairingId).toMatch(new RegExp(`^pair_${channel}_`));
    }
  });

  it("PLAN-TIER: Studio allowed imessage + whatsapp + sms", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "studio", plan: "studio" });
    for (const channel of ["imessage", "whatsapp", "sms"] as const) {
      const res = await asUser(t, "studio").action(
        api.integrations.openclaw.channels.requestPairing,
        { channel, phoneNumber: "+14155551234" }
      );
      expect(res.pairingId).toMatch(new RegExp(`^pair_${channel}_`));
    }
  });

  it.each([
    ["12345", "no leading +"],
    ["+", "bare +"],
    ["+1234567890123456789", "too long (>15 digits)"],
    ["<script>alert(1)</script>", "non-digit junk"],
    ["+0123", "country code starts with 0"],
    ["", "empty"],
    ["+1-415-555-1234", "contains dashes"],
    ["+1 415 555 1234", "contains spaces"],
  ])(
    "ADVERSARIAL: rejects malformed phone number %s (%s)",
    async (phoneNumber) => {
      const t = convexTest(schema, modules);
      await insertCreator(t, { suffix: "pro", plan: "pro" });
      await expect(
        asUser(t, "pro").action(
          api.integrations.openclaw.channels.requestPairing,
          { channel: "sms", phoneNumber }
        )
      ).rejects.toThrow(/E\.164/);
    }
  );

  it("persists a pairedChannels row in pending state on success", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await asUser(t, "a").action(
      api.integrations.openclaw.channels.requestPairing,
      { channel: "imessage", phoneNumber: "+14155551234" }
    );
    const rows = await t.run((ctx) =>
      ctx.db
        .query("pairedChannels")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].channel).toBe("imessage");
    expect(rows[0].phoneNumber).toBe("+14155551234");
    expect(rows[0].externalPairingId).toMatch(/^pair_imessage_/);
  });

  it("surfaces structured failure when OpenClaw CLI returns ok=false", async () => {
    _setOpenclawCliForTests(async () => ({
      ok: false,
      stderr: "openclaw: device limit reached",
    }));
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      asUser(t, "a").action(
        api.integrations.openclaw.channels.requestPairing,
        { channel: "imessage", phoneNumber: "+14155551234" }
      )
    ).rejects.toThrow(/device limit reached/);
  });

  it("surfaces structured failure when OpenClaw CLI times out", async () => {
    _setOpenclawCliForTests(async () => ({
      ok: false,
      stderr: "openclaw: command timed out after 15000ms",
    }));
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      asUser(t, "a").action(
        api.integrations.openclaw.channels.requestPairing,
        { channel: "imessage", phoneNumber: "+14155551234" }
      )
    ).rejects.toThrow(/timed out/);
  });

  it("surfaces error when OpenClaw returns success but no pairingId", async () => {
    _setOpenclawCliForTests(async () => ({
      ok: true,
      data: { qrCodeDataUrl: "data:image/png;base64,xxx" },
    }));
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      asUser(t, "a").action(
        api.integrations.openclaw.channels.requestPairing,
        { channel: "imessage", phoneNumber: "+14155551234" }
      )
    ).rejects.toThrow(/did not return a pairingId/);
  });
});

describe("openclaw.channels — confirmPairing", () => {
  beforeEach(() => {
    _setOpenclawCliForTests(mockHappyCli());
  });
  afterEach(() => {
    _setOpenclawCliForTests(null);
  });

  it("rejects unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.integrations.openclaw.channels.confirmPairing, {
        pairingId: "pair_x",
      })
    ).rejects.toThrow(/not authenticated/i);
  });

  it("rejects unknown pairingId", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      asUser(t, "a").action(
        api.integrations.openclaw.channels.confirmPairing,
        { pairingId: "pair_does_not_exist" }
      )
    ).rejects.toThrow(/not found for this creator/i);
  });

  it("CROSS-TENANT: Creator A cannot confirm Creator B's pairing", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    await insertCreator(t, { suffix: "b", plan: "pro" });
    // B initiates
    const bRes = await asUser(t, "b").action(
      api.integrations.openclaw.channels.requestPairing,
      { channel: "imessage", phoneNumber: "+14155550002" }
    );
    // A tries to confirm using B's pairingId — must reject.
    await expect(
      asUser(t, "a").action(
        api.integrations.openclaw.channels.confirmPairing,
        { pairingId: bRes.pairingId }
      )
    ).rejects.toThrow(/not found for this creator/i);
    // B's row still pending (untouched).
    const bRow = await t.run((ctx) =>
      ctx.db
        .query("pairedChannels")
        .withIndex("by_external_pairing_id", (q) =>
          q.eq("externalPairingId", bRes.pairingId)
        )
        .first()
    );
    expect(bRow?.status).toBe("pending");
  });

  it("ADVERSARIAL: SMS pairing requires a confirmationCode", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const res = await asUser(t, "a").action(
      api.integrations.openclaw.channels.requestPairing,
      { channel: "sms", phoneNumber: "+14155551234" }
    );
    await expect(
      asUser(t, "a").action(
        api.integrations.openclaw.channels.confirmPairing,
        { pairingId: res.pairingId } // no code
      )
    ).rejects.toThrow(/confirmationCode is required for SMS/i);
  });

  it("ADVERSARIAL: SMS rejects malformed confirmationCode", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const res = await asUser(t, "a").action(
      api.integrations.openclaw.channels.requestPairing,
      { channel: "sms", phoneNumber: "+14155551234" }
    );
    await expect(
      asUser(t, "a").action(
        api.integrations.openclaw.channels.confirmPairing,
        { pairingId: res.pairingId, confirmationCode: "ab" }
      )
    ).rejects.toThrow(/4-12 uppercase alphanumeric/);
    await expect(
      asUser(t, "a").action(
        api.integrations.openclaw.channels.confirmPairing,
        {
          pairingId: res.pairingId,
          confirmationCode: "ABCDEFGHIJKLMNOPQRST", // too long
        }
      )
    ).rejects.toThrow(/4-12 uppercase alphanumeric/);
  });

  it("happy path: confirms iMessage pairing, marks active, promotes channel preference", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const reqRes = await asUser(t, "a").action(
      api.integrations.openclaw.channels.requestPairing,
      { channel: "imessage", phoneNumber: "+14155551234" }
    );
    const confRes = await asUser(t, "a").action(
      api.integrations.openclaw.channels.confirmPairing,
      { pairingId: reqRes.pairingId }
    );
    expect(confRes.channel).toBe("imessage");
    expect(confRes.externalIdentifier).toBe("ext_thread_123");

    const row = await t.run((ctx) =>
      ctx.db
        .query("pairedChannels")
        .withIndex("by_external_pairing_id", (q) =>
          q.eq("externalPairingId", reqRes.pairingId)
        )
        .first()
    );
    expect(row?.status).toBe("active");
    expect(row?.externalIdentifier).toBe("ext_thread_123");
    expect(row?.pairedAt).toBeDefined();

    const creator = await t.run((ctx) => ctx.db.get(a));
    expect(creator?.channelPreference).toBe("imessage");
    expect(creator?.phoneNumber).toBe("+14155551234");
  });

  it("happy path: confirms SMS pairing with valid code", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "starter" });
    const reqRes = await asUser(t, "a").action(
      api.integrations.openclaw.channels.requestPairing,
      { channel: "sms", phoneNumber: "+14155551234" }
    );
    const confRes = await asUser(t, "a").action(
      api.integrations.openclaw.channels.confirmPairing,
      { pairingId: reqRes.pairingId, confirmationCode: "ABCD12" }
    );
    expect(confRes.channel).toBe("sms");
  });

  it("rejects confirming an already-active pairing", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const reqRes = await asUser(t, "a").action(
      api.integrations.openclaw.channels.requestPairing,
      { channel: "imessage", phoneNumber: "+14155551234" }
    );
    await asUser(t, "a").action(
      api.integrations.openclaw.channels.confirmPairing,
      { pairingId: reqRes.pairingId }
    );
    await expect(
      asUser(t, "a").action(
        api.integrations.openclaw.channels.confirmPairing,
        { pairingId: reqRes.pairingId }
      )
    ).rejects.toThrow(/in 'active' state/);
  });

  it("surfaces error when OpenClaw confirm returns ok=true but no externalIdentifier", async () => {
    let firstCall = true;
    _setOpenclawCliForTests(async (req) => {
      if (req.command === "pair") {
        return {
          ok: true,
          data: {
            pairingId: "pair_imessage_xyz",
            qrCodeDataUrl: "data:image/png;base64,xxx",
            expiresAt: NOW + 60_000,
          },
        };
      }
      if (req.command === "confirm") {
        firstCall = false;
        return { ok: true, data: {} };
      }
      return { ok: false };
    });
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const reqRes = await asUser(t, "a").action(
      api.integrations.openclaw.channels.requestPairing,
      { channel: "imessage", phoneNumber: "+14155551234" }
    );
    await expect(
      asUser(t, "a").action(
        api.integrations.openclaw.channels.confirmPairing,
        { pairingId: reqRes.pairingId }
      )
    ).rejects.toThrow(/externalIdentifier/);
    expect(firstCall).toBe(false);
  });
});

describe("openclaw.channels — unpairChannel", () => {
  beforeEach(() => {
    _setOpenclawCliForTests(mockHappyCli());
  });
  afterEach(() => {
    _setOpenclawCliForTests(null);
  });

  it("rejects unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.integrations.openclaw.channels.unpairChannel, {
        channel: "sms",
      })
    ).rejects.toThrow(/not authenticated/i);
  });

  it("rejects unpair when no active pairing exists", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      asUser(t, "a").action(
        api.integrations.openclaw.channels.unpairChannel,
        { channel: "sms" }
      )
    ).rejects.toThrow(/no active pairing/i);
  });

  it("CROSS-TENANT: A cannot unpair B's channel via channel-name route", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    await insertCreator(t, { suffix: "b", plan: "pro" });
    // B pairs imessage
    const bReq = await asUser(t, "b").action(
      api.integrations.openclaw.channels.requestPairing,
      { channel: "imessage", phoneNumber: "+14155550002" }
    );
    await asUser(t, "b").action(
      api.integrations.openclaw.channels.confirmPairing,
      { pairingId: bReq.pairingId }
    );
    // A tries to unpair imessage — but A has no imessage row, so reject.
    await expect(
      asUser(t, "a").action(
        api.integrations.openclaw.channels.unpairChannel,
        { channel: "imessage" }
      )
    ).rejects.toThrow(/no active pairing/i);
    // B's row stays active.
    const bRow = await t.run((ctx) =>
      ctx.db
        .query("pairedChannels")
        .withIndex("by_external_pairing_id", (q) =>
          q.eq("externalPairingId", bReq.pairingId)
        )
        .first()
    );
    expect(bRow?.status).toBe("active");
  });

  it("happy path: unpairs an active channel and falls back channelPreference to web", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const reqRes = await asUser(t, "a").action(
      api.integrations.openclaw.channels.requestPairing,
      { channel: "imessage", phoneNumber: "+14155551234" }
    );
    await asUser(t, "a").action(
      api.integrations.openclaw.channels.confirmPairing,
      { pairingId: reqRes.pairingId }
    );
    // Sanity: preference is now imessage
    const before = await t.run((ctx) => ctx.db.get(a));
    expect(before?.channelPreference).toBe("imessage");

    const res = await asUser(t, "a").action(
      api.integrations.openclaw.channels.unpairChannel,
      { channel: "imessage" }
    );
    expect(res.status).toBe("revoked");

    const row = await t.run((ctx) =>
      ctx.db
        .query("pairedChannels")
        .withIndex("by_external_pairing_id", (q) =>
          q.eq("externalPairingId", reqRes.pairingId)
        )
        .first()
    );
    expect(row?.status).toBe("revoked");

    const creator = await t.run((ctx) => ctx.db.get(a));
    expect(creator?.channelPreference).toBe("web");
  });

  it("OpenClaw CLI failure surfaces structured error", async () => {
    let attempt = 0;
    _setOpenclawCliForTests(async (req) => {
      attempt++;
      if (req.command === "pair") {
        return {
          ok: true,
          data: {
            pairingId: "pair_imessage_xyz",
            qrCodeDataUrl: "data:image/png;base64,xxx",
            expiresAt: NOW + 60_000,
          },
        };
      }
      if (req.command === "confirm") {
        return { ok: true, data: { externalIdentifier: "ext_thread_x" } };
      }
      if (req.command === "unpair") {
        return { ok: false, stderr: "openclaw: agent unreachable" };
      }
      return { ok: false };
    });
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const reqRes = await asUser(t, "a").action(
      api.integrations.openclaw.channels.requestPairing,
      { channel: "imessage", phoneNumber: "+14155551234" }
    );
    await asUser(t, "a").action(
      api.integrations.openclaw.channels.confirmPairing,
      { pairingId: reqRes.pairingId }
    );
    await expect(
      asUser(t, "a").action(
        api.integrations.openclaw.channels.unpairChannel,
        { channel: "imessage" }
      )
    ).rejects.toThrow(/agent unreachable/);
    expect(attempt).toBeGreaterThan(0);
  });
});

describe("openclaw.channels — listPairedChannels", () => {
  beforeEach(() => {
    _setOpenclawCliForTests(mockHappyCli());
  });
  afterEach(() => {
    _setOpenclawCliForTests(null);
  });

  it("returns [] for unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    const r = await t.query(
      api.integrations.openclaw.channels.listPairedChannels,
      {}
    );
    expect(r).toEqual([]);
  });

  it("returns [] when creator has no pairings", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const r = await asUser(t, "a").query(
      api.integrations.openclaw.channels.listPairedChannels,
      {}
    );
    expect(r).toEqual([]);
  });

  it("CROSS-TENANT: A only sees own pairings", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    await insertCreator(t, { suffix: "b", plan: "pro" });
    const aReq = await asUser(t, "a").action(
      api.integrations.openclaw.channels.requestPairing,
      { channel: "imessage", phoneNumber: "+14155550001" }
    );
    const bReq = await asUser(t, "b").action(
      api.integrations.openclaw.channels.requestPairing,
      { channel: "whatsapp", phoneNumber: "+14155550002" }
    );
    const aList = await asUser(t, "a").query(
      api.integrations.openclaw.channels.listPairedChannels,
      {}
    );
    const bList = await asUser(t, "b").query(
      api.integrations.openclaw.channels.listPairedChannels,
      {}
    );
    expect(aList).toHaveLength(1);
    expect(aList[0].externalPairingId).toBe(aReq.pairingId);
    expect(aList[0].phoneNumber).toBe("+14155550001");
    expect(bList).toHaveLength(1);
    expect(bList[0].externalPairingId).toBe(bReq.pairingId);
    expect(bList[0].phoneNumber).toBe("+14155550002");
  });

  it("PLAN-TIER (REVISED): allowedByPlan flag is true on every tier — channels are ungated", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    // Pair imessage on Pro
    const reqRes = await asUser(t, "a").action(
      api.integrations.openclaw.channels.requestPairing,
      { channel: "imessage", phoneNumber: "+14155551234" }
    );
    expect(reqRes.pairingId).toBeTruthy();
    // Downgrade to Starter and re-list. Channels are universally allowed now,
    // so the flag stays true.
    await t.run((ctx) => ctx.db.patch(a, { plan: "starter" }));
    const list = await asUser(t, "a").query(
      api.integrations.openclaw.channels.listPairedChannels,
      {}
    );
    expect(list).toHaveLength(1);
    expect(list[0].channel).toBe("imessage");
    expect(list[0].allowedByPlan).toBe(true);
  });

  it("orders rows newest-first", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    // Insert two rows directly with controlled timestamps.
    await t.run((ctx) =>
      ctx.db.insert("pairedChannels", {
        creatorId: a,
        channel: "imessage",
        phoneNumber: "+14155550001",
        externalPairingId: "pair_old",
        status: "revoked",
        requestedAt: NOW - 86_400_000,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("pairedChannels", {
        creatorId: a,
        channel: "whatsapp",
        phoneNumber: "+14155550002",
        externalPairingId: "pair_new",
        status: "active",
        requestedAt: NOW,
      })
    );
    const list = await asUser(t, "a").query(
      api.integrations.openclaw.channels.listPairedChannels,
      {}
    );
    expect(list.map((r) => r.externalPairingId)).toEqual([
      "pair_new",
      "pair_old",
    ]);
  });
});

describe("openclaw.channels — internal helpers", () => {
  it("recordPairingRequest defense-in-depth: rejects non-E.164 inserts", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const { internal } = await import("../../../_generated/api");
    await expect(
      t.mutation(
        internal.integrations.openclaw.channels.recordPairingRequest,
        {
          creatorId: a,
          channel: "imessage",
          phoneNumber: "12345", // bad
          externalPairingId: "pair_x",
        }
      )
    ).rejects.toThrow(/E\.164/);
  });
});
