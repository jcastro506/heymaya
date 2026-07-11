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

/**
 * Strategy/marketing JARGON the founder (not a marketing/tech expert)
 * shouldn't see (non-technical-tone pass, 2026-06-22). LOG-ONLY on the
 * private-DM send path: jargon is annoying, not catastrophic, and per the
 * no-regex-enforcement rule a non-catastrophic drift NEVER drops a message.
 * 2026-07-10 — these lived in BANNED_INTERNAL_TERMS, which the direct-send
 * firewall treats as blocking: "content angle" + "relationship target" in
 * the foundation synthesis blackholed the founder's plan (delivery stamped
 * nothing, pushCachedPlan retried into the same wall). The SOUL prompt is
 * the primary control; this list only feeds the drift counter.
 */
export const JARGON_DRIFT_TERMS = [
  "buyer map",
  "channel scorecard",
  "content angle",
  "relationship target",
  "stage-adaptive",
  "buyer journey",
  "T1 thread",
  "ICP threads",
];

/** Drift detector only — callers LOG these, never drop (see JARGON_DRIFT_TERMS). */
export function detectJargonDrift(
  text: string
): ValidateOutboundResult["failures"] {
  return findMatches(text, JARGON_DRIFT_TERMS, "internal_term");
}

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
      | "voice_divergence"
      // Deterministic punctuation AI-tells (em-dash, colon-header).
      | "ai_punctuation"
      // S2.7 — pre-publish SAFETY firewall (auto-post under the founder's
      // name). `safety_violation` = the critic flagged content; the matched
      // field carries the violation category (offensive/off_brand/
      // hallucinated_claim/competitor_disparagement/legal_overclaim/pii/
      // tos_risk). `safety_unverifiable` = the critic could not run (fail
      // CLOSED — the publish gate treats this as a block, NOT a pass).
      | "safety_violation"
      | "safety_unverifiable";
    matched: string;
    excerpt: string;
  }>;
}

/**
 * Deterministic AI-punctuation tells (operator directive 2026-06-02): the
 * em-dash and the colon-as-header are the two most recognizable "an AI wrote
 * this" markers. Real people texting on their phone use periods, commas, and
 * line breaks instead. We flag them deterministically (a regex IS the right
 * tool here — these are exact characters, not a fuzzy vibe judgment), so a
 * tripped draft/message is rejected and Maya rewrites it as a human would.
 *
 * Exemptions (legitimate colon uses we must NOT flag): URLs (`https://`),
 * clock times (`9:30`), ratios (`2:1`), and emoji shortcodes (`:tada:`).
 */
function detectAiPunctuation(
  text: string
): ValidateOutboundResult["failures"] {
  const failures: ValidateOutboundResult["failures"] = [];
  const push = (matched: string, idx: number) => {
    const start = Math.max(0, idx - 30);
    const end = Math.min(text.length, idx + 30);
    failures.push({
      category: "ai_punctuation",
      matched,
      excerpt: text.slice(start, end).trim(),
    });
  };

  // 1. Em-dash / en-dash — never needed in casual social prose; hard tell.
  const dashRe = /[—–]/g;
  let m: RegExpExecArray | null;
  let dashCount = 0;
  while ((m = dashRe.exec(text)) !== null && dashCount < 5) {
    push("— (em-dash)", m.index);
    dashCount += 1;
  }

  // 2. Spaced hyphen used as a dash mid-sentence ("too - you share") — the
  //    ASCII stand-in for an em-dash. Word, space-hyphen-space, word. (A
  //    markdown bullet "- " at line start has a leading newline/start, not a
  //    word char, so it's not matched.)
  const spacedDashRe = /\S \- \S|\S \-\S|\S\- \S/g; // " - " between non-spaces
  let sd = 0;
  while ((m = spacedDashRe.exec(text)) !== null && sd < 5) {
    // skip if it's a numeric range like "3 - 5" (acceptable)
    if (!/\d \- \d/.test(m[0])) {
      push("- (hyphen used as a dash)", m.index);
      sd += 1;
    }
  }

  // 3. Colon-as-header ("Here's the wedge:", "Today:") — a colon followed by
  //    whitespace, preceded by a letter. EXEMPT: URL (`:/`), time/ratio (digit
  //    on at least one side with no space), emoji shortcode handled by the
  //    letter-before requirement + the `:/` skip.
  const colonRe = /[A-Za-z]:(\s|$)/g;
  let c = 0;
  while ((m = colonRe.exec(text)) !== null && c < 5) {
    const at = m.index + 1; // position of the colon
    const next = text[at + 1] ?? "";
    // URL ("://") or time/ratio (digit right after colon) → exempt.
    if (next === "/" || /\d/.test(next)) continue;
    push(": (colon used as a header/label)", m.index);
    c += 1;
  }

  return failures;
}

