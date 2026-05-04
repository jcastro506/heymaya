/**
 * profile.ts mutations + actions — Sprint 6A acceptance.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: Creator A cannot edit / disconnect / threshold-set /
 *      reset-memory / export Creator B's anything. Even a spoofed argument
 *      (e.g. handleId pointing at B's row) fails closed.
 *   2. Plan-tier × action matrix (REVISED 2026-04-26):
 *        - Channels (web/sms/imessage/whatsapp) are UNGATED — every plan
 *          accepts every channel (channels are OpenClaw-native, no per-tier
 *          cost).
 *        - Gmail / Calendar are UNGATED — every plan can connect them.
 *        - Apollo / Hunter remain Studio-only (per-query paid lookups).
 *        - Auto-send threshold accepted for every plan on gmail / calendar /
 *          stripe; rejected on apollo / hunter for Starter and Pro (Studio
 *          only).
 *   3. Adversarial: monthlyRevenueUsd negative / NaN rejected; very long
 *      strings (>=5000 char) rejected for goal/longTermGoals; threshold above
 *      cap rejected; resetMayaMemory rejects any confirm token other than
 *      the literal "RESET".
 *   4. Sibling-file scan: covered repo-wide by sprint1Acceptance.
 *   5. TODO grep: covered repo-wide by sprint1Acceptance.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import type { Id } from "../_generated/dataModel";
import {
  _setOpenclawCliForTests,
  type OpenclawCliExecutor,
} from "../integrations/openclaw/cliClient";

const NOW = 1_700_000_000_000;

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    plan: "coach" | "manager";
    channel?: "imessage" | "whatsapp" | "sms" | "web";
    mayaFlyAppId?: string;
  }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: opts.channel ?? "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: opts.plan,
      mayaFlyAppId: opts.mayaFlyAppId,
      createdAt: NOW,
    })
  );
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

async function insertConnectedAccount(
  t: ReturnType<typeof convexTest>,
  opts: {
    creatorId: Id<"creators">;
    provider: "gmail" | "stripe" | "calendar" | "apollo" | "hunter";
    scopeStatus?: "active" | "revoked" | "expired";
    autoSendThreshold?: number;
  }
): Promise<Id<"connectedAccounts">> {
  return await t.run((ctx) =>
    ctx.db.insert("connectedAccounts", {
      creatorId: opts.creatorId,
      provider: opts.provider,
      composioAccountId: `enc_${opts.provider}_${opts.creatorId}`,
      composioAccountIdHash: `hash_${opts.provider}_${opts.creatorId}`,
      scopes: ["read"],
      scopeStatus: opts.scopeStatus ?? "active",
      autoSendThreshold: opts.autoSendThreshold,
      connectedAt: NOW,
    })
  );
}

/* -------------------------------------------------------------------------- */
/* getProfileSummary                                                          */
/* -------------------------------------------------------------------------- */

describe("profile.getProfileSummary", () => {
  it("returns null when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const res = await t.query(api.profile.getProfileSummary, {});
    expect(res).toBeNull();
  });

  it("returns the signed-in creator's bundle, scrubs composio account ids", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await insertConnectedAccount(t, { creatorId: a, provider: "gmail" });
    const res = await asUser(t, "a").query(api.profile.getProfileSummary, {});
    expect(res).not.toBeNull();
    expect(res!.creator._id).toBe(a);
    expect(res!.accounts).toHaveLength(1);
    // composioAccountId / composioAccountIdHash MUST NOT be on the wire.
    const acc = res!.accounts[0] as Record<string, unknown>;
    expect(acc).not.toHaveProperty("composioAccountId");
    expect(acc).not.toHaveProperty("composioAccountIdHash");
  });

  it("CROSS-TENANT: returns A's accounts only, never B's", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const b = await insertCreator(t, { suffix: "b", plan: "manager" });
    await insertConnectedAccount(t, { creatorId: a, provider: "gmail" });
    await insertConnectedAccount(t, { creatorId: b, provider: "calendar" });
    const aRes = await asUser(t, "a").query(api.profile.getProfileSummary, {});
    expect(aRes!.accounts.map((x) => x.provider)).toEqual(["gmail"]);
    const bRes = await asUser(t, "b").query(api.profile.getProfileSummary, {});
    expect(bRes!.accounts.map((x) => x.provider)).toEqual(["calendar"]);
  });
});

