import { describe, expect, it } from "vitest";
import {
  buildMayaWorkspace,
  ALWAYS_LOADED_TARGET_CHARS,
  BOOTSTRAP_MAX_CHARS_PER_FILE,
  BOOTSTRAP_TOTAL_MAX_CHARS,
  OPENCLAW_CONFIG_PATH,
  WORKSPACE_DIR,
  type MayaWorkspaceInput,
} from "../generators";
import { BUNDLED_MAYA_SKILLS, MAYA_CONVENTIONS } from "../bundledSkills";
import { HOLD_REASONS } from "../../../../maya/publishDecision";
import { readMayaSkills } from "../../../../../scripts/sync-maya-skills";

const INPUT: MayaWorkspaceInput = {
  founder: { email: "founder@example.com", name: "Sam", timezone: "UTC" },
  product: {
    name: "Widgetly",
    url: "https://widgetly.dev",
    truth: "turns a CSV into a dashboard in one paste",
  },
  channels: [{ channel: "x", postingMode: "just_go" }],
};

describe("THE PROMPT BUDGET IS MEASURED, NOT HOPED FOR", () => {
  it("the always-loaded set fits, with real headroom", () => {
    const bundle = buildMayaWorkspace(INPUT);
    expect(bundle.alwaysLoadedChars).toBeLessThan(ALWAYS_LOADED_TARGET_CHARS);
    expect(bundle.alwaysLoadedChars).toBeLessThan(BOOTSTRAP_TOTAL_MAX_CHARS);
    // And it isn't empty — a budget test passes trivially if nothing renders.
    expect(bundle.alwaysLoadedChars).toBeGreaterThan(3_000);
  });

  it("NO SINGLE FILE EXCEEDS THE PER-FILE INJECTION CAP", () => {
    // The check the first version of this test was missing entirely.
    //
    // OpenClaw truncates any bootstrap file over `bootstrapMaxChars` SILENTLY.
    // The v1 pack hit this in production on 2026-05-27: BOOT.md 15K, TOOLS.md
    // 17K and AGENTS.md 14.5K were each cut to 12K, dropping end-of-file
    // content including a hard gate and several procedures — with no error.
    //
    // A total-only budget test would pass a workspace whose AGENTS.md the
    // runtime then quietly halves, which is the worst kind of green.
    const bundle = buildMayaWorkspace(INPUT);
    for (const [name, body] of bundle.files) {
      if (name === OPENCLAW_CONFIG_PATH) continue; // config, not injected
      expect(
        body.length,
        `${name} would be silently truncated at injection`
      ).toBeLessThan(BOOTSTRAP_MAX_CHARS_PER_FILE);
    }
  });

  it("the config RAISES both caps rather than relying on defaults", () => {
    // Defaults are 12,000 per file and 60,000 total. Both default failure modes
    // are documented production incidents on v1, and both are silent — the
    // second one dropped BOOT.md entirely and the agent came up with no
    // instructions at all.
    const config = JSON.parse(
      buildMayaWorkspace(INPUT).files.get(OPENCLAW_CONFIG_PATH)!
    );
    expect(config.agents.defaults.bootstrapMaxChars).toBe(
      BOOTSTRAP_MAX_CHARS_PER_FILE
    );
    expect(config.agents.defaults.bootstrapTotalMaxChars).toBe(
      BOOTSTRAP_TOTAL_MAX_CHARS
    );
    expect(config.agents.defaults.bootstrapMaxChars).toBeGreaterThan(12_000);
    expect(config.agents.defaults.bootstrapTotalMaxChars).toBeGreaterThan(60_000);
  });

  it("counts every always-loaded file and nothing else", () => {
    const bundle = buildMayaWorkspace(INPUT);
    const summed = bundle.alwaysLoaded.reduce(
      (n, name) => n + (bundle.files.get(name)?.length ?? 0),
      0
    );
    expect(summed).toBe(bundle.alwaysLoadedChars);
    // Every name in the list must actually resolve to a file — a typo would
    // silently drop a file from the accounting and understate the budget.
    for (const name of bundle.alwaysLoaded) {
      expect(bundle.files.has(name), `${name} missing`).toBe(true);
    }
  });

  it("skills and platform norms do NOT count against the always-loaded budget", () => {
    // They're loaded on description match / when writing for that channel.
    // Counting them would force them to be smaller than they should be.
    const bundle = buildMayaWorkspace(INPUT);
    expect(bundle.alwaysLoaded).not.toContain("skills/write-post/SKILL.md");
    expect(bundle.alwaysLoaded.some((n) => n.startsWith("PLATFORM_ALGO"))).toBe(
      false
    );
    expect(bundle.alwaysLoaded).not.toContain("HEARTBEAT.md");
    expect(bundle.alwaysLoaded).not.toContain("BOOT.md");
  });

  it("stays inside budget even fully loaded with voice excerpts", () => {
    // SOUL.md is the file that grows — the excerpts are most of it (~20k
    // allocated). A realistic worst case must still fit.
    const heavy = buildMayaWorkspace({
      ...INPUT,
      voiceExcerpts: Array.from({ length: 40 }, (_, i) =>
        `${i}: ${"a real sentence this founder actually wrote. ".repeat(8)}`
      ),
      posture: "x".repeat(4_000),
      product: { ...INPUT.product, truth: "y".repeat(6_000) },
      channels: [
        { channel: "x", postingMode: "just_go" },
        { channel: "tiktok", postingMode: "show_me_first" },
        { channel: "instagram", postingMode: "just_go" },
        { channel: "youtube", postingMode: "just_go" },
      ],
    });
    expect(heavy.alwaysLoadedChars).toBeLessThan(ALWAYS_LOADED_TARGET_CHARS);
  });
});

