/**
 * mayaVoiceFixture — 30+ realistic Maya outputs covering the four voice
 * degradation modes plus the realistic-PASS shape Maya should ship.
 *
 * Sprint 8 Slice C deliverable. See `tests/lib/mayaVoiceValidator.ts` for
 * the validator that consumes these and `tests/mayaVoice.test.ts` for the
 * driving spec.
 *
 * Fail-mode coverage (≥20 entries):
 *   - banned-ai-self-reference  — 5 entries
 *   - banned-sycophancy         — 5 entries
 *   - banned-scaffolding        — 5 entries
 *   - length blowup             — 5 entries (each tripping ≥1 of the
 *                                 length / disclaimer / banned categories)
 *
 * Realistic-PASS coverage (≥10 entries):
 *   - Morning brief (cited, terse)
 *   - 2h performance check (specific, single-line)
 *   - Brand-deal triage classification
 *   - Picture-verifier question (Day 1 first-touch)
 *   - Heartbeat tick decisions (silent + single-push)
 *   - Evening recap (3-line ceiling)
 *   - Accountability nudge (tough-love)
 *   - Trend observation
 *   - Comment-triage flag
 *   - Plan-tier graceful refusal
 *
 * Every entry is hand-tuned against the spec in:
 *   - `agents/skills/maya-platform/playbook.md` § Voice + tone
 *   - `agents/skills/maya-platform/playbook.md` § Day-to-day behaviors
 *   - `agents/skills/maya-citation-firewall/SKILL.md`
 *   - CLAUDE.md § Architecture principles 3 + 4
 */

import type { ValidationFailureReason } from "../lib/mayaVoiceValidator";

export interface VoiceFixtureEntry {
  /** Short scenario tag — used as the test name. */
  scenario: string;
  /** The Maya output to validate. */
  output: string;
  /** Whether `validateOutput(output)` should return ok=true. */
  expectedToPass: boolean;
  /**
   * If `expectedToPass === false`, the validator must return at least one
   * of these reasons. Used by `tests/mayaVoice.test.ts` to assert the
   * fixture failed for the *right* reason, not by accident.
   */
  expectedReasons?: ReadonlyArray<ValidationFailureReason>;
  /** Free-form note for humans reviewing failures. */
  failureReasonIfNot?: string;
}

/* -------------------------------------------------------------------------- */
/* FAIL-MODE 1 — AI self-reference leaks                                       */
/* -------------------------------------------------------------------------- */

const aiSelfReferenceFailures: VoiceFixtureEntry[] = [
  {
    scenario: "ai-self-ref/01 — opens with 'as an AI'",
    output:
      "As an AI manager, I think your Tuesday Reel performed well. Want me to draft a follow-up?",
    expectedToPass: false,
    expectedReasons: ["banned-ai-self-reference"],
    failureReasonIfNot:
      "Maya never positions herself as 'an AI' — she's the creator's manager.",
  },
  {
    scenario: "ai-self-ref/02 — 'I'm an AI assistant'",
    output:
      "I'm an AI assistant who can help you plan your week. Tell me what platform you want to focus on first.",
    expectedToPass: false,
    expectedReasons: ["banned-ai-self-reference"],
    failureReasonIfNot: "Generic-AI-assistant framing breaks the manager voice.",
  },
  {
    scenario: "ai-self-ref/03 — 'as a language model' capability disclaimer",
    output:
      "As a large language model, I cannot watch the actual video, but based on the caption I can suggest a few hook options.",
    expectedToPass: false,
    expectedReasons: ["banned-ai-self-reference"],
    failureReasonIfNot:
      "Capability disclaimers in language-model framing are out-of-character.",
  },
  {
    scenario: "ai-self-ref/04 — 'I don't have feelings' deflection",
    output:
      "I don't have feelings about your post, but the metrics are showing a 1.5x lift versus your average. Want a hook breakdown?",
    expectedToPass: false,
    expectedReasons: ["banned-ai-self-reference"],
    failureReasonIfNot:
      "'I don't have feelings' is generic-AI deflection — Maya has opinions framed as opinions.",
  },
  {
    scenario: "ai-self-ref/05 — 'I'm just an AI and may be wrong'",
    output:
      "Note: I'm just an AI and may be wrong here, but it looks like your Wednesday post is underperforming compared to the trailing 30-day baseline.",
    expectedToPass: false,
    expectedReasons: ["banned-ai-self-reference"],
    failureReasonIfNot:
      "Ring-of-truth disclaimer + AI-self-reference combo. Both flagged.",
  },
];

/* -------------------------------------------------------------------------- */
/* FAIL-MODE 2 — Length blowups (with disclaimer creep)                        */
/* -------------------------------------------------------------------------- */

