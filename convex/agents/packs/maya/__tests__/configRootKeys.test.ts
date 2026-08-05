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
import {
  buildMayaWorkspace,
  OPENCLAW_CONFIG_PATH,
  CRON_STORE_PATH,
} from "../generators";

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

describe("THE CRITIC CANNOT ACT ON ITS OWN VERDICT", () => {
  const config = JSON.parse(
    buildMayaWorkspace({
      founder: { email: "sam@example.com", name: "Sam", timezone: "UTC" },
      product: { name: "Widgetly", url: "https://widgetly.dev" },
      channels: [],
    }).files.get(OPENCLAW_CONFIG_PATH)!
  );
  const critic = config.agents.list.find(
    (a: { id: string }) => a.id === "critique"
  );

  it("⭐ IT HAS NO PLUGIN TOOLS — it cannot publish what it just approved", () => {
    // And it doesn't work with them: inheriting the default tool surface,
    // kimi-k2 rejects the payload with a 400 and the critic never runs at all.
    // A gate that crashes is a gate that fails OPEN — every draft passes
    // review because review died. Observed live 2026-08-04.
    expect(critic.tools.deny).toContain("group:plugins");
    expect(critic.tools.profile).toBe("minimal");
  });

  it("⭐ EVERY TOOL PROFILE IS ONE OPENCLAW ACCEPTS", () => {
    // An invented profile doesn't degrade — the gateway REFUSES TO START.
    // Shipped "readonly" on 2026-08-05; the allowed set is exactly these four.
    const ALLOWED = ["minimal", "coding", "messaging", "full"];
    for (const agent of config.agents.list as Array<{
      id: string;
      tools?: { profile?: string };
    }>) {
      if (!agent.tools?.profile) continue;
      expect(ALLOWED, `${agent.id} has an invalid tools profile`).toContain(
        agent.tools.profile
      );
    }
  });

  it("it cannot spawn its way around the restriction", () => {
    expect(critic.subagents.allowAgents).toEqual([]);
  });

  it("and it still runs on a different family than the writer", () => {
    expect(critic.model.split("/")[1]).not.toBe(
      config.agents.defaults.model.primary.split("/")[1]
    );
  });
});

describe("SHE HAS A DAY, NOT JUST A REPORTING SCHEDULE", () => {
  const cron = JSON.parse(
    buildMayaWorkspace({
      founder: { email: "sam@example.com", name: "Sam", timezone: "America/Los_Angeles" },
      product: { name: "Widgetly", url: "https://widgetly.dev" },
      channels: [{ channel: "x", postingMode: "just_go" }],
    }).files.get(CRON_STORE_PATH)!
  );
  const ids: string[] = cron.jobs.map((j: { id: string }) => j.id);
  const at = (id: string) =>
    (
      cron.jobs.find((j: { id: string }) => j.id === id) as {
        schedule: { expr: string };
      }
    ).schedule.expr;

  it("⭐ SOMETHING ACTUALLY MAKES A PLACEMENT", () => {
    // Sprint 3's exit is a placement a day for seven days. Before this, her
    // crons briefed, recapped and reviewed a day that never happened — nothing
    // scheduled produced a post.
    expect(ids).toContain("0011_daily_placement");
  });

  it("⭐ SHE READS BEFORE SHE WRITES", () => {
    // Without the sweep she writes from product truth alone, which is the same
    // post every day. Verified live: three requested tweets came back as one
    // sentence reworded three times.
    expect(ids).toContain("0008_scroll");
  });

  it("THE BRIEF RUNS AFTER THE SWEEP, or it reports on nothing", () => {
    // Ordering is the entire reason for having both. Same-minute scheduling
    // would make the brief describe a scroll that hadn't returned.
    const minutes = (expr: string) => {
      const [m, h] = expr.split(" ");
      return Number(h) * 60 + Number(m);
    };
    expect(minutes(at("0010_morning_brief"))).toBeGreaterThan(
      minutes(at("0008_scroll"))
    );
  });

  it("and the placement comes after the brief", () => {
    const hour = (expr: string) => Number(expr.split(" ")[1]);
    expect(hour(at("0011_daily_placement"))).toBeGreaterThan(
      hour(at("0010_morning_brief"))
    );
  });

  it("every job runs in the FOUNDER'S timezone", () => {
    // A 07:00 UTC brief is a 23:00 brief in Los Angeles — the double-timezone
    // bug v1 shipped, which made everything four hours late.
    for (const job of cron.jobs) {
      expect(job.schedule.tz).toBe("America/Los_Angeles");
    }
  });
});