describe("CONVEX OWNS THE CLOCK", () => {
  it("emits NO jobs.json — the machine must not schedule itself", () => {
    // v1 ships agent-side crons. That makes the machine awake in order to check
    // whether it should be awake, and a spinning heartbeat keeps it hot 24/7 by
    // definition. Auto-stop is a 10× cost lever ($100–400/mo against
    // $1,400–3,000 at 200 customers); a self-scheduling agent throws it away.
    //
    // Pinned because this is exactly what gets re-added by someone porting a
    // feature across from the v1 pack.
    const bundle = buildMayaWorkspace(INPUT);
    expect([...bundle.files.keys()]).not.toContain("jobs.json");
    for (const key of bundle.files.keys()) {
      expect(key).not.toMatch(/cron|schedule\.json/i);
    }
  });

  it("THE HEARTBEAT IS DISABLED IN CONFIG, not just in prose", () => {
    // OpenClaw's heartbeat defaults to every 30m — 48 wakes a day on a machine
    // that should wake ~6–15 times. That alone would undo the auto-stop
    // economics the deploy path is built around, and no amount of doctrine in
    // a markdown file changes a gateway default.
    const config = JSON.parse(
      buildMayaWorkspace(INPUT).files.get(OPENCLAW_CONFIG_PATH)!
    );
    expect(config.agents.defaults.heartbeat.every).toBe("0m");
  });

  it("ships NO HEARTBEAT.md, because a disabled heartbeat never loads one", () => {
    // Per the runtime docs: with `every: "0m"`, normal runs also omit
    // HEARTBEAT.md from bootstrap context. This pack used to ship one anyway —
    // budget spent on a file that could never load, and a lie to the next
    // person who read it and assumed it was live.
    expect([...buildMayaWorkspace(INPUT).files.keys()]).not.toContain(
      "HEARTBEAT.md"
    );
  });
});

describe("the gateway config exists at all", () => {
  const config = JSON.parse(
    buildMayaWorkspace(INPUT).files.get(OPENCLAW_CONFIG_PATH)!
  );

  it("is emitted — a workspace with no config is a folder, not an agent", () => {
    // The pack previously shipped NO config, so a machine would have booted on
    // defaults that contradict nearly every decision here: 30m heartbeat, the
    // wrong workspace directory, our bootstrap files re-seeded over, no plugin
    // allow-list, and no model.
    expect(config).toBeTruthy();
    expect(OPENCLAW_CONFIG_PATH.startsWith("/")).toBe(true);
  });

  it("points the workspace at the PERSISTENT VOLUME", () => {
    // Default is ~/.openclaw/workspace, which is ephemeral root. Sprint 2's
    // exit is "she answers from rows across a redeploy" — that needs the
    // workspace on the volume.
    expect(config.agents.defaults.workspace).toBe(WORKSPACE_DIR);
    expect(WORKSPACE_DIR.startsWith("/data")).toBe(true);
  });

  it("skips OpenClaw's bootstrap ritual so our files aren't re-seeded", () => {
    expect(config.agents.defaults.skipBootstrap).toBe(true);
  });

  it("allow-lists only our plugin", () => {
    expect(config.plugins.allow).toEqual(["maya-tools"]);
  });

  it("turns typing on for the post-boot half", () => {
    // Convex covers the cold-start window; this covers everything after the
    // model loop starts. Neither layer can see both halves.
    expect(config.agents.defaults.typingMode).toBe("instant");
    expect(config.agents.defaults.typingIntervalSeconds).toBeLessThanOrEqual(5);
  });
});

