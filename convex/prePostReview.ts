/**
 * Sprint 3.5c — Convex action wrapper for `maya-pre-post-scorer`.
 *
 * The skill itself is pure-logic in
 * `agents/skills/maya-pre-post-scorer/script.ts`. This file is the
 * orchestration that:
 *
 *   1. Authenticates the caller via Clerk (`ctx.auth.getUserIdentity`).
 *   2. Resolves the signed-in creator (cross-tenant safe — no `creatorId`
 *      argument is accepted from the client; we always use the resolved
 *      identity).
 *   3. Loads the creator's `creatorPicture`, recent posts (with their
 *      latest `postMetrics` row), and `hookLibrary`.
 *   4. Builds the scoring prompt (`buildScoringPrompt`).
 *   5. Calls the model router (`callMaya`, taskTag
 *      `post_publish_reaction`, medium thinking — clamped per plan).
 *   6. Parses the model's structured output (`parseScoreOutput`).
 *   7. Runs the recommendations through `maya-citation-firewall`. If the
 *      firewall flags anything, drops the flagged recommendations and
 *      surfaces a partial result rather than failing closed (better fewer
 *      cited recommendations than a fictional one).
 *   8. Returns the structured score to the caller.
 *
 * Plan-tier: ALL TIERS. Pre-post review is foundational.
 *
 * The Convex action does NOT persist anything — `maya-pre-post-scorer`
 * is read-only synthesis. The caller (chat layer or future `/draft`
 * page) decides what to do with the score.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  buildScoringPrompt,
  parseScoreOutput,
  scoreDraftForFirewall,
  type ScorerInput,
  type ScoreOutput,
  type Recommendation,
} from "../agents/skills/maya-pre-post-scorer/script";
import {
  runFirewall,
  type Citation,
} from "../agents/skills/maya-citation-firewall/script";

const PlatformValidator = v.union(
  v.literal("tiktok"),
  v.literal("instagram"),
  v.literal("youtube"),
  v.literal("linkedin"),
  v.literal("x")
);

const MediaTypeValidator = v.union(
  v.literal("video"),
  v.literal("image"),
  v.literal("carousel"),
  v.literal("text")
);

const DraftValidator = v.object({
  caption: v.string(),
  hookCandidate: v.optional(v.string()),
  plannedFormat: MediaTypeValidator,
  plannedPlatform: PlatformValidator,
  plannedPostingTimeLocal: v.string(),
  mediaPreview: v.optional(
    v.object({
      videoUrl: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
      durationSec: v.optional(v.number()),
    })
  ),
});

/**
 * scoreDraft — public action.
 *
 * Auth: signed-in Clerk user required. Plan-tier: all tiers (no gating).
 * Cross-tenant safe: no `creatorId` is accepted from the client; the
 * identity-resolved creator is the only data source.
 */
export const scoreDraft = action({
  args: {
    draft: DraftValidator,
    /**
     * Optional pre-fetched note from `maya-platform-best-practice`. The
     * caller (chat layer or /draft page) may pass this in to enrich the
     * scoring prompt; if absent, the skill scores without it.
     */
    platformBestPracticeNote: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    | { ok: true; score: ScoreOutput; firewall: { droppedRecommendations: number } }
    | { ok: false; reason: "unauthenticated" | "no-creator" | "model-failed" }
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, reason: "unauthenticated" };

    const creator = await ctx.runQuery(internal.prePostReviewQueries.loadScorerInputs, {
      clerkUserId: identity.subject,
      platform: args.draft.plannedPlatform,
    });
    if (!creator) return { ok: false, reason: "no-creator" };

    const scorerInput: ScorerInput = {
      draft: args.draft,
      creatorPicture: creator.creatorPicture,
      recentPosts: creator.recentPosts,
      hookLibrary: creator.hookLibrary,
      platformBestPracticeNote: args.platformBestPracticeNote,
      creatorTimezone: creator.timezone,
      creatorId: creator.creatorId,
    };

    const prompt = buildScoringPrompt(scorerInput);

    let modelResult;
    try {
      modelResult = await ctx.runAction(internal.agents.modelRouter.maya.callMaya, {
        creatorId: creator.creatorId as Id<"creators">,
        taskTag: "post_publish_reaction",
        messages: [
          {
            role: "system",
            content:
              "You are Maya, an AI creator manager. Score the creator's draft against THEIR OWN history. Be honest about uncertainty. Anti-sycophancy: never inflate predictions.",
          },
          { role: "user", content: prompt },
        ],
        requestedBudget: "medium",
      });
    } catch {
      return { ok: false, reason: "model-failed" };
    }

    const parsed = parseScoreOutput(modelResult.content);

    // Firewall pass over the recommendations + their cited evidence.
    // Recommendations that fail firewall are dropped (better fewer-and-real
    // than many-and-fictional).
    const draftForFirewall = scoreDraftForFirewall(parsed);
    // Map scorer citation kinds → firewall citation kinds. The scorer uses a
    // narrower set ('post' | 'metric' | 'audience' | 'soul'); the firewall
    // expects its broader union. 'soul' (creator-soul anchor) is closest in
    // semantics to 'audience' for firewall token-overlap purposes.
    const citationsForFirewall: Citation[] = parsed.citations.map((c) => ({
      kind: c.kind === "soul" ? "audience" : c.kind,
      id: c.id,
      fact: c.fact,
    }));

    let surviving: Recommendation[] = parsed.recommendations as Recommendation[];
    let dropped = 0;
    if (draftForFirewall.length > 0 && parsed.recommendations.length > 0) {
      const verdict = runFirewall({ draft: draftForFirewall, citations: citationsForFirewall });
      if (!verdict.pass) {
        // Drop any recommendation whose change OR expectedImpact contains a
        // flagged claim substring. We keep the others.
        surviving = parsed.recommendations.filter((rec) => {
          const merged = `${rec.change} ${rec.expectedImpact}`;
          return !verdict.flaggedClaims.some((f) => merged.includes(f.claim));
        });
        dropped = parsed.recommendations.length - surviving.length;
      }
    }

    const finalScore: ScoreOutput = {
      ...parsed,
      recommendations: surviving,
      // If every recommendation was dropped, demote the verdict to
      // 'tweak-then-go' so the caller knows the analysis was inconclusive.
      goNoGo:
        dropped > 0 && surviving.length === 0 ? "tweak-then-go" : parsed.goNoGo,
    };

    return {
      ok: true,
      score: finalScore,
      firewall: { droppedRecommendations: dropped },
    };
  },
});
