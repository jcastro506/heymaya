/**
 * Sprint 17 — ClawHub skills pinned for Maya GTM workspaces.
 *
 * Per Part II D5 + the original sprint doc § Sprint 7, we vendor SKILL.md
 * bodies from canonical ClawHub registry downloads at deploy time. Maya
 * reads these as prompt-reference doctrine on every research turn that
 * touches the relevant platform.
 *
 * Runtime caveat: 5 of 7 skills (reddit-readonly, search-x, tiktok,
 * jk-archivist-tiktok-packager, market-research, in-depth-research) reference
 * companion scripts/.md files that aren't shipped in the workspace
 * tarball. For Maya to actually INVOKE the skill (vs READ it), the
 * operator must run `openclaw skills install <slug>@<version>` on the
 * Fly machine. Sprint 17 acceptance: deploy adds a first-boot hook that
 * installs these on machine startup; this file is the source-of-truth
 * VERSION LOCK for that install step.
 *
 * Bodies fetched from https://wry-manatee-359.convex.site/api/v1/download
 * (ClawHub canonical registry) 2026-05-23 by a research subagent.
 * Re-verify before bumping any version.
 */

export interface PinnedClawhubSkill {
  /** Registry slug — what `openclaw skills install` uses. */
  slug: string;
  /** Version locked at pin time. */
  version: string;
  /** Canonical ClawHub registry download URL for re-verification. */
  source: string;
  /** Env vars the skill needs to actually run. Operator must set these
   *  on the Convex deployment before the skill is invoked. */
  requiredEnv: string[];
  /** True if the skill is multi-file. SKILL.md is prompt-reference only;
   *  runtime invocation needs `openclaw skills install` on deploy. */
  needsRuntimeInstall: boolean;
  /** Optional notes — e.g. hardcoded-brand content to sanitize. */
  caveats: string[];
  /** SKILL.md body, verbatim from the registry download. */
  body: string;
}

const REDDIT_READONLY_BODY = `---
name: reddit-readonly
description: >-
  Browse and search Reddit in read-only mode using public JSON endpoints.
  Use when the user asks to browse subreddits, search for posts by topic,
  inspect comment threads, or build a shortlist of links to review and reply to manually.
metadata: {"clawdbot":{"emoji":"🔎","requires":{"bins":["node"]}}}
---

# Reddit Readonly

Read-only Reddit browsing for Maya.

## What this skill is for

- Finding posts in one or more subreddits (hot/new/top/controversial/rising)
- Searching for posts by query (within a subreddit or across all)
- Pulling a comment thread for context
- Producing a *shortlist of permalinks* so the user can open Reddit and reply manually

## Hard rules

- **Read-only only.** This skill never posts, replies, votes, or moderates.
- Be polite with requests: prefer small limits (5–10) first; expand only if needed.
- When returning results to the user, always include **permalinks**.

## Output format

All commands print JSON to stdout. Success: \`{ "ok": true, "data": ... }\`. Failure: \`{ "ok": false, "error": { ... } }\`.

## Suggested workflow

1. Clarify scope: subreddits + topic keywords + timeframe.
2. Start with \`find\` / \`posts\` / \`search\` using small limits.
3. For 1–3 promising items, fetch context via \`thread\`.
4. Present a shortlist: title, subreddit, score, created time, permalink, brief reason why it matched.
5. If asked, propose draft reply ideas in natural language, but remind the user to post manually.

## Pacing knobs (env)

\`REDDIT_RO_MIN_DELAY_MS\`, \`REDDIT_RO_MAX_DELAY_MS\`, \`REDDIT_RO_TIMEOUT_MS\`, \`REDDIT_RO_USER_AGENT\`.

Runtime install requires the \`scripts/reddit-readonly.mjs\` companion bundled by \`openclaw skills install reddit-readonly\`.
`;

