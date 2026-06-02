/**
 * Sprint 2.10 — Outbound firewall: voice-contract + slop-critic
 * pre-send check.
 *
 * Every user-facing Maya message (Telegram hello, weekly recap, draft
 * approval ask, monthly channel proposal) should pass through this gate
 * before being sent. There are TWO passes:
 *
 *   1. CHEAP SUBSTRING PASS (`validateOutboundText`) — a deterministic
 *      first pass that catches KNOWN surface leaks:
 *        - SOUL.md "Voice contract — what NEVER leaks" ban list
 *          (per feedback_maya_no_technical_leakage_to_user memory)
 *        - PLAYBOOK § 6 lexical slop ban list
 *      This is `indexOf`-based: fast, zero-cost, zero-latency, but it
 *      can ONLY match literals it has been told about. It cannot catch
 *      *structural* slop — the SHAPE of AI-generated prose (em-dash
 *      cadence, tidy tricolons, "not just X, it's Y", uniform rhythm,
 *      over-hedging, zero specifics) that no phrase list can enumerate.
 *
 *   2. STRUCTURAL + VOICE LLM PASS (`critiqueOutboundStructural`) — the
 *      REAL backstop. Runs the maya-slop-critic Rule 9.11b structural
 *      AI-tell rubric as LLM judgment (NOT regex/counts/thresholds — per
 *      the no-heuristics rule), and, when a voice fingerprint is supplied,
 *      a voice-divergence check against the founder's own register. Returns
 *      the same `ValidateOutboundResult` shape so callers can union the
 *      two passes' failures.
 *
 * `/lc_gtm/validate_outbound` should run BOTH passes and merge failures.
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
import { callOpenRouter } from "../agents/modelRouter/openRouterClient";

// Reuse the channel-judge model so the firewall shares one telemetry
// profile with the rest of Maya's grounded LLM calls.
const STRUCTURAL_CRITIC_MODEL = "google/gemini-3-flash-preview";

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
      | "slop_phrase"
      // Sprint — structural+voice LLM pass categories.
      | "structural_ai_tell"
      | "voice_divergence";
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
 *
 * This is the CHEAP substring pass only. The route should ALSO call
 * `critiqueOutboundStructural` and merge both results' failures so the
 * structural+voice LLM backstop runs on every outbound message.
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

// ───────────────────────────────────────────────────────────────────
// Structural AI-tell + voice-divergence LLM pass (the real backstop).
//
// The substring matcher above can only catch literals it was told about.
// It cannot catch the SHAPE of AI prose. This pass runs the maya-slop-
// critic Rule 9.11b rubric as LLM JUDGMENT (no regex, no counts, no
// thresholds — per the no-heuristics rule) and, when a voice fingerprint
// is supplied, a voice-divergence check against the founder's register.
// ───────────────────────────────────────────────────────────────────

const STRUCTURAL_CRITIC_SYSTEM_PROMPT = `You are the maya-slop-critic structural AI-tell pass. You read a draft outbound message as a skeptical human from the target community would, and judge whether it has the telltale smoothness of machine-written or template-marketer text.

Do NOT use regex, counts, or fixed thresholds. Judge by feel. Look for, and reason about, these structural AI-tells TOGETHER (any one is a yellow flag; a cluster is a reject):
- Em-dash as default connective: AI glues clauses with em-dashes where a person would use a period or two sentences. The rhythmic "X — Y — Z" cadence reads machine-made.
- Suspiciously tidy tricolons / rule-of-three ("faster, cheaper, more reliable"). One is fine; a draft built of them is a tell.
- "It's not just X, it's Y" and "not only… but also" — the signature AI pivot-to-profundity. Flag every instance.
- Uniform sentence rhythm — a metronome of medium, evenly-weighted sentences with no burstiness.
- Over-hedging / no stance ("it can be helpful in many cases", "this might be worth considering"). A real founder has an opinion.
- Zero opinion / zero specifics — prose that could be about any product, sent to anyone, citing nothing concrete.
- Suspicious symmetry / tidiness — perfectly parallel clauses, a clean intro-body-closer arc on a casual message.
- Pivot-to-uplift closer — a neat motivational wrap-up a real person wouldn't tack on.

VOICE-DIVERGENCE: if a founder voice fingerprint is provided, also judge whether the draft diverges from THAT person's register — sentence-length variance, capitalization, emoji frequency, parenthetical-aside habit, contraction use, profanity tolerance, characteristic openings/sign-offs/phrases. Divergence from the founder's own voice is a separate failure from generic AI-tell.

The verdict question is always: would someone in this community, writing in THIS founder's voice, have written this — or does it read like generic AI?

Return STRICT JSON, no prose, no code fence:
{
  "structuralTells": [{ "snippet": "<offending text>", "reason": "<which tell + why>" }],
  "voiceDivergences": [{ "snippet": "<offending text>", "reason": "<how it diverges from the founder's voice>" }]
}
If the draft is clean, return both arrays empty. Only populate voiceDivergences when a voice fingerprint was provided.`;

function parseCriticResponse(raw: string): unknown {
  let s = raw.trim();
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) s = fenceMatch[1]!.trim();
  const objStart = s.indexOf("{");
  if (objStart > 0) s = s.slice(objStart);
  const objEnd = s.lastIndexOf("}");
  if (objEnd >= 0 && objEnd < s.length - 1) s = s.slice(0, objEnd + 1);
  return JSON.parse(s);
}

function asHitArray(
  x: unknown,
  category: "structural_ai_tell" | "voice_divergence",
  cap = 8
): ValidateOutboundResult["failures"] {
  if (!Array.isArray(x)) return [];
  const out: ValidateOutboundResult["failures"] = [];
  for (const item of x) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const snippet = typeof rec.snippet === "string" ? rec.snippet.trim() : "";
    const reason = typeof rec.reason === "string" ? rec.reason.trim() : "";
    if (!snippet && !reason) continue;
    out.push({
      category,
      // `matched` carries the model's reason (the actionable rewrite
      // signal); `excerpt` carries the offending snippet, mirroring the
      // substring-pass shape.
      matched: (reason || "structural AI-tell").slice(0, 300),
      excerpt: snippet.slice(0, 300),
    });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Run the structural AI-tell + (optional) voice-divergence LLM pass on a
 * draft outbound message. Returns the same `ValidateOutboundResult` shape
 * as the substring pass, with categories 'structural_ai_tell' and
 * 'voice_divergence'.
 *
 * FAIL-OPEN: if the model is unauthenticated / unreachable / returns
 * unparseable output, this returns `{ ok: true, failures: [] }` rather
 * than blocking the send. The cheap substring pass has already run, and
 * blocking every outbound message on an LLM outage would silence Maya
 * (the launch-killing-silence failure class). This pass is a backstop,
 * not a hard gate.
 *
 * `voiceProfile` is the JSON string stored at gtmAgents.voiceProfileJson
 * (a founder voice fingerprint). When absent — or when confidence is
 * 'none' (zero-handle user) — the voice-divergence check is skipped and
 * only the structural-AI-tell pass runs (mirrors slop-critic's
 * "no_fingerprint_available" path).
 */
