---
name: maya-platform-skills
version: 0.1.0-sprint3
description: The skill inventory installed on every Maya. Where each skill comes from, when to invoke it.
---

# Maya skill inventory

This is the canonical reference for every skill installed in Maya's workspace. It is shared across all Mayas (every creator gets the same skill bundle; only `soul.md` and connected accounts vary). Maya consults this file when she is deciding which skill to invoke for a given task.

The inventory is split into four sources:

1. **Anthropic public utility skills** — vendored unchanged from `github.com/anthropics/skills` into `agents/skills/`. Universal-utility only (PDF, docx, prose tone). Provenance and re-vendor command in `agents/skills/VENDOR_MANIFEST.md`.
2. **Custom Maya skills** — written by us, Maya-specific.
3. **Third-party agent skills** — vendor-supplied (ScrapeCreators, Composio).
4. **Pinned ClawHub skills** — registered in `convex/creatorMayaV0/pinnedClawhubSkills.ts` and materialized into Maya's deployed workspace at build time. ClawHub pins fill gaps that custom skills don't cover (clip rendering, frame extraction, transcription, photo overlay, web search) without us reinventing them. Original v0 stance ("no ClawHub skills") relaxed in Sprint 2 Slice D once specific gaps were identified.

**Maya's skill mix at deploy: 22 bundled `maya-*` custom skills + 6 ClawHub pins (capcut, video-frames, faster-whisper, elevenlabs-transcribe, photo-text-overlay, brave-search) + 3 Anthropic vendored skills (pdf, docx, internal-comms). The `tiktok` ClawHub Growth-OS skill is also pinned alongside the 6 above for hook/script/retention strategy work.**

The sourcing policy is documented in `project_skill_strategy.md` (operator memory). Per-pin reasoning is in `convex/creatorMayaV0/pinnedClawhubSkills.ts`. See § Skills explicitly NOT installed for the audit trail of skills we evaluated and declined.

---

## How Maya picks a skill

When Maya needs to do something, she follows this decision rule, in order:

1. **Check this file first.** If a skill listed here matches the task, invoke it. Do not improvise.
2. **Prefer the most single-purpose skill.** A `maya-rate-calculator` call is always preferred over freeform reasoning about deal rates. Single-purpose skills are tested, plan-tier-gated, and citation-firewalled. Freeform reasoning is none of those.
3. **Compose, don't reinvent.** Many tasks chain skills: `maya-contract-redflag` calls the Anthropic `pdf` skill for parse, then runs its own scan, then routes the output through `maya-citation-firewall`. The chain is explicit; each link is a listed skill.
4. **Never invoke a skill outside this inventory.** If a skill name is not listed here, it is not installed. The OpenClaw runtime will fail the call. Do not try.
5. **For tasks that do not fit any listed skill** — and only after checking this file twice — Maya may use the `skill-creator` Anthropic public skill to author a new custom Maya skill following the SKILL.md conventions. This is the meta-skill we use to write our own skills, and it is the documented path for closing skill gaps that surface in beta. New skills authored this way must be reviewed and merged into this inventory before being relied on in production.
6. **All skill outputs that make claims about creator data must pass `maya-citation-firewall` before send.** The firewall is itself a listed skill; every other Maya skill calls it on its outputs. No exceptions.

---

## Anthropic public utility skills

The four skills below are installed unchanged from Anthropic's public skill repository. They are universal-utility — generic enough that there is no value in rewriting them. Maya wraps them in custom skills wherever creator-specific schema, voice, or citation enforcement matters.

| Skill | Source | Used by |
|---|---|---|
| `pdf` | `https://github.com/anthropics/skills/tree/main/skills/pdf` | `maya-contract-redflag` (parse), `maya-packet-generator` (render) |
| `docx` | `https://github.com/anthropics/skills/tree/main/skills/docx` | Brand-brief intake (uncommon but real) |
| `internal-comms` | `https://github.com/anthropics/skills/tree/main/skills/internal-comms` | Weekly review synth, manager-readiness packet narrative |
| `skill-creator` | `https://github.com/anthropics/skills/tree/main/skills/skill-creator` | Authoring new custom Maya skills (our process + Maya in beta) |

### `pdf`

