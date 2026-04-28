/**
 * ClawHub baseline skills — installed in every Maya at deploy.
 *
 * Per the operator-stated rule (2026-04-27): every Maya gets the SAME
 * curated skill bundle at deploy time; no per-business divergence; no
 * runtime skill installation. OpenClaw's runtime downloads these from
 * ClawHub on first boot using the IDs below. We do NOT vendor any
 * skill source files on disk — that was the Wave C.6 ffmpeg vendor
 * mistake that the operator's third correction this day reversed.
 *
 * The v0 baseline list is intentionally TINY (2 skills). The 18 custom
 * `maya-service-*` skills are the operational behavior layer; ClawHub
 * skills only fill in pure-mechanics gaps where:
 *   1. The capability is universal-utility (no Maya-specific judgment),
 *   2. A high-quality ClawHub skill exists with clear license + recent
 *      activity + cloud-rendered output (no Fly install dep),
 *   3. The basic-UI rule (`feedback_basic_ui_for_home_service.md`) is
 *      respected — no slide decks, no spreadsheet exports, no fancy data
 *      viz tooling beyond what's already in our HQ.
 *
 * Source curation pass: see `docs/spikes/clawhub-baseline-curation.md`.
 *
 * Operator-blocked items the manifest assumes:
 *   - NemoVideo anonymous tier (100 free credits / 7d) OR registered
 *     account if we want sustained throughput. Tracked separately as a
 *     Tier-3 unblock — see beta-cohort-recruitment.md.
 *
 * What we DON'T install — and why (audit trail):
 *   - **OCR skill** (DeepRead and similar): considered for receipts /
 *     invoices in operator job photos. Rejected 2026-04-27 — DeepRead
 *     is an unfunded 9-year-old single-team product (deepread.tech),
 *     no review signal. Asset-cataloger uses Gemini multimodal via
 *     OpenRouter directly for any OCR need. We already pay for that;
 *     no new vendor, no new env var, no operator data flowing to a
 *     thinly-resourced shop. Cost difference is negligible at v0
 *     scale (most operator photos are job-site visuals, not receipts).
 */

export interface ClawHubBaselineSkill {
  /** Full ClawHub skill ID — `<author>/<skill-name>`. */
  id: string;
  /** Pinned version — TBD on first deploy. Treat any auto-upgrade as a bug. */
  version: string;
  /** Why we install it. Audit-friendly, surfaced in operator support flows. */
  purpose: string;
  /** Which custom maya-service-* skill(s) delegate to it. */
  delegatedFrom: ReadonlyArray<string>;
  /** Required env vars for the skill to function. */
  requiredEnvVars: ReadonlyArray<string>;
  /** Free-tier shape — surfaced in operator-action docs. */
  freeTier: string;
}

export const CLAWHUB_BASELINE_SKILLS: ReadonlyArray<ClawHubBaselineSkill> = [
  {
    id: "vcarolxhberger/free-video-generator-capcut",
    version: "1.0.0",
    purpose:
      "Cloud video composition for Reels / TikTok / YouTube Shorts. Takes operator's clips + caption + target platform → returns 1080p MP4 download URL. Cloud-rendered (no Fly compute, no ffmpeg install dep). Backend: NemoVideo at mega-api-prod.nemovideo.ai.",
    delegatedFrom: ["maya-service-clip-composer"],
    requiredEnvVars: [],
    freeTier:
      "100 anonymous credits / 7 days; register for more. Studio-tier feature gate (planFeaturesService.mayaVideoEditing).",
  },
] as const;

export const CLAWHUB_REGISTRY_URL = "https://clawhub.ai" as const;