const SEARCH_X_BODY = `---
name: search-x
version: "1.2.1"
description: Real-time X/Twitter search powered by Grok. Find tweets, trends, and discussions with citations.
metadata:
  openclaw:
    requires:
      env:
        - XAI_API_KEY
    primaryEnv: XAI_API_KEY
---

# Search X

Real-time X/Twitter search via xAI's Responses API + x_search tool.

## Setup

Set XAI_API_KEY on the Convex deployment OR pass via openclaw config:

\`\`\`bash
openclaw config set skills.entries.search-x.apiKey "xai-YOUR-KEY"
\`\`\`

## Commands

- Basic: \`node {baseDir}/scripts/search.js "AI video editing"\`
- Time filter: \`--days 7 "breaking news"\` / \`--days 1 "trending today"\`
- Handle filter: \`--handles @elonmusk,@OpenAI "AI announcements"\` / \`--exclude @bots\`
- Output: \`--json\` (full) / \`--compact\` (just tweets) / \`--links-only\`

## Usage cues (in chat)

- "Search X for what people are saying about Claude Code" → query "Claude Code".
- "Find tweets from @remotion_dev in the last week" → --handles @remotion_dev --days 7.

## Response shape

Each result includes @username (display name), tweet content, date, direct link.

## Env

- \`XAI_API_KEY\` — REQUIRED.
- \`SEARCH_X_MODEL\` — optional, default grok-4-1-fast.
- \`SEARCH_X_DAYS\` — optional, default 30.

Runtime install requires the \`scripts/search.js\` companion bundled by \`openclaw skills install search-x\`.
`;

const TIKTOK_AGENTICIO_BODY = `---
name: tiktok
description: Local-first TikTok Growth OS for strategy, hooks, scripts, retention design, and analytics feedback. No API, no posting, no platform automation.
---

# TikTok Growth OS

A local-first operating system for TikTok creators. Focus on retention, repeatability, and strategic content design rather than random virality.

## What this skill does

Use when the user wants help with TikTok niche positioning, content pillars, video ideas, hooks, short-form scripts, A/V storyboard formatting, series planning, captions and hashtags, retention diagnosis, or performance pattern review.

## Core operating logic

TikTok growth is a system of controllable variables:

- Hook strength: does the first 1–3 seconds create tension or relevance?
- Retention design: does the script create momentum and payoff?
- Visual pacing: pattern interrupt every few seconds?
- Audience fit: does this feel native to the target viewer?
- Series potential: can this idea create return behavior?
- Data feedback: what to repeat / refine / drop?

Do not present growth as magic. Do not guarantee virality.

## Output rules

Prefer: spoken-language phrasing, short sentences, immediate tension, specific audience fit, clear payoff, native short-form rhythm.

Avoid: essay-style intros, generic motivational filler, slow setup with no payoff, over-explaining before the hook lands.

## Default content workflow

1. Clarify niche/audience.
2. Generate 3–10 content angles.
3. Produce 5 hook variations.
4. Build one execution-ready script.
5. Optionally save to local memory.
6. If analytics exist, use prior performance to refine.

## Hook generation rules

Hooks fall into: curiosity gap, painful truth, contrarian take, mistake warning, identity-based recognition, specific promise, emotional confession, authority/signal-of-experience.

For each variation: label the type; explain briefly why it may work; avoid repeating sentence shape.

## Script generation rules

Default format:

| Time | Visual | Spoken / Audio | On-Screen Text |
|------|--------|----------------|----------------|

First 1–3 seconds = hook. Each segment adds tension, clarity, or payoff. Include pattern interrupts. CTA only if it fits naturally.

## Performance review rules

If user provides metrics, diagnose: weak opening, slow payoff, too much setup, vague topic framing, mismatch between hook and delivery, insufficient visual momentum, weak emotional/practical value, unclear audience targeting.

## Local memory

Local-only at \`~/.openclaw/workspace/memory/tiktok/\`. Files: profile.json, content_bank.json, analytics.json, pattern_report.json.

## Safety boundaries

Local-only. No TikTok API. No account login. No posting. No scraping. No engagement automation. No claims of guaranteed virality. The user owns final review + posting + platform compliance.

Runtime install requires the Python scripts + references companions bundled by \`openclaw skills install tiktok\`.
`;

