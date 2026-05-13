/**
 * Sprint B.2 — editingFingerprintObservations tests.
 *
 * Covers the 5 mandatory categories per
 * `feedback_validation_gap_prevention.md`:
 *
 *   1. Cross-tenant isolation — Creator A's observations never touch
 *      Creator B's picture; a rendered-media-asset owned by Creator B
 *      cannot be linked from a Creator A observation.
 *   2. Plan-tier × action — observations are intentionally ungated
 *      (the moat sharpens for every plan). Asserted explicitly so a
 *      future regression that adds a gate gets caught.
 *   3. Adversarial inputs — malformed deltas, no rendered variant linked,
 *      observation against a creator with no fingerprint, applying
 *      observations to a creator with no fingerprint at all, deltas with
 *      unknown enum, durationMs negative, empty publishedPostId.
 *   4. Sibling-file scan — schema.ts has the table, lcMayaHttp.ts has the
 *      two endpoints, http.ts registers them, standingOrders.ts references
 *      `/lc_maya/observe_published_edit` + `/lc_maya/apply_observations_to_fingerprint`.
 *   5. TODO grep — covered repo-wide by `sprint1Acceptance.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { _setWebhookSecretForTests } from "../../lib/webhookSecret";
import {
  _setObservationMultimodalCallForTests,
  computeNextFingerprint,
  type EditingFingerprintShape,
  type ObservationMultimodalCall,
  type ObservationMultimodalCallArgs,
} from "../editingFingerprintObservations";

const TEST_SECRET = "deadbeef".repeat(8);
// Use real-time-ish NOW so the action's `Date.now()`-relative recency window
// catches the fixture rows we insert. Using a stale epoch (e.g. 2023) here
// would exclude every test fixture from the 30d cutoff.
const NOW = Date.now();
const REPO_ROOT = join(__dirname, "..", "..", "..");

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan?: "coach" | "manager" }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "imessage",
      timezone: "America/Los_Angeles",
      status: "onboarding",
      plan: opts.plan ?? "manager",
      createdAt: NOW,
    })
  );
}

const BASELINE_FINGERPRINT: EditingFingerprintShape = {
  pacing: {
    avgCutEverySec: 1.0,
    consistency: "tight",
    hookLandsAtMs: 400,
    pacingCurve: "fast-throughout",
  },
  opening: "face-on",
  transitions: "hard-cut",
  captions: {
    style: "burned-in",
    position: "center",
    cadence: "phrase",
    visualDescription: "white sans-serif",
  },
  audio: "original-voice",
  framing: "fully-vertical-9-16",
  signatureMoves: ["opens with a sip of coffee"],
  confidence: 0.7,
  sampleSize: 12,
  citedPostIds: ["tt_1", "tt_2"],
  extractedAt: NOW - 86400_000,
};

async function insertPictureWithFingerprint(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  fingerprint: EditingFingerprintShape | undefined = BASELINE_FINGERPRINT
): Promise<Id<"creatorPicture">> {
  return await t.run((ctx) =>
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
      editingFingerprint: fingerprint,
    })
  );
}

async function insertRenderedAsset(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  storageUrl = "https://convex-storage.test/rendered.mp4"
): Promise<Id<"creatorMayaV0MediaAssets">> {
  return await t.run((ctx) =>
    ctx.db.insert("creatorMayaV0MediaAssets", {
      creatorId,
      storageUrl,
      storageBytes: 1234,
      mimeType: "video/mp4",
      mediaKind: "video",
      source: "rendered_variant",
      contentHash: "h_" + creatorId,
      consent: { usage: "approved_for_this_request" },
      catalog: {
        primarySubject: "fitness clip",
        visualQuality: "good",
        creatorRelevance: "matches niche",
        suggestedUses: ["tiktok"],
        catalogedAt: NOW,
        catalogModel: "gemini-3-flash",
        catalogCostUsd: 0.001,
      },
      usageHistory: [],
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
}

function makeMockCall(opts: {
  response?: string;
  throwError?: Error;
  capture?: { args?: ObservationMultimodalCallArgs };
}): ObservationMultimodalCall {
  return async (args: ObservationMultimodalCallArgs) => {
    if (opts.capture) opts.capture.args = args;
    if (opts.throwError) throw opts.throwError;
    return {
      content:
        opts.response ??
        JSON.stringify({
          durationMs: 11000,
          deltas: [
            {
              field: "pacing.hookLandsAtMs",
              observed: "800",
              expected: "400",
              reason: "creator extended the setup beat",
            },
          ],
        }),
      model: "google/gemini-3-flash-preview",
    };
  };
}

/* -------------------------------------------------------------------------- */
/* Pure computeNextFingerprint                                                 */
/* -------------------------------------------------------------------------- */

