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
    expect(bootstrap.gatewayConfig).toEqual({ gateway: { mode: "local" } });
  });

  it("uses Gemini 3.5 Flash as the default GTM OpenClaw model", () => {
    const config = buildGtmMachineConfig({
      agentId: "agent",
      flyAppName: "clawlaunch-agent",
      workspaceBundleUrl: "https://storage.test/workspace.tar",
    });

    expect(config.env?.OPENCLAW_MODEL).toBe("google/gemini-3.5-flash");
    expect(config.env?.MAYA_GTM_MODEL_ROUTING_JSON).toContain(
      "futureDefaultResearch"
    );
  });
});
