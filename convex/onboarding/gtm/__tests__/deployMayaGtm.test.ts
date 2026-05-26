import { describe, expect, it } from "vitest";
import {
  buildGtmMachineConfig,
  flyAppNameForGtmAgent,
} from "../deployMayaGtm";

describe("Maya GTM OpenClaw deploy config", () => {
  it("builds a deterministic Fly app name for a GTM agent", () => {
    expect(flyAppNameForGtmAgent("12345;gtmAgents")).toBe(
      "clawlaunch-12345gtmagents"
    );
  });

  it("boots OpenClaw with the GTM workspace bundle and direct-ping smoke metadata", () => {
    const config = buildGtmMachineConfig({
      agentId: "12345;gtmAgents",
      flyAppName: "clawlaunch-12345gtmagents",
      workspaceBundleUrl: "https://storage.test/workspace.tar",
    });

    expect(config.image).toContain("heymaya-openclaw");
    expect(config.guest).toEqual({
      cpu_kind: "shared",
      cpus: 1,
      memory_mb: 1024,
    });
    expect(config.env?.OPENCLAW_STATE_DIR).toBe("/data");
    expect(config.env?.OPENCLAW_CONFIG_PATH).toBe("/data/openclaw.json");
    expect(config.env?.MAYA_WORKSPACE_BUNDLE_URL).toBe(
      "https://storage.test/workspace.tar"
    );
    expect(config.metadata).toEqual({
      agent_id: "12345;gtmAgents",
      kind: "maya-gtm",
      schema_version: "1",
    });
    expect(config.init?.cmd?.join(" ")).toContain("openclaw gateway");

    const bootstrap = JSON.parse(config.env?.MAYA_BOOTSTRAP_JSON ?? "{}");
    expect(bootstrap.product).toBe("clawlaunch-gtm");
    expect(bootstrap.modelRouting.mainMaya).toBe("google/gemini-3.5-flash");
    expect(bootstrap.modelRouting.hardResearchBeta).toContain("claude-sonnet");
    expect(bootstrap.directPingSmoke).toBe(true);
    // Sprint 2.1 expanded the agent list from 2 → 11 (six platform
    // research subagents + channel_judge + slop_critic +
    // extraction_worker). Sprint 1.3 added telegram channel + heartbeat
    // active-hours config. Rather than re-snapshotting the full config
    // every sprint (which has been the source of test drift), we pin
    // the structural invariants that actually matter for runtime
    // correctness:
    expect(bootstrap.gatewayConfig).toMatchObject({
      gateway: { mode: "local" },
      plugins: {
        entries: {
          acpx: { enabled: false },
          browser: { enabled: false },
          "device-pair": { enabled: false },
          "phone-control": { enabled: false },
          "talk-voice": { enabled: false },
        },
      },
      discovery: { mdns: { mode: "off" } },
      skills: { load: { watch: true } },
    });
    expect(bootstrap.gatewayConfig.agents.defaults.workspace).toBe(
      "/data/workspace"
    );
    expect(bootstrap.gatewayConfig.agents.defaults.subagents).toMatchObject({
      // Sprint 2.16j — bumped 4 → 8 per external-architect review. We
      // cap research lanes at 3 in the boot prompt so 8 leaves room
      // for refinement waves + weekly fans without queuing.
      maxConcurrent: 8,
      maxChildrenPerAgent: 4,
      runTimeoutSeconds: 900,
    });
    // Sprint 2.16j — hooks.internal enabled so BOOT.md fires on gateway
    // startup as a real native primitive (not just a workspace file).
    expect(bootstrap.gatewayConfig.agents.defaults.hooks).toEqual({
      internal: { enabled: true },
    });
    // Sprint 2.16h — LLM idle watchdog bumped from default 120s to 300s so
    // slow Gemini 3.5 Flash thinking turns don't trip "LLM request timed
    // out" mid-stream.
    expect(bootstrap.gatewayConfig.agents.defaults.llm).toEqual({
      idleTimeoutSeconds: 300,
    });
    // main + hard_research_beta must always exist; platform research
    // subagents are gated by enabled channels but main + beta are
    // always on.
    const agentIds = bootstrap.gatewayConfig.agents.list.map(
      (a: { id: string }) => a.id
    );
    expect(agentIds).toContain("main");
    expect(agentIds).toContain("hard_research_beta");
    const main = bootstrap.gatewayConfig.agents.list.find(
      (a: { id: string }) => a.id === "main"
    );
    expect(main.default).toBe(true);
    expect(main.model).toBe("openrouter/google/gemini-3.5-flash");
    expect(config.init?.cmd?.join(" ")).toContain(
      "cp /data/workspace/jobs.json /data/cron/jobs.json"
    );
    expect(config.init?.cmd?.join(" ")).toContain("chmod 700 /data/cron");
  });

  it("uses Gemini 3.5 Flash as the default GTM OpenClaw model", () => {
    const config = buildGtmMachineConfig({
      agentId: "agent",
      flyAppName: "clawlaunch-agent",
      workspaceBundleUrl: "https://storage.test/workspace.tar",
    });

    expect(config.env?.OPENCLAW_MODEL).toBe(
      "openrouter/google/gemini-3.5-flash"
    );
    expect(config.env?.OPENCLAW_DISABLE_BONJOUR).toBe("1");
    expect(config.env?.MAYA_GTM_MODEL_ROUTING_JSON).toContain(
      "futureDefaultResearch"
    );
  });
});