const JK_ARCHIVIST_TIKTOK_PACKAGER_BODY = `---
name: jk-archivist-tiktok-packager
description: Generate deterministic 6-slide portrait PNG slideshow assets plus caption text for TikTok-style posting workflows, including reusable templates and a strict validation pipeline.
metadata: {"openclaw":{"emoji":"🎬","requires":{"bins":["node","python3"]}}}
---

# JK Archivist TikTok Packager

Generate deterministic, text-driven 6-slide portrait slideshow assets for TikTok-style content.

## What this skill is for

- Repeatable 6-slide visual posts without external image generation
- Consistent dimensions and readable layout for short-form platforms
- A simple contract: input slide copy → validated PNG outputs + caption text
- A base that can later plug into draft upload workflows (e.g. via Postiz)

Typical use cases: brand or creator intro slides, educational mini explainers, product update snapshots, story-driven announcement sequences.

## Quick start

\`\`\`bash
python3 -m pip install -r requirements.txt
node scripts/tiktok-intro-draft.mjs
\`\`\`

With custom copy: \`--spec /absolute/path/to/spec.json\`. Generate from topic: \`--topic "your topic"\`. Optional draft upload: \`--postiz\`.

## Advanced modes

\`--template intro|educational|product-update|announcement\`,
\`--style default|high-contrast|clean|midnight\`,
\`--audience beginner|operator|expert\`,
\`--cta-pack follow-focused|link-focused|engagement-focused\`,
\`--hashtag-policy tcg-default|general\`,
\`--hashtag #customtag\` (repeatable),
\`--locale en|es|fr\`,
\`--ab-test caption-cta|style|template\`,
\`--dry-run\`, \`--postiz-only\`, \`--no-upload\`, \`--resume-upload\`,
\`--max-retries N\`, \`--timeout-ms N\`, \`--verbose\`.

## Core output contract

- Exactly 6 slides
- 1024x1536 portrait
- PNG output format
- Large readable text with safe margins

Output dir layout: \`outbox/tiktok/intro/YYYY-MM-DD/{_slide_spec.json, _render_metadata.json, slides/slide_01..06.png, caption.txt, review/{review.md,contact_sheet.png}, run_log.json, upload_state.json?, postiz_response.json?}\`.

## Customization matrix

| Need | Option |
|---|---|
| Your own slide copy | \`--spec /path/spec.json\` |
| Generate from topic | \`--topic "..."\` |
| Built-in narrative | \`--template educational\` etc. |
| Visual style | \`--style high-contrast\` |
| Reading complexity | \`--audience beginner\` |
| CTA behavior | \`--cta-pack ...\` |
| Hashtag policy | \`--hashtag-policy ...\` |
| Custom hashtags | \`--hashtag #customtag\` |
| Localize CTA | \`--locale es\` |
| Multiple candidates | \`--ab-test ...\` |
| Local-only | omit \`--postiz\` |
| Postiz upload | \`--postiz\` + required env |
| Resume partial uploads | \`--postiz --resume-upload\` |
| Tune network | \`--max-retries N --timeout-ms N\` |
| Validate without rendering | \`--dry-run\` |

## Spec JSON format

\`\`\`json
{
  "slides": ["line 1", "line 2", "line 3", "line 4", "line 5", "line 6"],
  "caption": "Optional caption override",
  "template": "intro",
  "audience": "operator",
  "ctaPack": "follow-focused",
  "hashtagPolicy": "general",
  "hashtagOverrides": ["#customtag"],
  "locale": "en",
  "ab_test": { "strategy": "caption-cta" },
  "style": { "preset": "default" }
}
\`\`\`

## Safety / never do

No token mentions. No \`$\`. No buy/sell language. No predictions. No copyrighted character art. No unverified superlatives.

## Required env

Optional upload mode: \`POSTIZ_API_KEY\`, \`POSTIZ_TIKTOK_INTEGRATION_ID\`. Optional: \`POSTIZ_BASE_URL\`, \`TIKTOK_FONT_PATH\` (absolute .ttf).

Runtime install requires the full Node + Python source tree bundled by \`openclaw skills install jk-archivist-tiktok-packager\`.
`;

