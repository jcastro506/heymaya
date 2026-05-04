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

describe("creatorMayaLiveMachineConfig — claw-messenger wiring", () => {
  beforeEach(() => {
    delete process.env.CLAW_MESSENGER_API_KEY;
  });
  afterEach(() => {
    if (SAVED_KEY === undefined) delete process.env.CLAW_MESSENGER_API_KEY;
    else process.env.CLAW_MESSENGER_API_KEY = SAVED_KEY;
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
});
