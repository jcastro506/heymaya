/**
 * `lc_maya/sync_wiki_observations` — Sprint 8.5 wiki → Convex projection mirror.
 *
 * Architecture:
 *
 *   1. Maya's memory-wiki vault lives on the per-creator Fly machine at
 *      `/data/memory-wiki/<topic>.md`. OpenClaw owns the vault; Maya mutates
 *      it via her native `wiki_apply` / `wiki_get` / `wiki_search` tools.
 *      (Per `feedback_openclaw_native_first.md` — never reimplement.)
 *
 *   2. Convex stores three READ-ONLY projection tables: `trendObservations`,
 *      `competitorObservations`, `weeklyLearningsCreator`. The HQ surfaces
 *      (Trends, Performance, Growth) read from these via Convex subscriptions
 *      so the UI stays reactive without round-tripping to the agent runtime.
 *
 *   3. As of Sprint 8, skills no longer write directly to those tables — the
 *      wiki is the source of truth. Sprint 8.5 (this file) closes the loop:
 *      a heartbeat-driven entry (`wiki_mirror_sync`, kind: heartbeat,
 *      cooldown 6h) scans the wiki for recent additions and POSTs the deltas
 *      here. The endpoint is BATCHED — Maya can sync 1+ trend observations,
 *      0+ competitor observations, and 0+ weekly-learnings rows in a single
 *      call, minimizing round-trip cost.
 *
 * Idempotency:
 *
 *   - Trend + competitor observations dedupe on `(creatorId, wikiVaultPath)`.
 *     Re-posting the same vaultPath patches the existing row's `updatedAt`
 *     and `mirroredAt` rather than inserting a duplicate.
 *   - Weekly-learnings dedupes on `(creatorId, weekStartMs)`. Re-posting the
 *     same week patches the row's patterns + `mirroredAt`.
 *   - Rows missing a `wikiVaultPath` are treated as legacy (skill-direct)
 *     writes and ALWAYS create new rows — the sync only owns wiki-sourced
 *     rows. This preserves backward compat with pre-8.5 skill-direct writes.
 *
 * Cross-tenant:
 *
 *   - Every payload entry carries the same top-level `creatorId` (from the
 *     Fly machine's per-creator workspace). The endpoint validates each row
 *     against that single creatorId — a malformed payload that mixes
 *     creators is rejected at the validator. Storage writes never index
 *     across `creatorId` boundaries.
 *
 * Auth:
 *
 *   - Same shared-secret pattern as the other lc_maya endpoints — the body
 *     carries `secret` and we run `assertWebhookSecret(secret)` constant-time.
 *
 * Failure modes:
 *
 *   - Missing/invalid secret  → 401
 *   - Body parse fail         → 400
 *   - Creator not found       → 404
 *   - Internal mutation throw → 500 (Maya retries on next heartbeat tick)
 */

import { httpAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { assertWebhookSecret } from "../lib/webhookSecret";

/* -------------------------------------------------------------------------- */
/* Validators                                                                  */
/* -------------------------------------------------------------------------- */

const TREND_SOURCE_LITERALS = [
  "niche-scan",
  "platform-wide",
  "industry-intel",
  "competitor-watch",
] as const;

const TREND_EVIDENCE_KIND_LITERALS = [
  "post",
  "hashtag",
  "sound",
  "article",
  "metric",
] as const;

const COMPETITOR_PLATFORM_LITERALS = [
  "tiktok",
  "instagram",
  "youtube",
  "linkedin",
  "x",
] as const;

const COMPETITOR_EVIDENCE_KIND_LITERALS = [
  "post",
  "metric",
  "hashtag",
] as const;

const WEEKLY_PATTERN_KIND_LITERALS = [
  "hook-text",
  "posting-time",
  "format",
  "topic",
  "brand-tone",
  "collab-pattern",
] as const;

type TrendSource = (typeof TREND_SOURCE_LITERALS)[number];
type TrendEvidenceKind = (typeof TREND_EVIDENCE_KIND_LITERALS)[number];
type CompetitorPlatform = (typeof COMPETITOR_PLATFORM_LITERALS)[number];
type CompetitorEvidenceKind = (typeof COMPETITOR_EVIDENCE_KIND_LITERALS)[number];
type WeeklyPatternKind = (typeof WEEKLY_PATTERN_KIND_LITERALS)[number];

/** Bound how big a single sync batch can get. Heartbeat fires every 6h on
 *  this entry; if Maya's wiki has more than 200 deltas in that window
 *  something pathological is happening — better to error than silently
 *  drop. The bound is shared across all three buckets. */
const MAX_BATCH_ROWS = 200;

/** Phantom-pattern guard for weekly learnings. Mirrors the service-side
 *  `weeklyLearnings` extractor (§ Wave C.5): a pattern needs at least 3
 *  supporting datapoints before it can be claimed. Server-side enforcement
 *  ensures even a misbehaving skill cannot ship a 1-sample claim. */
const MIN_WEEKLY_PATTERN_SAMPLE = 3;

interface TrendObservationPayload {
  source: TrendSource;
  observation: string;
  evidence: Array<{ kind: TrendEvidenceKind; ref: string; fact: string }>;
  relevanceScore: number;
  observedAt: number;
  wikiVaultPath?: string;
}

interface CompetitorObservationPayload {
  peerHandle: string;
  platform: CompetitorPlatform;
  observation: string;
  evidence: Array<{
    kind: CompetitorEvidenceKind;
    ref: string;
    fact: string;
  }>;
  observedAt: number;
  wikiVaultPath?: string;
}

interface WeeklyLearningsPayload {
  weekStartMs: number;
  weekEndMs: number;
  synthesizedAt: number;
  topPatterns: Array<{
    kind: WeeklyPatternKind;
    claim: string;
    sampleSize: number;
    engagementLift?: number;
    confidence: number;
    wikiVaultPath: string;
  }>;
  priorWeekDelta?: {
    newPatternCount: number;
    droppedPatternCount: number;
    confidenceShift: number;
  };
}

interface SyncWikiObservationsPayload {
  secret: string;
  creatorId: string;
  trends: TrendObservationPayload[];
  competitors: CompetitorObservationPayload[];
  weeklyLearnings: WeeklyLearningsPayload[];
}

function isOneOf<T extends string>(
  value: unknown,
  literals: readonly T[]
): value is T {
  return typeof value === "string" && (literals as readonly string[]).includes(value);
}

function parseTrendObservation(
  raw: unknown,
  index: number
): TrendObservationPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error(`trends[${index}] must be an object.`);
  }
  const r = raw as Record<string, unknown>;
  if (!isOneOf(r.source, TREND_SOURCE_LITERALS)) {
    throw new Error(
      `trends[${index}].source must be one of ${TREND_SOURCE_LITERALS.join(" | ")}.`
    );
  }
  if (typeof r.observation !== "string" || r.observation.trim().length === 0) {
    throw new Error(`trends[${index}].observation must be a non-empty string.`);
  }
  if (!Array.isArray(r.evidence)) {
    throw new Error(`trends[${index}].evidence must be an array.`);
  }
  const evidence = r.evidence.map((e, j) => {
    if (!e || typeof e !== "object") {
      throw new Error(`trends[${index}].evidence[${j}] must be an object.`);
    }
    const ev = e as Record<string, unknown>;
    if (!isOneOf(ev.kind, TREND_EVIDENCE_KIND_LITERALS)) {
      throw new Error(`trends[${index}].evidence[${j}].kind invalid.`);
    }
    if (typeof ev.ref !== "string" || ev.ref.length === 0) {
      throw new Error(`trends[${index}].evidence[${j}].ref required.`);
    }
    if (typeof ev.fact !== "string" || ev.fact.length === 0) {
      throw new Error(`trends[${index}].evidence[${j}].fact required.`);
    }
    return { kind: ev.kind, ref: ev.ref, fact: ev.fact };
  });
  if (
    typeof r.relevanceScore !== "number" ||
    !Number.isFinite(r.relevanceScore) ||
    r.relevanceScore < 0 ||
    r.relevanceScore > 1
  ) {
    throw new Error(`trends[${index}].relevanceScore must be in [0,1].`);
  }
  if (
    typeof r.observedAt !== "number" ||
    !Number.isFinite(r.observedAt) ||
    r.observedAt <= 0
  ) {
    throw new Error(`trends[${index}].observedAt must be a positive number.`);
  }
  let wikiVaultPath: string | undefined;
  if (r.wikiVaultPath !== undefined) {
    if (typeof r.wikiVaultPath !== "string" || r.wikiVaultPath.length === 0) {
      throw new Error(
        `trends[${index}].wikiVaultPath must be a non-empty string when provided.`
      );
    }
    wikiVaultPath = r.wikiVaultPath;
  }
  return {
    source: r.source,
    observation: r.observation,
    evidence,
    relevanceScore: r.relevanceScore,
    observedAt: r.observedAt,
    wikiVaultPath,
  };
}