- **Source:** `https://github.com/anthropics/skills/tree/main/skills/pdf`
- **One-liner:** Parse PDFs into structured text + extract render-ready PDFs from structured input.
- **When to invoke:**
  - Whenever the creator uploads a brand-deal contract PDF — `maya-contract-redflag` invokes `pdf` to extract the contract text + structure (sections, signature blocks, exhibit pages) before running its red-flag scan.
  - When `maya-packet-generator` produces the manager-readiness packet — it builds the structured content first, then delegates the actual PDF render to `pdf`.
- **Inputs:** Maya passes a PDF byte stream (parse) or a structured document object (render).
- **Outputs:** Maya gets back parsed text + section structure (parse), or a finalized PDF byte stream (render).

### `docx`

- **Source:** `https://github.com/anthropics/skills/tree/main/skills/docx`
- **One-liner:** Parse `.docx` documents into structured text + write `.docx` files.
- **When to invoke:**
  - When a brand sends a deal brief as a `.docx` attachment (uncommon — most agencies send PDF or Notion link, but it happens with corporate brands).
  - `maya-brand-deal-triager` invokes `docx` if the inbound Gmail thread has a `.docx` attachment, before passing the parsed brief into the triage classifier.
- **Inputs:** Maya passes a `.docx` byte stream.
- **Outputs:** Maya gets back parsed text with paragraph/heading/table structure preserved.

### `internal-comms`

- **Source:** `https://github.com/anthropics/skills/tree/main/skills/internal-comms`
- **One-liner:** Long-form prose tone calibration — written for org-internal communications but is the closest fit for the deliberative, multi-paragraph narrative Maya produces in synthesis tasks.
- **When to invoke:**
  - Weekly review synthesis (`playbook.md § Weekly review`) — Maya needs to write 4–8 paragraphs of grounded analysis covering what shipped, what worked, what didn't, and what's next. `internal-comms` is the prose-tone backbone; `maya-voice-applier` then adjusts to the creator's voice fingerprint on top.
  - Manager-readiness packet narrative (`playbook.md § Manager-readiness packet`) — the packet is half data, half story. `internal-comms` shapes the story sections (creator overview, audience narrative, brand-deal posture summary).
- **Inputs:** Maya passes a draft outline + key facts + intended length.
- **Outputs:** Maya gets back a long-form prose draft that is then voice-applied + citation-firewalled.

### `skill-creator`

- **Source:** `https://github.com/anthropics/skills/tree/main/skills/skill-creator`
- **One-liner:** The meta-skill. Anthropic's documented authoring conventions for SKILL.md files (frontmatter, description, when-to-use, examples, tests). We use this skill ourselves when writing the 10 custom Maya skills. Maya may use it in beta when she hits a gap.
- **When to invoke:**
  - Authoring new custom Maya skills (our process). Every `maya-*` skill in this inventory was authored against `skill-creator`'s conventions.
  - In beta, when Maya identifies a recurring task pattern that no listed skill covers, she may invoke `skill-creator` to draft a new skill. The draft is reviewed by the operator before being merged into this inventory.
- **Inputs:** Maya passes a skill name, purpose, intended inputs/outputs, and example invocations.
- **Outputs:** Maya gets back a draft SKILL.md + scaffolded test fixture.

---

## Custom Maya skills

Ten skills, all written by us in Sprint 3.5. Each lives in `agents/skills/maya-{name}/` with a `SKILL.md`, optional `script.ts`, and `__tests__/{name}.test.ts`. All ship as `pending Sprint 3.5` until the bundle lands; the OpenClaw config generator already references them so the runtime knows to expect them on disk.

| Skill | Status | Plan-tier gating |
|---|---|---|
| `maya-rate-calculator` | pending Sprint 3.5 | All tiers |
| `maya-hook-extractor` | pending Sprint 3.5 | Pro+ for multimodal video read; Starter caption-only |
| `maya-platform-best-practice` | pending Sprint 3.5 | All tiers |
| `maya-calendar-classifier` | pending Sprint 3.5 | Pro+ only |
| `maya-citation-firewall` | pending Sprint 3.5 | All tiers (mandatory on every output with claims) |
| `maya-packet-generator` | pending Sprint 3.5 | Pro+ on-demand; Starter quarterly auto-refresh only |
| `maya-contract-redflag` | pending Sprint 3.5 | All tiers |
| `maya-voice-applier` | pending Sprint 3.5 | All tiers |
| `maya-content-arc-planner` | pending Sprint 3.5 | All tiers (Starter limited to single-platform variants) |
| `maya-brand-deal-triager` | pending Sprint 3.5 | Pro+ only (Starter has no Gmail integration) |
| `maya-underperformance-diagnoser` | pending Sprint 3.5c | All tiers |
| `maya-pre-post-scorer` | pending Sprint 3.5c | All tiers |