const INSTAGRAM_AGENTICIO_BODY = `---
name: instagram
description: A local-first Instagram content system for hooks, captions, content structure, and draft storage. Acts as The Attention Sculptor to optimize stop-rate and retention. No API, no auto-posting, no automation.
version: 2.1.1
metadata:
  openclaw:
    requires:
      env: []
---

# Instagram — The Attention Sculptor

Visuals stop the scroll. Architecture earns the action.

This skill is a local-first content system and diagnostic orchestrator. Every post is a tactical entry in a conversion funnel.

## Privacy + safety

- Local storage only at \`~/.openclaw/workspace/memory/instagram/\`.
- No API connection. No auto-posting. No automated DMs.
- The script \`scripts/write_caption.py\` is for optional local draft persistence.

## Attention architecture (4 layers)

1. **Funnel position** — Awareness / Trust / Lead Generation / Conversion Support?
2. **Hook diagnosis** — what stops the scroll in the first 0-3s / slide 1?
3. **Retention + friction check** — remove spam-like patterns, reduce cognitive drag, improve pacing, build value momentum.
4. **Draft storage** — if requested, save locally.

## Operating modes

### Mode 1: content optimization
"Rewrite this Reel hook." / "Fix this caption." / "Make this carousel more save-worthy."

Focus: hook rewriting, caption strengthening, CTA redesign, friction reduction, retention improvement.

### Mode 2: account strategy
"What Instagram should I build?" / "What pillars should I use?" / "How do I align visuals with offer?"

Focus: funnel logic, content pillars, identity consistency, account positioning, CTA path design.

## Preferred CTA paths (lowest-friction first)

Save → Share → Comment Keyword → DM Trigger → Link in Bio → Story Follow-up.

CTA should match the funnel position of the content.

## Output modes

### Quick fix
- Main Problem
- Best Fix
- Rewritten Hook / Caption / CTA

### Deep audit
CONTENT STRATEGY DIAGNOSIS (format, funnel position, psychological trigger).
RESTRUCTURED EXECUTION (hook, retention sculpting, caption structure, CTA route).
COMPLIANCE + FRICTION CHECK (risk items, fix).

## What this skill does NOT do

No auto-posting, no virality guarantees, no algorithm-bypass claims, no bulk DMs, no full analytics dashboard.

This skill provides strategy + structure + optional local draft persistence. Account control stays in human hands.
`;

const MARKET_RESEARCH_BODY = `---
name: market-research
slug: market-research
version: 1.0.1
description: "Research markets with sizing, segmentation, competitor mapping, pricing checks, and demand validation that turn fuzzy ideas into decision-ready evidence."
---

# Market Research

Use this skill when the user needs market evidence, not just opinions.

## Activation conditions

Market sizing, opportunity validation, competitor landscape, segment selection, pricing research, whitespace mapping, expansion decisions. Especially "is this market worth entering?", "how big is the real opportunity?", "who else is already winning here?", "what evidence reduces risk?"

## Research brief

Start every serious engagement with this:

\`\`\`
MARKET RESEARCH BRIEF
Decision:
Target customer:
Geography:
Category or substitute set:
Time horizon:
Must-answer questions:
Evidence bar:
\`\`\`

If the brief is weak, the research drifts.

## Modes

| Mode | Best for | Minimum output |
|---|---|---|
| Quick scan | Early idea filtering | Snapshot + top competitors + 2-3 risks |
| Decision memo | Operators / investors making a next-step call | Sizing + segment map + competitor comparison + recommendation |
| Launch validation | New product / feature / niche | Demand signals + pricing + interviews + no-go risks |
| Expansion study | New geography / segment / adjacent category | SAM filters + local competitors + channel constraints |

## Core rules

1. **Define the decision before research starts.** Anchor work to ONE decision: enter or avoid; prioritize segment; shape positioning/pricing; build/launch/expand.
2. **Size in layers, not headlines.** TAM (category), SAM (reachable), SOM (winnable in window). Show formula + assumptions + confidence. Smaller defensible > big vague.
3. **Triangulate; grade source quality.** Use ≥3 evidence families: market structure (census/filings/benchmarks), behavior (search trends/reviews/jobs), direct customer (interviews/surveys/LOIs).
4. **Segment before generalize.** Split by customer type, company size, geo, pain urgency, willingness to pay, existing alternatives.
5. **Map competition around customer choice, not brand names.** Direct + indirect + workarounds + future entrants. The real competitor = whatever the customer would choose instead.
6. **Favor revealed demand over stated enthusiasm.** Strong: repeated workarounds, urgent frequency, willingness to pay/pilot/switch. Weak: "great idea", survey positivity, likes.
7. **Finish with a decision-ready recommendation.** What evidence supports; what's uncertain; what's next; what would change the recommendation.

## Common traps

Top-down theater. Competitor tunnel vision. Segment blur. Source recency failure. Opinion inflation. No confidence labeling. Research with no recommendation.

## Security

No hidden outbound. No fabricated interviews. No private-system access. No persistent memory by default. No stored secrets unless asked.

Companion files (bundled at install): \`competitor-analysis.md\`, \`validation.md\`, \`evidence-grading.md\`. Runtime install: \`openclaw skills install market-research\`.
`;

