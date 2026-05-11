/**
 * Sprint 12.7 Phase 3 — sibling-file scan for the trend-grounding rule set.
 *
 * Confirms that the four changed files stay coherent:
 *   1. AGENTS.md (generateAgentsMd.ts) — must contain the trend-grounding
 *      section with the banned phrasings + the validate_trend_citation step.
 *   2. standingOrders.ts — must define `chat_trend_lookup` as on-demand AND
 *      both trend_watcher + daily_niche_scan + weekly_content_plan must
 *      reference the new endpoints.
 *   3. The chat_trend_lookup standing order must render into AGENTS.md.
 *   4. Banned phrasings (the actual ones Maya emitted live) must be present
 *      so the LLM has the negative pattern in its system prompt.
 *
 * Catches the "I edited one file and forgot the others" failure mode that
 * CLAUDE.md § 4 mandates a sibling-file scan for.
 */

import { describe, expect, it } from "vitest";
import { generateAgentsMd } from "../generateAgentsMd";
import { STANDING_ORDERS } from "../standingOrders";

function renderAgentsMdForPlan(plan: "coach" | "manager"): string {
  return generateAgentsMd({
    creatorDisplayName: "Test Creator",
    plan,
    handles: [],
    embedStandingOrders: true,
  });
}

describe("AGENTS.md trend-grounding rules (Sprint 12.7 Phase 3)", () => {
  it("contains the trend-grounding section header", () => {
    const md = renderAgentsMdForPlan("manager");
    expect(md).toContain("### Trend mentions — grounded or silent");
  });

  it("names the three endpoints Maya must call", () => {
    const md = renderAgentsMdForPlan("manager");
    expect(md).toContain("/lc_maya/get_recent_trends");
    expect(md).toContain("/lc_maya/fetch_trends_live");
    expect(md).toContain("/lc_maya/validate_trend_citation");
    expect(md).toContain("/lc_maya/log_trend");
  });

  it("lists the banned phrasings (the actual confabulation Maya shipped live)", () => {
    const md = renderAgentsMdForPlan("manager");
    expect(md).toContain("I'm seeing two specific real-time trends");
    expect(md).toContain("this trend is hitting because");
    expect(md).toContain("going viral right now");
  });

  it("names the generic-model fingerprints to recognize as confabulation", () => {
    const md = renderAgentsMdForPlan("manager");
    // The live failure shape:
    expect(md).toContain("NYC Scent Map");
    expect(md).toContain("NYC Logic");
  });

  it("clarifies profile URLs do NOT satisfy the gate", () => {
    const md = renderAgentsMdForPlan("manager");
    expect(md).toContain(
      "Profile pages and hashtag pages do NOT satisfy the citation gate"
    );
  });

  it("section is present in both coach and manager renderings (no tier-gating)", () => {
    for (const plan of ["coach", "manager"] as const) {
      const md = renderAgentsMdForPlan(plan);
      expect(md, `plan=${plan}`).toContain(
        "### Trend mentions — grounded or silent"
      );
    }
  });
});

describe("standing orders — trend-grounding coherence (Sprint 12.7 Phase 3)", () => {
  it("registers chat_trend_lookup as on-demand, all tiers, no cron entry", () => {
    const order = STANDING_ORDERS.find((o) => o.id === "chat_trend_lookup");
    expect(order, "chat_trend_lookup missing from STANDING_ORDERS").toBeDefined();
    expect(order!.kind).toBe("on-demand");
    expect(order!.tier).toBe("all");
    // On-demand orders MUST NOT carry a cronEntryId/defaultCron (jobs.json
    // would render an orphan cron entry that fires forever otherwise).
    expect((order as unknown as { cronEntryId?: string }).cronEntryId).toBeUndefined();
    expect((order as unknown as { defaultCron?: string }).defaultCron).toBeUndefined();
  });

  it("chat_trend_lookup scope wires the four endpoints in cache-first order", () => {
    const order = STANDING_ORDERS.find((o) => o.id === "chat_trend_lookup");
    const scope = order!.scope;
    expect(scope).toContain("/lc_maya/get_recent_trends");
    expect(scope).toContain("/lc_maya/fetch_trends_live");
    expect(scope).toContain("/lc_maya/log_trend");
    expect(scope).toContain("/lc_maya/validate_trend_citation");
    // The "cache-first" wording is the discipline.
    expect(scope).toMatch(/cache-first|cache.first/i);
  });

  it("trend_watcher + daily_niche_scan now reference the trend-grounding discipline", () => {
    const watcher = STANDING_ORDERS.find((o) => o.id === "trend_watcher")!;
    const scan = STANDING_ORDERS.find((o) => o.id === "daily_niche_scan")!;
    expect(watcher.scope).toMatch(/Sprint 12\.7|platform-post URL|specific post/i);
    expect(scan.scope).toMatch(/Sprint 12\.7|platform-post URL|log_trend/i);
  });

  it("weekly_content_plan references the new endpoints (so trend ideas are grounded)", () => {
    const plan = STANDING_ORDERS.find((o) => o.id === "weekly_content_plan")!;
    expect(plan.scope).toContain("/lc_maya/get_recent_trends");
    expect(plan.scope).toContain("/lc_maya/validate_trend_citation");
  });

  it("chat_trend_lookup renders into the AGENTS.md inventory under the manager plan", () => {
    const md = renderAgentsMdForPlan("manager");
    expect(md).toContain("### Chat trend lookup (on-demand)");
  });

  it("chat_trend_lookup also renders under coach (tier='all')", () => {
    const md = renderAgentsMdForPlan("coach");
    expect(md).toContain("### Chat trend lookup (on-demand)");
  });
});