### `maya-rate-calculator`

- **Status:** pending Sprint 3.5 (will flip to `installed v1.0.0` on ship)
- **One-liner:** Brand-deal rate suggestion engine — heuristic floor-rate model + LLM reasoning layer.
- **When to invoke:**
  - `playbook.md § Brand email triage` — when a brand inbound arrives, Maya runs `maya-rate-calculator` against the creator's profile + the deliverables the brand is asking for, to ground her counter-offer.
  - `playbook.md § Rate suggestion` — on-demand from creator chat ("what should I charge for a TikTok + IG carousel?").
- **Inputs:** Maya passes follower count (per platform), niche, deliverables (post type + count + usage rights + exclusivity terms), prior deal history.
- **Outputs:** Maya gets back a rate range (low / target / stretch), reasoning citing the heuristic + creator's prior deals, and 3–5 comparable creator data points if available.
- **Plan-tier:** All tiers.

### `maya-hook-extractor`

- **Status:** pending Sprint 3.5
- **One-liner:** Multimodal video → hook pattern extraction. Watches the first 3 seconds of a post, reads captions, scans top comments, returns the hook structure + why-it-worked analysis.
- **When to invoke:**
  - `playbook.md § Hook library auto-build` — every new top-performing post triggers extraction; the hook gets stored in `hookLibrary` for re-use suggestions.
  - `playbook.md § Post-publish reaction` — when a creator publishes a post, Maya extracts its hook to compare against the creator's working library and flag novelty.
- **Inputs:** Maya passes the post video URL, captions, top 10 comments. (Pro+ unlocks multimodal video read; Starter receives caption + comments only.)
- **Outputs:** Maya gets back the hook pattern (text + structural classification), why-it-worked analysis citing the multimodal evidence, and a suggestion on whether to repeat / variant / retire the pattern.
- **Plan-tier:** Pro+ for the multimodal video read; Starter falls back to caption-only analysis.

### `maya-platform-best-practice`

- **Status:** pending Sprint 3.5
- **One-liner:** Per-platform expert consultant — TikTok hooks vs IG Reels saves vs YT retention vs LinkedIn voice vs X concision.
- **When to invoke:**
  - Used everywhere Maya is making a cross-platform decision. `playbook.md § Platform expertise` references this skill as the citation source for any platform-specific recommendation.
  - Inside `maya-content-arc-planner` when generating per-platform variants of a post idea.
  - Inside `maya-hook-extractor` when classifying whether a hook fits the platform's distribution model.
- **Inputs:** Maya passes platform + content type + the specific question (e.g., "what's the optimal first-frame for TikTok vs IG Reels?").
- **Outputs:** Maya gets back a best-practice answer with cited examples. Citations come from a curated knowledge base bundled in the skill — not freeform recall.
- **Plan-tier:** All tiers.

### `maya-calendar-classifier`

- **Status:** pending Sprint 3.5
- **One-liner:** Calendar event → content-arc classification. Filters noise from real life events worth planning around.
- **When to invoke:**
  - `playbook.md § Calendar-aware content planning` — the daily 8am calendar look-ahead invokes this skill on every event 1–14 days out.
  - Folded into Sunday weekly plan generation when the weekly window includes upcoming calendar events.
- **Inputs:** Maya passes the calendar event (title, date, attendees count, description). Attendee email addresses are NOT passed — the privacy contract in `playbook.md § Calendar-aware content planning` forbids it.
- **Outputs:** Maya gets back a classification (`creator-relevant-life-event` / `work-meeting` / `recurring-noise` / `creator-shoot` / `personal-private`) plus, for relevant events, a suggested content-arc shape (build-up days, day-of capture plan, recap window).
- **Plan-tier:** Pro+ only. Calendar is not in Starter's `allowedProviders`.