describe("THE CRITIC RUNS ON A GENUINELY DIFFERENT MODEL", () => {
  const config = JSON.parse(
    buildMayaWorkspace(INPUT).files.get(OPENCLAW_CONFIG_PATH)!
  );
  const critic = config.subagents.find(
    (s: { id: string }) => s.id === "critique"
  );

  it("binds critique to a model, structurally", () => {
    // The skill asks the model to refuse the verdict if it notices it IS the
    // writer's model — a prompt asking a model to introspect, which is the
    // weakest enforcement available. Configuration makes it true instead.
    expect(critic?.model).toBeTruthy();
    expect(critic.model).not.toBe(config.agents.defaults.model.primary);
  });

  it("is not merely a different REASONING MODE of the same model", () => {
    // The trap: `openai/gpt-5.6-luna` looks like a different model from
    // `openai/gpt-5.6-luna-pro` and isn't — the spec is explicit that luna-pro
    // "is the same underlying model as luna, served with reasoning.mode: pro".
    // A luna critic judging a luna-pro writer grades its own register and
    // catches nothing, which is exactly what the rule exists to prevent.
    const family = (m: string) => m.split("/")[1]?.replace(/-pro$/, "");
    expect(family(critic.model)).not.toBe(
      family(config.agents.defaults.model.primary)
    );
    // Different vendor entirely, which is the strongest available signal.
    expect(critic.model.split("/")[0]).not.toBe(
      config.agents.defaults.model.primary.split("/")[0]
    );
  });
});

describe("only the customer's own channels ship", () => {
  it("an X-only founder carries no TikTok, Instagram, or YouTube norms", () => {
    // §15.1.2 — a Solo customer on one channel should never pay context for
    // three others' norms.
    const keys = [...buildMayaWorkspace(INPUT).files.keys()];
    expect(keys).toContain("PLATFORM_ALGO/x.md");
    expect(keys).not.toContain("PLATFORM_ALGO/tiktok.md");
    expect(keys).not.toContain("PLATFORM_ALGO/instagram.md");
    expect(keys).not.toContain("PLATFORM_ALGO/youtube.md");
  });

  it("a four-channel founder gets all four", () => {
    const bundle = buildMayaWorkspace({
      ...INPUT,
      channels: (["x", "tiktok", "instagram", "youtube"] as const).map((c) => ({
        channel: c,
        postingMode: "just_go" as const,
      })),
    });
    for (const c of ["x", "tiktok", "instagram", "youtube"]) {
      expect(bundle.files.has(`PLATFORM_ALGO/${c}.md`)).toBe(true);
    }
  });

  it("TikTok's norms state the missing comment API and the consent rule", () => {
    // The two things about TikTok that are expensive to be wrong about.
    const bundle = buildMayaWorkspace({
      ...INPUT,
      channels: [{ channel: "tiktok", postingMode: "show_me_first" }],
    });
    const norms = bundle.files.get("PLATFORM_ALGO/tiktok.md")!;
    expect(norms).toMatch(/no comment api/i);
    expect(norms).toMatch(/their legal requirement|legal requirement/i);
  });

  it("X's norms say the 280 is WEIGHTED and not to count manually", () => {
    const norms = buildMayaWorkspace(INPUT).files.get("PLATFORM_ALGO/x.md")!;
    expect(norms).toMatch(/weighted/i);
    expect(norms).toMatch(/URL counts 23/i);
  });
});

