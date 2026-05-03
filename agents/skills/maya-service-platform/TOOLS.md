# TOOLS.md — shared service-platform template

Per-business TOOLS.md is rendered by `convex/agents/packs/maya-service/generateTools.ts`. The generator filters the static `TOOL_REGISTRY` by `plan` and emits a tier-aware tool list.

This file is guidance only — it does not control tool availability. Tool availability is set by the OpenClaw runtime config + the skill loader picking up `skills/<slug>/SKILL.md` packages, with plan-tier gates enforced server-side via `planFeaturesService(business)` (fail-closed).

## Tool surfaces (full list across all tiers)

### 1. Convex HTTP endpoints (`lc_maya_service.*`)

Maya's read/write surface for all per-business data. Examples:

- `lc_maya_service.read_jobs` — read `serviceJobs` for a business + date range.
- `lc_maya_service.read_reviews` — read `reviews` (optionally filtered to unreplied).
- `lc_maya_service.write_review_request` — create/update `reviewRequests` row, idempotent on `(jobId, kind)`.
- `lc_maya_service.write_gbp_draft` — persist a GBP post draft with `status='pending_approval'`.
- `lc_maya_service.write_review_draft` — persist `reviews.draftReply`. Never auto-publishes.
- `lc_maya_service.read_media_assets` — read `mediaAssets` for repurposing + content rejuvenation.
- `lc_maya_service.write_media_catalog` — write `mediaAssets.catalog` after `maya-service-asset-cataloger` run.
- `lc_maya_service.write_packet` — persist `packetGenerations` row + PDF storage URL (Studio).
- `lc_maya_service.read_revenue` — pull CRM jobs.completed + invoices.paid for revenue snapshot (Pro+).
- `lc_maya_service.health_zernio` / `health_crm` / `connected_accounts_health` — reachability probes for BOOT.md.

### 2. Zernio MCP (multi-platform social + GBP)

- `zernio.gbp.local_post.create` — GBP local post with scrollable photo carousel.
- `zernio.gbp.review.reply` — GBP review reply (operator approval required at all tiers, locked).
- `zernio.facebook.post.create` — Facebook post (Pro+).
- `zernio.instagram.post.create` — Instagram post (Pro+).
- `zernio.tiktok.post.create` — TikTok video (Studio).

### 3. Composio universal runner

- `composio.gmail.messages.send` — operator's Gmail (Pro+, citation firewall + brand voice required).
- `composio.gmail.messages.list` — brand-email triage cycle (Pro+).
- `composio.calendar.events.list` — daily 1-14 day lookahead (Pro+).

### 4. Twilio (SMS + outbound voice)

- `twilio.sms.send` — outbound SMS, rate-limited 4 unsolicited/day max.
- `twilio.voice.outbound` — outbound notification call (Studio).

### 5. ElevenLabs Agents (inbound voice — Studio only)

- `elevenlabs.agent.handoff` — Maya is the custom-LLM endpoint; `thinkingBudget=0` forced.

### 6. CRM adapter (Nango-mediated, Pro+ only)

- `crm.jobs.read` / `crm.invoices.read` / `crm.customers.read` — normalized across Jobber / HCP / QBO / ServiceTitan.

### 7. Media pipeline

- `media.r2.upload` — R2 attachment bridge for inbound photos/videos.
- `media.gemini.files.process` — multimodal vision (cataloging, photo curation).
- `media.ffmpeg.edit` — IG Reels + TikTok video editing pipeline (Studio).

## What this file is NOT

- Not a tool registry. The skill loader is.
- Not a permissions document. `planFeaturesService(business)` is the source of truth, server-side, fail-closed.
- Not exhaustive. Surface evolves; canonical lives in `convex/http.ts` (endpoints), Zernio MCP manifest, Composio v3 docs, Nango connector specs.