### `maya-citation-firewall`

- **Status:** pending Sprint 3.5
- **One-liner:** Pre-send hallucination gate. Verifies every claim in a Maya output is grounded in cited evidence. Called by every other Maya skill on outputs that make claims about creator data.
- **When to invoke:**
  - **Mandatory.** Every Maya skill listed here calls `maya-citation-firewall` on its outputs before returning them. This is non-negotiable per the "grounded or silent" principle (`CLAUDE.md § Architecture principles 3`).
  - Also called directly by Maya before sending any chat reply, brief, or proactive nudge that references creator-specific data.
- **Inputs:** Maya passes the draft text + a list of cited evidence items (post IDs, scraped facts, calendar event IDs, contract clause IDs).
- **Outputs:** Maya gets back a pass/fail verdict, plus — on fail — a list of unsupported claims with their location in the draft. Maya must either remove the unsupported claims or surface citations before retrying.
- **Plan-tier:** All tiers. The firewall is part of every Maya, regardless of plan.

### `maya-packet-generator`

- **Status:** pending Sprint 3.5
- **One-liner:** Manager-readiness packet generator. Produces the PDF a creator can show a prospective human manager.
- **When to invoke:**
  - `playbook.md § Manager-readiness packet` — on-demand from creator chat (Pro+) or quarterly auto-refresh cron (all tiers).
- **Inputs:** Maya passes the creator picture (from `creatorPicture` table), 90-day metrics, brand-deal log, audience demographics. Internal narrative sections are drafted via `internal-comms`.
- **Outputs:** Maya gets back a PDF byte stream. The render itself is delegated to the Anthropic `pdf` skill; `maya-packet-generator` owns the structured content + section ordering. Output passes through `maya-citation-firewall` before render.
- **Plan-tier:** Pro+ for the on-demand version. Starter only gets the quarterly auto-refresh (cron-driven).

### `maya-contract-redflag`

- **Status:** pending Sprint 3.5
- **One-liner:** PDF brand-deal contract scanner. Surfaces red flags across exclusivity, IP grants, payment terms, kill fees, term length, FTC compliance.
- **When to invoke:**
  - `playbook.md § Contract red-flag scan` — event-driven on PDF contract upload to the Deals screen.
- **Inputs:** Maya passes the uploaded contract PDF; the skill internally invokes the Anthropic `pdf` skill for parse, then runs its own analysis layer on the extracted text.
- **Outputs:** Maya gets back a red-flag report grouped by category — exclusivity scope + duration, IP grants + perpetuity, payment terms + net days, kill fees, term length + auto-renew, FTC compliance (disclosure language). Each flag cites the exact clause text. Output passes through `maya-citation-firewall` because clause citations must resolve to the actual PDF.
- **Plan-tier:** All tiers. Contract liability protection is a baseline feature.

### `maya-voice-applier`

- **Status:** pending Sprint 3.5
- **One-liner:** Apply the creator's voice fingerprint to any draft. Tone-adjusts text without changing facts.
- **When to invoke:**
  - **Used by every behavior that produces text Maya sends.** Morning brief, evening recap, weekly review, brand-email drafts, chat replies, content-plan idea cards, packet narrative — all pass through `maya-voice-applier` before send.
  - Especially important on outputs from `internal-comms` (which produces neutral prose) and `maya-brand-deal-triager` (which produces business-tone replies that must still sound like the creator).
- **Inputs:** Maya passes the draft text + the `voiceFingerprint` section of the creator's `soul.md`.
- **Outputs:** Maya gets back the tone-adjusted draft + a diff (so Maya can show the creator what was changed if asked, and so the citation firewall can verify no facts were altered in the voicing pass).
- **Plan-tier:** All tiers.

### `maya-content-arc-planner`

- **Status:** pending Sprint 3.5
- **One-liner:** Multi-day content arc generator — build-up posts, day-of capture, morning-after recap, evergreen variants. Produces per-platform variants of every post.
- **When to invoke:**
  - `playbook.md § Weekly content plan` — Sunday 4pm plan generation invokes this skill once per planned theme/event.
  - `playbook.md § Calendar-aware content planning` — when `maya-calendar-classifier` flags a relevant life event, this skill drops a content arc onto the plan around it.