describe("the doctrine stays coherent with the server", () => {
  const files = buildMayaWorkspace(INPUT).files;

  /**
   * Deliberately NOT substring-matching prose.
   *
   * The project rule is "assert on structure and stable identifiers, never on
   * generated prose — prompt text changes weekly, and a test that
   * substring-matches it is a false-alarm generator." The first draft of this
   * block broke on a LINE WRAP, which is precisely that failure: the doctrine
   * hadn't changed at all.
   *
   * What's asserted instead is agreement with code — identifiers that exist in
   * TypeScript and would fail to compile if renamed.
   */

  it("AGENTS.md names EXACTLY the hold reasons the server can return", () => {
    // The real coherence risk: the server gains or renames a hold reason and
    // the doctrine still describes the old set, so she relays a reason that no
    // longer exists — or worse, treats a new one as unexpected and retries.
    const agents = files.get("AGENTS.md")!;
    for (const reason of HOLD_REASONS) {
      expect(agents, `AGENTS.md omits ${reason}`).toContain(reason);
    }
    // And names no others: an invented fifth reason is a defect, and the
    // closed set is only closed if the doctrine agrees it's closed.
    const named = [...agents.matchAll(/`(\w+_\w+(?:_\w+)*)`/g)]
      .map((m) => m[1])
      .filter((token) => /^(show_me|safety|channel|tiktok)/.test(token));
    expect([...new Set(named)].sort()).toEqual([...HOLD_REASONS].sort());
  });

  it("TOOLS.md documents exactly the tools that have routes", () => {
    // A documented tool with no route is one the model will call and get
    // nothing from; a route with no docs is one it never learns exists.
    const tools = files.get("TOOLS.md")!;
    const documented = [...tools.matchAll(/\| `(\w+)` \|/g)].map((m) => m[1]);
    expect(documented.sort()).toEqual(["ask_founder", "publish", "reply"]);
  });

  it("TOOLS.md states the envelope contract verbatim", () => {
    // A stable contract string, not prose — this exact shape is what every
    // tool returns and what the plugin passes through untouched.
    expect(files.get("TOOLS.md")!).toContain("{ ok, data, next, why }");
  });

  it("every always-loaded file renders something real", () => {
    // Structure, not wording: an empty or stub file would sail past a prose
    // matcher looking for one phrase, and leave the agent with no doctrine.
    for (const name of buildMayaWorkspace(INPUT).alwaysLoaded) {
      const body = files.get(name)!;
      expect(body.length, `${name} is too thin to be real`).toBeGreaterThan(200);
      expect(body.startsWith("#"), `${name} has no heading`).toBe(true);
    }
  });

  it("SOUL.md degrades honestly when there are no writing samples", () => {
    // Structural: with no excerpts it must still render, and must not fabricate
    // a voice. Checked by comparing the two renders rather than matching prose.
    const thin = buildMayaWorkspace(INPUT).files.get("SOUL.md")!;
    const rich = buildMayaWorkspace({
      ...INPUT,
      voiceExcerpts: ["shipped the thing. it works. mostly."],
    }).files.get("SOUL.md")!;
    expect(thin).not.toBe(rich);
    expect(rich).toContain("shipped the thing. it works. mostly.");
    expect(thin.length).toBeGreaterThan(200);
  });
});

describe("the bundled skills match their source files", () => {
  it("has not drifted from agents/skills/maya/", () => {
    // Generated by `npm run sync:maya-skills`. Hand-editing the generated file
    // is how the frozen pack ended up shipping skills that disagreed with the
    // ones in the repo — this fails CI instead.
    const onDisk = readMayaSkills();
    expect(MAYA_CONVENTIONS).toBe(onDisk.conventions);
    expect(BUNDLED_MAYA_SKILLS.map((s) => s.slug)).toEqual(
      onDisk.skills.map((s) => s.slug)
    );
    for (const skill of onDisk.skills) {
      const bundled = BUNDLED_MAYA_SKILLS.find((s) => s.slug === skill.slug);
      expect(bundled?.body, `${skill.slug} drifted`).toBe(skill.body);
    }
  });

  it("ships all three skills plus CONVENTIONS into the workspace", () => {
    const files = buildMayaWorkspace(INPUT).files;
    for (const slug of ["write-post", "critique", "answer-people"]) {
      expect(files.has(`skills/${slug}/SKILL.md`), slug).toBe(true);
    }
    expect(files.has("CONVENTIONS.md")).toBe(true);
  });
});