function parseCompetitorObservation(
  raw: unknown,
  index: number
): CompetitorObservationPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error(`competitors[${index}] must be an object.`);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.peerHandle !== "string" || r.peerHandle.length === 0) {
    throw new Error(`competitors[${index}].peerHandle required.`);
  }
  if (!isOneOf(r.platform, COMPETITOR_PLATFORM_LITERALS)) {
    throw new Error(`competitors[${index}].platform invalid.`);
  }
  if (typeof r.observation !== "string" || r.observation.trim().length === 0) {
    throw new Error(
      `competitors[${index}].observation must be a non-empty string.`
    );
  }
  if (!Array.isArray(r.evidence)) {
    throw new Error(`competitors[${index}].evidence must be an array.`);
  }
  const evidence = r.evidence.map((e, j) => {
    if (!e || typeof e !== "object") {
      throw new Error(
        `competitors[${index}].evidence[${j}] must be an object.`
      );
    }
    const ev = e as Record<string, unknown>;
    if (!isOneOf(ev.kind, COMPETITOR_EVIDENCE_KIND_LITERALS)) {
      throw new Error(
        `competitors[${index}].evidence[${j}].kind invalid.`
      );
    }
    if (typeof ev.ref !== "string" || ev.ref.length === 0) {
      throw new Error(
        `competitors[${index}].evidence[${j}].ref required.`
      );
    }
    if (typeof ev.fact !== "string" || ev.fact.length === 0) {
      throw new Error(
        `competitors[${index}].evidence[${j}].fact required.`
      );
    }
    return { kind: ev.kind, ref: ev.ref, fact: ev.fact };
  });
  if (
    typeof r.observedAt !== "number" ||
    !Number.isFinite(r.observedAt) ||
    r.observedAt <= 0
  ) {
    throw new Error(
      `competitors[${index}].observedAt must be a positive number.`
    );
  }
  let wikiVaultPath: string | undefined;
  if (r.wikiVaultPath !== undefined) {
    if (typeof r.wikiVaultPath !== "string" || r.wikiVaultPath.length === 0) {
      throw new Error(
        `competitors[${index}].wikiVaultPath must be a non-empty string when provided.`
      );
    }
    wikiVaultPath = r.wikiVaultPath;
  }
  return {
    peerHandle: r.peerHandle,
    platform: r.platform,
    observation: r.observation,
    evidence,
    observedAt: r.observedAt,
    wikiVaultPath,
  };
}

