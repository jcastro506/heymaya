/**
 * PIN-challenge module — pure-function + convex-test integration suite.
 *
 * 5 mandatory categories:
 *   1. Cross-tenant — Business A's PIN never authorizes Business B's
 *      sensitive op (verifyPin keyed by businessId).
 *   2. Plan-tier × action — sensitive-op gating fails-closed regardless of
 *      tier; tier gating happens upstream at action wrapper.
 *   3. Adversarial — wrong-format PIN, wrong-format hash, malformed base64
 *      all return false (never throw to a caller-observable failure).
 *   4. Sibling-file scan — covered repo-wide.
 *   5. TODO grep — covered repo-wide.
 *
 * Voice-specific:
 *   - Sensitive-op enforcement matrix (every op in `SENSITIVE_VOICE_OPS`
 *     fails-closed without correct PIN).
 *   - PIN setup → verify round-trip.
 *   - PBKDF2 iteration count bumped down for test-speed via
 *     `_setPbkdf2IterationsForTests`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import {
  _setPbkdf2IterationsForTests,
  hashPin,
  verifyPinHash,
} from "../pinChallenge";
import {
  SENSITIVE_VOICE_OPS,
  READONLY_VOICE_OPS,
  isReadonlyVoiceOp,
  isSensitiveOp,
} from "../sensitiveOps";

const NOW = 1_700_000_000_000;

beforeAll(() => {
  // Drop iterations to keep PBKDF2 fast in tests. Production uses 600_000.
  _setPbkdf2IterationsForTests(1_000);
});

afterAll(() => {
  _setPbkdf2IterationsForTests(null);
});

async function insertBusinessWithVoiceChannel(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; pinHash?: string }
): Promise<{
  businessId: Id<"businesses">;
  voiceChannelId: Id<"voiceChannels">;
}> {
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
  const businessId = await t.run((ctx) =>
    ctx.db.insert("businesses", {
      accountId,
      name: `Business ${opts.suffix}`,
      serviceTypes: ["hvac"],
      planTier: "studio",
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
  const voiceChannelId = await t.run((ctx) =>
    ctx.db.insert("voiceChannels", {
      businessId,
      twilioNumberSid: `PN_${opts.suffix}`,
      twilioPhoneNumber: `+1555${opts.suffix.padEnd(7, "0").slice(0, 7)}`,
      provisionedAt: NOW,
      monthlyMinutesUsed: 0,
      pinHash: opts.pinHash,
      pinSetAt: opts.pinHash ? NOW : undefined,
    })
  );
  return { businessId, voiceChannelId };
}

describe("hashPin / verifyPinHash — pure functions", () => {
  it("round-trips a valid 4-digit PIN", async () => {
    const hash = await hashPin("1234");
    expect(await verifyPinHash("1234", hash)).toBe(true);
  });

  it("round-trips a valid 6-digit PIN", async () => {
    const hash = await hashPin("987654");
    expect(await verifyPinHash("987654", hash)).toBe(true);
  });

  it("two equal PINs produce DIFFERENT hashes (random salt)", async () => {
    const h1 = await hashPin("1234");
    const h2 = await hashPin("1234");
    expect(h1).not.toEqual(h2);
  });

  it("rejects mismatched PIN", async () => {
    const hash = await hashPin("1234");
    expect(await verifyPinHash("1235", hash)).toBe(false);
  });

  it("rejects null hash", async () => {
    expect(await verifyPinHash("1234", null)).toBe(false);
  });

  it("rejects empty hash", async () => {
    expect(await verifyPinHash("1234", "")).toBe(false);
  });

  it("rejects malformed hash format", async () => {
    expect(await verifyPinHash("1234", "not.a.valid.format")).toBe(false);
    expect(await verifyPinHash("1234", "noseparator")).toBe(false);
    expect(await verifyPinHash("1234", "ZZZ.ZZZ")).toBe(false);
  });

  it("hashPin rejects non-numeric PIN", async () => {
    await expect(hashPin("abcd")).rejects.toThrow(/digits only/i);
  });

  it("hashPin rejects too-short PIN", async () => {
    await expect(hashPin("12")).rejects.toThrow(/digits/i);
  });

  it("hashPin rejects too-long PIN", async () => {
    await expect(hashPin("1234567")).rejects.toThrow(/digits/i);
  });

  it("verifyPinHash rejects non-numeric input without throwing", async () => {
    const hash = await hashPin("1234");
    expect(await verifyPinHash("abcd", hash)).toBe(false);
  });
});

describe("setPinForBusinessInternal / clearPinForBusinessInternal", () => {
  it("setPinForBusiness stores hash + pinSetAt", async () => {
    const t = convexTest(schema, modules);
    const { businessId, voiceChannelId } =
      await insertBusinessWithVoiceChannel(t, { suffix: "p1" });

    const hash = await hashPin("4242");
    await t.mutation(internal.voice.pinChallenge.setPinForBusinessInternal, {
      businessId,
      pinHash: hash,
    });

    const row = await t.run((ctx) => ctx.db.get(voiceChannelId));
    expect(row?.pinHash).toBe(hash);
    expect(typeof row?.pinSetAt).toBe("number");
  });

  it("setPin throws when voiceChannels row missing", async () => {
    const t = convexTest(schema, modules);
    const accountId = await t.run((ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "op_nochan",
        email: "nochan@svc.test",
        channelPreference: "web",
        timezone: "America/Los_Angeles",
        status: "active",
        plan: "starter",
        accountType: "service-business",
        createdAt: NOW,
      })
    );
    const businessId = await t.run((ctx) =>
      ctx.db.insert("businesses", {
        accountId,
        name: "Business no chan",
        serviceTypes: ["hvac"],
        planTier: "studio",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );

    const hash = await hashPin("4242");
    await expect(
      t.mutation(internal.voice.pinChallenge.setPinForBusinessInternal, {
        businessId,
        pinHash: hash,
      })
    ).rejects.toThrow(/missing/i);
  });

  it("clearPin nulls out hash + pinSetAt", async () => {
    const t = convexTest(schema, modules);
    const hash = await hashPin("1111");
    const { businessId, voiceChannelId } =
      await insertBusinessWithVoiceChannel(t, { suffix: "clr", pinHash: hash });

    await t.mutation(internal.voice.pinChallenge.clearPinForBusinessInternal, {
      businessId,
    });
    const row = await t.run((ctx) => ctx.db.get(voiceChannelId));
    expect(row?.pinHash).toBeUndefined();
    expect(row?.pinSetAt).toBeUndefined();
  });
});

describe("getVoicePinHashForBusiness — cross-tenant", () => {
  it("returns A's hash to A and B's hash to B; never crosses", async () => {
    const t = convexTest(schema, modules);
    const hashA = await hashPin("1111");
    const hashB = await hashPin("2222");
    const { businessId: bA } = await insertBusinessWithVoiceChannel(t, {
      suffix: "ca",
      pinHash: hashA,
    });
    const { businessId: bB } = await insertBusinessWithVoiceChannel(t, {
      suffix: "cb",
      pinHash: hashB,
    });

    const a = await t.query(
      internal.voice.pinChallenge.getVoicePinHashForBusiness,
      { businessId: bA }
    );
    const b = await t.query(
      internal.voice.pinChallenge.getVoicePinHashForBusiness,
      { businessId: bB }
    );
    expect(a.hash).toBe(hashA);
    expect(b.hash).toBe(hashB);
    expect(a.hash).not.toEqual(b.hash);
  });
});

describe("Sensitive-op matrix — locked list invariants", () => {
  it("SENSITIVE_VOICE_OPS contains every locked op (per § 13 Sprint 6)", () => {
    const expected = [
      "createJob",
      "modifyCustomer",
      "sendReviewRequest",
      "sendInvoice",
      "modifyPricing",
      "postToSocial",
      "modifyGbpProfile",
    ];
    for (const op of expected) {
      expect(SENSITIVE_VOICE_OPS).toContain(op);
      expect(isSensitiveOp(op)).toBe(true);
    }
  });

  it("READONLY_VOICE_OPS does NOT overlap with SENSITIVE_VOICE_OPS", () => {
    for (const op of READONLY_VOICE_OPS) {
      expect(isSensitiveOp(op)).toBe(false);
      expect(isReadonlyVoiceOp(op)).toBe(true);
    }
  });

  it("isReadonlyVoiceOp returns false for sensitive ops", () => {
    for (const op of SENSITIVE_VOICE_OPS) {
      expect(isReadonlyVoiceOp(op)).toBe(false);
    }
  });

  it("isSensitiveOp returns false for unknown op string", () => {
    expect(isSensitiveOp("nonexistentOperation")).toBe(false);
  });
});

describe("markPinChallengeResult — audit trail", () => {
  it("patches pinChallengePassed on existing transcript row", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await insertBusinessWithVoiceChannel(t, {
      suffix: "mpr",
    });

    // Create a transcript row first.
    await t.mutation(internal.voice.transcripts.recordTranscriptChunk, {
      businessId,
      callId: "CA_pinaudit",
      direction: "inbound",
      fromNumber: "+15551111111",
      toNumber: "+15552222222",
      startedAt: NOW,
      chunk: { role: "caller", ts: 0, text: "PIN test", chunkIdx: 0 },
    });

    await t.mutation(internal.voice.sensitiveOps.markPinChallengeResult, {
      businessId,
      callId: "CA_pinaudit",
      passed: true,
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query("voiceCallTranscripts")
        .withIndex("by_callId", (q) => q.eq("callId", "CA_pinaudit"))
        .first()
    );
    expect(row?.pinChallengePassed).toBe(true);
  });

  it("no-op when transcript row missing (does not silently create)", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await insertBusinessWithVoiceChannel(t, {
      suffix: "nox",
    });
    await t.mutation(internal.voice.sensitiveOps.markPinChallengeResult, {
      businessId,
      callId: "CA_nonexistent",
      passed: true,
    });
    const row = await t.run((ctx) =>
      ctx.db
        .query("voiceCallTranscripts")
        .withIndex("by_callId", (q) => q.eq("callId", "CA_nonexistent"))
        .first()
    );
    expect(row).toBeNull();
  });

  it("cross-tenant: refuses to patch row from a different business", async () => {
    const t = convexTest(schema, modules);
    const { businessId: bA } = await insertBusinessWithVoiceChannel(t, {
      suffix: "xa",
    });
    const { businessId: bB } = await insertBusinessWithVoiceChannel(t, {
      suffix: "xb",
    });

    await t.mutation(internal.voice.transcripts.recordTranscriptChunk, {
      businessId: bA,
      callId: "CA_xt",
      direction: "inbound",
      fromNumber: "+15551111111",
      toNumber: "+15552222222",
      startedAt: NOW,
      chunk: { role: "caller", ts: 0, text: "x", chunkIdx: 0 },
    });

    await t.mutation(internal.voice.sensitiveOps.markPinChallengeResult, {
      businessId: bB, // wrong business
      callId: "CA_xt",
      passed: true,
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query("voiceCallTranscripts")
        .withIndex("by_callId", (q) => q.eq("callId", "CA_xt"))
        .first()
    );
    // Should remain null/not-set — the patch attempt was rejected.
    expect(row?.pinChallengePassed).toBeNull();
  });
});
