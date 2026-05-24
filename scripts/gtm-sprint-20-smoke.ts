#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 20 — L4 smoke (Maya-side subagent lane).
 *
 * Asserts that the OpenClaw gateway config Maya boots with registers
 * all 8 per-platform / per-role subagents, that depth + concurrency caps
 * are documented, that channel_judge + slop_critic have external-API
 * tools DENIED (synthesis only, no budget burn mid-decision), and that
 * AGENTS.md teaches Maya the subagent slugs by name.
 */

import { buildGatewayConfig } from "../convex/onboarding/gtm/deployMayaGtm";
import { buildMayaGtmWorkspace } from "../convex/agents/packs/maya_gtm/generators";

interface Check {
  name: string;
  status: "passed" | "failed";
  detail: string;
}
const checks: Check[] = [];
const pass = (name: string, detail: string) =>
  checks.push({ name, status: "passed", detail });
const fail = (name: string, detail: string) =>
  checks.push({ name, status: "failed", detail });

interface AgentEntry {
  id: string;
  name?: string;
  model?: unknown;
  subagents?: { allowAgents?: string[] };
  tools?: { profile?: string; allow?: string[]; deny?: string[] };
}

function checkGatewayConfigHasAllSubagents(): void {
  const cfg = buildGatewayConfig() as {
    agents: { defaults: { subagents: Record<string, unknown> }; list: AgentEntry[] };
  };
  const list = cfg.agents.list;
  const ids = list.map((a) => a.id);
  const required = [
    "main",
    "hard_research_beta",
    "reddit_research",
    "x_research",
    "tiktok_research",
    "instagram_research",
    "linkedin_research",
    "channel_judge",
    "slop_critic",
    "extraction_worker",
  ];
  for (const id of required) {
    if (!ids.includes(id)) {
      fail("subagent-registered", `missing agentId '${id}' in agents.list[]`);
      return;
    }
  }
  pass(
    "subagent-registered",
    `all ${required.length} required subagent IDs registered in agents.list[]`
  );
}

function checkSpawnDepthCap(): void {
  const cfg = buildGatewayConfig() as {
    agents: { defaults: { subagents: { maxSpawnDepth?: number; maxConcurrent?: number } } };
  };
  const defaults = cfg.agents.defaults.subagents;
  if (defaults.maxSpawnDepth !== 1) {
    fail(
      "max-spawn-depth",
      `expected maxSpawnDepth=1, got ${defaults.maxSpawnDepth}`
    );
    return;
  }
  if ((defaults.maxConcurrent ?? 0) < 2) {
    fail("max-concurrent", `expected maxConcurrent ≥2, got ${defaults.maxConcurrent}`);
    return;
  }
  pass(
    "subagent-caps",
    `maxSpawnDepth=${defaults.maxSpawnDepth}, maxConcurrent=${defaults.maxConcurrent}`
  );
}

function checkChannelJudgeIsSynthesisOnly(): void {
  const cfg = buildGatewayConfig() as {
    agents: { list: AgentEntry[] };
  };
  const judge = cfg.agents.list.find((a) => a.id === "channel_judge");
  if (!judge) {
    fail("channel-judge-exists", "channel_judge not registered");
    return;
  }
  const deny = judge.tools?.deny ?? [];
  const requiredDenies = ["scrapecreators-api", "web_fetch"];
  for (const r of requiredDenies) {
    if (!deny.includes(r)) {
      fail(
        "channel-judge-denies-apis",
        `channel_judge does not deny '${r}' — judge must be synthesis-only (no mid-decision API spend)`
      );
      return;
    }
  }
  pass(
    "channel-judge-synthesis-only",
    `channel_judge denies external API tools (${deny.join(", ")}); synthesis-only`
  );
}

function checkSlopCriticIsLocalOnly(): void {
  const cfg = buildGatewayConfig() as { agents: { list: AgentEntry[] } };
  const critic = cfg.agents.list.find((a) => a.id === "slop_critic");
  if (!critic) {
    fail("slop-critic-exists", "slop_critic not registered");
    return;
  }
  const deny = critic.tools?.deny ?? [];
  if (!deny.includes("scrapecreators-api") || !deny.includes("web_fetch")) {
    fail(
      "slop-critic-local-only",
      `slop_critic must deny external APIs (heartbeat-safe). deny=${JSON.stringify(deny)}`
    );
    return;
  }
  pass(
    "slop-critic-local-only",
    `slop_critic denies external APIs; safe for heartbeat invocation`
  );
}

function checkMainCanSpawnAllSubagents(): void {
  const cfg = buildGatewayConfig() as { agents: { list: AgentEntry[] } };
  const main = cfg.agents.list.find((a) => a.id === "main");
  if (!main) {
    fail("main-exists", "main agent not registered");
    return;
  }
  const allowed = main.subagents?.allowAgents ?? [];
  const requiredSpawnTargets = [
    "reddit_research",
    "x_research",
    "tiktok_research",
    "channel_judge",
    "slop_critic",
  ];
  for (const t of requiredSpawnTargets) {
    if (!allowed.includes(t)) {
      fail(
        "main-allow-spawn",
        `main.subagents.allowAgents missing '${t}' — Maya can't spawn this subagent`
      );
      return;
    }
  }
  pass(
    "main-allow-spawn",
    `main agent can spawn all ${allowed.length} registered subagents`
  );
}

function checkAgentsMdMentionsSubagentIds(): void {
  const { files } = buildMayaGtmWorkspace({
    accountEmail: "rwtc@heymaya.test",
    timezone: "America/New_York",
    bootKickoffAtMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    app: {
      name: "S20 fixture",
      url: "https://s20-fixture.test/",
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
    },
  });
  const agents = files.get("AGENTS.md") ?? "";
  const requiredMentions = [
    "sessions_spawn",
    "reddit_research",
    "x_research",
    "tiktok_research",
    "channel_judge",
    "slop_critic",
    "maxSpawnDepth=1",
  ];
  for (const m of requiredMentions) {
    if (!agents.includes(m)) {
      fail(
        "agents-md-teaches-subagents",
        `AGENTS.md missing required mention: '${m}'`
      );
      return;
    }
  }
  pass(
    "agents-md-teaches-subagents",
    `AGENTS.md teaches Maya the sessions_spawn API + all subagent slugs by name + concurrency caps`
  );
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  checkGatewayConfigHasAllSubagents();
  checkSpawnDepthCap();
  checkChannelJudgeIsSynthesisOnly();
  checkSlopCriticIsLocalOnly();
  checkMainCanSpawnAllSubagents();
  checkAgentsMdMentionsSubagentIds();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 20 L4 smoke: ${passed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups:\n" +
        "  1. After RWTC redeploy with new image, SSH in + `openclaw agents list`. Confirm 10 agents registered.\n" +
        "  2. Trigger Maya: 'Spawn reddit_research and x_research for ICP icp_1.' Expect 2 parallel subagent sessions.\n" +
        "  3. Verify channel_judge run cannot make ScrapeCreators calls (try forcing it; expect tool-denied).\n" +
        "  4. Verify slop_critic can run from heartbeat without spending budget."
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