describe("computeNextFingerprint — rolling synthesis", () => {
  it("HAPPY: nudges hookLandsAtMs toward observed value (weighted, not flipped)", () => {
    const { next, summary } = computeNextFingerprint({
      current: BASELINE_FINGERPRINT,
      observations: [
        {
          deltas: [
            {
              field: "pacing.hookLandsAtMs",
              observed: "800",
              expected: "400",
              reason: "longer setup",
            },
          ],
          observedAt: NOW,
          publishedPostId: "tt_p1",
        },
      ],
      nowMs: NOW,
    });
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.pacing.hookLandsAtMs).toBeGreaterThan(400);
    expect(next.pacing.hookLandsAtMs).toBeLessThan(800);
    expect(summary.updated).toContain("pacing.hookLandsAtMs");
    expect(summary.applied).toBe(1);
    expect(summary.conflicts).toEqual([]);
  });

  it("HAPPY: flips categorical field (opening) when one observed value clearly dominates", () => {
    const obs = Array.from({ length: 5 }).map((_, i) => ({
      deltas: [
        {
          field: "opening" as const,
          observed: "motion-shot",
          expected: "face-on",
          reason: "now opens with movement",
        },
      ],
      observedAt: NOW - i * 1000,
      publishedPostId: `tt_p${i}`,
    }));
    const { next, summary } = computeNextFingerprint({
      current: BASELINE_FINGERPRINT,
      observations: obs,
      nowMs: NOW,
    });
    expect(next?.opening).toBe("motion-shot");
    expect(summary.updated).toContain("opening");
    expect(summary.conflicts).not.toContain("opening");
  });

  it("HOLDS the current value + flags conflict when observed values disagree", () => {
    const { next, summary } = computeNextFingerprint({
      current: BASELINE_FINGERPRINT,
      observations: [
        {
          deltas: [
            {
              field: "opening",
              observed: "motion-shot",
              expected: "face-on",
              reason: "x",
            },
          ],
          observedAt: NOW,
          publishedPostId: "tt_a",
        },
        {
          deltas: [
            {
              field: "opening",
              observed: "text-card",
              expected: "face-on",
              reason: "y",
            },
          ],
          observedAt: NOW,
          publishedPostId: "tt_b",
        },
      ],
      nowMs: NOW,
    });
    expect(next?.opening).toBe("face-on"); // held
    expect(summary.conflicts).toContain("opening");
    expect(summary.updated).not.toContain("opening");
  });

  it("ADD-ONLY: signatureMoves accumulates without removing existing moves", () => {
    const { next } = computeNextFingerprint({
      current: BASELINE_FINGERPRINT,
      observations: [
        {
          deltas: [
            {
              field: "signatureMoves",
              observed: "ends on a stare",
              expected: "",
              reason: "new recurring beat",
            },
          ],
          observedAt: NOW,
          publishedPostId: "tt_p",
        },
      ],
      nowMs: NOW,
    });
    expect(next?.signatureMoves).toContain("opens with a sip of coffee"); // kept
    expect(next?.signatureMoves).toContain("ends on a stare"); // added
  });

  it("signatureMoves dedupes case-insensitively", () => {
    const { next } = computeNextFingerprint({
      current: BASELINE_FINGERPRINT,
      observations: [
        {
          deltas: [
            {
              field: "signatureMoves",
              observed: "Opens With A Sip Of Coffee",
              expected: "",
              reason: "duplicate of existing",
            },
          ],
          observedAt: NOW,
          publishedPostId: "tt_p",
        },
      ],
      nowMs: NOW,
    });
    expect(next?.signatureMoves.length).toBe(1);
  });

  it("signatureMoves caps at 8 entries", () => {
    const existing = Array.from({ length: 7 }).map((_, i) => `move_${i}`);
    const fingerprint = { ...BASELINE_FINGERPRINT, signatureMoves: existing };
    const { next } = computeNextFingerprint({
      current: fingerprint,
      observations: [
        {
          deltas: Array.from({ length: 5 }).map((_, i) => ({
            field: "signatureMoves" as const,
            observed: `new_move_${i}`,
            expected: "",
            reason: "x",
          })),
          observedAt: NOW,
          publishedPostId: "tt_p",
        },
      ],
      nowMs: NOW,
    });
    expect(next?.signatureMoves.length).toBe(8);
    // First new one made it in.
    expect(next?.signatureMoves).toContain("new_move_0");
  });

  it("visualDescription: latest-observation wins", () => {
    const { next } = computeNextFingerprint({
      current: BASELINE_FINGERPRINT,
      observations: [
        {
          deltas: [
            {
              field: "captions.visualDescription",
              observed: "bold black with white stroke",
              expected: "white sans-serif",
              reason: "switched palette",
            },
          ],
          observedAt: NOW,
          publishedPostId: "tt_recent",
        },
      ],
      nowMs: NOW,
    });
    expect(next?.captions.visualDescription).toBe("bold black with white stroke");
  });

  it("returns null when there is no current fingerprint AND no observations", () => {
    const { next, summary } = computeNextFingerprint({
      current: null,
      observations: [],
      nowMs: NOW,
    });
    expect(next).toBeNull();
    expect(summary.applied).toBe(0);
  });

  it("returns null next + marks applied when current is null but observations exist", () => {
    const { next, summary } = computeNextFingerprint({
      current: null,
      observations: [
        {
          deltas: [
            {
              field: "opening",
              observed: "motion-shot",
              expected: "?",
              reason: "x",
            },
          ],
          observedAt: NOW,
          publishedPostId: "tt_p",
        },
      ],
      nowMs: NOW,
    });
    expect(next).toBeNull();
    expect(summary.applied).toBe(1);
  });

  it("invalid enum value in observed is filtered out (not flipped to nonsense)", () => {
    const { next } = computeNextFingerprint({
      current: BASELINE_FINGERPRINT,
      observations: [
        {
          deltas: [
            {
              field: "opening",
              observed: "definitely-not-a-real-enum",
              expected: "face-on",
              reason: "garbage",
            },
          ],
          observedAt: NOW,
          publishedPostId: "tt_p",
        },
      ],
      nowMs: NOW,
    });
    expect(next?.opening).toBe("face-on");
  });

  it("avgCutEverySec averages weighted but does not flip beyond observation range", () => {
    const { next } = computeNextFingerprint({
      current: BASELINE_FINGERPRINT,
      observations: [
        {
          deltas: [
            {
              field: "pacing.avgCutEverySec",
              observed: "2.0",
              expected: "1.0",
              reason: "longer cuts",
            },
          ],
          observedAt: NOW,
          publishedPostId: "tt_p",
        },
      ],
      nowMs: NOW,
    });
    expect(next?.pacing.avgCutEverySec).toBeGreaterThan(1.0);
    expect(next?.pacing.avgCutEverySec).toBeLessThan(2.0);
  });

  it("non-numeric value in numeric field is ignored", () => {
    const { next } = computeNextFingerprint({
      current: BASELINE_FINGERPRINT,
      observations: [
        {
          deltas: [
            {
              field: "pacing.avgCutEverySec",
              observed: "much longer",
              expected: "1.0",
              reason: "qualitative",
            },
          ],
          observedAt: NOW,
          publishedPostId: "tt_p",
        },
      ],
      nowMs: NOW,
    });
    expect(next?.pacing.avgCutEverySec).toBe(1.0); // unchanged
  });

  it("recency weighting: older observations carry less weight", () => {
    // Two observations: a recent "2.0" and an old "5.0" — recent should win
    // the weighted average.
    const { next } = computeNextFingerprint({
      current: BASELINE_FINGERPRINT,
      observations: [
        {
          deltas: [
            {
              field: "pacing.avgCutEverySec",
              observed: "2.0",
              expected: "1.0",
              reason: "recent",
            },
          ],
          observedAt: NOW,
          publishedPostId: "tt_recent",
        },
        {
          deltas: [
            {
              field: "pacing.avgCutEverySec",
              observed: "5.0",
              expected: "1.0",
              reason: "old",
            },
          ],
          observedAt: NOW - 30 * 24 * 60 * 60 * 1000, // 30d ago
          publishedPostId: "tt_old",
        },
      ],
      nowMs: NOW,
    });
    // 30d at 7d half-life = ~1/16 weight; the old datapoint should barely
    // move the result. So next should be much closer to baseline+2 than
    // baseline+5.
    expect(next?.pacing.avgCutEverySec).toBeLessThan(2.5);
  });
});

