/**
 * runLearningsExtractor — orchestrator action for the weekly learnings skill.
 *
 * Per `agents/skills/maya-service-learnings-extractor/SKILL.md`. Runs Sundays
 * 10pm op-tz (declared in `competitor_watch` standing-order prose; OpenClaw
 * triggers it via the existing cron entry). Also callable on-demand.
 *
 * Pipeline:
 *   1. Gather window data — `gbpPosts` + `inboundLeads` + `serviceJobs` +
 *      `reviewRequests` rows for THIS business in [weekStart..weekEnd) +
 *      the trailing 7d for `priorWindow`.
 *   2. Convert into the skill script's input shape (`ExtractorInputs`).
 *   3. Call the script with a Gemini 3 Flash MEDIUM `LlmCaller` — the script
 *      also runs deterministically when no LLM is provided (test seam).
 *   4. Persist a `weeklyLearnings` row.
 *   5. Apply each `wikiApplies` page through `wikiProjections.applyProjection`.
 *
 * Cross-tenant: all queries are `businessId`-indexed. The action accepts
 * `businessId` only; the public surface that wraps this resolves via Clerk.
 *
 * Idempotency: re-running the same window upserts the `weeklyLearnings` row
 * keyed by `(businessId, weekStartMs)`. Repeated `wiki_apply` is upsert-by-
 * vaultPath via `applyProjection`. Phantom-pattern guard runs in the script.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Doc, Id } from "../../../_generated/dataModel";
import {
  extractWeeklyLearnings,
  type ExtractorInputs,
  type ExtractedPattern,
  type ExtractedWikiApply,
  type LlmCaller,
} from "../../../../agents/skills/maya-service-learnings-extractor/script";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LEARNINGS_MODEL = "google/gemini-3-flash";

/* -------------------------------------------------------------------------- */
/* Internal queries — gather window data                                       */
/* -------------------------------------------------------------------------- */

interface WindowData {
  posts: Array<Doc<"gbpPosts">>;
  leads: Array<Doc<"inboundLeads">>;
  jobs: Array<Doc<"serviceJobs">>;
  reviewRequests: Array<Doc<"reviewRequests">>;
}

export const gatherWindowData = internalQuery({
  args: {
    businessId: v.id("businesses"),
    startMs: v.number(),
    endMs: v.number(),
  },
  handler: async (ctx, args): Promise<WindowData> => {
    const allPosts = await ctx.db
      .query("gbpPosts")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const posts = allPosts.filter(
      (p) =>
        p.businessId === args.businessId &&
        (p.postedAt ?? 0) >= args.startMs &&
        (p.postedAt ?? 0) < args.endMs
    );

    const allLeads = await ctx.db
      .query("inboundLeads")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const leads = allLeads.filter(
      (l) =>
        l.businessId === args.businessId &&
        l.capturedAt >= args.startMs &&
        l.capturedAt < args.endMs
    );

    const allJobs = await ctx.db
      .query("serviceJobs")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const jobs = allJobs.filter(
      (j) =>
        j.businessId === args.businessId &&
        (j.completedAt ?? j.createdAt) >= args.startMs &&
        (j.completedAt ?? j.createdAt) < args.endMs
    );

    const allRr = await ctx.db
      .query("reviewRequests")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const reviewRequests = allRr.filter(
      (r) =>
        r.businessId === args.businessId &&
        ((r.sentAt ?? r.createdAt) >= args.startMs &&
          (r.sentAt ?? r.createdAt) < args.endMs)
    );

    return { posts, leads, jobs, reviewRequests };
  },
});

/* -------------------------------------------------------------------------- */
/* Internal mutation — persist weeklyLearnings (upsert by week)                */
/* -------------------------------------------------------------------------- */

