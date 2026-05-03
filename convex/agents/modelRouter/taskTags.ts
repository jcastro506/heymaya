/**
 * Single source of truth: Maya task tag → default thinking budget.
 *
 * Per docs/SPRINT_PLAN_V0.md § 3 ("Brain — single model, thinking-budget routing"):
 * Maya runs Gemini 3 Flash for everything in v0. The only lever is per-call
 * thinking budget, mapped from the task tag.
 *
 * Plan-tier caps are enforced separately in convex/lib/planFeatures.ts via
 * clampThinkingBudget(). This file only encodes the *intent* per task; the
 * router clamps that intent against the creator's plan.
 */

import type { ThinkingBudget } from "../../lib/planFeatures";

/** All Maya task tags v0 supports. Keep in sync with playbook.md / cron.md. */
export const TASK_TAGS = [
  // none / low — routine, fast, cheapest
  "chat_reply",
  "comment_triage",
  "accountability_nudge",
  "niche_scan",
  "evening_recap",
  // medium — reasoning quality matters; multi-document grounding
  "morning_brief",
  "post_publish_reaction",
  "weekly_content_plan",
  "hook_library_build",
  "rate_suggestion",
  // high — high-stakes; wrong output has real cost
  "brand_email_draft",
  "weekly_review_synth",
  "manager_readiness_packet",
  "contract_redflag_scan",
  "creator_picture_synthesis",
  "soul_generation",
] as const;

export type TaskTag = (typeof TASK_TAGS)[number];

const DEFAULT_BUDGET: Record<TaskTag, ThinkingBudget> = {
  // none / low
  chat_reply: "low",
  comment_triage: "low",
  accountability_nudge: "low",
  niche_scan: "low",
  evening_recap: "low",
  // medium
  morning_brief: "medium",
  post_publish_reaction: "medium",
  weekly_content_plan: "medium",
  hook_library_build: "medium",
  rate_suggestion: "medium",
  // high
  brand_email_draft: "high",
  weekly_review_synth: "high",
  manager_readiness_packet: "high",
  contract_redflag_scan: "high",
  creator_picture_synthesis: "high",
  soul_generation: "high",
};

/**
 * Returns the default thinking budget for a task tag.
 * Throws on unknown tags — strict by design so a typo can't silently route to
 * "none" and produce hallucinated output on a high-stakes task.
 */
export function defaultThinkingBudget(tag: string): ThinkingBudget {
  if (!isTaskTag(tag)) {
    throw new Error(
      `Unknown Maya task tag: '${tag}'. Add it to TASK_TAGS in convex/agents/modelRouter/taskTags.ts.`
    );
  }
  return DEFAULT_BUDGET[tag];
}

export function isTaskTag(tag: string): tag is TaskTag {
  return (TASK_TAGS as readonly string[]).includes(tag);
}