/* -------------------------------------------------------------------------- */
/* Action: extractObservationFromPublishedPost                                 */
/* -------------------------------------------------------------------------- */

describe("extractObservationFromPublishedPost", () => {
  beforeEach(() => {
    _setObservationMultimodalCallForTests(null);
  });
  afterEach(() => {
    _setObservationMultimodalCallForTests(null);
  });

  it("HAPPY: returns a structured observation when multimodal call returns valid JSON", async () => {
    const capture: { args?: ObservationMultimodalCallArgs } = {};
    _setObservationMultimodalCallForTests(makeMockCall({ capture }));
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "a" });
    await insertPictureWithFingerprint(t, creatorId);

    const res = await t.action(
      internal.creatorMayaV0.editingFingerprintObservations
        .extractObservationFromPublishedPost,
      {
        creatorId,
        publishedPostId: "tt_v1",
        publishedPostUrl: "https://www.tiktok.com/@creator/video/v1",
      }
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.observation.publishedPostId).toBe("tt_v1");
    expect(res.observation.durationMs).toBe(11000);
    expect(res.observation.deltas.length).toBe(1);
    expect(res.observation.deltas[0].field).toBe("pacing.hookLandsAtMs");
    expect(capture.args?.renderedVariantUrl).toBeNull();
  });

  it("HAPPY: when renderedMediaAssetId provided, the call receives the rendered URL", async () => {
    const capture: { args?: ObservationMultimodalCallArgs } = {};
    _setObservationMultimodalCallForTests(makeMockCall({ capture }));
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "b" });
    await insertPictureWithFingerprint(t, creatorId);
    const renderedId = await insertRenderedAsset(t, creatorId);

    const res = await t.action(
      internal.creatorMayaV0.editingFingerprintObservations
        .extractObservationFromPublishedPost,
      {
        creatorId,
        publishedPostId: "tt_v2",
        publishedPostUrl: "https://www.tiktok.com/@creator/video/v2",
        renderedMediaAssetId: renderedId,
      }
    );
    expect(res.ok).toBe(true);
    expect(capture.args?.renderedVariantUrl).toBe(
      "https://convex-storage.test/rendered.mp4"
    );
  });

  it("HAPPY: works when fingerprint is missing but rendered variant is linked", async () => {
    _setObservationMultimodalCallForTests(makeMockCall({}));
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "c" });
    // No picture row at all — only the rendered variant is the baseline.
    const renderedId = await insertRenderedAsset(t, creatorId);

    const res = await t.action(
      internal.creatorMayaV0.editingFingerprintObservations
        .extractObservationFromPublishedPost,
      {
        creatorId,
        publishedPostId: "tt_v3",
        publishedPostUrl: "https://www.tiktok.com/@creator/video/v3",
        renderedMediaAssetId: renderedId,
      }
    );
    expect(res.ok).toBe(true);
  });

  it("ADVERSARIAL: creator-not-found returns ok:false", async () => {
    _setObservationMultimodalCallForTests(makeMockCall({}));
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "z" });
    await t.run((ctx) => ctx.db.delete(creatorId));

    const res = await t.action(
      internal.creatorMayaV0.editingFingerprintObservations
        .extractObservationFromPublishedPost,
      {
        creatorId,
        publishedPostId: "tt_x",
        publishedPostUrl: "https://x.example",
      }
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("creator-not-found");
  });

  it("ADVERSARIAL: no fingerprint AND no rendered variant → fingerprint-missing", async () => {
    _setObservationMultimodalCallForTests(makeMockCall({}));
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "d" });
    // No picture row + no renderedMediaAssetId.

    const res = await t.action(
      internal.creatorMayaV0.editingFingerprintObservations
        .extractObservationFromPublishedPost,
      {
        creatorId,
        publishedPostId: "tt_x",
        publishedPostUrl: "https://x.example",
      }
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("fingerprint-missing");
  });

  it("ADVERSARIAL: multimodal not wired → multimodal-not-wired", async () => {
    _setObservationMultimodalCallForTests(null);
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "e" });
    await insertPictureWithFingerprint(t, creatorId);

    const res = await t.action(
      internal.creatorMayaV0.editingFingerprintObservations
        .extractObservationFromPublishedPost,
      {
        creatorId,
        publishedPostId: "tt_x",
        publishedPostUrl: "https://x.example",
      }
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("multimodal-not-wired");
  });

  it("ADVERSARIAL: multimodal throws → multimodal-call-failed", async () => {
    _setObservationMultimodalCallForTests(
      makeMockCall({ throwError: new Error("boom") })
    );
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "f" });
    await insertPictureWithFingerprint(t, creatorId);

    const res = await t.action(
      internal.creatorMayaV0.editingFingerprintObservations
        .extractObservationFromPublishedPost,
      {
        creatorId,
        publishedPostId: "tt_x",
        publishedPostUrl: "https://x.example",
      }
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("multimodal-call-failed");
  });

  it("ADVERSARIAL: invalid model JSON → model-response-invalid", async () => {
    _setObservationMultimodalCallForTests(
      makeMockCall({ response: "definitely not json" })
    );
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "g" });
    await insertPictureWithFingerprint(t, creatorId);

    const res = await t.action(
      internal.creatorMayaV0.editingFingerprintObservations
        .extractObservationFromPublishedPost,
      {
        creatorId,
        publishedPostId: "tt_x",
        publishedPostUrl: "https://x.example",
      }
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("model-response-invalid");
  });

  it("tolerates a ```json fenced response", async () => {
    const fenced =
      "```json\n" +
      JSON.stringify({
        durationMs: 5000,
        deltas: [],
      }) +
      "\n```";
    _setObservationMultimodalCallForTests(makeMockCall({ response: fenced }));
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "h" });
    await insertPictureWithFingerprint(t, creatorId);

    const res = await t.action(
      internal.creatorMayaV0.editingFingerprintObservations
        .extractObservationFromPublishedPost,
      {
        creatorId,
        publishedPostId: "tt_x",
        publishedPostUrl: "https://x.example",
      }
    );
    expect(res.ok).toBe(true);
  });

  it("CROSS-TENANT: rendered asset belonging to Creator B rejected for Creator A", async () => {
    _setObservationMultimodalCallForTests(makeMockCall({}));
    const t = convexTest(schema, modules);
    const creatorA = await insertCreator(t, { suffix: "ta" });
    const creatorB = await insertCreator(t, { suffix: "tb" });
    await insertPictureWithFingerprint(t, creatorA);
    const renderedB = await insertRenderedAsset(t, creatorB);

    const res = await t.action(
      internal.creatorMayaV0.editingFingerprintObservations
        .extractObservationFromPublishedPost,
      {
        creatorId: creatorA,
        publishedPostId: "tt_x",
        publishedPostUrl: "https://x.example",
        renderedMediaAssetId: renderedB,
      }
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("rendered-asset-cross-tenant");
  });
});

