/**
 * Every top-level key of her config must be one OpenClaw actually accepts.
 *
 * ## Why this exists
 *
 * A config OpenClaw rejects doesn't degrade — the gateway REFUSES TO START.
 * The machine boots, Fly reports `started: true`, and the only symptom is
 * `healthz 502` for a minute until this scrolls past in the logs:
 *
 * ```
 * OpenClaw config is invalid
 *   - <root>: Invalid input
 * ```
 *
 * That is the least informative error in the stack — it names no key. It has
 * now cost two live deploys: once for agents at the root instead of under
 * `agents.list`, once for `http` at the root instead of under `gateway`. Both
 * were one misplaced key, and both took a deploy plus a log read to find.
 *
 * ## Why a frozen list rather than the real schema
 *
 * OpenClaw is not a repo dependency — it's installed globally and baked into
 * the image. Adding it as a devDependency to import its zod schema would pin a
 * second copy of a large package that then has to be bumped in lockstep with
 * the image digest.
 *
 * So this is a SNAPSHOT of the shipped types, extracted from the exact version
 * we run. That makes it a real check with a real maintenance cost: when the
 * image is bumped, re-extract. The alternative was finding out on a machine,
 * which we have now done twice.
 *
 * Extracted from `OpenClawConfig` in openclaw@2026.5.26,
 * `dist/types.openclaw-*.d.ts`.
 */

import { describe, expect, it } from "vitest";
import { buildMayaWorkspace, OPENCLAW_CONFIG_PATH } from "../generators";

/** The 42 keys `OpenClawConfig` declares. Nothing else validates. */
const ACCEPTED_ROOT_KEYS = new Set([
  "accessGroups", "acp", "agents", "approvals", "audio", "auth", "bindings",
  "broadcast", "browser", "channels", "cli", "commands", "commitments",
  "crestodian", "cron", "diagnostics", "discovery", "env", "gateway", "hooks",
  "logging", "mcp", "media", "memory", "messages", "meta", "models", "nodeHost",
  "plugins", "proxy", "secrets", "security", "session", "skills", "surfaces",
  "talk", "tools", "transcripts", "ui", "update", "web", "wizard",
]);

describe("EVERY ROOT KEY IS ONE OPENCLAW ACCEPTS", () => {
  it("no key would trip `<root>: Invalid input`", () => {
    const config = JSON.parse(
      buildMayaWorkspace({
        founder: { email: "sam@example.com", name: "Sam", timezone: "UTC" },
        product: {
          name: "Widgetly",
          url: "https://widgetly.dev",
          truth: "turns a CSV into a dashboard in one paste",
        },
        channels: [{ channel: "x", postingMode: "just_go" }],
      }).files.get(OPENCLAW_CONFIG_PATH)!
    ) as Record<string, unknown>;

    const rejected = Object.keys(config).filter(
      (key) => !ACCEPTED_ROOT_KEYS.has(key)
    );
    expect(rejected).toEqual([]);
  });

  it("does not advertise itself on the LAN", () => {
    // One machine holds one customer's memory. There is nobody on that network
    // it should be announcing an agent endpoint to.
    const config = JSON.parse(
      buildMayaWorkspace({
        founder: { email: "sam@example.com", name: "Sam", timezone: "UTC" },
        product: {
          name: "Widgetly",
          url: "https://widgetly.dev",
          truth: "turns a CSV into a dashboard in one paste",
        },
        channels: [{ channel: "x", postingMode: "just_go" }],
      }).files.get(OPENCLAW_CONFIG_PATH)!
    );
    expect(config.discovery.mdns.mode).toBe("off");
  });

  it("EVERY MODEL REF NAMES ITS PROVIDER", () => {
    // A bare OpenRouter slug is not a no-op — OpenClaw reads `provider/model`,
    // so `openai/gpt-5.6-luna-pro` resolves to provider `openai`, which has no
    // such model. The machine boots healthy and answers every single message
    // with `Unknown model`. Found live 2026-08-04.
    const config = JSON.parse(
      buildMayaWorkspace({
        founder: { email: "sam@example.com", name: "Sam", timezone: "UTC" },
        product: {
          name: "Widgetly",
          url: "https://widgetly.dev",
          truth: "turns a CSV into a dashboard in one paste",
        },
        channels: [{ channel: "x", postingMode: "just_go" }],
      }).files.get(OPENCLAW_CONFIG_PATH)!
    );

    const refs: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      const entries = Object.entries(node);
      // A `model` sitting next to an explicit `provider` is already
      // unambiguous, and is not necessarily an OpenRouter slug — memorySearch
      // embeds through `provider: "gemini"` with a bare `gemini-embedding-001`.
      const namesItsProviderAlready = entries.some(
        ([key, value]) => key === "provider" && typeof value === "string"
      );
      for (const [key, value] of entries) {
        if (
          (key === "model" || key === "primary") &&
          typeof value === "string" &&
          !namesItsProviderAlready
        ) {
          refs.push(value);
        }
        walk(value);
      }
    };
    walk(config);

    // The walk must actually find them — a guard over an empty list passes.
    expect(refs.length).toBeGreaterThanOrEqual(4);
    for (const ref of refs) {
      expect(ref, `${ref} names no provider`).toMatch(/^openrouter\//);
    }
  });

  it("the guard actually fires — a bogus root key is caught", () => {
    // Mutation check. A test that can't fail isn't a guard, and this one is
    // only worth its maintenance cost if it catches the thing it claims to.
    expect(ACCEPTED_ROOT_KEYS.has("http")).toBe(false);
    expect(ACCEPTED_ROOT_KEYS.has("gateway")).toBe(true);
  });
});