function parseWeeklyLearnings(
  raw: unknown,
  index: number
): WeeklyLearningsPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error(`weeklyLearnings[${index}] must be an object.`);
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r.weekStartMs !== "number" ||
    !Number.isFinite(r.weekStartMs) ||
    r.weekStartMs <= 0
  ) {
    throw new Error(`weeklyLearnings[${index}].weekStartMs invalid.`);
  }
  if (
    typeof r.weekEndMs !== "number" ||
    !Number.isFinite(r.weekEndMs) ||
    r.weekEndMs <= r.weekStartMs
  ) {
    throw new Error(
      `weeklyLearnings[${index}].weekEndMs must be > weekStartMs.`
    );
  }
  if (
    typeof r.synthesizedAt !== "number" ||
    !Number.isFinite(r.synthesizedAt) ||
    r.synthesizedAt <= 0
  ) {
    throw new Error(`weeklyLearnings[${index}].synthesizedAt invalid.`);
  }
  if (!Array.isArray(r.topPatterns)) {
    throw new Error(`weeklyLearnings[${index}].topPatterns must be an array.`);
  }
  const topPatterns = r.topPatterns.map((p, j) => {
    if (!p || typeof p !== "object") {
      throw new Error(
        `weeklyLearnings[${index}].topPatterns[${j}] must be an object.`
      );
    }
    const pp = p as Record<string, unknown>;
    if (!isOneOf(pp.kind, WEEKLY_PATTERN_KIND_LITERALS)) {
      throw new Error(
        `weeklyLearnings[${index}].topPatterns[${j}].kind invalid.`
      );
    }
    if (typeof pp.claim !== "string" || pp.claim.trim().length === 0) {
      throw new Error(
        `weeklyLearnings[${index}].topPatterns[${j}].claim required.`
      );
    }
    if (
      typeof pp.sampleSize !== "number" ||
      !Number.isFinite(pp.sampleSize) ||
      pp.sampleSize < MIN_WEEKLY_PATTERN_SAMPLE
    ) {
      throw new Error(
        `weeklyLearnings[${index}].topPatterns[${j}].sampleSize must be >=${MIN_WEEKLY_PATTERN_SAMPLE} (phantom-pattern guard).`
      );
    }
    if (
      typeof pp.confidence !== "number" ||
      !Number.isFinite(pp.confidence) ||
      pp.confidence < 0 ||
      pp.confidence > 1
    ) {
      throw new Error(
        `weeklyLearnings[${index}].topPatterns[${j}].confidence must be in [0,1].`
      );
    }
    if (
      typeof pp.wikiVaultPath !== "string" ||
      pp.wikiVaultPath.length === 0
    ) {
      throw new Error(
        `weeklyLearnings[${index}].topPatterns[${j}].wikiVaultPath required.`
      );
    }
    let engagementLift: number | undefined;
    if (pp.engagementLift !== undefined) {
      if (
        typeof pp.engagementLift !== "number" ||
        !Number.isFinite(pp.engagementLift)
      ) {
        throw new Error(
          `weeklyLearnings[${index}].topPatterns[${j}].engagementLift must be a finite number when provided.`
        );
      }
      engagementLift = pp.engagementLift;
    }
    return {
      kind: pp.kind,
      claim: pp.claim,
      sampleSize: pp.sampleSize,
      engagementLift,
      confidence: pp.confidence,
      wikiVaultPath: pp.wikiVaultPath,
    };
  });
  let priorWeekDelta: WeeklyLearningsPayload["priorWeekDelta"];
  if (r.priorWeekDelta !== undefined) {
    if (!r.priorWeekDelta || typeof r.priorWeekDelta !== "object") {
      throw new Error(
        `weeklyLearnings[${index}].priorWeekDelta must be an object when provided.`
      );
    }
    const d = r.priorWeekDelta as Record<string, unknown>;
    const need = (k: keyof typeof d) => {
      if (typeof d[k] !== "number" || !Number.isFinite(d[k] as number)) {
        throw new Error(
          `weeklyLearnings[${index}].priorWeekDelta.${String(k)} must be a finite number.`
        );
      }
    };
    need("newPatternCount");
    need("droppedPatternCount");
    need("confidenceShift");
    priorWeekDelta = {
      newPatternCount: d.newPatternCount as number,
      droppedPatternCount: d.droppedPatternCount as number,
      confidenceShift: d.confidenceShift as number,
    };
  }
  return {
    weekStartMs: r.weekStartMs,
    weekEndMs: r.weekEndMs,
    synthesizedAt: r.synthesizedAt,
    topPatterns,
    priorWeekDelta,
  };
}

export function parseSyncWikiObservationsPayload(
  raw: unknown
): SyncWikiObservationsPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Body must be a JSON object.");
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.secret !== "string") {
    throw new Error("secret must be a string.");
  }
  if (typeof r.creatorId !== "string" || r.creatorId.length === 0) {
    throw new Error("creatorId is required.");
  }
  const trendsRaw = r.trends ?? [];
  const competitorsRaw = r.competitors ?? [];
  const weeklyRaw = r.weeklyLearnings ?? [];
  if (!Array.isArray(trendsRaw)) {
    throw new Error("trends must be an array (or omitted).");
  }
  if (!Array.isArray(competitorsRaw)) {
    throw new Error("competitors must be an array (or omitted).");
  }
  if (!Array.isArray(weeklyRaw)) {
    throw new Error("weeklyLearnings must be an array (or omitted).");
  }
  const total = trendsRaw.length + competitorsRaw.length + weeklyRaw.length;
  if (total > MAX_BATCH_ROWS) {
    throw new Error(
      `batch too large: ${total} rows exceeds cap ${MAX_BATCH_ROWS}.`
    );
  }
  if (total === 0) {
    throw new Error(
      "empty batch: at least one of trends / competitors / weeklyLearnings must be non-empty."
    );
  }
  const trends = trendsRaw.map((row, i) => parseTrendObservation(row, i));
  const competitors = competitorsRaw.map((row, i) =>
    parseCompetitorObservation(row, i)
  );
  const weeklyLearnings = weeklyRaw.map((row, i) =>
    parseWeeklyLearnings(row, i)
  );
  return {
    secret: r.secret,
    creatorId: r.creatorId,
    trends,
    competitors,
    weeklyLearnings,
  };
}