/* -------------------------------------------------------------------------- */
/* updateCreatorPicture                                                       */
/* -------------------------------------------------------------------------- */

describe("profile.updateCreatorPicture", () => {
  it("creates a stub creatorPicture when none exists, with the patched fields", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await asUser(t, "a").mutation(api.profile.updateCreatorPicture, {
      careerStage: "monetizing",
      locationSoul: { city: "Brooklyn", state: "NY", country: "US" },
      monthlyRevenueUsd: 7500,
      currentRevenueStreams: ["brand-deals", "courses"],
      longTermGoals: { oneYear: "book a 10K/mo deal" },
      tonePreference: "tough-love",
    });
    const pic = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .first()
    );
    expect(pic?.careerStage).toBe("monetizing");
    expect(pic?.locationSoul?.city).toBe("Brooklyn");
    expect(pic?.monthlyRevenueUsd).toBe(7500);
    expect(pic?.currentRevenueStreams).toEqual(["brand-deals", "courses"]);
    expect(pic?.longTermGoals?.oneYear).toBe("book a 10K/mo deal");
    const cre = await t.run((ctx) => ctx.db.get(a));
    expect(cre?.tonePreference).toBe("tough-love");
  });

  it("patches an existing creatorPicture in place, preserves synth-owned fields", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const seedId = await t.run((ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId: a,
        niche: "fitness",
        audience: { ageRanges: ["25-34"], topGeos: ["US"], interestTags: [] },
        voiceFingerprint: "punchy",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "gemini-3-flash",
        sourceCitations: [],
      })
    );
    await asUser(t, "a").mutation(api.profile.updateCreatorPicture, {
      monthlyRevenueUsd: 12_000,
    });
    const pic = await t.run((ctx) => ctx.db.get(seedId));
    expect(pic?.niche).toBe("fitness"); // synth-owned untouched
    expect(pic?.monthlyRevenueUsd).toBe(12_000);
  });

  it("rejects unauthenticated calls", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.profile.updateCreatorPicture, { monthlyRevenueUsd: 100 })
    ).rejects.toThrow(/not authenticated/i);
  });

  it("CROSS-TENANT: A cannot mutate B's picture even though args carry no creatorId", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const b = await insertCreator(t, { suffix: "b", plan: "manager" });
    await asUser(t, "a").mutation(api.profile.updateCreatorPicture, {
      monthlyRevenueUsd: 9999,
      tonePreference: "tough-love",
    });
    // B's row is untouched.
    const bPic = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .first()
    );
    expect(bPic).toBeNull();
    const bCre = await t.run((ctx) => ctx.db.get(b));
    expect(bCre?.tonePreference).toBeUndefined();
    // A's tone was set.
    const aCre = await t.run((ctx) => ctx.db.get(a));
    expect(aCre?.tonePreference).toBe("tough-love");
  });

  it("ADVERSARIAL: rejects negative monthlyRevenueUsd", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    await expect(
      asUser(t, "a").mutation(api.profile.updateCreatorPicture, {
        monthlyRevenueUsd: -42,
      })
    ).rejects.toThrow(/monthlyRevenueUsd/i);
  });

  it("ADVERSARIAL: rejects NaN monthlyRevenueUsd", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    await expect(
      asUser(t, "a").mutation(api.profile.updateCreatorPicture, {
        monthlyRevenueUsd: Number.NaN,
      })
    ).rejects.toThrow(/monthlyRevenueUsd/i);
  });

  it("ADVERSARIAL: rejects long oneYear goal (>= 5000 chars)", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const longStr = "x".repeat(5_001);
    await expect(
      asUser(t, "a").mutation(api.profile.updateCreatorPicture, {
        longTermGoals: { oneYear: longStr },
      })
    ).rejects.toThrow(/exceeds.*5000/i);
  });

  it("ADVERSARIAL: rejects long fiveYear goal (>= 5000 chars)", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const longStr = "y".repeat(5_001);
    await expect(
      asUser(t, "a").mutation(api.profile.updateCreatorPicture, {
        longTermGoals: { fiveYear: longStr },
      })
    ).rejects.toThrow(/exceeds.*5000/i);
  });

  it("ADVERSARIAL: rejects long city string (>= 5000 chars)", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    await expect(
      asUser(t, "a").mutation(api.profile.updateCreatorPicture, {
        locationSoul: { city: "z".repeat(5_001) },
      })
    ).rejects.toThrow(/exceeds.*5000/i);
  });

  it("PLAN-TIER: every tier can edit their picture (no gate)", async () => {
    for (const plan of ["coach", "manager"] as const) {
      const t = convexTest(schema, modules);
      await insertCreator(t, { suffix: plan, plan });
      await expect(
        asUser(t, plan).mutation(api.profile.updateCreatorPicture, {
          monthlyRevenueUsd: 100,
          tonePreference: "supportive",
        })
      ).resolves.toBeDefined();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* addCreatorHandle / removeCreatorHandle                                     */
/* -------------------------------------------------------------------------- */

describe("profile.addCreatorHandle", () => {
  it("inserts a new handle row", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const id = await asUser(t, "a").mutation(api.profile.addCreatorHandle, {
      platform: "tiktok",
      handle: "@joshcastro",
      followerCount: 12_000,
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.handle).toBe("joshcastro"); // strips leading @
    expect(row?.creatorId).toBe(a);
    expect(row?.followerCount).toBe(12_000);
  });

  it("upserts when the same platform handle is added again (per-platform unique)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const id1 = await asUser(t, "a").mutation(api.profile.addCreatorHandle, {
      platform: "tiktok",
      handle: "old",
    });
    const id2 = await asUser(t, "a").mutation(api.profile.addCreatorHandle, {
      platform: "tiktok",
      handle: "new",
      followerCount: 1000,
    });
    expect(id1).toBe(id2);
    const all = await t.run((ctx) =>
      ctx.db
        .query("creatorHandles")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    expect(all).toHaveLength(1);
    expect(all[0].handle).toBe("new");
    expect(all[0].followerCount).toBe(1000);
  });

  it("PLAN-TIER (coach): allows up to maxHandles (5) and rejects the 6th", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "s", plan: "coach" });
    for (const [platform, handle] of [
      ["tiktok", "a"],
      ["instagram", "b"],
      ["youtube", "c"],
      ["linkedin", "d"],
      ["x", "e"],
    ] as const) {
      await asUser(t, "s").mutation(api.profile.addCreatorHandle, {
        platform,
        handle,
      });
    }
    await expect(
      asUser(t, "s").mutation(api.profile.addCreatorHandle, {
        platform: "threads",
        handle: "f",
      })
    ).rejects.toThrow(/Plan.*coach/i);
  });

  it("PLAN-TIER (manager): allows up to maxHandles (5) and rejects the 6th", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "p", plan: "manager" });
    for (const [platform, handle] of [
      ["tiktok", "a"],
      ["instagram", "b"],
      ["youtube", "c"],
      ["linkedin", "d"],
      ["x", "e"],
    ] as const) {
      await asUser(t, "p").mutation(api.profile.addCreatorHandle, {
        platform,
        handle,
      });
    }
    await expect(
      asUser(t, "p").mutation(api.profile.addCreatorHandle, {
        platform: "threads",
        handle: "f",
      })
    ).rejects.toThrow(/Plan.*manager/i);
  });

  it("ADVERSARIAL: rejects empty handle", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    await expect(
      asUser(t, "a").mutation(api.profile.addCreatorHandle, {
        platform: "tiktok",
        handle: "   ",
      })
    ).rejects.toThrow(/handle is required/i);
  });
});

