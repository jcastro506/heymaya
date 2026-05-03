/**
 * Anthropic public skills baseline — installed in every Maya at deploy.
 *
 * Per the operator-stated rule (2026-04-27): every Maya gets the SAME
 * curated skill bundle at deploy time; no per-business divergence; no
 * runtime skill installation.
 *
 * These skills come from `github.com/anthropics/skills` — MIT-licensed,
 * universally-utility shape. OpenClaw's runtime downloads them on first
 * boot using the IDs below. We do NOT vendor them on disk.
 *
 * Per `feedback_install_first_not_build.md`: install via OpenClaw's
 * runtime download, never vendor source files. Per
 * `project_skill_strategy.md`: Anthropic-public + custom-Maya only;
 * `pptx` and `xlsx` were considered and rejected per the basic-UI rule
 * (`feedback_basic_ui_for_home_service.md`).
 *
 * The fifth Anthropic skill (`skill-creator`) is dev-time-only — used by
 * us when authoring custom Maya skills, NOT shipped in the per-business
 * workspace bundle. It is intentionally NOT in this list.
 */

export interface AnthropicBaselineSkill {
  /** Skill folder name in `github.com/anthropics/skills/skills/<name>` */
  id: string;
  /** Pinned commit / tag — TBD when we lock the repo ref. */
  version: string;
  /** Why we install it. Audit-friendly, surfaced in operator support flows. */
  purpose: string;
  /** Which custom maya-service-* skill(s) delegate to it. */
  delegatedFrom: ReadonlyArray<string>;
}

export const ANTHROPIC_BASELINE_SKILLS: ReadonlyArray<AnthropicBaselineSkill> =
  [
    {
      id: "pdf",
      version: "main", // pin to a stable tag once Anthropic publishes one
      purpose: "PDF parse + render for contract review and packet generation",
      delegatedFrom: [
        "maya-service-contract-redflag",
        "maya-service-packet-generator",
      ],
    },
    {
      id: "docx",
      version: "main",
      purpose: "docx parse for occasional brand briefs / vendor contracts",
      delegatedFrom: ["maya-service-contract-redflag"],
    },
    {
      id: "internal-comms",
      version: "main",
      purpose:
        "Long-form prose tone for weekly summaries and packet narrative",
      delegatedFrom: ["maya-service-packet-generator"],
    },
  ] as const;

export const ANTHROPIC_SKILLS_REPO = "https://github.com/anthropics/skills" as const;