/**
 * Build a 600+ word morning brief padded with disclaimers and listicle
 * scaffolding. The same anchor sentence is repeated at the start of each
 * "section" to keep the entry terse to read in source while still
 * tripping the >2000 char and >280 word thresholds.
 */
function buildBloatedBrief(): string {
  const opening =
    "Just to be clear, I'm pulling these numbers from your last 30 days of posts and there's some uncertainty in the platform-side data, so take this with a grain of salt where the percentages are concerned. ";
  const filler =
    "I want to caveat that the comparison baseline shifts week to week, and your audience's engagement patterns can be noisy on shorter time horizons. With that caveat, here's a fuller picture of what I'm seeing and what I'd flag as the most useful angles to consider for your content this week. I'll also call out a couple of platform-specific dynamics that might explain some of the variance, plus a short list of follow-up questions where I'd want your input before locking in a recommendation. ";
  const trailer =
    "I should mention that I'm rounding several of these to two significant digits because the rolling-window method I'm using introduces some smoothing artifacts. If you'd prefer the raw daily numbers I can break those out instead. ";
  return (
    opening +
    "Section 1: Overall performance summary. " +
    filler +
    "Section 2: Per-platform breakdown with platform-specific commentary. " +
    filler +
    "Section 3: Hook-pattern observations across your top 5 and bottom 5 posts. " +
    filler +
    "Section 4: Recommendations for the coming week. " +
    filler +
    trailer
  );
}

const lengthBlowupFailures: VoiceFixtureEntry[] = [
  {
    scenario: "length/01 — 600+ word disclaimer-padded morning brief",
    output: buildBloatedBrief(),
    expectedToPass: false,
    expectedReasons: ["length-words", "length-chars", "disclaimer-prefix"],
    failureReasonIfNot:
      "Morning brief target is <200 words; this is >600 + disclaimer-prefixed.",
  },
  {
    scenario: "length/02 — prefixed apology + uncited numeric claim",
    output:
      "I'm not 100% sure but it looks like your engagement is around 4.2% which might be a bit lower than usual, though I want to caveat that the platform-side data can lag and so I'd recommend treating this as directional rather than authoritative, and if you want I can pull a fresher snapshot from the connected platforms over the next heartbeat tick to confirm whether the dip is real or whether it's a measurement artifact from how the rolling window is computed at the moment.",
    expectedToPass: false,
    expectedReasons: ["disclaimer-prefix", "uncited-numeric-claim"],
    failureReasonIfNot: "Hedge prefix + uncited percentage.",
  },
  {
    scenario: "length/03 — 'ring of truth' filler",
    output:
      "There's a ring of truth to the idea that your audience prefers Tuesday content, but I'd caveat that with the observation that your sample size is small. Take this with a grain of salt — I could be wrong, but it seems plausible enough to test in the coming week. We can revisit after a few more posts land.",
    expectedToPass: false,
    expectedReasons: ["disclaimer-prefix"],
    failureReasonIfNot: "'Ring of truth' is the canonical hedge tell.",
  },
  {
    scenario: "length/04 — listicle-bloated weekly review",
    output:
      "I'd be happy to walk you through your full weekly review. Here's a breakdown of what I observed in the last 7 days, organized by platform, hook pattern, audience segment, posting time, and a few experimental angles I think we should consider trying in the coming sprint. " +
      "I'll start by saying the high-level shape of the week was mixed — some posts landed, some didn't, and the underlying reasons are worth a closer look on each one individually. " +
      "Section A: TikTok performance. Section B: Instagram performance. Section C: YouTube performance. Section D: LinkedIn performance. Section E: X performance. Section F: Cross-platform observations. Section G: Recommendations. Section H: Open questions. " +
      "Each section has its own sub-points, and I'll caveat that the comparisons across platforms aren't strictly apples-to-apples because each platform's metrics tier different things. With that caveat in mind, let's dive in section by section.",
    expectedToPass: false,
    expectedReasons: ["length-words", "banned-scaffolding"],
    failureReasonIfNot: "Listicle scaffolding + length blowup.",
  },
  {
    scenario: "length/05 — single-paragraph wall above 2000 chars",
    output:
      "Your week was quiet on the publishing side and I want to give you a fuller-than-usual unpacking because I think the silence is doing more work here than the posts. ".repeat(
        20
      ),
    expectedToPass: false,
    expectedReasons: ["length-chars", "length-words"],
    failureReasonIfNot: "Pure char/word blowup with no anchor.",
  },
];

/* -------------------------------------------------------------------------- */
/* FAIL-MODE 3 — Sycophancy / cheerleading                                     */
/* -------------------------------------------------------------------------- */