describe("profile.removeCreatorHandle", () => {
  it("CROSS-TENANT: A cannot delete B's handle", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const b = await insertCreator(t, { suffix: "b", plan: "manager" });
    expect(a).toBeDefined();
    const bHandle = await t.run((ctx) =>
      ctx.db.insert("creatorHandles", {
        creatorId: b,
        platform: "tiktok",
        handle: "b_handle",
        verified: true,
      })
    );
    await expect(
      asUser(t, "a").mutation(api.profile.removeCreatorHandle, {
        handleId: bHandle,
      })
    ).rejects.toThrow(/does not belong/i);
    // B's row still exists.
    const stillThere = await t.run((ctx) => ctx.db.get(bHandle));
    expect(stillThere).not.toBeNull();
  });

  it("idempotent: deleting an already-gone handle is a no-op", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    // Insert + delete to get a real-shape Id pointing at nothing.
    const id = await t.run((ctx) =>
      ctx.db.insert("creatorHandles", {
        creatorId: a,
        platform: "tiktok",
        handle: "ghost",
        verified: true,
      })
    );
    await t.run((ctx) => ctx.db.delete(id));
    // Second call against the deleted id should resolve cleanly (row not
    // found). Convex serializes a void return as null on the wire — accept
    // either undefined or null here.
    const r = await asUser(t, "a").mutation(api.profile.removeCreatorHandle, {
      handleId: id,
    });
    expect(r === null || r === undefined).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* disconnectProvider                                                         */
/* -------------------------------------------------------------------------- */

describe("profile.disconnectProvider", () => {
  it("flips an active gmail account to revoked, logs to mayaActionLog", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const accId = await insertConnectedAccount(t, {
      creatorId: a,
      provider: "gmail",
    });
    const res = await asUser(t, "a").mutation(
      api.profile.disconnectProvider,
      { provider: "gmail" }
    );
    expect(res.revoked).toBe(true);
    const row = await t.run((ctx) => ctx.db.get(accId));
    expect(row?.scopeStatus).toBe("revoked");
    const log = await t.run((ctx) =>
      ctx.db
        .query("mayaActionLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    expect(log.some((r) => r.entryId === "profile.disconnect.gmail")).toBe(true);
  });

  it("idempotent: calling twice does not error", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await insertConnectedAccount(t, { creatorId: a, provider: "gmail" });
    const r1 = await asUser(t, "a").mutation(
      api.profile.disconnectProvider,
      { provider: "gmail" }
    );
    const r2 = await asUser(t, "a").mutation(
      api.profile.disconnectProvider,
      { provider: "gmail" }
    );
    expect(r1.revoked).toBe(true);
    expect(r2.revoked).toBe(false);
    expect(r2.reason).toBe("already-revoked");
  });

  it("returns reason=not-connected when there's no row to begin with", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const r = await asUser(t, "a").mutation(api.profile.disconnectProvider, {
      provider: "gmail",
    });
    expect(r.revoked).toBe(false);
    expect(r.reason).toBe("not-connected");
  });

  it("CROSS-TENANT: A's disconnect call does not touch B's account", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const b = await insertCreator(t, { suffix: "b", plan: "manager" });
    expect(a).toBeDefined();
    const bAcc = await insertConnectedAccount(t, {
      creatorId: b,
      provider: "gmail",
    });
    const res = await asUser(t, "a").mutation(
      api.profile.disconnectProvider,
      { provider: "gmail" }
    );
    expect(res.revoked).toBe(false); // A has no gmail
    const bRow = await t.run((ctx) => ctx.db.get(bAcc));
    expect(bRow?.scopeStatus).toBe("active");
  });
});

