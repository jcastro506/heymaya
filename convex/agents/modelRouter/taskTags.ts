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

/* -------------------------------------------------------------------------- */
/* Task tag → usageEvents kind mapping                                         */
/* -------------------------------------------------------------------------- */

/**
 * Cron-driven task tags. Each maps to a `cron_fired` usage event with the
 * tag itself as the label. This is the single source of truth used by
 * `convex/agents/modelRouter/maya.ts#callMaya` to emit `cron_fired` /
 * `event_fired` events for every Maya behavior that goes through the
 * router. See `convex/lib/usageEvents.ts` for the consumer.
 */
const CRON_TASK_TAGS: ReadonlySet<TaskTag> = new Set<TaskTag>([
  "morning_brief",
  "evening_recap",
  "niche_scan",
  "weekly_content_plan",
  "weekly_review_synth",
  "hook_library_build",
  "manager_readiness_packet",
]);

/**
 * Event-driven task tags. Each maps to an `event_fired` usage event.
 * Excludes pure on-demand chat (`chat_reply` is a chat_turn_out, not an
 * event firing). The brand_email_draft + contract_redflag_scan +
 * post_publish_reaction tags are textbook event-driven Maya behaviors.
 */
const EVENT_TASK_TAGS: ReadonlySet<TaskTag> = new Set<TaskTag>([
  "brand_email_draft",
  "contract_redflag_scan",
  "post_publish_reaction",
  "rate_suggestion",
  "comment_triage",
  "accountability_nudge",
  "creator_picture_synthesis",
  "soul_generation",
]);

/**
 * Map a task tag to a usage-event firing kind. Returns null for tags that
 * should NOT emit a firing event (e.g. `chat_reply` — its emission lives
 * with the chat-turn wire-in instead).
 */
export function taskTagFiringKind(
  tag: TaskTag
): "cron_fired" | "event_fired" | null {
  if (CRON_TASK_TAGS.has(tag)) return "cron_fired";
  if (EVENT_TASK_TAGS.has(tag)) return "event_fired";
  // chat_reply (and any future on-demand-chat tags) — handled by chat-turn wire.
  return null;
}