/* -------------------------------------------------------------------------- */
/* Mutation: insertEditingFingerprintObservation                               */
/* -------------------------------------------------------------------------- */

describe("insertEditingFingerprintObservation", () => {
  it("HAPPY: inserts row + returns counts", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "i" });
    const res = await t.mutation(
      internal.creatorMayaV0.editingFingerprintObservations
        .insertEditingFingerprintObservation,
      {
        creatorId,
        publishedPostId: "tt_a",
        publishedPostUrl: "https://x.example/a",
        durationMs: 9000,
        deltas: [
          {
            field: "opening",
            observed: "motion-shot",
            expected: "face-on",
            reason: "x",
          },
        ],
        nowMs: NOW,
      }
    );
    expect(res.totalForCreator).toBe(1);
    expect(res.unappliedForCreator).toBe(1);
    expect(res.observationId).toBeTruthy();
  });

  it("ADVERSARIAL: creator-not-found throws", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "j" });
    await t.run((ctx) => ctx.db.delete(creatorId));
    await expect(
      t.mutation(
        internal.creatorMayaV0.editingFingerprintObservations
          .insertEditingFingerprintObservation,
        {
          creatorId,
          publishedPostId: "tt_a",
          publishedPostUrl: "https://x",
          durationMs: 0,
          deltas: [],
          nowMs: NOW,
        }
      )
    ).rejects.toThrow(/creator-not-found/);
  });

  it("ADVERSARIAL: empty publishedPostId rejected", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "k" });
    await expect(
      t.mutation(
        internal.creatorMayaV0.editingFingerprintObservations
          .insertEditingFingerprintObservation,
        {
          creatorId,
          publishedPostId: "",
          publishedPostUrl: "https://x",
          durationMs: 0,
          deltas: [],
          nowMs: NOW,
        }
      )
    ).rejects.toThrow(/observation-validation-failed/);
  });

  it("ADVERSARIAL: negative durationMs rejected", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "l" });
    await expect(
      t.mutation(
        internal.creatorMayaV0.editingFingerprintObservations
          .insertEditingFingerprintObservation,
        {
          creatorId,
          publishedPostId: "tt_x",
          publishedPostUrl: "https://x",
          durationMs: -1,
          deltas: [],
          nowMs: NOW,
        }
      )
    ).rejects.toThrow(/observation-validation-failed/);
  });

  it("CROSS-TENANT: foreign renderedMediaAssetId rejected at mutation boundary", async () => {
    const t = convexTest(schema, modules);
    const creatorA = await insertCreator(t, { suffix: "ma" });
    const creatorB = await insertCreator(t, { suffix: "mb" });
    const renderedB = await insertRenderedAsset(t, creatorB);
    await expect(
      t.mutation(
        internal.creatorMayaV0.editingFingerprintObservations
          .insertEditingFingerprintObservation,
        {
          creatorId: creatorA,
          publishedPostId: "tt_x",
          publishedPostUrl: "https://x",
          renderedMediaAssetId: renderedB,
          durationMs: 0,
          deltas: [],
          nowMs: NOW,
        }
      )
    ).rejects.toThrow(/rendered-asset-cross-tenant/);
  });
});