/* -------------------------------------------------------------------------- */
/* updateChannelPreference                                                    */
/* -------------------------------------------------------------------------- */

describe("profile.updateChannelPreference", () => {
  it("PLAN-TIER (REVISED): starter accepts all 4 channels — channels are OpenClaw-native, ungated", async () => {
    const t = convexTest(schema, modules);
    const s = await insertCreator(t, { suffix: "s", plan: "coach" });
    for (const ch of ["web", "sms", "imessage", "whatsapp"] as const) {
      await asUser(t, "s").mutation(api.profile.updateChannelPreference, {
        channel: ch,
      });
      const row = await t.run((ctx) => ctx.db.get(s));
      expect(row?.channelPreference).toBe(ch);
    }
  });

  it("PLAN-TIER: pro accepts all 4 channels", async () => {
    const t = convexTest(schema, modules);
    const p = await insertCreator(t, { suffix: "p", plan: "manager" });
    for (const ch of ["web", "sms", "imessage", "whatsapp"] as const) {
      await asUser(t, "p").mutation(api.profile.updateChannelPreference, {
        channel: ch,
      });
      const row = await t.run((ctx) => ctx.db.get(p));
      expect(row?.channelPreference).toBe(ch);
    }
  });

  it("PLAN-TIER: studio accepts all 4 channels", async () => {
    const t = convexTest(schema, modules);
    const s = await insertCreator(t, { suffix: "s2", plan: "manager" });
    for (const ch of ["web", "sms", "imessage", "whatsapp"] as const) {
      await asUser(t, "s2").mutation(api.profile.updateChannelPreference, {
        channel: ch,
      });
      const row = await t.run((ctx) => ctx.db.get(s));
      expect(row?.channelPreference).toBe(ch);
    }
  });

  it("CROSS-TENANT: A's channel update writes to A only, B's row untouched", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager", channel: "web" });
    const b = await insertCreator(t, { suffix: "b", plan: "manager", channel: "web" });
    await asUser(t, "a").mutation(api.profile.updateChannelPreference, {
      channel: "imessage",
    });
    const aRow = await t.run((ctx) => ctx.db.get(a));
    const bRow = await t.run((ctx) => ctx.db.get(b));
    expect(aRow?.channelPreference).toBe("imessage");
    expect(bRow?.channelPreference).toBe("web");
  });
});

