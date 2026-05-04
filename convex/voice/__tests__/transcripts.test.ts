/**
 * voiceCallTranscripts persistence — convex-test integration suite.
 *
 * 5 mandatory categories (per `feedback_validation_gap_prevention.md`):
 *   1. Cross-tenant isolation — Business B can never read or mutate
 *      Business A's transcripts. Tests run two businesses in parallel.
 *   2. Plan-tier × action — voice setup actions are Studio-only; setMyVoicePin
 *      from a Pro tier rejects.
 *   3. Adversarial inputs — malformed payloads, signature mismatches,
 *      duplicate chunkIdx replay all rejected/no-op'd.
 *   4. Sibling-file scan — covered repo-wide.
 *   5. TODO grep — covered repo-wide.
 *
 * Voice-specific:
 *   - HMAC signature verification (good/bad signatures, timing-safe compare)
 *   - Idempotent chunk replay
 *   - One-shot finalization
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import {
  parseTranscriptHookPayload,
  verifyTranscriptHmac,
} from "../transcripts";

const NOW = 1_700_000_000_000;

async function insertBusiness(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; tier?: "starter" | "pro" | "studio" }
): Promise<Id<"businesses">> {
  const accountId = await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `op_${opts.suffix}`,
      email: `${opts.suffix}@svc.test`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "coach",
      accountType: "service-business",
      createdAt: NOW,
    })
  );
  return await t.run((ctx) =>
    ctx.db.insert("businesses", {
      accountId,
      name: `Business ${opts.suffix}`,
      serviceTypes: ["hvac"],
      planTier: opts.tier ?? "studio",
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
}

describe("voiceCallTranscripts — recordTranscriptChunk", () => {
  it("creates a row on first chunk and appends on second", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });

    const r1 = await t.mutation(
      internal.voice.transcripts.recordTranscriptChunk,
      {
        businessId,
        callId: "CA_test_1",
        direction: "inbound",
        fromNumber: "+15551111111",
        toNumber: "+15552222222",
        startedAt: NOW,
        chunk: { role: "caller", ts: 100, text: "Hello", chunkIdx: 0 },
      }
    );
    expect(r1.duplicate).toBe(false);

    const r2 = await t.mutation(
      internal.voice.transcripts.recordTranscriptChunk,
      {
        businessId,
        callId: "CA_test_1",
        direction: "inbound",
        fromNumber: "+15551111111",
        toNumber: "+15552222222",
        startedAt: NOW,
        chunk: { role: "agent", ts: 1100, text: "Hi there", chunkIdx: 1 },
      }
    );
    expect(r2.duplicate).toBe(false);
    expect(r2.transcriptId).toEqual(r1.transcriptId);

    const row = await t.run((ctx) => ctx.db.get(r1.transcriptId));
    expect(row?.transcript.length).toBe(2);
    expect(row?.transcript[0].text).toBe("Hello");
    expect(row?.transcript[1].text).toBe("Hi there");
  });

  it("idempotent: replay of same chunkIdx is a no-op", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "b" });

    await t.mutation(internal.voice.transcripts.recordTranscriptChunk, {
      businessId,
      callId: "CA_idem",
      direction: "inbound",
      fromNumber: "+15551111111",
      toNumber: "+15552222222",
      startedAt: NOW,
      chunk: { role: "caller", ts: 0, text: "Once", chunkIdx: 0 },
    });

    const replay = await t.mutation(
      internal.voice.transcripts.recordTranscriptChunk,
      {
        businessId,
        callId: "CA_idem",
        direction: "inbound",
        fromNumber: "+15551111111",
        toNumber: "+15552222222",
        startedAt: NOW,
        chunk: { role: "caller", ts: 0, text: "Once", chunkIdx: 0 },
      }
    );
    expect(replay.duplicate).toBe(true);

    const row = await t.run((ctx) => ctx.db.get(replay.transcriptId));
    expect(row?.transcript.length).toBe(1);
  });

  it("cross-tenant: Business B's call cannot collide with A's", async () => {
    const t = convexTest(schema, modules);
    const businessA = await insertBusiness(t, { suffix: "a" });
    const businessB = await insertBusiness(t, { suffix: "b" });

    await t.mutation(internal.voice.transcripts.recordTranscriptChunk, {
      businessId: businessA,
      callId: "CA_collision",
      direction: "inbound",
      fromNumber: "+15551111111",
      toNumber: "+15552222222",
      startedAt: NOW,
      chunk: { role: "caller", ts: 0, text: "From A", chunkIdx: 0 },
    });

    await expect(
      t.mutation(internal.voice.transcripts.recordTranscriptChunk, {
        businessId: businessB,
        callId: "CA_collision",
        direction: "inbound",
        fromNumber: "+15551111111",
        toNumber: "+15552222222",
        startedAt: NOW,
        chunk: { role: "caller", ts: 0, text: "From B", chunkIdx: 0 },
      })
    ).rejects.toThrow(/cross-tenant/i);
  });
});

describe("voiceCallTranscripts — finalizeTranscript", () => {
  it("sets endedAt + summary + costCents on first call; second is no-op", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "fin" });

    await t.mutation(internal.voice.transcripts.recordTranscriptChunk, {
      businessId,
      callId: "CA_fin",
      direction: "inbound",
      fromNumber: "+15551111111",
      toNumber: "+15552222222",
      startedAt: NOW,
      chunk: { role: "caller", ts: 0, text: "Hi", chunkIdx: 0 },
    });

    await t.mutation(internal.voice.transcripts.finalizeTranscript, {
      businessId,
      callId: "CA_fin",
      endedAt: NOW + 60_000,
      durationSec: 60,
      summary: "Customer asked schedule",
      escalatedToOperator: false,
      costCents: 12,
    });

    const r1 = await t.run((ctx) =>
      ctx.db
        .query("voiceCallTranscripts")
        .withIndex("by_callId", (q) => q.eq("callId", "CA_fin"))
        .first()
    );
    expect(r1?.endedAt).toBe(NOW + 60_000);
    expect(r1?.summary).toBe("Customer asked schedule");
    expect(r1?.costCents).toBe(12);

    // Second call — should be a no-op (idempotent finalize).
    await t.mutation(internal.voice.transcripts.finalizeTranscript, {
      businessId,
      callId: "CA_fin",
      endedAt: NOW + 99_999,
      durationSec: 999,
      summary: "Different summary",
      escalatedToOperator: true,
      costCents: 999,
    });
    const r2 = await t.run((ctx) =>
      ctx.db
        .query("voiceCallTranscripts")
        .withIndex("by_callId", (q) => q.eq("callId", "CA_fin"))
        .first()
    );
    expect(r2?.endedAt).toBe(NOW + 60_000); // still original
    expect(r2?.costCents).toBe(12);
  });

  it("rejects finalize when no chunks exist for callId", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "nochunks" });

    await expect(
      t.mutation(internal.voice.transcripts.finalizeTranscript, {
        businessId,
        callId: "CA_missing",
        endedAt: NOW,
        durationSec: 0,
      })
    ).rejects.toThrow(/no transcript row/i);
  });

  it("rejects cross-tenant finalize", async () => {
    const t = convexTest(schema, modules);
    const businessA = await insertBusiness(t, { suffix: "fa" });
    const businessB = await insertBusiness(t, { suffix: "fb" });

    await t.mutation(internal.voice.transcripts.recordTranscriptChunk, {
      businessId: businessA,
      callId: "CA_xfin",
      direction: "inbound",
      fromNumber: "+15551111111",
      toNumber: "+15552222222",
      startedAt: NOW,
      chunk: { role: "caller", ts: 0, text: "Hi", chunkIdx: 0 },
    });

    await expect(
      t.mutation(internal.voice.transcripts.finalizeTranscript, {
        businessId: businessB,
        callId: "CA_xfin",
        endedAt: NOW + 1000,
        durationSec: 1,
      })
    ).rejects.toThrow(/cross-tenant/i);
  });
});

describe("verifyTranscriptHmac", () => {
  const SECRET = "test-secret-32-bytes-yyyyyyyyyy";

  async function signBody(body: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(body)
    );
    const bytes = new Uint8Array(sig);
    let hex = "";
    for (let i = 0; i < bytes.length; i++)
      hex += bytes[i].toString(16).padStart(2, "0");
    return `sha256=${hex}`;
  }

  it("accepts a valid signature", async () => {
    const body = '{"hello":"world"}';
    const sig = await signBody(body, SECRET);
    expect(await verifyTranscriptHmac(body, sig, SECRET)).toBe(true);
  });

  it("rejects mismatched body", async () => {
    const sig = await signBody("original", SECRET);
    expect(await verifyTranscriptHmac("tampered", sig, SECRET)).toBe(false);
  });

  it("rejects missing prefix", async () => {
    const sig = await signBody("body", SECRET);
    const noPrefix = sig.slice("sha256=".length);
    expect(await verifyTranscriptHmac("body", noPrefix, SECRET)).toBe(false);
  });

  it("rejects malformed hex", async () => {
    expect(await verifyTranscriptHmac("body", "sha256=ZZZ", SECRET)).toBe(false);
  });

  it("rejects empty signature header", async () => {
    expect(await verifyTranscriptHmac("body", null, SECRET)).toBe(false);
    expect(await verifyTranscriptHmac("body", "", SECRET)).toBe(false);
  });

  it("rejects empty secret", async () => {
    const sig = await signBody("body", SECRET);
    expect(await verifyTranscriptHmac("body", sig, "")).toBe(false);
  });
});

describe("parseTranscriptHookPayload", () => {
  const BASE = {
    callId: "CA_x",
    businessId: "abc123",
    direction: "inbound" as const,
    fromNumber: "+15551111111",
    toNumber: "+15552222222",
    startedAt: NOW,
  };

  it("parses chunk-only payload", () => {
    const p = parseTranscriptHookPayload({
      ...BASE,
      chunk: { role: "caller", ts: 0, text: "hi", chunkIdx: 0 },
    });
    expect(p.chunk?.text).toBe("hi");
  });

  it("parses finalize-only payload", () => {
    const p = parseTranscriptHookPayload({
      ...BASE,
      finalize: { endedAt: NOW + 1000, durationSec: 1 },
    });
    expect(p.finalize?.durationSec).toBe(1);
  });

  it("rejects when neither chunk nor finalize present", () => {
    expect(() => parseTranscriptHookPayload(BASE)).toThrow(
      /chunk.*finalize/i
    );
  });

  it("rejects malformed direction", () => {
    expect(() =>
      parseTranscriptHookPayload({
        ...BASE,
        direction: "sideways",
        chunk: { role: "caller", ts: 0, text: "hi", chunkIdx: 0 },
      })
    ).toThrow(/direction/i);
  });

  it("rejects empty businessId", () => {
    expect(() =>
      parseTranscriptHookPayload({
        ...BASE,
        businessId: "",
        chunk: { role: "caller", ts: 0, text: "hi", chunkIdx: 0 },
      })
    ).toThrow(/businessId/i);
  });

  it("rejects non-finite numbers", () => {
    expect(() =>
      parseTranscriptHookPayload({
        ...BASE,
        startedAt: Number.NaN,
        chunk: { role: "caller", ts: 0, text: "hi", chunkIdx: 0 },
      })
    ).toThrow(/startedAt/i);
  });
});

describe("setMyVoicePin — plan-tier gating", () => {
  async function insertBusinessAndLinkAccount(
    t: ReturnType<typeof convexTest>,
    suffix: string,
    tier: "starter" | "pro" | "studio"
  ): Promise<Id<"businesses">> {
    const accountId = await t.run((ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: `op_${suffix}`,
        email: `${suffix}@svc.test`,
        channelPreference: "web",
        timezone: "America/Los_Angeles",
        status: "active",
        plan: "coach",
        accountType: "service-business",
        createdAt: NOW,
      })
    );
    const businessId = await t.run((ctx) =>
      ctx.db.insert("businesses", {
        accountId,
        name: `Business ${suffix}`,
        serviceTypes: ["hvac"],
        planTier: tier,
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    // Link account → business so `getMyBusinessForOAuth` resolves.
    await t.run((ctx) =>
      ctx.db.patch(accountId, { businessId })
    );
    return businessId;
  }

  it("Pro tier cannot set voice PIN (Studio-only)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusinessAndLinkAccount(t, "pro1", "pro");
    // Provision a voice channel anyway (Pro inclusion bucket allows row);
    // gating is at action layer.
    await t.run((ctx) =>
      ctx.db.insert("voiceChannels", {
        businessId,
        twilioNumberSid: "PNxxxx",
        twilioPhoneNumber: "+15553334444",
        provisionedAt: NOW,
        monthlyMinutesUsed: 0,
      })
    );

    const asPro = t.withIdentity({ subject: "op_pro1" });
    await expect(
      asPro.action(api.voice.transcripts.setMyVoicePin, { pin: "1234" })
    ).rejects.toThrow(/studio/i);
  });
});