/* -------------------------------------------------------------------------- */
/* Action: applyObservationsToFingerprint                                      */
/* -------------------------------------------------------------------------- */

describe("applyObservationsToFingerprint", () => {
  it("HAPPY: applies unapplied observations + stamps appliedToFingerprintAt", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "n" });
    await insertPictureWithFingerprint(t, creatorId);
    await t.run((ctx) =>
      ctx.db.insert("editingFingerprintObservations", {
        creatorId,
        publishedPostId: "tt_p1",
        publishedPostUrl: "https://x/1",
        observedAt: NOW,
        durationMs: 11000,
        deltas: [
          {
            field: "pacing.hookLandsAtMs",
            observed: "800",
            expected: "400",
            reason: "extended setup",
          },
        ],
      })
    );

    const res = await t.action(
      internal.creatorMayaV0.editingFingerprintObservations
        .applyObservationsToFingerprint,
      { creatorId }
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.applied).toBe(1);
    expect(res.summary.updated).toContain("pacing.hookLandsAtMs");

    const rows = await t.run((ctx) =>
      ctx.db
        .query("editingFingerprintObservations")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows[0].appliedToFingerprintAt).toBeTypeOf("number");

    const picture = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .first()
    );
    expect(picture?.editingFingerprint?.pacing.hookLandsAtMs).toBeGreaterThan(400);
  });

  it("no-unapplied-observations → ok:false reason='no-unapplied-observations'", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "o" });
    await insertPictureWithFingerprint(t, creatorId);
    const res = await t.action(
      internal.creatorMayaV0.editingFingerprintObservations
        .applyObservationsToFingerprint,
      { creatorId }
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("no-unapplied-observations");
  });

  it("ADVERSARIAL: applies cleanly when creator has no fingerprint at all (marks rows applied, no patch)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "p" });
    // No picture row at all.
    await t.run((ctx) =>
      ctx.db.insert("editingFingerprintObservations", {
        creatorId,
        publishedPostId: "tt_p1",
        publishedPostUrl: "https://x/1",
        observedAt: NOW,
        durationMs: 5000,
        deltas: [
          {
            field: "opening",
            observed: "motion-shot",
            expected: "?",
            reason: "first observation",
          },
        ],
      })
    );
    const res = await t.action(
      internal.creatorMayaV0.editingFingerprintObservations
        .applyObservationsToFingerprint,
      { creatorId }
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.applied).toBe(1);
    expect(res.summary.updated).toEqual([]); // nothing to patch

    const rows = await t.run((ctx) =>
      ctx.db
        .query("editingFingerprintObservations")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows[0].appliedToFingerprintAt).toBeTypeOf("number");
  });

  it("CROSS-TENANT: applying for Creator A only touches Creator A's rows + picture", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "qa" });
    const b = await insertCreator(t, { suffix: "qb" });
    await insertPictureWithFingerprint(t, a);
    await insertPictureWithFingerprint(t, b);
    await t.run((ctx) =>
      ctx.db.insert("editingFingerprintObservations", {
        creatorId: a,
        publishedPostId: "tt_a",
        publishedPostUrl: "https://x/a",
        observedAt: NOW,
        durationMs: 1000,
        deltas: [
          {
            field: "pacing.hookLandsAtMs",
            observed: "999",
            expected: "400",
            reason: "x",
          },
        ],
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("editingFingerprintObservations", {
        creatorId: b,
        publishedPostId: "tt_b",
        publishedPostUrl: "https://x/b",
        observedAt: NOW,
        durationMs: 1000,
        deltas: [
          {
            field: "pacing.hookLandsAtMs",
            observed: "1500",
            expected: "400",
            reason: "x",
          },
        ],
      })
    );

    await t.action(
      internal.creatorMayaV0.editingFingerprintObservations
        .applyObservationsToFingerprint,
      { creatorId: a }
    );

    const aRows = await t.run((ctx) =>
      ctx.db
        .query("editingFingerprintObservations")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    const bRows = await t.run((ctx) =>
      ctx.db
        .query("editingFingerprintObservations")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .collect()
    );
    expect(aRows[0].appliedToFingerprintAt).toBeTypeOf("number");
    expect(bRows[0].appliedToFingerprintAt).toBeUndefined();

    const bPicture = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .first()
    );
    // Creator B's hookLandsAtMs unchanged at baseline.
    expect(bPicture?.editingFingerprint?.pacing.hookLandsAtMs).toBe(400);
  });

  it("PLAN-TIER: ungated — observations apply for `coach` (Assistant) plan creators too", async () => {
    // Intentional regression guard: a future change that adds a plan-tier
    // gate to this action would break the "every shipped post sharpens the
    // moat" guarantee. If gating is needed later, it should live at the
    // standing-order layer, not the apply action.
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "r", plan: "coach" });
    await insertPictureWithFingerprint(t, creatorId);
    await t.run((ctx) =>
      ctx.db.insert("editingFingerprintObservations", {
        creatorId,
        publishedPostId: "tt_r",
        publishedPostUrl: "https://x/r",
        observedAt: NOW,
        durationMs: 5000,
        deltas: [
          {
            field: "pacing.hookLandsAtMs",
            observed: "700",
            expected: "400",
            reason: "x",
          },
        ],
      })
    );
    const res = await t.action(
      internal.creatorMayaV0.editingFingerprintObservations
        .applyObservationsToFingerprint,
      { creatorId }
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.applied).toBe(1);
  });

  it("recency window: observations older than 30d are not folded", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "s" });
    await insertPictureWithFingerprint(t, creatorId);
    await t.run((ctx) =>
      ctx.db.insert("editingFingerprintObservations", {
        creatorId,
        publishedPostId: "tt_old",
        publishedPostUrl: "https://x/old",
        observedAt: NOW - 40 * 24 * 60 * 60 * 1000,
        durationMs: 1000,
        deltas: [
          {
            field: "opening",
            observed: "motion-shot",
            expected: "face-on",
            reason: "old",
          },
        ],
      })
    );
    // Force "now" of the action to be NOW via vi.useFakeTimers / setSystemTime.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    try {
      const res = await t.action(
        internal.creatorMayaV0.editingFingerprintObservations
          .applyObservationsToFingerprint,
        { creatorId }
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("no-unapplied-observations");
    } finally {
      vi.useRealTimers();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* HTTP endpoints: observe_published_edit + apply_observations_to_fingerprint  */
/* -------------------------------------------------------------------------- */

describe("POST /lc_maya/observe_published_edit", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
    _setObservationMultimodalCallForTests(null);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
    _setObservationMultimodalCallForTests(null);
  });

  it("HAPPY: 200 + writes a row + returns counts", async () => {
    _setObservationMultimodalCallForTests(makeMockCall({}));
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "ha" });
    await insertPictureWithFingerprint(t, creatorId);

    const res = await t.fetch("/lc_maya/observe_published_edit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        publishedPostId: "tt_pub_1",
        publishedPostUrl: "https://tiktok.com/v1",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      totalForCreator: number;
      unappliedForCreator: number;
    };
    expect(body.ok).toBe(true);
    expect(body.totalForCreator).toBe(1);
    expect(body.unappliedForCreator).toBe(1);
  });

  it("ADVERSARIAL: missing / empty / wrong secret returns 401", async () => {
    _setObservationMultimodalCallForTests(makeMockCall({}));
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "hb" });
    for (const bad of ["", "wrong", `${TEST_SECRET}x`]) {
      const res = await t.fetch("/lc_maya/observe_published_edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: bad,
          creatorId,
          publishedPostId: "tt_x",
          publishedPostUrl: "https://x",
        }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("ADVERSARIAL: malformed body returns 400", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "hc" });
    const cases = [
      "not-json",
      JSON.stringify({ secret: TEST_SECRET }),
      JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        publishedPostId: "",
        publishedPostUrl: "https://x",
      }),
      JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        publishedPostId: "tt_x",
        publishedPostUrl: "",
      }),
      JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        publishedPostId: "tt_x",
        publishedPostUrl: "https://x",
        thinkingBudget: "ultra",
      }),
    ];
    for (const body of cases) {
      const res = await t.fetch("/lc_maya/observe_published_edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(res.status).toBe(400);
    }
  });

  it("ADVERSARIAL: creator-not-found returns 404", async () => {
    _setObservationMultimodalCallForTests(makeMockCall({}));
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "hd" });
    await t.run((ctx) => ctx.db.delete(creatorId));
    const res = await t.fetch("/lc_maya/observe_published_edit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        publishedPostId: "tt_x",
        publishedPostUrl: "https://x",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("ADVERSARIAL: multimodal-not-wired returns 409", async () => {
    _setObservationMultimodalCallForTests(null);
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "he" });
    await insertPictureWithFingerprint(t, creatorId);
    const res = await t.fetch("/lc_maya/observe_published_edit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        publishedPostId: "tt_x",
        publishedPostUrl: "https://x",
      }),
    });
    expect(res.status).toBe(409);
  });

  it("CROSS-TENANT: posting for Creator A leaves Creator B's observations + picture untouched", async () => {
    _setObservationMultimodalCallForTests(makeMockCall({}));
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "hxa" });
    const b = await insertCreator(t, { suffix: "hxb" });
    await insertPictureWithFingerprint(t, a);
    await insertPictureWithFingerprint(t, b);

    await t.fetch("/lc_maya/observe_published_edit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId: a,
        publishedPostId: "tt_a",
        publishedPostUrl: "https://x/a",
      }),
    });

    const bObs = await t.run((ctx) =>
      ctx.db
        .query("editingFingerprintObservations")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .collect()
    );
    expect(bObs.length).toBe(0);
    const bPic = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .first()
    );
    expect(bPic?.editingFingerprint?.pacing.hookLandsAtMs).toBe(400);
  });
});

