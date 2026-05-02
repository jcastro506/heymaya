/**
 * ClawHub baseline skills — installed in Riley at deploy.
 *
 * Mirror of `convex/agents/packs/maya_service/clawhubManifest.ts`. Single-user
 * product (Josh personally), so simpler — no per-tenant divergence to worry
 * about; Riley always gets this exact bundle.
 *
 * Selection method: live ClawHub browse + SKILL.md reads (operator-curated
 * 2026-04-29). The list is intentionally tight — ClawHub fills mechanics
 * gaps where there's no Composio / Unipile / OpenClaw-native equivalent.
 *
 * Auth model — IMPORTANT.
 *   `arun-8687/linkedin-cli` and `chuhuilove/bird-twitter` use **session
 *   cookies on Josh's primary accounts**, not OAuth. Josh extracts them once
 *   from his browser DevTools and we set them as Fly secrets. This is a
 *   carve-out from the original safety rule #3 ("never use a headless browser
 *   logged into the same session as Josh's daily LinkedIn") — CLI cookie
 *   reads are a different risk profile than full browser automation, and the
 *   alternative (Composio managed-OAuth + X dev account + $10 top-up +
 *   Unipile $59-99/mo) was a worse v0 trade. If a cookie gets invalidated,
 *   Riley pings Josh to re-paste it.
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
      "(Josh copy/pastes per locked safety rule #1).",
    requiredEnvVars: ["LINKEDIN_LI_AT", "LINKEDIN_JSESSIONID"],
    authMethod: "cookie",
  },
  {
    id: "chuhuilove/bird-twitter",
    version: "1.0.0",
    purpose:
      "X / Twitter full surface — post / reply / read / search / trending / " +
      "follow / lists. Cookie-auth replaces Composio Twitter wrappers and " +
      "drops the operator-blocked X dev-account + $10 credits step.",
    requiredEnvVars: ["AUTH_TOKEN", "CT0"],
    authMethod: "cookie",
  },
  {
    id: "1kalin/linkedin-writer",
    version: "1.0.0",
    purpose:
      "LinkedIn voice templates (5 post formats, 7 hook formulas, " +
      "no-buzzword rules) as starting scaffolding. Operator-approved " +
      "2026-04-29: memory-wiki refines toward Josh's actual voice over " +
      "time as he edits / rejects drafts. Templates are the floor, not " +
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
      "context. Riley also has OpenClaw native web_search as a fallback, " +
      "but this skill's `search.js` + `content.js` are purpose-built for " +
      "the research workflow.",
    requiredEnvVars: ["BRAVE_API_KEY"],
    authMethod: "api-key",
  },
] as const;

export const CLAWHUB_REGISTRY_URL = "https://clawhub.ai" as const;
