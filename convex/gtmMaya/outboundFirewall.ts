/**
 * Sprint 2.10 — Outbound firewall: voice-contract + slop-critic
 * pre-send check.
 *
 * Every user-facing Maya message (Telegram hello, weekly recap, draft
 * approval ask, monthly channel proposal) should pass through this gate
 * before being sent. The check enforces:
 *   - SOUL.md "Voice contract — what NEVER leaks" ban list
 *     (per feedback_maya_no_technical_leakage_to_user memory)
 *   - PLAYBOOK § 6 slop ban list
 *
 * Failed checks return `{ ok: false, failures: [...] }` with specific
 * reasons so Maya can rewrite. Real enforcement requires Maya to ACTUALLY
 * call this endpoint before sendMessage — for now this is contract-level
 * (boot_kickoff + weekly_review prompts instruct her to validate).
 *
 * Future: OpenClaw extension that intercepts at the delivery layer
 * (like creator-product's claw-messenger firewall) for true blocking.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";

const BANNED_SKILL_SLUGS = [
  "maya-app-inspector",
  "maya-icp-hypothesis",
  "maya-channel-strategy-judge",
  "maya-reddit-demand-researcher",
  "maya-x-founder-led-researcher",
  "maya-tiktok-format-researcher",
  "maya-tiktok-demo-strategist",
  "maya-linkedin-fit-researcher",
  "maya-content-format-miner",
  "maya-competitor-researcher",
  "maya-viral-demo-moment-miner",
  "maya-distribution-motion-tester",
  "maya-slop-critic",
  "maya-results-reviewer",
  "maya-calendar-plan-builder",
  "maya-calendar-populator",
  "maya-voice-matcher",
  "maya-approval-publisher",
  "maya-ugc-system-advisor",
];

const BANNED_WORKSPACE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "USER.md",
  "APP.md",
  "GTM.md",
  "TOOLS.md",
  "BOOT.md",
  "HEARTBEAT.md",
  "MEMORY.md",
  "DREAMING.md",
  "PLAYBOOK.md",
  "IDENTITY.md",
  "jobs.json",
];

const BANNED_INTERNAL_TERMS = [
  "evidence card",
  "evidence cards",
  "ICP hypothesis",
  "channel score",
  "channel scores",
  "research lane",
  "first boot",
  "boot kickoff",
  "boot_kickoff",
  "workspace mutation",
  "approval state",
  "priorityScore",
  "voiceMatchScore",
  "slopCriticPassed",
  "bounded job",
  "queued job",
  "subagent",
  "sessions_spawn",
  "/lc_gtm/",
  "gtmTargetThreads",
  "gtmDraftedContent",
  "gtmPostResults",
];

// Sprint 2.10 — AI references — Maya is "your launch manager," not
// "your AI assistant" (per feedback_no_ai_in_marketing_copy memory,
// extended to operator-facing runtime output).
//
// Sprint 2.16u-fix7 — DROPPED bare "LLM" / "language model" /
// "large language model". The matcher is `indexOf` (substring match
// anywhere), so the bare terms blocked legit product-domain language
// like "local LLM workflows" (ModelHub's literal domain). Verified
// failure 2026-05-26: Maya tried to send "complaining about
// disjointed local LLM workflows" and validate_outbound returned
// firewall_blocked:ai_reference:LLM — looped forever, never sent.
//
// The intent of this list is self-references ("I'm an AI",
// "as a language model") — not any mention of LLM/AI in product or
// market context. Replaced bare terms with their SELF-REFERENCE
// patterns so product-domain mentions go through.
const BANNED_AI_REFERENCES = [
  "as an AI",
  "I am an AI",
  "I'm an AI",
  "AI assistant",
  "AI manager",
  "AI agent",
  "your AI",
  "as an LLM",
  "I am an LLM",
  "I'm an LLM",
  "as a language model",
  "I am a language model",
  "I'm a language model",
  "as a large language model",
];

// PLAYBOOK § 6 slop ban list — partial; canonical list lives in
// PLAYBOOK.md and the maya-slop-critic skill enforces the full set
// via the LLM-driven critique.
const BANNED_SLOP_PHRASES = [
  "game changer",
  "game-changer",
  "unlock",
  "supercharge",
  "skyrocket",
  "10x your",
  "next level",
  "level up your",
  "dive deep",
  "deep dive",
  "in today's",
  "in today's fast-paced",
  "the world of",
  "the realm of",
  "I hope this email finds you well",
  "rest assured",
];

export interface ValidateOutboundResult {
  ok: boolean;
  failures: Array<{
    category:
      | "skill_slug"
      | "workspace_file"
      | "internal_term"
      | "ai_reference"
      | "slop_phrase";
    matched: string;
    excerpt: string;
  }>;
}

function findMatches(
  text: string,
  candidates: string[],
  category: ValidateOutboundResult["failures"][number]["category"]
): ValidateOutboundResult["failures"] {
  const lower = text.toLowerCase();
  const failures: ValidateOutboundResult["failures"] = [];
  for (const candidate of candidates) {
    const candidateLower = candidate.toLowerCase();
    const idx = lower.indexOf(candidateLower);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 30);
    const end = Math.min(text.length, idx + candidate.length + 30);
    failures.push({
      category,
      matched: candidate,
      excerpt: text.slice(start, end).trim(),
    });
  }
  return failures;
}

/**
 * Validate a draft outbound message against the voice contract +
 * slop ban list. Used by `/lc_gtm/validate_outbound` (Maya calls
 * before sendMessage).
 */
export function validateOutboundText(text: string): ValidateOutboundResult {
  const failures: ValidateOutboundResult["failures"] = [
    ...findMatches(text, BANNED_SKILL_SLUGS, "skill_slug"),
    ...findMatches(text, BANNED_WORKSPACE_FILES, "workspace_file"),
    ...findMatches(text, BANNED_INTERNAL_TERMS, "internal_term"),
    ...findMatches(text, BANNED_AI_REFERENCES, "ai_reference"),
    ...findMatches(text, BANNED_SLOP_PHRASES, "slop_phrase"),
  ];
  return { ok: failures.length === 0, failures };
}

/**
 * Internal action callable from /lc_gtm/validate_outbound HTTP route.
 */
export const validateOutbound = internalAction({
  args: { text: v.string() },
  handler: async (
    _ctx,
    args
  ): Promise<ValidateOutboundResult> => {
    return validateOutboundText(args.text);
  },
});
