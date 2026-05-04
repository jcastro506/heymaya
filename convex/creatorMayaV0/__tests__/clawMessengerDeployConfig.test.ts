import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { creatorMayaLiveMachineConfig } from "../backend";

const FIXED_WORKSPACE = {
  "AGENTS.md": "# AGENTS",
  "SOUL.md": "# SOUL",
  "USER.md": "# USER",
  "jobs.json": "[]",
};
const FIXED_METADATA = {
  creatorId: "creator_test",
  mode: "live_test",
  appName: "heymaya-cmv0-creator-test",
};

function readOpenclawJson(cfg: ReturnType<typeof creatorMayaLiveMachineConfig>) {
  const file = cfg.files?.find((f) => f.guest_path === "/data/openclaw.json");
  if (!file?.raw_value) throw new Error("openclaw.json not in machine config");
  return JSON.parse(Buffer.from(file.raw_value, "base64").toString("utf8"));
}

const SAVED_KEY = process.env.CLAW_MESSENGER_API_KEY;
const SAVED_COMPOSIO_KEY = process.env.COMPOSIO_CONSUMER_KEY;

describe("creatorMayaLiveMachineConfig — claw-messenger wiring", () => {
  beforeEach(() => {
    delete process.env.CLAW_MESSENGER_API_KEY;
    delete process.env.COMPOSIO_CONSUMER_KEY;
  });
  afterEach(() => {
    if (SAVED_KEY === undefined) delete process.env.CLAW_MESSENGER_API_KEY;
    else process.env.CLAW_MESSENGER_API_KEY = SAVED_KEY;
    if (SAVED_COMPOSIO_KEY === undefined)
      delete process.env.COMPOSIO_CONSUMER_KEY;
    else process.env.COMPOSIO_CONSUMER_KEY = SAVED_COMPOSIO_KEY;
  });

  it("emits the claw-messenger channel block when CLAW_MESSENGER_API_KEY is set", () => {
    process.env.CLAW_MESSENGER_API_KEY = "cm_live_TEST_KEY";
    const cfg = creatorMayaLiveMachineConfig(FIXED_WORKSPACE, FIXED_METADATA);
    const openclaw = readOpenclawJson(cfg);
    expect(openclaw.channels["claw-messenger"]).toEqual({
      enabled: true,
      apiKey: "cm_live_TEST_KEY",
      serverUrl: "wss://claw-messenger.onrender.com",
      preferredService: "iMessage",
      dmPolicy: "open",
    });
    expect(openclaw.channels.telegram).toEqual({ enabled: true });
  });

  it("omits the claw-messenger channel block when the env var is missing", () => {
    const cfg = creatorMayaLiveMachineConfig(FIXED_WORKSPACE, FIXED_METADATA);
    const openclaw = readOpenclawJson(cfg);
    expect(openclaw.channels["claw-messenger"]).toBeUndefined();
    expect(openclaw.channels.telegram).toEqual({ enabled: true });
  });

  it("installs the claw-messenger plugin in init.cmd before starting the gateway", () => {
    process.env.CLAW_MESSENGER_API_KEY = "cm_live_TEST_KEY";
    const cfg = creatorMayaLiveMachineConfig(FIXED_WORKSPACE, FIXED_METADATA);
    const initLine = cfg.init?.cmd?.[2];
    expect(initLine).toBeTruthy();
    const installIdx = initLine!.indexOf("openclaw plugins install @emotion-machine/claw-messenger");
    const gatewayIdx = initLine!.indexOf("exec openclaw gateway");
    expect(installIdx).toBeGreaterThan(-1);
    expect(gatewayIdx).toBeGreaterThan(installIdx);
    expect(initLine).toContain("|| true");
  });

  it("forces IPv4-first DNS resolution via NODE_OPTIONS so OpenRouter / Telegram / Claw Messenger don't time out on Fly's IPv6 egress", () => {
    const cfg = creatorMayaLiveMachineConfig(FIXED_WORKSPACE, FIXED_METADATA);
    expect(cfg.env?.NODE_OPTIONS).toBe("--dns-result-order=ipv4first");
  });

  it("does not bake the API key into the openclaw.json file when env is missing (cross-tenant safety: a missing key never leaks an empty apiKey field)", () => {
    const cfg = creatorMayaLiveMachineConfig(FIXED_WORKSPACE, FIXED_METADATA);
    const openclaw = readOpenclawJson(cfg);
    const serialized = JSON.stringify(openclaw);
    expect(serialized).not.toContain("cm_live_");
    expect(serialized).not.toContain("apiKey");
  });

  it("rejects adversarial workspace contents by passing them through unchanged (the responsibility is on workspaceManifest to validate, but the config should not interpret base64-encoded strings)", () => {
    process.env.CLAW_MESSENGER_API_KEY = "cm_live_TEST_KEY";
    const adversarial = {
      ...FIXED_WORKSPACE,
      "AGENTS.md": "# AGENTS\n$(rm -rf /)\n`evil`\n${env.EVIL}",
    };
    const cfg = creatorMayaLiveMachineConfig(adversarial, FIXED_METADATA);
    const file = cfg.files?.find((f) => f.guest_path === "/data/workspace/AGENTS.md");
    expect(file?.raw_value).toBeTruthy();
    const decoded = Buffer.from(file!.raw_value!, "base64").toString("utf8");
    expect(decoded).toBe(adversarial["AGENTS.md"]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Composio OpenClaw plugin wiring
  //
  // Maya gets every Composio toolkit (GMAIL / GOOGLECALENDAR / TIKTOK /
  // LINKEDIN / TWITTER) as a native runtime tool via
  // `@composio/openclaw-plugin`. The plugin only takes a consumerKey — there
  // is no toolkit allowlist (verified against the README at
  // https://github.com/ComposioHQ/openclaw-composio-plugin), so the deploy-
  // config surface is just (a) install the plugin, (b) set consumerKey, (c)
  // restart the gateway. OAuth lifecycle stays in
  // convex/integrations/composio/oauth.ts.
  // ──────────────────────────────────────────────────────────────────────────

  it("installs the @composio/openclaw-plugin in init.cmd when COMPOSIO_CONSUMER_KEY is set, in correct order: install → config set → gateway restart → exec gateway", () => {
    process.env.COMPOSIO_CONSUMER_KEY = "ck_test_KEY_123";
    const cfg = creatorMayaLiveMachineConfig(FIXED_WORKSPACE, FIXED_METADATA);
    const initLine = cfg.init?.cmd?.[2];
    expect(initLine).toBeTruthy();

    const installIdx = initLine!.indexOf(
      "openclaw plugins install @composio/openclaw-plugin"
    );
    const configSetIdx = initLine!.indexOf(
      "openclaw config set plugins.entries.composio.config.consumerKey"
    );
    const restartIdx = initLine!.indexOf("openclaw gateway restart");
    const execIdx = initLine!.indexOf("exec openclaw gateway");

    expect(installIdx).toBeGreaterThan(-1);
    expect(configSetIdx).toBeGreaterThan(installIdx);
    expect(restartIdx).toBeGreaterThan(configSetIdx);
    expect(execIdx).toBeGreaterThan(restartIdx);
  });

  it("uses `|| true` on every Composio plugin command so a registry hiccup never blocks the gateway start (matching the existing claw-messenger pattern)", () => {
    process.env.COMPOSIO_CONSUMER_KEY = "ck_test_KEY_123";
    const cfg = creatorMayaLiveMachineConfig(FIXED_WORKSPACE, FIXED_METADATA);
    const initLine = cfg.init?.cmd?.[2] ?? "";

    expect(initLine).toContain(
      "openclaw plugins install @composio/openclaw-plugin || true"
    );
    expect(initLine).toContain(
      "openclaw config set plugins.entries.composio.config.consumerKey"
    );
    expect(initLine).toMatch(
      /openclaw config set plugins\.entries\.composio\.config\.consumerKey [^&|]+\|\| true/
    );
    expect(initLine).toContain("openclaw gateway restart || true");
  });

  it("omits all three Composio commands when COMPOSIO_CONSUMER_KEY is missing — dev / test deploys without a key still boot", () => {
    const cfg = creatorMayaLiveMachineConfig(FIXED_WORKSPACE, FIXED_METADATA);
    const initLine = cfg.init?.cmd?.[2] ?? "";
    expect(initLine).not.toContain("@composio/openclaw-plugin");
    expect(initLine).not.toContain(
      "plugins.entries.composio.config.consumerKey"
    );
    expect(initLine).not.toContain("openclaw gateway restart");
  });

  it("shell-escapes the consumer key so a key containing a single quote cannot break out of the shell argument", () => {
    process.env.COMPOSIO_CONSUMER_KEY = "ck_evil'; rm -rf / #";
    const cfg = creatorMayaLiveMachineConfig(FIXED_WORKSPACE, FIXED_METADATA);
    const initLine = cfg.init?.cmd?.[2] ?? "";
    // Must not appear unquoted with the dangerous payload exposed to the
    // shell — the escape collapses every interior `'` into `'\''`.
    expect(initLine).not.toMatch(/consumerKey ck_evil'; rm/);
    expect(initLine).toContain(
      "'ck_evil'\\''; rm -rf / #'"
    );
  });

  it("does not leak the Composio consumer key into the openclaw.json file (cross-tenant safety: the key is set at runtime via CLI, never baked into the workspace bundle)", () => {
    process.env.COMPOSIO_CONSUMER_KEY = "ck_test_SECRET_123";
    const cfg = creatorMayaLiveMachineConfig(FIXED_WORKSPACE, FIXED_METADATA);
    const openclaw = readOpenclawJson(cfg);
    const serialized = JSON.stringify(openclaw);
    expect(serialized).not.toContain("ck_test_SECRET_123");
    expect(serialized).not.toContain("composio");
    expect(serialized).not.toContain("consumerKey");
  });

  it("Composio install runs after claw-messenger install but before exec gateway — so all plugins are on disk + configured before the long-running process starts", () => {
    process.env.CLAW_MESSENGER_API_KEY = "cm_live_TEST_KEY";
    process.env.COMPOSIO_CONSUMER_KEY = "ck_test_KEY_123";
    const cfg = creatorMayaLiveMachineConfig(FIXED_WORKSPACE, FIXED_METADATA);
    const initLine = cfg.init?.cmd?.[2] ?? "";

    const clawInstallIdx = initLine.indexOf(
      "openclaw plugins install @emotion-machine/claw-messenger"
    );
    const composioInstallIdx = initLine.indexOf(
      "openclaw plugins install @composio/openclaw-plugin"
    );
    const execIdx = initLine.indexOf("exec openclaw gateway");

    expect(clawInstallIdx).toBeGreaterThan(-1);
    expect(composioInstallIdx).toBeGreaterThan(clawInstallIdx);
    expect(execIdx).toBeGreaterThan(composioInstallIdx);
  });
});