/* -------------------------------------------------------------------------- */
/* setAutoSendThreshold                                                       */
/* -------------------------------------------------------------------------- */

describe("profile.setAutoSendThreshold", () => {
  it("PLAN-TIER (REVISED): starter can set gmail threshold — deal desk is universal", async () => {
    const t = convexTest(schema, modules);
    const s = await insertCreator(t, { suffix: "s", plan: "coach" });
    await insertConnectedAccount(t, { creatorId: s, provider: "gmail" });
    await asUser(t, "s").mutation(api.profile.setAutoSendThreshold, {
      provider: "gmail",
      thresholdUsd: 75,
    });
    const row = await t.run((ctx) =>
      ctx.db
        .query("connectedAccounts")
        .withIndex("by_creator_and_provider", (q) =>
          q.eq("creatorId", s).eq("provider", "gmail")
        )
        .first()
    );
    expect(row?.autoSendThreshold).toBe(75);
  });

  it("PLAN-TIER: pro can set gmail threshold", async () => {
    const t = convexTest(schema, modules);
    const p = await insertCreator(t, { suffix: "p", plan: "manager" });
    await insertConnectedAccount(t, { creatorId: p, provider: "gmail" });
    await asUser(t, "p").mutation(api.profile.setAutoSendThreshold, {
      provider: "gmail",
      thresholdUsd: 250,
    });
    const row = await t.run((ctx) =>
      ctx.db
        .query("connectedAccounts")
        .withIndex("by_creator_and_provider", (q) =>
          q.eq("creatorId", p).eq("provider", "gmail")
        )
        .first()
    );
    expect(row?.autoSendThreshold).toBe(250);
  });

  it("PLAN-TIER (coach): blocked from apollo / hunter thresholds (Manager-only providers)", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "p", plan: "coach" });
    for (const provider of ["apollo", "hunter"] as const) {
      await expect(
        asUser(t, "p").mutation(api.profile.setAutoSendThreshold, {
          provider,
          thresholdUsd: 100,
        })
      ).rejects.toThrow(/Plan.*coach/i);
    }
  });

  it("ADVERSARIAL: rejects negative threshold", async () => {
    const t = convexTest(schema, modules);
    const p = await insertCreator(t, { suffix: "p", plan: "manager" });
    await insertConnectedAccount(t, { creatorId: p, provider: "gmail" });
    await expect(
      asUser(t, "p").mutation(api.profile.setAutoSendThreshold, {
        provider: "gmail",
        thresholdUsd: -1,
      })
    ).rejects.toThrow(/non-negative/i);
  });

  it("ADVERSARIAL: rejects threshold > 50000", async () => {
    const t = convexTest(schema, modules);
    const p = await insertCreator(t, { suffix: "p", plan: "manager" });
    await insertConnectedAccount(t, { creatorId: p, provider: "gmail" });
    await expect(
      asUser(t, "p").mutation(api.profile.setAutoSendThreshold, {
        provider: "gmail",
        thresholdUsd: 50_001,
      })
    ).rejects.toThrow(/50000/);
  });

  it("rejects setting threshold for an unconnected provider", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "p", plan: "manager" });
    await expect(
      asUser(t, "p").mutation(api.profile.setAutoSendThreshold, {
        provider: "gmail",
        thresholdUsd: 100,
      })
    ).rejects.toThrow(/not connected/i);
  });

  it("CROSS-TENANT: A's threshold update never touches B's row", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const b = await insertCreator(t, { suffix: "b", plan: "manager" });
    await insertConnectedAccount(t, {
      creatorId: a,
      provider: "gmail",
      autoSendThreshold: 0,
    });
    const bAcc = await insertConnectedAccount(t, {
      creatorId: b,
      provider: "gmail",
      autoSendThreshold: 999,
    });
    await asUser(t, "a").mutation(api.profile.setAutoSendThreshold, {
      provider: "gmail",
      thresholdUsd: 50,
    });
    const bRow = await t.run((ctx) => ctx.db.get(bAcc));
    expect(bRow?.autoSendThreshold).toBe(999);
  });
});

