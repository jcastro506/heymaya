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
import { SAFETY_CRITIC_MODEL } from "../../../../maya/outbound";
import { BUNDLED_MAYA_PLUGIN_TOOLS } from "../bundledPlugin";
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
        channels: [{ channel: "tiktok", postingMode: "just_go" }],
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
        channels: [{ channel: "tiktok", postingMode: "just_go" }],
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
        channels: [{ channel: "tiktok", postingMode: "just_go" }],
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

describe("THE CRITIQUE SUBAGENT IS GONE, AND THAT'S RECORDED", () => {
  const config = JSON.parse(
    buildMayaWorkspace({
      founder: { email: "sam@example.com", name: "Sam", timezone: "UTC" },
      product: { name: "Widgetly", url: "https://widgetly.dev" },
      channels: [],
    }).files.get(OPENCLAW_CONFIG_PATH)!
  );

  it("⛔ no critique agent — it killed every turn that invoked it", () => {
    // It resolved to moonshotai/kimi-k2-0905, which appears NOWHERE in the
    // config, and 400'd on every call. A subagent failure is not contained:
    // it surfaces as FailoverError and kills the PARENT turn, so the founder
    // got "No response from OpenClaw" for anything touching drafting.
    const ids = (config.agents.list as Array<{ id: string }>).map((a) => a.id);
    expect(ids).not.toContain("critique");
  });

  it("and main cannot delegate to an agent that isn't there", () => {
    const main = (config.agents.list as Array<{ id: string; subagents?: { allowAgents?: string[] } }>)
      .find((a) => a.id === "main");
    expect(main?.subagents?.allowAgents ?? []).toEqual([]);
  });

  it("⭐ BUT THE SAFETY GUARANTEE STILL EXISTS, SERVER-SIDE", () => {
    // The critique moved to convex/maya/outbound.ts: different family, fails
    // CLOSED, and at the publish gate where she cannot route around it. The
    // subagent was a critic she chose to invoke; this one she cannot skip.
    // Different family is the only rule the critic has: a model cannot see the
    // tells that are its own defaults. An openai/* critic judging luna-pro
    // approves its own register, which is no critic at all.
    expect(SAFETY_CRITIC_MODEL).not.toMatch(/^openai\//);
    expect(SAFETY_CRITIC_MODEL).toMatch(/^(google|moonshotai|qwen|anthropic)\//);
    // And a direct REST call, so no OpenClaw provider prefix.
    expect(SAFETY_CRITIC_MODEL).not.toMatch(/^openrouter\//);
  });

  it("EVERY TOOL PROFILE IS STILL ONE OPENCLAW ACCEPTS", () => {
    // An invented profile doesn't degrade — the gateway refuses to start.
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
});

describe("SHE HAS A DAY, NOT JUST A REPORTING SCHEDULE", () => {
  const cron = JSON.parse(
    buildMayaWorkspace({
      founder: { email: "sam@example.com", name: "Sam", timezone: "America/Los_Angeles" },
      product: { name: "Widgetly", url: "https://widgetly.dev" },
      channels: [{ channel: "tiktok", postingMode: "just_go" }],
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

  it("⭐ EVERY DAILY JOB TARGETS `isolated`, NEVER `main`", () => {
    // A `main` job enqueues a system event and defers to the heartbeat — it
    // does not run an agent turn. Live 2026-08-05: 12 hours of a daily loop
    // where every main-targeted job reported `skipped` and only the one
    // isolated job ever ran.
    for (const job of cron.jobs) {
      expect(job.sessionTarget, `${job.id} would be skipped`).toBe("isolated");
    }
  });

  it("the runner never tries to deliver — she does, via `update`", () => {
    // Default is `announce -> last`, which on this machine resolves to "no
    // route, will fail-closed" — her OpenClaw has no Telegram and can't have
    // one. A second delivery path that can only fail makes "the brief didn't
    // arrive" ambiguous between two mechanisms.
    for (const job of cron.jobs) {
      expect(job.delivery?.mode, `${job.id}`).toBe("none");
    }
  });

  it("⭐ SOMETHING MAKES THE WEEKLY DECISION", () => {
    /**
     * `pick-the-week` describes a Monday ritual — one shape, five to seven
     * variations, asked once — and for its whole existence NOTHING TRIGGERED
     * IT. A skill describing a day that never arrives is the built-and-unwired
     * defect this codebase produces more than any other.
     */
    expect(ids).toContain("0014_weekly_pick");
    const [, , , , dow] = at("0014_weekly_pick").split(" ");
    expect(dow, "the week is picked on Monday").toBe("1");
  });

  it("the week is picked BEFORE the day's placement is made", () => {
    // A placement that runs first would be built on last week's shape, and the
    // founder would see the change a day late every Monday.
    const hour = (expr: string) => Number(expr.split(" ")[1]);
    expect(hour(at("0014_weekly_pick"))).toBeLessThan(
      hour(at("0011_daily_placement"))
    );
  });

  it("⭐ THE WEEKLY PICK REACHES FOR RUNG-1 EVIDENCE BY NAME", () => {
    /**
     * ⚠️ Asserted on the TOOL NAME, not on the prose around it — these
     * messages are prompt text and get rewritten, so a substring match on the
     * wording is a false-alarm generator. `ad_intel` is a stable identifier:
     * if it disappears from this message, the ladder's top rung is unreachable
     * again and the pick silently falls back to organic posts.
     */
    const pick = (
      cron.jobs.find((j: { id: string }) => j.id === "0014_weekly_pick") as {
        payload: { message: string };
      }
    ).payload.message;
    expect(pick).toContain("ad_intel");
  });

  it("⭐ EVERY TOOL HER CRONS TELL HER TO CALL IS ACTUALLY REGISTERED", () => {
    /**
     * The sibling-file check. A cron instructing her to call something the
     * plugin never registered produces a turn that fails on a live machine and
     * a founder who hears nothing — invisible in every other test.
     *
     * ⚠️ This list is maintained BY HAND on purpose. Scanning the messages for
     * backticked words cannot tell a tool name from prose (`show_me_first` is a
     * hold reason, not a tool), and a scan that skips what it cannot classify
     * asserts nothing at all while looking thorough.
     */
    const TOOLS_THE_DAY_DEPENDS_ON = [
      "history", // morning brief + weekly review
      "ad_intel", // weekly pick — rung 1 of the ladder
      "weekly_read", // weekly review
      "checkpoint", // daily memory checkpoint
    ];
    for (const tool of TOOLS_THE_DAY_DEPENDS_ON) {
      expect(BUNDLED_MAYA_PLUGIN_TOOLS, `${tool} is not registered`).toContain(
        tool
      );
    }

    const allMessages = cron.jobs
      .map((j: { payload: { message: string } }) => j.payload.message)
      .join("\n");
    for (const tool of TOOLS_THE_DAY_DEPENDS_ON) {
      expect(allMessages, `no cron ever calls ${tool}`).toContain(tool);
    }
  });

  it("every job runs in the FOUNDER'S timezone", () => {
    // A 07:00 UTC brief is a 23:00 brief in Los Angeles — the double-timezone
    // bug v1 shipped, which made everything four hours late.
    for (const job of cron.jobs) {
      expect(job.schedule.tz).toBe("America/Los_Angeles");
    }
  });
});