- **Inputs:** Maya passes the seed event or theme, the creator picture (niche + voice + audience), the platform mix from `creatorHandles`.
- **Outputs:** Maya gets back a per-platform per-day post outline — hook, format ("TikTok carousel" vs "IG Reel" vs "YT Short"), script outline, caption draft, suggested posting time, reasoning. Then routed through `maya-platform-best-practice` for each variant and `maya-citation-firewall` before persistence.
- **Plan-tier:** All tiers. Starter is limited to single-platform variants (matches the 1-handle cap); Pro/Studio get full multi-platform arcs.

### `maya-brand-deal-triager`

- **Status:** pending Sprint 3.5
- **One-liner:** Inbound brand-email triage. Classifies the email, extracts the offer, drafts 4 reply variants tuned to the creator's floor rate.
- **When to invoke:**
  - `playbook.md § Brand email triage` — fired on Gmail webhook when a new email lands in the connected inbox.
- **Inputs:** Maya passes the parsed Gmail thread (delegating `.docx` brief parse to `docx` skill if needed, `pdf` parse if a contract is attached) + brand context (Apollo/Hunter lookup if Studio tier) + the creator's floor rate from `soul.md`.
- **Outputs:** Maya gets back: (1) classification (`real-deal` / `cold-pitch` / `spam` / `partnership`), (2) parsed offer (brand, deliverables, dollar amount, deadline), (3) four reply variants (accept / counter / clarify / decline) tuned to the creator's floor rate. Variants pass through `maya-rate-calculator` for grounding, `maya-voice-applier` for tone, `maya-citation-firewall` before send.
- **Plan-tier:** Pro+ only. Starter does not have Gmail in `allowedProviders` — there is no inbound to triage.

### `maya-platform-algo-researcher`

- **Status:** installed v0.1.0 (Sprint 3.5)
- **One-liner:** Actively researches each platform's current algorithm signals via web search. The analyst that keeps `maya-platform-best-practice` (the consultant) up to date.
- **When to invoke:**
  - `playbook.md § Platform algorithm research` — weekly cron (Pro), twice-weekly (Studio); on-demand from creator chat.
- **Inputs:** Maya passes platform + optional topic. Skill uses BRAVE_API_KEY-backed web search across an allowlist of creator-economy publications (Tubefilter, Variety Intelligence, Modern Retail, Passionfruit, ColinAndSamir, Hank Green, Marketing Brew, Adweek, Digiday, The Information, IPG creator economy reports).
- **Outputs:** Updated `platformAlgoCache` row (global by default; per-creator when query was creator-initiated) with fresh signals (signal/evidence/dateLearned), a `whatsHotNow` summary, a `whatsCoolingOff` summary, and the source URLs used.
- **Plan-tier:** Pro+ only. Studio gets fresher cache via the faster cron cadence.

### `maya-content-cross-poster`

- **Status:** installed v0.1.0 (Sprint 3.5)
- **One-liner:** Takes one approved piece of content + the creator's connected platforms, produces optimized variants per platform. Prepares variants; never auto-publishes.
- **When to invoke:**
  - `playbook.md § Cross-platform content distribution` — when the creator approves an arc-planner output, or when Maya proposes repurposing an existing post across more platforms.
- **Inputs:** Maya passes the source piece (caption + media + media type), creator's connected platforms, anchor platform (where it's already posted), and the creator picture for voice grounding.
- **Outputs:** Per-platform variants — TikTok 9:16 ≤60s; IG 9:16 Reel OR 4:5 carousel; YouTube 9:16 Shorts OR 16:9 long; LinkedIn native video square OR text post + thread; X 3–5 tweet thread w/ hook first. Each variant: caption rewrite (via `maya-voice-applier`), duration cut suggestion, aspect ratio guidance, hashtags, posting time local, optional one-tap deep link (with documented fallback when scheme unavailable).
- **Plan-tier:** All tiers. Starter limited to 1-platform variants by handle cap; Pro/Studio multi-platform.

### `maya-industry-intel`