/* -------------------------------------------------------------------------- */
/* Mutation                                                                    */
/* -------------------------------------------------------------------------- */

export const syncWikiObservationsInternal = internalMutation({
  args: {
    creatorId: v.id("creators"),
    nowMs: v.number(),
    trends: v.array(
      v.object({
        source: v.union(
          v.literal("niche-scan"),
          v.literal("platform-wide"),
          v.literal("industry-intel"),
          v.literal("competitor-watch")
        ),
        observation: v.string(),
        evidence: v.array(
          v.object({
            kind: v.union(
              v.literal("post"),
              v.literal("hashtag"),
              v.literal("sound"),
              v.literal("article"),
              v.literal("metric")
            ),
            ref: v.string(),
            fact: v.string(),
          })
        ),
        relevanceScore: v.number(),
        observedAt: v.number(),
        wikiVaultPath: v.optional(v.string()),
      })
    ),
    competitors: v.array(
      v.object({
        peerHandle: v.string(),
        platform: v.union(
          v.literal("tiktok"),
          v.literal("instagram"),
          v.literal("youtube"),
          v.literal("linkedin"),
          v.literal("x")
        ),
        observation: v.string(),
        evidence: v.array(
          v.object({
            kind: v.union(
              v.literal("post"),
              v.literal("metric"),
              v.literal("hashtag")
            ),
            ref: v.string(),
            fact: v.string(),
          })
        ),
        observedAt: v.number(),
        wikiVaultPath: v.optional(v.string()),
      })
    ),
    weeklyLearnings: v.array(
      v.object({
        weekStartMs: v.number(),
        weekEndMs: v.number(),
        synthesizedAt: v.number(),
        topPatterns: v.array(
          v.object({
            kind: v.union(
              v.literal("hook-text"),
              v.literal("posting-time"),
              v.literal("format"),
              v.literal("topic"),
              v.literal("brand-tone"),
              v.literal("collab-pattern")
            ),
            claim: v.string(),
            sampleSize: v.number(),
            engagementLift: v.optional(v.number()),
            confidence: v.number(),
            wikiVaultPath: v.string(),
          })
        ),
        priorWeekDelta: v.optional(
          v.object({
            newPatternCount: v.number(),
            droppedPatternCount: v.number(),
            confidenceShift: v.number(),
          })
        ),
      })
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    trendsInserted: number;
    trendsUpdated: number;
    competitorsInserted: number;
    competitorsUpdated: number;
    weeklyLearningsInserted: number;
    weeklyLearningsUpdated: number;
  }> => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("creator-not-found");
    }

    let trendsInserted = 0;
    let trendsUpdated = 0;
    let competitorsInserted = 0;
    let competitorsUpdated = 0;
    let weeklyInserted = 0;
    let weeklyUpdated = 0;

    // ── Trends ────────────────────────────────────────────────────────────
    for (const t of args.trends) {
      // Idempotency: dedupe on (creatorId, wikiVaultPath) when path is set.
      // Rows without a path are legacy skill-direct writes — always insert.
      const existing =
        t.wikiVaultPath !== undefined
          ? await ctx.db
              .query("trendObservations")
              .withIndex("by_creator_and_vault_path", (q) =>
                q
                  .eq("creatorId", args.creatorId)
                  .eq("wikiVaultPath", t.wikiVaultPath)
              )
              .first()
          : null;
      if (existing) {
        // Cross-tenant defensive — even though the index pins creatorId,
        // re-check the row's value before patching. Mirrors the
        // wikiProjections.applyProjection pattern.
        if (existing.creatorId !== args.creatorId) {
          throw new Error("sync_wiki_observations: cross-tenant violation on trend upsert.");
        }
        await ctx.db.patch(existing._id, {
          source: t.source,
          observation: t.observation,
          evidence: t.evidence,
          relevanceScore: t.relevanceScore,
          observedAt: t.observedAt,
          mirroredAt: args.nowMs,
        });
        trendsUpdated += 1;
      } else {
        await ctx.db.insert("trendObservations", {
          creatorId: args.creatorId,
          source: t.source,
          observation: t.observation,
          evidence: t.evidence,
          relevanceScore: t.relevanceScore,
          observedAt: t.observedAt,
          mirroredAt: args.nowMs,
          wikiVaultPath: t.wikiVaultPath,
        });
        trendsInserted += 1;
      }
    }

    // ── Competitors ───────────────────────────────────────────────────────
    for (const c of args.competitors) {
      const existing =
        c.wikiVaultPath !== undefined
          ? await ctx.db
              .query("competitorObservations")
              .withIndex("by_creator_and_vault_path", (q) =>
                q
                  .eq("creatorId", args.creatorId)
                  .eq("wikiVaultPath", c.wikiVaultPath)
              )
              .first()
          : null;
      if (existing) {
        if (existing.creatorId !== args.creatorId) {
          throw new Error("sync_wiki_observations: cross-tenant violation on competitor upsert.");
        }
        await ctx.db.patch(existing._id, {
          peerHandle: c.peerHandle,
          platform: c.platform,
          observation: c.observation,
          evidence: c.evidence,
          observedAt: c.observedAt,
          mirroredAt: args.nowMs,
        });
        competitorsUpdated += 1;
      } else {
        await ctx.db.insert("competitorObservations", {
          creatorId: args.creatorId,
          peerHandle: c.peerHandle,
          platform: c.platform,
          observation: c.observation,
          evidence: c.evidence,
          observedAt: c.observedAt,
          mirroredAt: args.nowMs,
          wikiVaultPath: c.wikiVaultPath,
        });
        competitorsInserted += 1;
      }
    }

    // ── Weekly learnings ──────────────────────────────────────────────────
    for (const w of args.weeklyLearnings) {
      // Idempotency: one row per (creatorId, weekStartMs).
      const existing = await ctx.db
        .query("weeklyLearningsCreator")
        .withIndex("by_creator_and_week", (q) =>
          q
            .eq("creatorId", args.creatorId)
            .eq("weekStartMs", w.weekStartMs)
        )
        .first();
      if (existing) {
        if (existing.creatorId !== args.creatorId) {
          throw new Error("sync_wiki_observations: cross-tenant violation on weekly learnings upsert.");
        }
        await ctx.db.patch(existing._id, {
          weekEndMs: w.weekEndMs,
          synthesizedAt: w.synthesizedAt,
          topPatterns: w.topPatterns,
          priorWeekDelta: w.priorWeekDelta,
          mirroredAt: args.nowMs,
        });
        weeklyUpdated += 1;
      } else {
        await ctx.db.insert("weeklyLearningsCreator", {
          creatorId: args.creatorId,
          weekStartMs: w.weekStartMs,
          weekEndMs: w.weekEndMs,
          synthesizedAt: w.synthesizedAt,
          topPatterns: w.topPatterns,
          priorWeekDelta: w.priorWeekDelta,
          mirroredAt: args.nowMs,
        });
        weeklyInserted += 1;
      }
    }

    return {
      trendsInserted,
      trendsUpdated,
      competitorsInserted,
      competitorsUpdated,
      weeklyLearningsInserted: weeklyInserted,
      weeklyLearningsUpdated: weeklyUpdated,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* HTTP endpoint                                                               */
/* -------------------------------------------------------------------------- */

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const syncWikiObservationsHttp = httpAction(async (ctx, request) => {
  let payload: SyncWikiObservationsPayload;
  try {
    payload = parseSyncWikiObservationsPayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const result = await ctx.runMutation(
      internal.lcMaya.wikiMirrorSync.syncWikiObservationsInternal,
      {
        creatorId: payload.creatorId as Id<"creators">,
        nowMs: Date.now(),
        trends: payload.trends,
        competitors: payload.competitors,
        weeklyLearnings: payload.weeklyLearnings,
      }
    );
    return jsonResponse({ ok: true, ...result }, 200);
  } catch (err) {
    const msg = (err as Error).message ?? "internal-error";
    if (msg === "creator-not-found") {
      return jsonResponse({ error: "creator-not-found" }, 404);
    }
    return jsonResponse({ error: msg }, 500);
  }
});
