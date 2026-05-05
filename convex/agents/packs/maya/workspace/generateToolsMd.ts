/**
 * generateToolsMd — shared TOOLS.md for every Maya workspace.
 *
 * Sprint 3.7 phase A. Per OpenClaw spec
 * (`https://docs.openclaw.ai/concepts/agent-workspace.md`), TOOLS.md is
 * "guidance only — does not control tool availability." Tool availability
 * is controlled by the OpenClaw runtime config + the skill loader picking
 * up `skills/<slug>/SKILL.md` packages from the workspace.
 *
 * This file documents three surfaces Maya talks to:
 *   1. Our `lc_maya_*` HTTP endpoints (the Convex HTTP action surface).
 *   2. The ScrapeCreators agent skill (read 27+ social platforms).
 *   3. The Composio universal runner (Gmail / Stripe / Calendar / Apollo / Hunter / LinkedIn / X).
 *
 * Same content for every creator — no per-creator parameterization. Pure
 * function so the call signature mirrors the other generators.
 */

export function generateToolsMd(): string {
  return [
    "# TOOLS.md",
    "",
    "Documentation of the three external surfaces Maya talks to. **This file is guidance only — it does not control tool availability.** Tool availability is set by the OpenClaw runtime config + the skill loader discovering `skills/<slug>/SKILL.md` packages in the workspace.",
    "",
    "## 1. Convex HTTP endpoints (`lc_maya_*`)",
    "",
    "Maya calls our Convex HTTP action surface for every read/write against creator data. Endpoints are Clerk-authenticated and plan-tier gated server-side; failed-closed on every gated entry point.",
    "",
    "| Method | Path | When to use |",
    "|---|---|---|",
    "| POST | `/lc_maya/submit_opening_answers` | First-boot only. POST the 3 parsed opening answers (`goal`, `tone`, `brandDealFloorUsd?`) so they land on `creatorPicture.openingAnswers` and stamp `creators.openingAnswersAt`. Webhook-secret-gated. |",
    "| POST | `/lc_maya/start_oauth` | Generate a hosted Composio OAuth deep-link for `gmail` / `calendar` / `linkedin` / `twitter`. Returns `{ redirectUrl, state }` — text the URL to the user. Creator TikTok uses ScrapeCreators public data, not Composio OAuth. Plan-tier gated server-side; webhook-secret-gated. |",
    "| POST | `lc_maya.save_brief` | Persist morning / evening brief markdown + recommendations + cited evidence. |",
    "| POST | `lc_maya.save_hook` | Append to `hookLibrary` after `maya-hook-extractor` returns a novel pattern. |",
    "| POST | `lc_maya.save_plan` | Persist Sunday weekly content plan to `contentPlans`. |",
    "| POST | `lc_maya.save_drafts` | Persist 4 brand-email reply variants to `brandDeals.replyVariants`. |",
    "| POST | `lc_maya.create_deal` | Create a fresh `brandDeals` row from a brand-email triage. |",
    "| POST | `lc_maya.log_trend` | Append a `trendObservations` row from daily niche scan or trend watcher. |",
    "| POST | `lc_maya.log_competitor_observation` | Append a `competitorObservations` row from competitor watch. |",
    "| POST | `lc_maya.log_comment_triage` | Append `commentTriage` rows from the 11am/5pm sweep. |",
    "| GET  | `lc_maya.metrics_window` | Pull post metrics deltas in a time window for the 2h performance check. |",
    "| GET  | `lc_maya.get_commitments` | Read open `commitments` rows for accountability nudge. |",
    "| GET  | `lc_maya.connected_accounts_health` | Verify Composio account scopes are still active (used in BOOT.md). |",
    "| GET  | `lc_maya.health_scrapecreators` | ScrapeCreators reachability probe (used in BOOT.md). |",
    "| POST | `lc_maya.score_draft` | Wrap `maya-pre-post-scorer` for chat-initiated 'Maya score this' flows. |",
    "",
    "Endpoint surface evolves with sprints — the canonical inventory is in `convex/http.ts`. If a name in this table drifts from `convex/http.ts`, the Convex side wins and this file is stale.",
    "",
    "## 2. ScrapeCreators agent skill",
    "",
    "Read layer for 27+ social platforms — TikTok, Instagram, YouTube, LinkedIn, X, Threads, Reddit, Pinterest, Facebook, Snapchat, Twitch, Kick, Truth Social, Bluesky, plus ad libraries (Meta, TikTok) and link aggregators (Linktree, Komi, Pillar).",
    "",
    "The skill is loaded into the workspace at deploy as `skills/scrapecreators-api/SKILL.md` (the official package from `github.com/scrapecreators/agent-skills`). It documents 110 endpoints across all 27+ platforms with intent-routing tables. The skill's frontmatter declares the env requirement (`SCRAPE_CREATORS_API_KEY`) and OpenClaw metadata; the loader auto-discovers it under the workspace `skills/` tree.",
    "",
    "Common invocations:",
    "",
    "- **Profile pull** — handle + platform → profile metadata (follower count, bio, verified badge, link-in-bio).",
    "- **Posts list** — handle + platform + window → ordered list of posts with captions + thumbnails + metrics.",
    "- **Post metrics** — post URL or platform post id → current view / like / comment / share / save counts.",
    "- **Comments** — post URL or id → comments list with author handle + text + timestamp + engagement.",
    "- **Trending hashtags / sounds / formats** — platform + niche keyword → ranked trending list.",
    "- **Audience demographics** — handle + platform → age ranges + gender split + top geos + interest tags (where the platform exposes it).",
    "",
    "Rate limits: per the ScrapeCreators Freelance tier ($47/mo). The cache layer (`scrapeCreatorsCache` in Convex) shields repeat calls; do not bypass it.",
    "",
    "## 3. Composio universal runner",
    "",
    "Write layer for OAuth-protected vendor APIs. One runner, many providers, per-creator credentials in `connectedAccounts` (decrypted at config-generation time).",
    "",
    "Per-provider availability is plan-gated by `planFeatures(creator).allowedProviders`:",
    "",
    "- **Starter:** `stripe` only (Stripe is data-only — Maya reads, never writes).",
    "- **Pro:** `gmail`, `stripe`, `calendar`.",
    "- **Manager:** Pro plus `apollo`, `hunter`, `linkedin`, `twitter` for brand contact discovery and Builder distribution.",
    "",
    "Common per-provider actions:",
    "",
    "- **Gmail** — `messages.send` (subject to `autoSendThreshold` + citation firewall + voice applier), `messages.list` for the brand-email inbound sweep, `threads.get` for thread reconstruction.",
    "- **Stripe** — `charges.list` and `subscriptions.list` for revenue snapshot. Read-only — Maya never writes to Stripe.",
    "- **Calendar** — `events.list` for the daily 1-14 day lookahead. Privacy: drop private events 24h after they pass; never read attendee email addresses.",
    "- **Apollo / Hunter** — `people.search` and `email.find` for outbound brand-pitch contact discovery (Studio only).",
    "",
    "Failure modes (OAuth revoke, rate limit, transport error) are documented in `AGENTS.md` § Failure modes — Maya degrades with a creator-facing message rather than retrying silently.",
    "",
    "## What this file is NOT",
    "",
    "- Not a tool registry. The skill loader is. This file is for human (and Maya's) reading comprehension.",
    "- Not a permissions document. Plan-tier gating is enforced server-side in `convex/lib/planFeatures.ts`. Maya cannot self-bypass via tool calls.",
    "- Not exhaustive. Surface evolves; canonical lives in `convex/http.ts` (endpoints), the ScrapeCreators manifest, and the Composio v3 docs.",
    "",
  ].join("\n");
}