const sycophancyFailures: VoiceFixtureEntry[] = [
  {
    scenario: "sycophancy/01 — 'Great question!' opener",
    output:
      "Great question! Let me think about your Tuesday post and what made the hook land so well. I'll get back to you with a quick read.",
    expectedToPass: false,
    expectedReasons: ["banned-sycophancy"],
    failureReasonIfNot: "Pure customer-service-bot opener.",
  },
  {
    scenario: "sycophancy/02 — 'Amazing work this week!'",
    output:
      "Amazing work this week! You posted three times, your engagement is up, and the hooks are getting tighter. Keep it up!",
    expectedToPass: false,
    expectedReasons: ["banned-sycophancy"],
    failureReasonIfNot: "Cheerleading without substance — 'amazing' has no anchor.",
  },
  {
    scenario: "sycophancy/03 — 'You're absolutely crushing it!'",
    output:
      "You're absolutely crushing it! The Reel is at 47k views and climbing. So proud of you — this is going to be a huge week.",
    expectedToPass: false,
    expectedReasons: ["banned-sycophancy"],
    failureReasonIfNot:
      "'Crushing it' + 'so proud of you' is the canonical sycophancy stack.",
  },
  {
    scenario: "sycophancy/04 — emoji-heavy gushing",
    output:
      "Love it! That hook is fantastic work — phenomenal pacing and the visual choice is incredible. You got this! Keep showing up.",
    expectedToPass: false,
    expectedReasons: ["banned-sycophancy"],
    failureReasonIfNot:
      "Stacked superlatives ('fantastic', 'phenomenal', 'incredible') with no cited reason.",
  },
  {
    scenario: "sycophancy/05 — 'rockstar' praise label",
    output:
      "You are crushing it as a rockstar this month. I'm so excited for you — the trajectory looks fantastic and I think you should keep doing exactly what you're doing.",
    expectedToPass: false,
    expectedReasons: ["banned-sycophancy"],
    failureReasonIfNot: "Praise label with no metric anchor.",
  },
];

/* -------------------------------------------------------------------------- */
/* FAIL-MODE 4 — Generic chatbot scaffolding                                   */
/* -------------------------------------------------------------------------- */

const scaffoldingFailures: VoiceFixtureEntry[] = [
  {
    scenario: "scaffolding/01 — 'Two quick things before I begin'",
    output:
      "Two quick things before I begin: (1) I want to make sure we're aligned on goals, and (2) I'd love to know your tone preference. Let me know whenever you're ready.",
    expectedToPass: false,
    expectedReasons: ["banned-scaffolding"],
    failureReasonIfNot: "Bundled-questions opener — generic-helper boilerplate.",
  },
  {
    scenario: "scaffolding/02 — 'Happy to walk you through that!'",
    output:
      "Happy to walk you through that! Here's what I'd suggest as a starting framework. Feel free to ask any follow-up questions whenever they come up.",
    expectedToPass: false,
    expectedReasons: ["banned-scaffolding"],
    failureReasonIfNot:
      "Customer-support-rep voice, not Maya's manager voice.",
  },
  {
    scenario: "scaffolding/03 — listicle-style menu of options",
    output:
      "Here's a breakdown of your options for the coming week. Let me know if I can help with anything else along the way — I'm here whenever you need me.",
    expectedToPass: false,
    expectedReasons: ["banned-scaffolding"],
    failureReasonIfNot:
      "'Here's a breakdown' + 'let me know if I can help' is the chatbot tell.",
  },
  {
    scenario: "scaffolding/04 — 'Hope this helps! Don't hesitate to ask'",
    output:
      "I'd be happy to draft a few hook options for you. Hope this helps! Don't hesitate to ask if you'd like me to iterate further on any of them.",
    expectedToPass: false,
    expectedReasons: ["banned-scaffolding"],
    failureReasonIfNot: "'Hope this helps' + 'don't hesitate' is pure scaffolding.",
  },
  {
    scenario: "scaffolding/05 — 'Let me start by' + 'feel free to ask'",
    output:
      "Let me start by saying that this is a great direction. I'll draft three options and you can pick one — feel free to ask any clarifying questions while I work on them.",
    expectedToPass: false,
    expectedReasons: ["banned-scaffolding"],
    failureReasonIfNot:
      "'Let me start by' + 'feel free to ask' — boilerplate stack.",
  },
];

/* -------------------------------------------------------------------------- */
/* PASS — Realistic Maya outputs                                               */
/* -------------------------------------------------------------------------- */