const IN_DEPTH_RESEARCH_BODY = `---
name: in-depth-research
description: "Conduct exhaustive multi-source investigation with methodology tracking, source evaluation, and iterative depth."
---

# Deep Research

Investigate thoroughly until the question is answered. Systematic exploration with documented methodology.

Not for: quick lookups (just search), combining existing docs (Synthesize), ongoing monitoring (Digest).

## Protocol

\`\`\`
Scope → Search → Evaluate → Deepen → Synthesize → Document → Deliver
\`\`\`

### 1. Scope
What exactly needs answering? Required depth (Overview / Thorough / Exhaustive)? Decision this enables? Time/effort budget? Reframe vague questions into specific, answerable queries.

### 2. Search
Multi-vector: start broad, then narrow. Multiple engines/sources. Follow citation trails. Check primary sources when secondary cite them. Look for contradicting viewpoints. Track every source.

### 3. Evaluate
For each source: authority, recency, evidence quality, bias, corroboration. Flag low-credibility. Weight accordingly.

### 4. Deepen
Iterative. Initial findings reveal new questions. Follow promising threads. Fill gaps. Stop when answer is clear, returns diminish, or budget exhausted. Document the stop decision.

### 5. Synthesize
Reconcile contradictions explicitly. Weight by source quality. Note confidence levels. Identify remaining unknowns.

### 6. Document
Sources consulted with links. Search queries used. Why certain sources were weighted higher. What was NOT found (gaps).

### 7. Deliver
Format per user needs: executive (BLUF + findings + confidence), academic (full methodology + citations), working doc (all findings for further work).

## Depth levels

| Level | Effort | Sources | When |
|---|---|---|---|
| Quick | 5-10 min | 3-5 | Simple factual |
| Standard | 30-60 min | 8-15 | Most requests |
| Thorough | 2-4 hours | 20-30 | Important decisions |
| Exhaustive | Days | 50+ | Critical, high-stakes |

Confirm depth before starting; adjust if findings warrant.

## Output (default — sanitize emoji for iMessage)

ANSWER: 2-3 sentences direct answer.
CONFIDENCE: High/Medium/Low — why.
KEY FINDINGS: bullets with sources.
CAVEATS: limitations / uncertainties.
GAPS: what couldn't be determined.
SOURCES: numbered list with credibility notes.
METHODOLOGY: what was searched, how sources evaluated.

Companion files (bundled at install): \`methodology.md\`, \`sources.md\`, \`output-formats.md\`. Runtime install: \`openclaw skills install in-depth-research\`.
`;