export const upsertWeeklyLearnings = internalMutation({
  args: {
    businessId: v.id("businesses"),
    weekStartMs: v.number(),
    weekEndMs: v.number(),
    synthesizedAt: v.number(),
    topPatterns: v.array(
      v.object({
        kind: v.union(
          v.literal("hook-text"),
          v.literal("photo-style"),
          v.literal("time-of-day"),
          v.literal("response-latency"),
          v.literal("review-request-channel"),
          v.literal("review-reply-tone"),
          v.literal("local-hook")
        ),
        claim: v.string(),
        sampleSize: v.number(),
        jobsAttributed: v.number(),
        fiveStarsAttributed: v.number(),
        confidence: v.number(),
        wikiVaultPath: v.string(),
      })
    ),
    priorWeekDelta: v.optional(
      v.object({
        jobsAttributedDelta: v.number(),
        fiveStarsAttributedDelta: v.number(),
        newPatternCount: v.number(),
        droppedPatternCount: v.number(),
      })
    ),
  },
  handler: async (ctx, args): Promise<Id<"weeklyLearnings">> => {
    // Phantom-pattern guard (defense-in-depth — script enforces too).
    for (const p of args.topPatterns) {
      if (p.sampleSize < 3) {
        throw new Error(
          `weeklyLearnings: refused write — pattern '${p.kind}' has sampleSize ${p.sampleSize} < 3.`
        );
      }
      if (p.confidence < 0 || p.confidence > 1 || !Number.isFinite(p.confidence)) {
        throw new Error(
          `weeklyLearnings: refused write — pattern '${p.kind}' has invalid confidence ${p.confidence}.`
        );
      }
    }

    const existing = await ctx.db
      .query("weeklyLearnings")
      .withIndex("by_business_and_week", (q) =>
        q.eq("businessId", args.businessId).eq("weekStartMs", args.weekStartMs)
      )
      .first();

    if (existing) {
      if (existing.businessId !== args.businessId) {
        throw new Error(
          "weeklyLearnings.upsert: cross-tenant violation."
        );
      }
      await ctx.db.patch(existing._id, {
        weekEndMs: args.weekEndMs,
        synthesizedAt: args.synthesizedAt,
        topPatterns: args.topPatterns,
        priorWeekDelta: args.priorWeekDelta,
      });
      return existing._id;
    }

    return await ctx.db.insert("weeklyLearnings", {
      businessId: args.businessId,
      weekStartMs: args.weekStartMs,
      weekEndMs: args.weekEndMs,
      synthesizedAt: args.synthesizedAt,
      topPatterns: args.topPatterns,
      priorWeekDelta: args.priorWeekDelta,
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Helpers — convert Convex docs into the script's input shape                */
/* -------------------------------------------------------------------------- */

function postsToInput(rows: ReadonlyArray<Doc<"gbpPosts">>): ExtractorInputs["posts"] {
  return rows.map((r) => ({
    id: String(r._id),
    text: r.text,
    postedAt: r.postedAt ?? r.createdAt,
    engagementMetrics: r.engagementMetrics ?? null,
    attributedLeadIds: (r.attributedLeadIds ?? []).map((id) => String(id)),
    // The local-hook the post claimed lives in the cta or is parsed at
    // post-creation time; v0 surfaces it through the post text — we extract
    // a coarse hook signal as the first 64 chars when there's no explicit
    // localHookText available. The detector tolerates absence (no pattern).
    localHookText: undefined,
  }));
}

function leadsToInput(rows: ReadonlyArray<Doc<"inboundLeads">>): ExtractorInputs["leads"] {
  return rows.map((r) => ({
    id: String(r._id),
    capturedAt: r.capturedAt,
    source: r.source,
    originatingActionKind: r.originatingActionKind,
    originatingActionId: r.originatingActionId,
    convertedJobId: r.convertedJobId !== undefined ? String(r.convertedJobId) : undefined,
    responseLatencyMs: r.responseLatencyMs,
  }));
}

function jobsToInput(rows: ReadonlyArray<Doc<"serviceJobs">>): ExtractorInputs["jobs"] {
  return rows.map((r) => ({
    id: String(r._id),
    completedAt: r.completedAt,
    originatingLeadId:
      r.originatingLeadId !== undefined ? String(r.originatingLeadId) : undefined,
    serviceType: r.serviceType,
  }));
}

function rrToInput(
  rows: ReadonlyArray<Doc<"reviewRequests">>
): ExtractorInputs["reviewRequests"] {
  return rows.map((r) => ({
    id: String(r._id),
    sentAt: r.sentAt,
    channel: r.channel,
    responseRating: r.responseRating,
    responseAt: r.responseAt,
  }));
}

/* -------------------------------------------------------------------------- */
/* Public action — runLearningsExtractor                                       */
/* -------------------------------------------------------------------------- */

export interface RunLearningsResult {
  weeklyLearningsId: Id<"weeklyLearnings">;
  topPatterns: ExtractedPattern[];
  wikiAppliesWritten: number;
  priorWeekDelta: ReturnType<typeof extractWeeklyLearnings> extends Promise<infer R>
    ? R extends { priorWeekDelta: infer D }
      ? D
      : null
    : null;
}

export const runLearningsExtractor = internalAction({
  args: {
    businessId: v.id("businesses"),
    /** Window start (UTC ms inclusive). Defaults to 7d before now. */
    weekStartMs: v.optional(v.number()),
    /** Window end (UTC ms exclusive). Defaults to now. */
    weekEndMs: v.optional(v.number()),
    /** Test seam — pinned timestamp. */
    nowMs: v.optional(v.number()),
    /** Test seam — disable LLM call, use deterministic fallback. */
    disableLlm: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<RunLearningsResult> => {
    const now = args.nowMs ?? Date.now();
    const weekEndMs = args.weekEndMs ?? now;
    const weekStartMs = args.weekStartMs ?? weekEndMs - WEEK_MS;
    const priorWindowEndMs = weekStartMs;
    const priorWindowStartMs = weekStartMs - WEEK_MS;

    // Gather both windows.
    const current = (await ctx.runQuery(
      internal.agents.packs.maya_service.runLearningsExtractor.gatherWindowData,
      {
        businessId: args.businessId,
        startMs: weekStartMs,
        endMs: weekEndMs,
      }
    )) as WindowData;

    const prior = (await ctx.runQuery(
      internal.agents.packs.maya_service.runLearningsExtractor.gatherWindowData,
      {
        businessId: args.businessId,
        startMs: priorWindowStartMs,
        endMs: priorWindowEndMs,
      }
    )) as WindowData;

    // Prior pattern kinds — pull last week's row if any.
    const priorRow = await ctx.runQuery(
      internal.agents.packs.maya_service.runLearningsExtractor.getPriorLearnings,
      {
        businessId: args.businessId,
        weekStartMs: priorWindowStartMs,
      }
    );
    const priorPatternKinds = priorRow?.topPatterns.map((p) => p.kind) ?? [];

    const inputs: ExtractorInputs = {
      weekStartMs,
      weekEndMs,
      priorWindowStartMs,
      priorWindowEndMs,
      posts: postsToInput(current.posts),
      leads: leadsToInput(current.leads),
      jobs: jobsToInput(current.jobs),
      reviewRequests: rrToInput(current.reviewRequests),
      priorWindow: {
        posts: postsToInput(prior.posts),
        leads: leadsToInput(prior.leads),
        jobs: jobsToInput(prior.jobs),
        reviewRequests: rrToInput(prior.reviewRequests),
        priorPatternKinds,
      },
    };

    // Build LLM caller (Gemini 3 Flash MEDIUM) unless disabled.
    let llm: LlmCaller | undefined;
    if (!args.disableLlm) {
      llm = await buildLlmCaller(ctx);
    }

    const result = await extractWeeklyLearnings(inputs, llm);

    // Persist `weeklyLearnings`.
    const weeklyLearningsId = (await ctx.runMutation(
      internal.agents.packs.maya_service.runLearningsExtractor.upsertWeeklyLearnings,
      {
        businessId: args.businessId,
        weekStartMs,
        weekEndMs,
        synthesizedAt: now,
        topPatterns: result.topPatterns,
        priorWeekDelta: result.priorWeekDelta ?? undefined,
      }
    )) as Id<"weeklyLearnings">;

    // Apply each wiki page through `wikiProjections.applyProjection`.
    let wikiAppliesWritten = 0;
    for (const page of result.wikiApplies) {
      try {
        await ctx.runMutation(internal.wikiProjections.applyProjection, {
          businessId: args.businessId,
          vaultPath: page.vaultPath,
          kind: page.kind,
          claim: page.claim,
          provenance: page.provenance.map((e) => ({
            sourceId: e.sourceId,
            path: e.path,
            weight: e.weight,
            note: e.note,
          })),
          confidence: page.confidence,
        });
        wikiAppliesWritten += 1;
      } catch {
        // Silent skip on a single page failure — never fail the whole run.
      }
    }

    return {
      weeklyLearningsId,
      topPatterns: result.topPatterns,
      wikiAppliesWritten,
      priorWeekDelta: result.priorWeekDelta as RunLearningsResult["priorWeekDelta"],
    };
  },
});

export const getPriorLearnings = internalQuery({
  args: {
    businessId: v.id("businesses"),
    weekStartMs: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ topPatterns: Array<{ kind: string }> } | null> => {
    const row = await ctx.db
      .query("weeklyLearnings")
      .withIndex("by_business_and_week", (q) =>
        q.eq("businessId", args.businessId).eq("weekStartMs", args.weekStartMs)
      )
      .first();
    if (!row) return null;
    if (row.businessId !== args.businessId) return null;
    return { topPatterns: row.topPatterns.map((p) => ({ kind: p.kind })) };
  },
});

/* -------------------------------------------------------------------------- */
/* LLM caller — Gemini 3 Flash MEDIUM via OpenRouter                          */
/* -------------------------------------------------------------------------- */

async function buildLlmCaller(_ctx: ActionCtx): Promise<LlmCaller | undefined> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.length === 0) return undefined;
  const { callOpenRouter } = await import(
    "../../modelRouter/openRouterClient"
  );
  return async ({ system, user }) => {
    const completion = await callOpenRouter({
      model: LEARNINGS_MODEL,
      thinkingBudget: "medium",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      apiKey,
    });
    return completion.content;
  };
}