/**
 * Mechanically fix the deterministic AI-punctuation tells (em/en-dash,
 * spaced-hyphen-dash, colon-as-header) so an operator-facing message is
 * DELIVERED clean rather than blackholed by a hard firewall block. A clean
 * message is unchanged (the patterns simply don't match). This is the
 * sanitize-and-send path for private operator DMs (send_update) — the firewall's
 * job there is voice quality, not ban-safety, so a bounce that reaches no one is
 * strictly worse than a comma where an em-dash was. Public POSTS still hard-gate.
 */
export function sanitizeOutboundText(text: string): string {
  let out = text;
  // Em-dash / en-dash (with any surrounding spaces) → comma+space (grammatical
  // clause join, no capitalization needed).
  out = out.replace(/\s*[—–]\s*/g, ", ");
  // Spaced hyphen used as a dash ("word - word") → comma, EXCEPT numeric ranges.
  out = out.replace(/(\S) - (\S)/g, (full, a, b) =>
    /\d/.test(a) && /\d/.test(b) ? full : `${a}, ${b}`
  );
  // Colon-as-header ("Word: " / "Word:\n") → period. Naturally exempts URLs
  // ("://" — colon not followed by whitespace) and times ("9:30" — no letter
  // before the colon).
  out = out.replace(/([A-Za-z]):(\s|$)/g, "$1.$2");
  // Collapse any accidental double punctuation / spaces the swaps introduced.
  out = out.replace(/,\s*,/g, ",").replace(/\.\s*\./g, ".").replace(/[ \t]{2,}/g, " ");
  return out;
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
 * Outbound-discipline DRIFT DETECTOR (2026-06-22, demoted to log-only 2026-06-22).
 *
 * Flags a PROACTIVE send that LOOKS like pure pipeline-narration — the agent
 * reporting its own cron run ("Midday pulse complete", "Just finished the midday
 * pulse") rather than something the founder needs to ACT ON.
 *
 * ⚠️ This is NOT an enforcement gate. The PRIMARY control is the SOUL prompt
 * (Banned phrases → cron/pass-completion narration). This detector exists only so
 * the callsite can LOG `send_update.status_narration_detected` — an observability
 * counter that tells us whether the prompt is actually holding on Kimi. If it
 * starts firing often, the fix is to strengthen the PROMPT (or add an LLM check),
 * NOT to grow these brittle phrase regexes. We deliberately do not drop the
 * message: status narration is annoying, not catastrophic (unlike a leaked token
 * or skill slug — those stay on the hard `validateOutboundText` denylist), so it
 * does not earn a deterministic phrase-matcher in the send path.
 *
 * Content-beats-pattern still applies: a message with a URL / @handle / r/sub is
 * never even flagged, so the counter doesn't get muddied by real updates that
 * happen to mention a "pulse."
 */
const CRON_NARRATION_RE =
  /\b(pulse|brief|recap|review|sweep|scan)\s+(complete|completed|done|finished)\b/i;
const SELF_REPORT_RE = /^\s*(just\s+)?(now\s+)?(finished|done|completed|wrapped up|ran)\b/i;
/** Grounded-content signals — if ANY is present the message is actionable, not narration. */
const GROUNDED_CONTENT_RE = /(https?:\/\/|\bwww\.|@[A-Za-z0-9_]{2,}|r\/[A-Za-z0-9_]{2,})/;

/** Detector only — see the doc comment. True = "looks like cron narration, worth
 *  logging as prompt-drift." Callers must NOT drop on this; the prompt is the gate. */
export function looksLikeStatusNarration(text: string): boolean {
  if (typeof text !== "string" || text.trim() === "") return false;
  // Actionable content present → not narration.
  if (GROUNDED_CONTENT_RE.test(text)) return false;
  return CRON_NARRATION_RE.test(text) || SELF_REPORT_RE.test(text);
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
    ...detectAiPunctuation(text),
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

// ───────────────────────────────────────────────────────────────────
// S2.7 — Pre-publish SAFETY firewall + the autonomous-publish gate.
//
// Auto-post removes the human-in-the-loop the old paste-the-link model
// relied on. Voice-match proves a draft SOUNDS like the founder; the
// slop-critic proves it doesn't READ like AI; NEITHER proves it is SAFE
// TO SAY under the founder's name. This adds that missing layer and the
// three-verdict gate that S3's publish path consults.
//
// CRITICAL fail-semantics difference: the structural pass above is
// fail-OPEN (never silence Maya's chat on an LLM outage). The safety
// critic is fail-CLOSED — if it cannot run, the draft does NOT auto-
// publish; it downgrades to a one-tap confirm. A wrong auto-post under
// the founder's name is worse than asking them to tap.
// ───────────────────────────────────────────────────────────────────

const SAFETY_CRITIC_SYSTEM_PROMPT = `You are Maya's pre-publish safety critic. A draft is about to be auto-posted PUBLICLY under the founder's own name and brand, with no human reading it first. Your job is to catch anything that would embarrass the founder, mislead their audience, break a platform's rules, or create legal exposure. Judge like a cautious brand manager who will be blamed if this goes wrong.

Flag a draft if it contains ANY of:
- offensive: hateful, harassing, discriminatory, sexual, violent, or crude content; punching down; anything a reasonable person would find inappropriate from a brand.
- off_brand: claims, topics, or a tone the founder would not endorse (politics/religion unless that IS the product, drama, off-topic hot takes).
- hallucinated_claim: a factual or product claim that is not grounded in something the founder actually provided (made-up metrics, features, customers, awards, "studies show"). Grounded-or-silent: if the draft asserts a specific number/result/capability with no basis, flag it.
- competitor_disparagement: naming or trashing a competitor in a way that invites a fight or a defamation claim.
- legal_overclaim: guarantees, medical/financial/health promises, income claims, "guaranteed", "cure", "risk-free", unsubstantiated superlatives ("the best", "#1") stated as fact.
- pii: leaking a real person's private data (email, phone, address, a customer's name without consent).
- tos_risk: content likely to violate the target platform's rules (spammy repetition, banned-topic promotion, engagement-bait that triggers bans, undisclosed paid promotion).

Return STRICT JSON, no prose, no code fence:
{
  "violations": [{ "category": "<one of: offensive|off_brand|hallucinated_claim|competitor_disparagement|legal_overclaim|pii|tos_risk>", "snippet": "<offending text>", "reason": "<why it's unsafe>" }]
}
If the draft is safe to post, return an empty violations array. When unsure whether a specific claim is grounded, FLAG it (hallucinated_claim) — it is cheaper for the founder to tap-approve than to post a false claim.`;

const SAFETY_VIOLATION_CATEGORIES = new Set([
  "offensive",
  "off_brand",
  "hallucinated_claim",
  "competitor_disparagement",
  "legal_overclaim",
  "pii",
  "tos_risk",
]);

function asSafetyHits(x: unknown, cap = 12): ValidateOutboundResult["failures"] {
  if (!Array.isArray(x)) return [];
  const out: ValidateOutboundResult["failures"] = [];
  for (const item of x) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const category =
      typeof rec.category === "string" && SAFETY_VIOLATION_CATEGORIES.has(rec.category)
        ? rec.category
        : "off_brand";
    const snippet = typeof rec.snippet === "string" ? rec.snippet.trim() : "";
    const reason = typeof rec.reason === "string" ? rec.reason.trim() : "";
    if (!snippet && !reason) continue;
    out.push({
      category: "safety_violation",
      // `matched` carries the violation category + reason (the actionable
      // signal); `excerpt` carries the offending snippet.
      matched: `${category}: ${reason || "unsafe to publish"}`.slice(0, 300),
      excerpt: snippet.slice(0, 300),
    });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Run the pre-publish safety critic on a draft about to be AUTO-POSTED.
 *
 * FAIL-CLOSED: unlike `critiqueOutboundStructural`, if the model is
 * unreachable / unauthenticated / returns unparseable output, this returns
 * `{ ok: false, failures: [safety_unverifiable] }` — the publish gate must
 * treat that as a block (downgrade to needs_confirm), never an auto-publish.
 */
export const critiqueOutboundSafety = internalAction({
  args: { text: v.string() },
  handler: async (_ctx, args): Promise<ValidateOutboundResult> => {
    const text = args.text.trim();
    // An empty draft is not "safe" — there's nothing to publish. Block.
    if (text.length === 0) {
      return {
        ok: false,
        failures: [
          { category: "safety_unverifiable", matched: "empty draft", excerpt: "" },
        ],
      };
    }
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        failures: [
          {
            category: "safety_unverifiable",
            matched: "OPENROUTER_API_KEY missing — cannot verify safety",
            excerpt: "",
          },
        ],
      };
    }
    let raw: string;
    try {
      const completion = await callOpenRouter({
        model: STRUCTURAL_CRITIC_MODEL,
        messages: [
          { role: "system", content: SAFETY_CRITIC_SYSTEM_PROMPT },
          { role: "user", content: `DRAFT ABOUT TO BE AUTO-POSTED:\n${text}` },
        ],
        thinkingBudget: "medium",
        maxOutputTokens: 1200,
        apiKey,
      });
      raw = completion.content;
    } catch {
      return {
        ok: false,
        failures: [
          {
            category: "safety_unverifiable",
            matched: "safety critic API call failed",
            excerpt: "",
          },
        ],
      };
    }
    let parsed: Record<string, unknown>;
    try {
      const p = parseCriticResponse(raw);
      if (!p || typeof p !== "object" || Array.isArray(p)) {
        return {
          ok: false,
          failures: [
            {
              category: "safety_unverifiable",
              matched: "safety critic returned unparseable output",
              excerpt: "",
            },
          ],
        };
      }
      parsed = p as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        failures: [
          {
            category: "safety_unverifiable",
            matched: "safety critic returned unparseable output",
            excerpt: "",
          },
        ],
      };
    }
    const failures = asSafetyHits(parsed.violations);
    return { ok: failures.length === 0, failures };
  },
});

// ───────────────────────────────────────────────────────────────────
// The three-verdict autonomous-publish gate (S2.7 → consumed by S3).
//
// A draft may auto-publish ONLY when ALL THREE hold:
//   1. voice is CONFIDENT enough (the founder's voice is calibrated),
//   2. the slop/style firewall passed (not AI-tell, not a voice contract leak),
//   3. the safety critic passed (safe to say publicly).
// Any miss => the draft does NOT auto-publish; S3 routes it to needs_confirm
// (a one-tap founder approval). Fail-closed by construction.
// ───────────────────────────────────────────────────────────────────

export type VoiceConfidence = "none" | "low" | "medium" | "high";

/**
 * Read the voice-confidence from the agent's stored voiceProfileJson.
 * Defaults to 'none' (most-restrictive) on missing/corrupt JSON.
 */
export function readVoiceConfidence(
  voiceProfileJson: string | null | undefined
): VoiceConfidence {
  if (!voiceProfileJson) return "none";
  try {
    const parsed = JSON.parse(voiceProfileJson) as { confidence?: unknown };
    const c = parsed?.confidence;
    if (c === "high" || c === "medium" || c === "low" || c === "none") return c;
    return "none";
  } catch {
    return "none";
  }
}

export interface AutoPublishGateInput {
  voiceProfileJson?: string | null;
  /** Result of the slop/style firewall (substring + structural merged). */
  slopResult: ValidateOutboundResult;
  /** Result of `critiqueOutboundSafety`. */
  safetyResult: ValidateOutboundResult;
}

export interface AutoPublishGateResult {
  allowAutoPublish: boolean;
  voiceConfidence: VoiceConfidence;
  /** Why auto-publish was denied (empty when allowed). */
  blockReasons: Array<{
    layer: "voice_confidence" | "slop" | "safety";
    detail: string;
  }>;
}

/**
 * The autonomous-publish decision. Pure + deterministic (no I/O) so it is
 * trivially testable and S3 can call it inline. Confident voice = 'medium'
 * or 'high'; 'low'/'none' means the founder's voice isn't calibrated yet, so
 * Maya never autonomously posts in it (she still drafts for one-tap confirm).
 */
export function evaluateAutoPublishGate(
  input: AutoPublishGateInput
): AutoPublishGateResult {
  const voiceConfidence = readVoiceConfidence(input.voiceProfileJson);
  const blockReasons: AutoPublishGateResult["blockReasons"] = [];

  if (voiceConfidence === "none" || voiceConfidence === "low") {
    blockReasons.push({
      layer: "voice_confidence",
      detail: `voice not calibrated (confidence=${voiceConfidence}); route to confirm-to-post until calibrated`,
    });
  }
  if (!input.slopResult.ok) {
    blockReasons.push({
      layer: "slop",
      detail: input.slopResult.failures
        .map((f) => `${f.category}:${f.matched}`)
        .slice(0, 5)
        .join("; "),
    });
  }
  if (!input.safetyResult.ok) {
    blockReasons.push({
      layer: "safety",
      detail: input.safetyResult.failures
        .map((f) => `${f.category}:${f.matched}`)
        .slice(0, 5)
        .join("; "),
    });
  }

  return {
    allowAutoPublish: blockReasons.length === 0,
    voiceConfidence,
    blockReasons,
  };
}