export const PINNED_CLAWHUB_SKILLS: readonly PinnedClawhubSkill[] = [
  {
    slug: "reddit-readonly",
    version: "1.0.0",
    source:
      "https://wry-manatee-359.convex.site/api/v1/download?slug=reddit-readonly",
    requiredEnv: [],
    needsRuntimeInstall: true,
    caveats: [
      "Optional pacing knobs: REDDIT_RO_MIN_DELAY_MS, REDDIT_RO_MAX_DELAY_MS, REDDIT_RO_TIMEOUT_MS, REDDIT_RO_USER_AGENT.",
      "Multi-file skill — scripts/reddit-readonly.mjs bundled at openclaw skills install time.",
    ],
    body: REDDIT_READONLY_BODY,
  },
  {
    slug: "search-x",
    version: "1.2.1",
    source: "https://wry-manatee-359.convex.site/api/v1/download?slug=search-x",
    requiredEnv: ["XAI_API_KEY"],
    needsRuntimeInstall: true,
    caveats: [
      "Operator must set XAI_API_KEY on Convex env before Maya invokes.",
      "Multi-file — scripts/search.js bundled at install.",
    ],
    body: SEARCH_X_BODY,
  },
  {
    slug: "tiktok",
    version: "3.0.0",
    source: "https://wry-manatee-359.convex.site/api/v1/download?slug=tiktok",
    requiredEnv: [],
    needsRuntimeInstall: true,
    caveats: [
      "No TikTok API; no posting; no scraping. Strategy + scripts only.",
      "Multi-file — 5 Python scripts + 2 references bundled at install.",
    ],
    body: TIKTOK_AGENTICIO_BODY,
  },
  {
    slug: "jk-archivist-tiktok-packager",
    version: "1.6.0",
    source:
      "https://wry-manatee-359.convex.site/api/v1/download?slug=jk-archivist-tiktok-packager",
    requiredEnv: [],
    needsRuntimeInstall: true,
    caveats: [
      "Postiz upload mode needs POSTIZ_API_KEY + POSTIZ_TIKTOK_INTEGRATION_ID.",
      "Original SKILL.md included a hardcoded 'JK Archivist Intro' Pokémon TCG preset — stripped here so Maya doesn't default to that copy. Sanitize again if updating from upstream.",
      "Multi-file Node + Python skill — full source tree bundled at install.",
    ],
    body: JK_ARCHIVIST_TIKTOK_PACKAGER_BODY,
  },
  {
    slug: "instagram",
    version: "2.1.1",
    source:
      "https://wry-manatee-359.convex.site/api/v1/download?slug=instagram",
    requiredEnv: [],
    needsRuntimeInstall: false,
    caveats: [
      "Mostly self-contained — only optional scripts/write_caption.py companion.",
      "Upstream zip ships lowercase skill.md; we ship as SKILL.md to match Linux/Fly conventions.",
    ],
    body: INSTAGRAM_AGENTICIO_BODY,
  },
  {
    slug: "market-research",
    version: "1.0.1",
    source:
      "https://wry-manatee-359.convex.site/api/v1/download?slug=market-research",
    requiredEnv: [],
    needsRuntimeInstall: true,
    caveats: [
      "Companion files (competitor-analysis.md, validation.md, evidence-grading.md) bundled at install.",
      "Upstream included a 'Related Skills' footer that recommended other clawhub installs — stripped here so Maya doesn't recommend installs the deployment doesn't allow.",
    ],
    body: MARKET_RESEARCH_BODY,
  },
  {
    slug: "in-depth-research",
    version: "1.0.0",
    source:
      "https://wry-manatee-359.convex.site/api/v1/download?slug=in-depth-research",
    requiredEnv: [],
    needsRuntimeInstall: true,
    caveats: [
      "Original output format used heavy emoji — we sanitized inline so the cron-delivery output doesn't trip iMessage UX bans. If we ever ship the emoji version, gate behind channel.",
      "Companion files (methodology.md, sources.md, output-formats.md) bundled at install.",
    ],
    body: IN_DEPTH_RESEARCH_BODY,
  },
];

/** Required env across all pinned skills — used by deploy to validate
 *  the Convex environment before a workspace is built. */
export function pinnedClawhubRequiredEnv(): string[] {
  const set = new Set<string>();
  for (const skill of PINNED_CLAWHUB_SKILLS) {
    for (const env of skill.requiredEnv) set.add(env);
  }
  return [...set].sort();
}

/** Build the openclaw skills install command sequence that runs on
 *  first boot to install the runtime-needed companions. Idempotent. */
export function buildSkillInstallCommands(): string[] {
  return PINNED_CLAWHUB_SKILLS.filter((s) => s.needsRuntimeInstall).map(
    (s) => `openclaw skills install ${s.slug}@${s.version} --global`
  );
}
