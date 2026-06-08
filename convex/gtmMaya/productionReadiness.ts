import { query } from "../_generated/server";

/**
 * Sprint 22 — production readiness check.
 *
 * Single Convex query the operator can call (from the mission board or
 * a smoke script) to verify the GTM stack's required environment is
 * present. Per-feature ready/not-ready breakdown so the operator can
 * see which paths will work today and which need env config.
 *
 * No secrets returned — only presence flags. The full operator
 * checklist is the union of every feature's `requiredEnv`.
 */

interface FeatureCheck {
  feature: string;
  ready: boolean;
  requiredEnv: string[];
  missingEnv: string[];
  note?: string;
}

interface ReadinessReport {
  /** True iff every feature with ready=false is intentionally optional. */
  productionReady: boolean;
  features: FeatureCheck[];
  /** Union of all missing env vars; what the operator should set first. */
  missingEnvSummary: string[];
  /** Sprint 22 metadata. */
  generatedAt: number;
  convexSiteUrl?: string;
}

function present(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.length > 0;
}

function presentOf(...names: string[]): boolean {
  return names.every(present);
}

function missingOf(...names: string[]): string[] {
  return names.filter((n) => !present(n));
}

export const getProductionReadinessReport = query({
  args: {},
  handler: async (): Promise<ReadinessReport> => {
    const features: FeatureCheck[] = [];

    // S2 + S1 + S4 — real research via ScrapeCreators.
    features.push({
      feature: "real_research",
      ready: present("SCRAPE_CREATORS_API_KEY"),
      requiredEnv: ["SCRAPE_CREATORS_API_KEY"],
      missingEnv: missingOf("SCRAPE_CREATORS_API_KEY"),
      note: "Required for the Sprint 1 orchestrator to actually call platforms. Without it, runBudgetedResearchJob returns failed.",
    });

    // S9 — Google Calendar.
    features.push({
      feature: "calendar_oauth_write",
      ready: presentOf(
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "ENCRYPTION_KEY"
      ),
      requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ENCRYPTION_KEY"],
      missingEnv: missingOf(
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "ENCRYPTION_KEY"
      ),
      note: "Reuse the same OAuth client as creator product. ENCRYPTION_KEY must decode to 32 bytes base64.",
    });

    // S15 + S10 — Telegram pairing + handoff.
    features.push({
      feature: "telegram_channel",
      ready: presentOf("TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME"),
      requiredEnv: [
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_BOT_USERNAME",
        "TELEGRAM_WEBHOOK_SECRET",
      ],
      missingEnv: missingOf(
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_BOT_USERNAME",
        "TELEGRAM_WEBHOOK_SECRET"
      ),
      note: "Bot provisioned via @BotFather. Webhook secret is any 32+ char random string.",
    });

    // S2.5 / S4 — embeddings for memory_search (Gemini).
    features.push({
      feature: "memory_search_embeddings",
      ready:
        present("GEMINI_API_KEY") ||
        present("GOOGLE_GENERATIVE_AI_API_KEY"),
      requiredEnv: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
      missingEnv: present("GEMINI_API_KEY")
        ? []
        : present("GOOGLE_GENERATIVE_AI_API_KEY")
          ? []
          : ["GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY)"],
      note: "Either env var works. If neither set, memory_search vector index is disabled (memory still works as markdown).",
    });

    // S17 — search-x ClawHub skill (optional — only needed if Maya
    // invokes the search-x skill specifically).
    features.push({
      feature: "search_x_skill (optional)",
      ready: present("XAI_API_KEY"),
      requiredEnv: ["XAI_API_KEY"],
      missingEnv: missingOf("XAI_API_KEY"),
      note: "Only needed for the search-x ClawHub skill (mvanhorn/search-x). All other X research uses ScrapeCreators.",
    });

    // S13 — image bump target (operator's call).
    features.push({
      feature: "openclaw_image_target",
      ready: present("MAYA_GTM_OPENCLAW_IMAGE") || present("MAYA_OPENCLAW_IMAGE"),
      requiredEnv: ["MAYA_GTM_OPENCLAW_IMAGE"],
      missingEnv: present("MAYA_GTM_OPENCLAW_IMAGE")
        ? []
        : present("MAYA_OPENCLAW_IMAGE")
          ? []
          : ["MAYA_GTM_OPENCLAW_IMAGE (optional — defaults to pinned v2026.4.23)"],
      note: "Optional override. Default pins to v2026.4.23. Set to v2026.5.20 once doctor + audit confirm OK on a throwaway Fly app (Sprint 13 L6 step).",
    });

    // S16 — Convex hook bridge requires CONVEX_SITE_URL for callbacks.
    features.push({
      feature: "hook_bridge_callbacks",
      ready:
        present("CONVEX_SITE_URL") || present("NEXT_PUBLIC_CONVEX_SITE_URL"),
      requiredEnv: ["CONVEX_SITE_URL"],
      missingEnv: present("CONVEX_SITE_URL")
        ? []
        : present("NEXT_PUBLIC_CONVEX_SITE_URL")
          ? []
          : ["CONVEX_SITE_URL (or NEXT_PUBLIC_CONVEX_SITE_URL)"],
      note: "Required so workspace generator can template the /lc_gtm/* callback URLs into TOOLS.md (Sprint 16).",
    });

    // S22 — admin token (gate on adminSetSafetyState etc.).
    features.push({
      feature: "admin_kill_switch (optional)",
      ready: present("GTM_COST_CAP_OVERRIDE")
        ? true // overridden means operator has bypass active
        : true, // not a hard requirement; gates open by default
      requiredEnv: [],
      missingEnv: [],
      note: present("GTM_COST_CAP_OVERRIDE")
        ? `ACTIVE OVERRIDE: ${process.env.GTM_COST_CAP_OVERRIDE?.slice(0, 80) ?? "(empty)"} — cost cap BYPASSED`
        : "No override active (default).",
    });

    // Fly deploy
    features.push({
      feature: "fly_deploy",
      ready: presentOf("FLY_API_TOKEN", "FLY_ORG_SLUG"),
      requiredEnv: ["FLY_API_TOKEN", "FLY_ORG_SLUG"],
      missingEnv: missingOf("FLY_API_TOKEN", "FLY_ORG_SLUG"),
      note: "Required for runMyGtmDeploy to provision per-creator Fly machines.",
    });

    const missing = new Set<string>();
    for (const f of features) {
      for (const m of f.missingEnv) missing.add(m);
    }
    const productionReady = features.every((f) => f.ready);

    return {
      productionReady,
      features,
      missingEnvSummary: [...missing].sort(),
      generatedAt: Date.now(),
      convexSiteUrl: process.env.CONVEX_SITE_URL,
    };
  },
});
