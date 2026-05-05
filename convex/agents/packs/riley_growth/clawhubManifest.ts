/**
 * ClawHub baseline skills — installed in Builder Maya at deploy.
 *
 * Mirror of `convex/agents/packs/maya_service/clawhubManifest.ts`. Single-user
 * product, so simpler — no per-tenant divergence to worry about; Builder
 * Maya always gets this exact bundle.
 *
 * Selection method: live ClawHub browse + SKILL.md reads (operator-curated
 * 2026-04-29). The list is intentionally tight — ClawHub fills mechanics
 * gaps where there's no Composio / Unipile / OpenClaw-native equivalent.
 *
 * Auth model — IMPORTANT.
 *   `arun-8687/linkedin-cli` and `chuhuilove/bird-twitter` use **session
 *   cookies on the operator's primary accounts**, not OAuth. The operator
 *   extracts them from browser DevTools and we set them as Fly secrets. This is a
 *   carve-out from the original safety rule #3 ("never use a headless browser
 *   logged into the same session as the operator's daily LinkedIn") — CLI cookie
 *   reads are a different risk profile than full browser automation, and the
 *   preferred path is Composio managed OAuth; cookie skills are fallback.
 *   If a cookie gets invalidated, Maya asks the operator to re-paste it.
 *
 *   See `docs/RILEY_GROWTH_PLAN.md` § Locked safety rules for the full carve-out.
 */

export interface ClawHubBaselineSkill {
  /** Full ClawHub skill ID — `<author>/<skill-name>`. */
  id: string;
  /** Pinned version — TBD on first deploy. Treat any auto-upgrade as a bug. */
  version: string;
  /** Why we install it. Audit-friendly. */
  purpose: string;
  /** Required env vars (must be set as Fly secrets in deployRiley). */
  requiredEnvVars: ReadonlyArray<string>;
  /** Auth model — informational. */
  authMethod: "cookie" | "api-key" | "oauth" | "none";
}

export const CLAWHUB_BASELINE_SKILLS: ReadonlyArray<ClawHubBaselineSkill> = [
  {
    id: "arun-8687/linkedin-cli",
    version: "1.0.0",
    purpose:
      "LinkedIn read surface — whoami / search / profile / feed / messages. " +
      "Powers outreach-list build, engagement watch, and DM-inbox reads " +
      "without needing Unipile in v0. Read-only; posting stays manual " +
      "(operator copy/pastes per locked safety rule #1).",
    requiredEnvVars: ["LINKEDIN_LI_AT", "LINKEDIN_JSESSIONID"],
    authMethod: "cookie",
  },
  {
    id: "chuhuilove/bird-twitter",
    version: "1.0.0",
    purpose:
      "X / Twitter fallback surface — post / reply / read / search / trending / " +
      "follow / lists when Composio is unavailable.",
    requiredEnvVars: ["AUTH_TOKEN", "CT0"],
    authMethod: "cookie",
  },
  {
    id: "1kalin/linkedin-writer",
    version: "1.0.0",
    purpose:
      "LinkedIn voice templates (5 post formats, 7 hook formulas, " +
      "no-buzzword rules) as starting scaffolding. Operator-approved " +
      "2026-04-29: memory-wiki refines toward the operator's actual voice over " +
      "time as they edit / reject drafts. Templates are the floor, not " +
      "the ceiling.",
    requiredEnvVars: [],
    authMethod: "none",
  },
  {
    id: "steipete/brave-search",
    version: "1.0.0",
    purpose:
      "Web search + URL-to-markdown content extraction via official Brave " +
      "Search API (no HTML scraping). Powers trend research and market " +
      "context. Maya also has OpenClaw native web_search as a fallback, " +
      "but this skill's `search.js` + `content.js` are purpose-built for " +
      "the research workflow.",
    requiredEnvVars: ["BRAVE_API_KEY"],
    authMethod: "api-key",
  },
] as const;

export const CLAWHUB_REGISTRY_URL = "https://clawhub.ai" as const;