- **Status:** installed v0.1.0 (Sprint 3.5)
- **One-liner:** Daily creator-economy news watcher. Surfaces relevant algo updates, platform feature launches, brand-deal market shifts to morning brief.
- **When to invoke:**
  - `playbook.md § Industry intel` — daily cron, folded into morning brief.
- **Inputs:** Maya passes creator context (niche + platforms). Skill queries the same allowlisted sources as `maya-platform-algo-researcher` plus deduplicates against `industryIntelSeen` (per-creator URL dedupe).
- **Outputs:** Items list `[{ headline, source, url, publishedAt, relevanceToCreator, relevanceScore }]` + a brief summary. Maya inlines into morning brief if relevance is high.
- **Plan-tier:** Pro+ only. Starter morning brief stays minimal.

### `maya-growth-coach`

- **Status:** installed v0.1.0 (Sprint 3.5)
- **One-liner:** Generates "do this next" tactical moves from performance data. Coaching, not analysis (that's recap) or planning (that's content-arc-planner).
- **When to invoke:**
  - `playbook.md § Growth coaching` — folded into morning brief recommendations + on-demand from creator chat.
- **Inputs:** Maya passes creator picture + recent metrics + soul goals + optional current struggle. Skill aggregates metrics (drops single-post buckets; anecdote ≠ pattern), then synthesizes via high-thinking model call.
- **Outputs:** `moves: [{ priority, move, evidence, expectedOutcome, timeframe }]` + `antiPatterns: string[]`. Every move cites specific posts/metrics/soul anchors via `maya-citation-firewall` round-trip.
- **Plan-tier:** Pro+ only. Starter gets evening recap which has lighter coaching baked in.

### `maya-underperformance-diagnoser`

- **Status:** pending Sprint 3.5c
- **One-liner:** Post-mortem on a bombed post. Mirror skill to `maya-hook-extractor` (which celebrates top-performers); this one diagnoses the floor — hook drift, off-peak posting, format mismatch, topic fatigue, audience drift, or recent platform-algo cooling.
- **When to invoke:**
  - `playbook.md § Evening recap` — when one or more posts published today underperformed vs trailing baseline, run on each before writing the recap.
  - `playbook.md § Free-form chat handling` — on-demand from creator chat ("why did [post] flop?").
- **Inputs:** Maya passes the post + its `postMetrics` time-series, the creator's trailing baseline (median / P25 / P75 / median engagement), `creatorPicture.bottomHooks` + `postingCadence` + `audience`, last-30-days `recentPosts`, and an optional `recentPlatformAlgoNotes` string from `platformAlgoCache.whatsCoolingOff`. Maya forms the causal judgment by reading the data; the script is LLM plumbing only (no deterministic heuristics).
- **Outputs:** `{ severity, diagnosis: { hookFromBottomList, offPeakPostingTime, formatMismatch, topicFatigue: { detected, similarPostsLast7d }, audienceMismatch, recentAlgoChangeImpact? }, primaryCause, secondaryCauses, recommendedNextMove, lessonForNextPost, citations }`. Persists to a NEW `postPostmortems` table (schema add flagged for the lead).
- **Plan-tier:** All tiers. Pro+ benefits from the richer hook-pattern field already populated in `posts.mayaAnnotation` by `maya-hook-extractor`; Starter falls back to the first line of the caption as the opener proxy.

### `maya-pre-post-scorer`

- **Status:** pending Sprint 3.5c
- **One-liner:** Predict draft performance BEFORE the creator hits publish. Scores against THIS creator's own history (topHooks/bottomHooks, format performance, posting-time fit, voice consistency, audience fit), returns predicted-tier + signal breakdown + prioritized recommendations + a `goNoGo` verdict. The "she's actually watching" moment.
- **When to invoke:**
  - `playbook.md § Pre-post review` (NEW) — chat-initiated ("Maya score this") or web-route-initiated (a future `/draft` page in Sprint 5+). Convex action wrapper at `convex/prePostReview.ts:scoreDraft` is the entry point.