describe("POST /lc_maya/apply_observations_to_fingerprint", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("HAPPY: 200 + returns summary", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "ap1" });
    await insertPictureWithFingerprint(t, creatorId);
    await t.run((ctx) =>
      ctx.db.insert("editingFingerprintObservations", {
        creatorId,
        publishedPostId: "tt_a",
        publishedPostUrl: "https://x/a",
        observedAt: NOW,
        durationMs: 1000,
        deltas: [
          {
            field: "pacing.hookLandsAtMs",
            observed: "800",
            expected: "400",
            reason: "x",
          },
        ],
      })
    );

    const res = await t.fetch("/lc_maya/apply_observations_to_fingerprint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; summary: { applied: number } };
    expect(body.ok).toBe(true);
    expect(body.summary.applied).toBe(1);
  });

  it("HAPPY: no observations → 200 with noop:true (safe to call repeatedly)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "ap2" });
    await insertPictureWithFingerprint(t, creatorId);
    const res = await t.fetch("/lc_maya/apply_observations_to_fingerprint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      noop?: boolean;
      summary: { applied: number };
    };
    expect(body.ok).toBe(true);
    expect(body.noop).toBe(true);
    expect(body.summary.applied).toBe(0);
  });

  it("ADVERSARIAL: 401 on missing / wrong secret", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "ap3" });
    for (const bad of ["", "wrong"]) {
      const res = await t.fetch("/lc_maya/apply_observations_to_fingerprint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: bad, creatorId }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("ADVERSARIAL: 400 on missing creatorId", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/lc_maya/apply_observations_to_fingerprint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET }),
    });
    expect(res.status).toBe(400);
  });
});

