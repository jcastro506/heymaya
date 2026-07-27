import { describe, expect, it } from "vitest";
import {
  buildGtmMachineConfig,
  collectDeploySecrets,
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
      cpus: 2,
      memory_mb: 2048,
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
    // V2 redesign: main brain is Kimi K2-0905 (handles the long workspace +
    // research build-up that broke gemini); workers stay on Gemini 3 Flash.
    expect(bootstrap.modelRouting.mainMaya).toBe("moonshotai/kimi-k2-0905");
    expect(bootstrap.modelRouting.hardResearchBeta).toContain("gemini-3-flash");
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
        // Sprint 2.16j v3 — switched from `enabled: false` stubs for
        // every disabled plugin to a restrictive `plugins.allow`
        // allowlist (deny-by-default). External-architect cited known
        // OpenClaw bug where doctor-bundled-plugin-runtime-deps still
        // installed disabled-channel deps via a health path.
        allow: ["maya-gtm-tools"],
        entries: {},
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
      runTimeoutSeconds: 1500,
    });
    // Sprint 2.16j — hooks.internal.enabled at TOP LEVEL of config
    // (sibling of `agents`, `plugins`, `gateway`) per OpenClaw 2026.4.23
    // schema. BOOT.md fires on gateway startup as a real native primitive
    // (not just a workspace file).
    expect(bootstrap.gatewayConfig.hooks).toMatchObject({
      enabled: true,
      path: "/hooks",
      token: "${HOOK_TOKEN}",
      allowedAgentIds: ["main"],
      internal: { enabled: true },
    });
    // (The `llm.idleTimeoutSeconds` sub-key was valid in 4.23 but 5.x dropped
    // it from the agent-defaults schema — OpenClaw's stream-establishment idle
    // timer supersedes it, so the config no longer emits an `llm` block.)
    expect(bootstrap.gatewayConfig.agents.defaults.llm).toBeUndefined();
    // `main` must always exist + be default. (Sprint 2.18 #3 retired
    // hard_research_beta from agents.list — it's no longer a registered agent.)
    const agentIds = bootstrap.gatewayConfig.agents.list.map(
      (a: { id: string }) => a.id
    );
    expect(agentIds).toContain("main");
    expect(agentIds).not.toContain("hard_research_beta");
    const main = bootstrap.gatewayConfig.agents.list.find(
      (a: { id: string }) => a.id === "main"
    );
    expect(main.default).toBe(true);
    expect(main.model).toBe("openrouter/moonshotai/kimi-k2-0905");
    expect(config.init?.cmd?.join(" ")).toContain(
      "cp /data/workspace/jobs.json /data/cron/jobs.json"
    );
    expect(config.init?.cmd?.join(" ")).toContain("chmod 700 /data/cron");
    expect(config.services).toEqual([
      {
        protocol: "tcp",
        internal_port: 18789,
        ports: [
          { port: 443, handlers: ["tls", "http"] },
          { port: 80, handlers: ["http"] },
        ],
      },
    ]);
  });

  it("keeps Telegram in Convex switchboard webhook mode when configured", () => {
    const config = buildGtmMachineConfig({
      agentId: "agent",
      flyAppName: "clawlaunch-agent",
      workspaceBundleUrl: "https://storage.test/workspace.tar",
      telegramChatId: "123456",
      telegramWebhookUrl: "https://example.convex.site/telegram/webhook",
      telegramWebhookSecret: "webhook-secret",
    });

    const bootstrap = JSON.parse(config.env?.MAYA_BOOTSTRAP_JSON ?? "{}");
    expect(bootstrap.gatewayConfig.plugins).toMatchObject({
      allow: ["telegram", "maya-gtm-tools"],
      entries: { telegram: { enabled: true } },
    });
    expect(bootstrap.gatewayConfig.channels.telegram).toMatchObject({
      enabled: true,
      dmPolicy: "allowlist",
      allowFrom: [123456],
      webhookUrl: "https://example.convex.site/telegram/webhook",
      webhookSecret: "webhook-secret",
      webhookHost: "0.0.0.0",
      webhookPort: 8787,
      webhookPath: "/telegram-webhook",
    });
  });

  it("uses kimi-k2-0905 as the default GTM OpenClaw model (qwen reverted 2026-07-26)", () => {
    const config = buildGtmMachineConfig({
      agentId: "agent",
      flyAppName: "clawlaunch-agent",
      workspaceBundleUrl: "https://storage.test/workspace.tar",
    });

    expect(config.env?.OPENCLAW_MODEL).toBe(
      "openrouter/moonshotai/kimi-k2-0905"
    );
    expect(config.env?.OPENCLAW_DISABLE_BONJOUR).toBe("1");
    expect(config.env?.MAYA_GTM_MODEL_ROUTING_JSON).toContain(
      "futureDefaultResearch"
    );
  });

  it("maps env-specific Telegram bot tokens into the Fly secret name OpenClaw reads", () => {
    expect(
      collectDeploySecrets({
        CONVEX_DEPLOYMENT: "dev:precise-canary-781",
        TELEGRAM_BOT_TOKEN_STAGING: "staging-token",
        TELEGRAM_BOT_TOKEN: "global-token",
      }).TELEGRAM_BOT_TOKEN
    ).toBe("staging-token");

    expect(
      collectDeploySecrets({
        CONVEX_DEPLOYMENT: "dev:precise-canary-781",
        TELEGRAM_BOT_TOKEN_STAGING: "staging-token",
      }).TELEGRAM_BOT_TOKEN
    ).toBe("staging-token");

    expect(
      collectDeploySecrets({
        CONVEX_DEPLOYMENT: "prod:whatever",
        TELEGRAM_BOT_TOKEN_PRODUCTION: "prod-token",
      }).TELEGRAM_BOT_TOKEN
    ).toBe("prod-token");
  });

  it("carries the Convex switchboard URL and Telegram webhook secret into deploy secrets", () => {
    expect(
      collectDeploySecrets({
        NEXT_PUBLIC_CONVEX_SITE_URL: "https://example.convex.site",
        TELEGRAM_WEBHOOK_SECRET: "secret",
      })
    ).toMatchObject({
      CONVEX_SITE_URL: "https://example.convex.site",
      NEXT_PUBLIC_CONVEX_SITE_URL: "https://example.convex.site",
      TELEGRAM_WEBHOOK_SECRET: "secret",
    });
  });
});