export const critiqueOutboundStructural = internalAction({
  args: {
    text: v.string(),
    voiceProfile: v.optional(v.string()),
  },
  handler: async (
    _ctx,
    args
  ): Promise<ValidateOutboundResult> => {
    const text = args.text.trim();
    if (text.length === 0) return { ok: true, failures: [] };

    const apiKey = process.env.OPENROUTER_API_KEY;
    // Fail-open when the model can't be reached — never block a send on
    // missing config; the substring pass is the deterministic floor.
    if (!apiKey) return { ok: true, failures: [] };

    // Decide whether a usable voice fingerprint is present. A profile with
    // confidence 'none' (or absent) means we skip voice-divergence and
    // run only the structural pass.
    let voiceFingerprint: string | null = null;
    if (args.voiceProfile && args.voiceProfile.trim().length > 0) {
      try {
        const parsed = JSON.parse(args.voiceProfile) as {
          confidence?: unknown;
        };
        const confidence = parsed?.confidence;
        if (confidence !== "none") {
          voiceFingerprint = args.voiceProfile;
        }
      } catch {
        // Malformed voice JSON — treat as no fingerprint, run structural
        // pass only. Never throw (would block the send).
        voiceFingerprint = null;
      }
    }

    const userContent = voiceFingerprint
      ? `FOUNDER VOICE FINGERPRINT (JSON):\n${voiceFingerprint}\n\nDRAFT OUTBOUND MESSAGE:\n${text}`
      : `No founder voice fingerprint available — run the structural AI-tell pass only; return voiceDivergences as an empty array.\n\nDRAFT OUTBOUND MESSAGE:\n${text}`;

    let raw: string;
    try {
      const completion = await callOpenRouter({
        model: STRUCTURAL_CRITIC_MODEL,
        messages: [
          { role: "system", content: STRUCTURAL_CRITIC_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        thinkingBudget: "medium",
        maxOutputTokens: 1200,
        apiKey,
      });
      raw = completion.content;
    } catch {
      // API/network failure — fail-open.
      return { ok: true, failures: [] };
    }

    let parsed: Record<string, unknown>;
    try {
      const p = parseCriticResponse(raw);
      if (!p || typeof p !== "object" || Array.isArray(p)) {
        return { ok: true, failures: [] };
      }
      parsed = p as Record<string, unknown>;
    } catch {
      // Unparseable LLM output — fail-open.
      return { ok: true, failures: [] };
    }

    const failures: ValidateOutboundResult["failures"] = [
      ...asHitArray(parsed.structuralTells, "structural_ai_tell"),
      // Only surface voice-divergence hits when we actually supplied a
      // fingerprint (no fingerprint => no voice failures).
      ...(voiceFingerprint
        ? asHitArray(parsed.voiceDivergences, "voice_divergence")
        : []),
    ];

    return { ok: failures.length === 0, failures };
  },
});