/* -------------------------------------------------------------------------- */
/* resetMayaMemory                                                            */
/* -------------------------------------------------------------------------- */

describe("profile.resetMayaMemory", () => {
  afterEach(() => {
    _setOpenclawCliForTests(null);
  });

  it("requires the literal confirm='RESET' token", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    for (const bad of ["reset", "Reset", "RESET ", " RESET", "yes", ""]) {
      await expect(
        asUser(t, "a").action(api.profile.resetMayaMemory, { confirm: bad })
      ).rejects.toThrow(/RESET/);
    }
  });

  it("logs entryId='memory.reset' with skipped_dependency_missing when no Maya is deployed", async () => {
    // No mayaFlyAppId on the creator — we refuse to issue any CLI call and
    // record the request as skipped so the operator dashboard surfaces it.
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const cli: OpenclawCliExecutor = vi.fn(async () => ({ ok: true }));
    _setOpenclawCliForTests(cli);

    const res = await asUser(t, "a").action(api.profile.resetMayaMemory, {
      confirm: "RESET",
    });
    expect(res.logged).toBe(true);
    expect(res.rolledBackLongTerm).toBe(false);
    expect(res.rolledBackShortTerm).toBe(false);
    // Critical: with no Fly app, the CLI is NEVER invoked. This protects
    // against accidentally targeting the operator's default agent context.
    expect(cli).not.toHaveBeenCalled();

    const log = await t.run((ctx) =>
      ctx.db
        .query("mayaActionLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    const entry = log.find((r) => r.entryId === "memory.reset");
    expect(entry).toBeDefined();
    expect(entry?.outcome).toBe("skipped_dependency_missing");
  });

  it("invokes the OpenClaw CLI with both rollback subcommands scoped to the creator's Fly app", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, {
      suffix: "a",
      plan: "manager",
      mayaFlyAppId: "maya-creator-a",
    });
    const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
    _setOpenclawCliForTests(async (req) => {
      calls.push({ command: req.command, args: req.args });
      return { ok: true };
    });

    const res = await asUser(t, "a").action(api.profile.resetMayaMemory, {
      confirm: "RESET",
    });
    expect(res.logged).toBe(true);
    expect(res.rolledBackLongTerm).toBe(true);
    expect(res.rolledBackShortTerm).toBe(true);

    // Both rollback subcommands fired, both scoped to the creator's app.
    expect(calls).toHaveLength(2);
    const longTerm = calls.find((c) => c.command === "memoryRollback");
    const shortTerm = calls.find((c) => c.command === "memoryRollbackShortTerm");
    expect(longTerm).toBeDefined();
    expect(shortTerm).toBeDefined();
    expect(longTerm!.args).toContain("--rollback");
    expect(longTerm!.args).toContain("--agent");
    expect(longTerm!.args).toContain("maya-creator-a");
    expect(shortTerm!.args).toContain("--rollback-short-term");
    expect(shortTerm!.args).toContain("--agent");
    expect(shortTerm!.args).toContain("maya-creator-a");

    // mayaActionLog records outcome=ran with both rollback successes noted.
    const log = await t.run((ctx) =>
      ctx.db
        .query("mayaActionLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    const entry = log.find((r) => r.entryId === "memory.reset");
    expect(entry?.outcome).toBe("ran");
    expect(entry?.detail).toContain("agent=maya-creator-a");
    expect(entry?.detail).toContain("longTerm=ok");
    expect(entry?.detail).toContain("shortTerm=ok");
  });

  it("records outcome='failed' but still attempts both rollbacks when one CLI call errors", async () => {
    // Creator's expectation is "wipe what you can" — partial failure must
    // not short-circuit the second rollback.
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, {
      suffix: "a",
      plan: "manager",
      mayaFlyAppId: "maya-creator-a",
    });
    const seen: string[] = [];
    _setOpenclawCliForTests(async (req) => {
      seen.push(req.command);
      if (req.command === "memoryRollback") {
        return { ok: false, stderr: "openclaw: connection refused" };
      }
      return { ok: true };
    });

    const res = await asUser(t, "a").action(api.profile.resetMayaMemory, {
      confirm: "RESET",
    });
    expect(res.rolledBackLongTerm).toBe(false);
    expect(res.rolledBackShortTerm).toBe(true);
    expect(seen).toEqual(["memoryRollback", "memoryRollbackShortTerm"]);

    const log = await t.run((ctx) =>
      ctx.db
        .query("mayaActionLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    const entry = log.find((r) => r.entryId === "memory.reset");
    expect(entry?.outcome).toBe("failed");
    expect(entry?.detail).toContain("longTerm=failed:openclaw: connection refused");
    expect(entry?.detail).toContain("shortTerm=ok");
  });

  it("CROSS-TENANT: A's reset call only logs against A, never B, and never reaches B's Fly app", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, {
      suffix: "a",
      plan: "manager",
      mayaFlyAppId: "maya-creator-a",
    });
    const b = await insertCreator(t, {
      suffix: "b",
      plan: "manager",
      mayaFlyAppId: "maya-creator-b",
    });
    const seenAgents: string[] = [];
    _setOpenclawCliForTests(async (req) => {
      const idx = req.args.indexOf("--agent");
      if (idx >= 0 && idx + 1 < req.args.length) {
        seenAgents.push(req.args[idx + 1]);
      }
      return { ok: true };
    });

    await asUser(t, "a").action(api.profile.resetMayaMemory, {
      confirm: "RESET",
    });

    expect(seenAgents.every((s) => s === "maya-creator-a")).toBe(true);
    expect(seenAgents).not.toContain("maya-creator-b");

    const aLog = await t.run((ctx) =>
      ctx.db
        .query("mayaActionLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    const bLog = await t.run((ctx) =>
      ctx.db
        .query("mayaActionLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .collect()
    );
    expect(aLog.some((r) => r.entryId === "memory.reset")).toBe(true);
    expect(bLog).toEqual([]);
  });

  it("rejects unauthenticated calls", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.profile.resetMayaMemory, { confirm: "RESET" })
    ).rejects.toThrow(/not authenticated/i);
  });
});