/* -------------------------------------------------------------------------- */
/* Sibling-file scan                                                           */
/* -------------------------------------------------------------------------- */

describe("sibling-file scan: schema + http + standingOrders coherence", () => {
  it("schema.ts declares the editingFingerprintObservations table with required indices", async () => {
    const schemaSrc = await readFile(
      join(REPO_ROOT, "convex", "schema.ts"),
      "utf8"
    );
    expect(schemaSrc).toMatch(/editingFingerprintObservations: defineTable/);
    expect(schemaSrc).toMatch(
      /\.index\("by_creator", \["creatorId"\]\)[\s\S]*\.index\("by_creator_and_observedAt"/
    );
    expect(schemaSrc).toMatch(/\.index\("by_creator_and_published_post"/);
  });

  it("http.ts registers /lc_maya/observe_published_edit + /lc_maya/apply_observations_to_fingerprint", async () => {
    const httpSrc = await readFile(
      join(REPO_ROOT, "convex", "http.ts"),
      "utf8"
    );
    expect(httpSrc).toMatch(/\/lc_maya\/observe_published_edit/);
    expect(httpSrc).toMatch(/\/lc_maya\/apply_observations_to_fingerprint/);
    expect(httpSrc).toMatch(/observePublishedEditHttp/);
    expect(httpSrc).toMatch(/applyObservationsToFingerprintHttp/);
  });

  it("standingOrders.ts post_publish_reaction references the new endpoints", async () => {
    const soSrc = await readFile(
      join(
        REPO_ROOT,
        "convex",
        "agents",
        "packs",
        "maya",
        "workspace",
        "standingOrders.ts"
      ),
      "utf8"
    );
    // Pull out the post_publish_reaction block specifically.
    const blockStart = soSrc.indexOf('id: "post_publish_reaction"');
    expect(blockStart).toBeGreaterThan(-1);
    const block = soSrc.slice(blockStart, blockStart + 4000);
    expect(block).toMatch(/\/lc_maya\/observe_published_edit/);
    expect(block).toMatch(/\/lc_maya\/apply_observations_to_fingerprint/);
    // Make sure the moat language is present.
    expect(block).toMatch(/fingerprint sharpens/i);
  });
});