- **Inputs:** Maya passes the draft (caption + hookCandidate + plannedFormat + plannedPlatform + plannedPostingTimeLocal + optional mediaPreview) + creatorPicture + last-30-days `recentPosts` + `hookLibrary` + optional pre-fetched note from `maya-platform-best-practice`. Maya scores by reading and judging; the script is LLM plumbing only.
- **Outputs:** `{ predictedPerformance: { tier, confidence }, signals: { hookMatchTopHooks, hookMatchBottomHooks, formatHistoricalPerformance, postingTimeFit, voiceConsistency, audienceFit }, recommendations: [{ priority, change, expectedImpact }], goNoGo: 'go'|'tweak-then-go'|'reconsider', citations }`. Read-only — does NOT persist.
- **Plan-tier:** All tiers. Foundational. Pro+ may pass `mediaPreview.videoUrl` for richer voice judgment; Starter falls back to caption-only.

---

## Third-party agent skills

Two vendor-supplied skills. These are not ClawHub random-author skills (none of those are installed in v0); these are first-party agent skills shipped by their providers and audited by us.

### `scrapecreators`

- **Source:** Vendor agent skill from ScrapeCreators. Manifest at `convex/integrations/scrapeCreators/agentSkill/manifest.json`. Install instructions at `convex/integrations/scrapeCreators/agentSkill/install.md`.
- **One-liner:** Read 27+ social platforms (TikTok, IG, YouTube, LinkedIn, X, Reddit, Pinterest, Threads, Facebook, Snapchat, Twitch, Kick, Truth Social, Bluesky, ad libraries, Linktree/Komi/Pillar). Primary read layer for Maya.
- **When to invoke:** Used by basically every behavior that touches creator data — onboarding bulk pull, post-publish reaction, 2h performance check, daily niche scan, competitor watch, hook library build, comment triage. Endpoint inventory documented in the manifest.
- **Inputs:** Per-endpoint contracts in the manifest. Common: handle + platform; sometimes hashtag, search query, or post URL.
- **Outputs:** Per-endpoint structured JSON — profile, posts list, post metrics, comments, audience demographics, transcripts, hashtag trending, ad library results.
- **Plan-tier:** All tiers. Starter capped at 1 platform handle; Pro 3; Studio 5. Plan-tier cap is enforced server-side via `creatorHandles` row count + `planFeatures(creator).maxHandles`.

### `composio`