/* -------------------------------------------------------------------------- */
/* exportCreatorData                                                          */
/* -------------------------------------------------------------------------- */

describe("profile.exportCreatorData", () => {
  it("returns a URL that resolves to a JSON blob containing the creator's data without composio account ids", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await insertConnectedAccount(t, { creatorId: a, provider: "gmail" });
    await t.run((ctx) =>
      ctx.db.insert("creatorHandles", {
        creatorId: a,
        platform: "tiktok",
        handle: "joshcastro",
        verified: true,
      })
    );
    const res = await asUser(t, "a").action(api.profile.exportCreatorData, {});
    expect(res.url).toMatch(/^https?:\/\//);
    expect(res.storageId).toBeDefined();

    // Pull the blob bytes back via the test storage seam.
    const bytes = await t.run(async (ctx) => {
      const blob = await ctx.storage.get(res.storageId);
      if (!blob) throw new Error("blob missing");
      return await blob.text();
    });
    const parsed = JSON.parse(bytes) as Record<string, unknown>;
    expect(parsed.creator).toBeDefined();
    expect(Array.isArray(parsed.creatorHandles)).toBe(true);
    expect(Array.isArray(parsed.connectedAccounts)).toBe(true);

    // Critical: composioAccountId is scrubbed from EVERY connectedAccounts row.
    const accs = parsed.connectedAccounts as Array<Record<string, unknown>>;
    for (const acc of accs) {
      expect(acc).not.toHaveProperty("composioAccountId");
      expect(acc).not.toHaveProperty("composioAccountIdHash");
    }
    // And it doesn't appear anywhere in the JSON text either (defense-in-depth).
    expect(bytes).not.toContain("composioAccountId");
    expect(bytes).not.toContain("composioAccountIdHash");
  });

  it("CROSS-TENANT: export only contains A's data, not B's", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const b = await insertCreator(t, { suffix: "b", plan: "manager" });
    await t.run((ctx) =>
      ctx.db.insert("creatorHandles", {
        creatorId: a,
        platform: "tiktok",
        handle: "a_handle",
        verified: true,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("creatorHandles", {
        creatorId: b,
        platform: "instagram",
        handle: "b_handle_secret",
        verified: true,
      })
    );
    expect(b).toBeDefined();
    const res = await asUser(t, "a").action(api.profile.exportCreatorData, {});
    const text = await t.run(async (ctx) => {
      const blob = await ctx.storage.get(res.storageId);
      if (!blob) throw new Error("blob missing");
      return await blob.text();
    });
    expect(text).toContain("a_handle");
    expect(text).not.toContain("b_handle_secret");
  });

  it("rejects unauthenticated calls", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.profile.exportCreatorData, {})
    ).rejects.toThrow(/not authenticated/i);
  });
});