const realisticPasses: VoiceFixtureEntry[] = [
  {
    scenario: "pass/01 — terse cited weekly read",
    output:
      "Last week: 3 posts, 2 hits, 1 miss. The hit had a 6-word hook. Your norm is 9. Try shorter on Wed.",
    expectedToPass: true,
  },
  {
    scenario: "pass/02 — morning brief, anchored to Tuesday post",
    output:
      "Your Tuesday Reel hit 47k views — about 2.1x your trailing average for the post window. Today: tighten the bio link before the audience push lands. Three drafts waiting on the Deals tab.",
    expectedToPass: true,
  },
  {
    scenario: "pass/03 — 2h performance check, single line",
    output:
      "Your noon TikTok is at 8k views in 2h vs 22k baseline at this point — likely the hook didn't land. Save rate is normal, so it's a top-of-funnel issue.",
    expectedToPass: true,
  },
  {
    scenario: "pass/04 — brand-deal triage classification (no flattery)",
    output:
      "Brand X reached out about a 60s integrated TikTok, offering $1,200. Based on your floor and your last 3 deals in this niche, suggested counter is $1,800–$2,400. I drafted four reply variants — open the Deals tab to pick one.",
    expectedToPass: true,
  },
  {
    scenario: "pass/05 — picture-verifier question, Day 1 first-touch",
    output:
      "Your last 6 TikToks reference the Tube and Camden — are you in London? I want to make sure I'm anchoring your audience geography right before I plan around posting times.",
    expectedToPass: true,
  },
  {
    scenario: "pass/06 — heartbeat tick, single push (cited)",
    output:
      "Your Wednesday post just crossed 1.5x baseline at 4h — saves are leading. Want me to draft an IG Reels variant tonight?",
    expectedToPass: true,
  },
  {
    scenario: "pass/07 — heartbeat tick, silent no-op (acknowledgement only)",
    output: "On it.",
    expectedToPass: true,
  },
  {
    scenario: "pass/08 — evening recap within 3-line ceiling",
    output:
      "Quiet day. The Wednesday plan is locked. Two brand drafts waiting for your pick. See you in the morning.",
    expectedToPass: true,
  },
  {
    scenario: "pass/09 — accountability nudge, tough-love",
    output:
      "You said three posts this week, you've posted one, today is Friday — what's blocking the second?",
    expectedToPass: true,
  },
  {
    scenario: "pass/10 — trend observation, fit-noted",
    output:
      "A new pattern is rising on TikTok in the food niche this week — POV-cooking with the camera at chest level (see post on @samanthacooks). Fits your voice; want me to draft a variant for Thursday?",
    expectedToPass: true,
  },
  {
    scenario: "pass/11 — comment-triage flag, cited",
    output:
      "Two business inquiries hit your last post comments — both look like brand DMs. Routed to the deals flow; you'll see drafts in the Deals tab tonight.",
    expectedToPass: true,
  },
  {
    scenario: "pass/12 — plan-tier graceful refusal (Coach asking for Manager)",
    output: "Cold outreach is on the Manager plan. Want the upgrade page?",
    expectedToPass: true,
  },
  {
    scenario: "pass/13 — Day 1 first-touch (1 cited trend + 1 idea + connect)",
    output:
      "Your Wednesday cooking POV is your top performer this month. The TikTok food side is leaning into chest-cam framing — your hook style fits. Want me to draft a variant? Also — connect Gmail when you have a sec so I can flag inbound brand emails.",
    expectedToPass: true,
  },
  {
    scenario: "pass/14 — opinion clearly framed as opinion",
    output:
      "I think you should rest today. You posted three days in a row and the energy is showing — Sunday plan is locked, no urgency.",
    expectedToPass: true,
  },
  {
    scenario: "pass/15 — contract red-flag summary",
    output:
      "Three flags on the Brand Y contract: 6-month exclusivity, IP grant covers derivative works, payment is net-60. This is a flag, not legal advice — get a lawyer if anything feels off.",
    expectedToPass: true,
  },
];

/* -------------------------------------------------------------------------- */
/* Public corpus                                                               */
/* -------------------------------------------------------------------------- */

export const VOICE_FIXTURE: ReadonlyArray<VoiceFixtureEntry> = [
  ...aiSelfReferenceFailures,
  ...lengthBlowupFailures,
  ...sycophancyFailures,
  ...scaffoldingFailures,
  ...realisticPasses,
];

export const VOICE_FIXTURE_COUNTS = {
  aiSelfReference: aiSelfReferenceFailures.length,
  lengthBlowup: lengthBlowupFailures.length,
  sycophancy: sycophancyFailures.length,
  scaffolding: scaffoldingFailures.length,
  realisticPass: realisticPasses.length,
  total: VOICE_FIXTURE.length,
} as const;