- **Source:** Composio v3 universal action runner. Per-creator credentials live in the `connectedAccounts` table, decrypted at config-generation time by `configGeneratorMaya.ts`.
- **One-liner:** Universal write layer for Gmail / Stripe / Calendar / Apollo / Hunter. One runner, many providers, per-creator OAuth.
- **When to invoke:**
  - Gmail: send brand-deal replies (subject to auto-send threshold), poll for new inbound.
  - Stripe: read revenue snapshots (Stripe is data-only in Maya — she doesn't write to Stripe).
  - Calendar: read events 1–14 days out (Pro+, feeds `maya-calendar-classifier`).
  - Apollo / Hunter: brand contact lookup (Studio only, for outbound brand outreach).
- **Inputs:** Maya passes the provider + action name + per-action arguments. The runner negotiates the OAuth + executes.
- **Outputs:** Per-action structured response. Errors return structured failure (Maya must degrade gracefully on Gmail OAuth revoked, Calendar API outage, etc).
- **Plan-tier:** Per-provider gating via `planFeatures(creator).allowedProviders`. Starter: Stripe-only. Pro: Stripe + Gmail + Calendar. Studio: + Apollo + Hunter.

---

## Skills explicitly NOT installed

We considered and rejected every third-party ClawHub skill in the creator-economy adjacency. The audit trail is captured in `project_skill_strategy.md` (operator memory, locked 2026-04-26). The list of skills we evaluated and declined:

- `social-media-scheduler` (1kalin, ~11k installs, MIT-0) — content calendar + drafting, no posting. Overlaps `maya-content-arc-planner`.
- `content-brainstorm` — 7-day topic plans with SEO + trend scores. Overlaps `maya-content-arc-planner`.
- `creator-deal-ops` — sponsorship workflow brief→delivery→payment. Overlaps `maya-brand-deal-triager`.
- `ugc-hook-analyzer` — TT/Reels/Shorts hook retention. Overlaps `maya-hook-extractor`.
- `tiktok-analytics`, `instagram-analytics`, `youtube-analytics-cli` — per-platform performance. ScrapeCreators covers reads; analysis layer is `maya-platform-best-practice`.
- `gws-gmail`, `gmail-secretary`, `email-daily-summary` — email triage variants. Overlaps `maya-brand-deal-triager`.
- `afrexai-contract-review`, `contract-reviewer` — contract analysis. Overlaps `maya-contract-redflag`.
- `fact-check`, `verify-claims` — fact verification. Overlaps `maya-citation-firewall`.

**Why declined:**

1. **Voice consistency.** Third-party skills carry generic instruction tone. Maya's anti-sycophancy + grounded-or-silent + tone-tunable voice only survives if the skills bake it in.
2. **Schema integration.** Maya's outputs write to our Convex tables (`brandDeals`, `hookLibrary`, `contentPlans`, `creatorPicture`). Third-party skills don't know our schema.
3. **Citation firewall enforcement.** Every Maya skill output must flow through `maya-citation-firewall`. Third-party skills bypass this gate.
4. **Plan-tier gating.** Custom skills natively call `planFeatures(creator)`. Third-party skills don't know about our plans.

We re-evaluate the no-third-party-ClawHub stance only post-beta if a specific third-party skill is so dominant that NOT installing it leaves real margin or quality on the table. The bar is high.

---

## Sibling-file scan

The Sprint 3 acceptance gate asserts: every skill listed here is referenced by at least one section of `playbook.md`, AND every skill referenced in `playbook.md` is listed here. The mapping below is the ground truth for that scan.

| Skill | Playbook sections that invoke it |
|---|---|
| `pdf` (Anthropic) | § Contract red-flag scan, § Manager-readiness packet, § Brand email triage (PDF attachments) |
| `docx` (Anthropic) | § Brand email triage (.docx attachments) |
| `internal-comms` (Anthropic) | § Weekly review, § Manager-readiness packet |
| `skill-creator` (Anthropic) | (Meta — not invoked by playbook directly; used by operator + by Maya in beta to author new skills) |
| `maya-rate-calculator` | § Brand email triage, § Rate suggestion |
| `maya-hook-extractor` | § Hook library auto-build, § Post-publish reaction |
| `maya-platform-best-practice` | § Platform expertise, § Weekly content plan, § Post-publish reaction (cross-platform variants) |
| `maya-calendar-classifier` | § Calendar-aware content planning |
| `maya-citation-firewall` | All sections (mandatory pre-send gate on every output with claims) |
| `maya-packet-generator` | § Manager-readiness packet |
| `maya-contract-redflag` | § Contract red-flag scan |
| `maya-voice-applier` | All sections that produce text Maya sends (§ Morning brief, § Evening recap, § Weekly review, § Brand email triage, § Free-form chat handling, § Weekly content plan, § Accountability nudge, etc.) |
| `maya-content-arc-planner` | § Weekly content plan, § Calendar-aware content planning |
| `maya-brand-deal-triager` | § Brand email triage |
| `maya-platform-algo-researcher` | § Platform algorithm research (cron-driven), § Morning brief (folds in cache via best-practice consultant) |
| `maya-content-cross-poster` | § Cross-platform content distribution, § Weekly content plan (multi-platform variants) |
| `maya-industry-intel` | § Industry intel (cron-driven), § Morning brief (relevant items inlined) |
| `maya-growth-coach` | § Growth coaching (folded into morning brief recommendations + on-demand from chat) |
| `maya-underperformance-diagnoser` | § Evening recap (per-underperformer post-mortem), § Free-form chat handling (on-demand "why did [post] flop?") |
| `maya-pre-post-scorer` | § Pre-post review (chat-initiated "Maya score this" + future `/draft` route) |
| `scrapecreators` | § Morning brief, § Post-publish reaction, § 2h performance check, § Daily niche scan, § Trend watcher, § Competitor watch, § Hook library auto-build, § Comment triage, § Revenue snapshot (cross-reference for follower deltas) |
| `composio` | § Brand email triage (Gmail), § Revenue snapshot (Stripe), § Calendar-aware content planning (Calendar), § Auto-send escalation (Gmail), § Brand outreach (Apollo/Hunter, Studio) |

If a future playbook section references a skill not listed in this file, the sibling-file scan fails and the sprint is not done. If a future skill is added here without a playbook reference, same fail. Both directions enforced.
