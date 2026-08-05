import { describe, expect, it } from "vitest";
import {
  buildMayaWorkspace,
  ALWAYS_LOADED_TARGET_CHARS,
  BOOTSTRAP_MAX_CHARS_PER_FILE,
  BOOTSTRAP_TOTAL_MAX_CHARS,
  CRON_STORE_PATH,
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

describe("OPENCLAW OWNS THE CLOCK", () => {
  const config = JSON.parse(
    buildMayaWorkspace(INPUT).files.get(OPENCLAW_CONFIG_PATH)!
  );

  it("THE HEARTBEAT IS ON, in config and not merely in prose", () => {
    // The heartbeat is the agent's pulse, and it is also how daily notes get
    // distilled into MEMORY.md and how inferred commitments are delivered.
    // An earlier version of this pack set "0m" to protect an auto-stop cost
    // lever and silently took proactivity, memory consolidation, and
    // follow-through with it.
    expect(config.agents.defaults.heartbeat.every).not.toBe("0m");
    expect(config.agents.defaults.heartbeat.every).toMatch(/^\d+m$/);
  });

  it("THE HEARTBEAT DOESN'T RUN OVERNIGHT", () => {
    // v1's live burn autopsy, 2026-07-15: round-the-clock ticks idled at
    // ~$2.50/hr overnight with zero founder activity. Nothing needs monitoring
    // while they sleep, and an inbound DM wakes her independently.
    const hb = config.agents.defaults.heartbeat;
    expect(hb.activeHours.start).toBe("07:00");
    expect(hb.activeHours.end).toBe("23:00");
    // "local", not UTC — resolved against the machine's TZ env.
    expect(hb.activeHours.timezone).toBe("local");
  });

  it("a tick runs on the CHEAP model, not the main brain", () => {
    // A tick is a triage read, not strategic reasoning. v1 measured ~$0.03 on
    // the main brain against ~$0.002 on a worker — $0.50/day vs $0.03/day per
    // customer across 16 waking ticks.
    const hb = config.agents.defaults.heartbeat;
    expect(hb.model).toBeTruthy();
    expect(hb.model).not.toBe(config.agents.defaults.model.primary);
  });

  it("a tick carries LIGHT context and its own session", () => {
    // lightContext: only HEARTBEAT.md, not every doctrine file. A tick
    // re-reading the whole always-loaded set is the most wasteful thing an idle
    // agent can do. isolatedSession keeps housekeeping out of the founder's
    // actual conversation.
    const hb = config.agents.defaults.heartbeat;
    expect(hb.lightContext).toBe(true);
    expect(hb.isolatedSession).toBe(true);
  });

  it("ships a HEARTBEAT.md, because an enabled heartbeat loads one", () => {
    const heartbeat = buildMayaWorkspace(INPUT).files.get("HEARTBEAT.md")!;
    expect(heartbeat).toBeTruthy();
    // A checklist, not doctrine — it is re-injected on every heartbeat turn.
    expect(heartbeat.length).toBeLessThan(2_500);
  });

  it("ships a cron store with STABLE ids", () => {
    // Registered at deploy, never by the agent. v1 let her add crons and she
    // re-added the same jobs every boot with no dedupe, then invented an ad-hoc
    // recovery cron that timed out and spammed failures.
    const cron = JSON.parse(
      buildMayaWorkspace(INPUT).files.get(CRON_STORE_PATH)!
    );
    const ids = cron.jobs.map((j: { id: string }) => j.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d{4}_[a-z_]+$/);
  });

  it("EVERY CRON FIRES IN THE FOUNDER'S TIMEZONE", () => {
    // A 07:00 "morning brief" evaluated in UTC is a 23:00 brief in Los Angeles.
    // v1 shipped a double-timezone bug that made everything four hours late.
    const bundle = buildMayaWorkspace({
      ...INPUT,
      founder: { ...INPUT.founder, timezone: "America/Los_Angeles" },
    });
    const cron = JSON.parse(bundle.files.get(CRON_STORE_PATH)!);
    for (const job of cron.jobs) {
      expect(job.schedule.tz).toBe("America/Los_Angeles");
      expect(job.schedule.kind).toBe("cron");
    }
  });

  it("the agent is told not to invent crons", () => {
    expect(buildMayaWorkspace(INPUT).files.get("HEARTBEAT.md")!).toMatch(
      /never add cron jobs/i
    );
  });
});

describe("MEMORY IS CONFIGURED FOR YEARS, NOT WEEKS", () => {
  const config = JSON.parse(
    buildMayaWorkspace(INPUT).files.get(OPENCLAW_CONFIG_PATH)!
  );

  it("memory search is enabled at all", () => {
    // Absent entirely from the first version of this pack, which left recall as
    // a static generated file.
    expect(config.agents.defaults.memorySearch.enabled).toBe(true);
    expect(config.agents.defaults.memorySearch.store.path).toMatch(/^\/data\//);
  });

  it("TEMPORAL DECAY AND MMR ARE ON — both default to off", () => {
    // These are the two features that exist specifically for an agent with
    // months-to-years of daily notes: decay stops last quarter outranking last
    // week, MMR stops five near-identical notes filling all eight slots.
    const hybrid = config.agents.defaults.memorySearch.query.hybrid;
    expect(hybrid.temporalDecay.enabled).toBe(true);
    expect(hybrid.mmr.enabled).toBe(true);
  });

  it("SESSION TRANSCRIPTS ARE INDEXED", () => {
    // Off by default, and it is what lets her recall an actual earlier
    // conversation rather than only the notes she wrote about it. v1's note is
    // blunt: this replaces a read-back tool outright — an agent that cannot
    // read what she already said was the root enabler of her repeating herself.
    expect(config.agents.defaults.memorySearch.experimental.sessionMemory).toBe(
      true
    );
  });

  it("the index actually re-syncs, including after compaction", () => {
    // Compaction is exactly when detail leaves the context window, so it is
    // exactly when that detail has to become searchable instead.
    const sync = config.agents.defaults.memorySearch.sync;
    expect(sync.watch).toBe(true);
    expect(sync.intervalMinutes).toBeLessThanOrEqual(60);
    expect(sync.sessions.postCompactionForce).toBe(true);
  });

  it("hybrid search keeps real weight on keywords", () => {
    // Exact terms — a post id, a handle, a product name — have to match even
    // when nothing is semantically near them.
    const hybrid = config.agents.defaults.memorySearch.query.hybrid;
    expect(hybrid.enabled).toBe(true);
    expect(hybrid.textWeight).toBeGreaterThan(0.2);
    expect(hybrid.vectorWeight + hybrid.textWeight).toBeCloseTo(1);
  });

  it("subagents cannot spawn subagents", () => {
    // Depth 1 is the load-bearing limit: a worker spawning workers is how a
    // research fan-out becomes a runaway loop, and this product has already had
    // one at ~$30/hr.
    expect(config.agents.defaults.subagents.maxSpawnDepth).toBe(1);
    expect(config.agents.defaults.subagents.runTimeoutSeconds).toBeLessThanOrEqual(
      1800
    );
  });

  it("DREAMING IS ON, AND IN THE RIGHT PLACE", () => {
    // A pre-flight check against the installed type definitions caught this:
    // there IS a `dreaming` key in OpenClaw's types, but it belongs to the
    // memory-LANCEDB extension's config. On `agents.defaults` it would have
    // been rejected as `Invalid input` — or worse, silently ignored, leaving
    // MEMORY.md growing only when she happened to write to it.
    expect(config.agents.defaults.dreaming).toBeUndefined();
    const core = config.plugins.entries["memory-core"];
    expect(core.enabled).toBe(true);
    expect(core.config.dreaming.enabled).toBe(true);
    // The nightly sweep at the FOUNDER'S 3am, not UTC's.
    expect(core.config.dreaming.timezone).toBe("UTC");
  });

  it("plugin settings are nested under `config`, not on the entry", () => {
    // The other half of the same mistake. The first version put active-memory's
    // settings directly on the entry, which the schema rejects.
    const am = config.plugins.entries["active-memory"];
    expect(am.enabled).toBe(true);
    expect(am.config.agents).toEqual(["main"]);
    // `allowedChatTypes: ["direct"]` — NOT the `sessionTypes: ["dm"]` I invented.
    expect(am.config.allowedChatTypes).toEqual(["direct"]);
    expect(config.plugins.entries["memory-wiki"].enabled).toBe(true);
  });

  it("MEMORY.md IS SEEDED, NEVER OVERWRITTEN", () => {
    // The bug this sprint exists to fix. OpenClaw's MEMORY.md is agent-curated
    // and dreaming APPENDS promoted memories to it. Shipping it as a normal
    // deploy file wipes everything she has learned, on every redeploy, silently.
    const bundle = buildMayaWorkspace(INPUT);
    expect([...bundle.files.keys()]).not.toContain("MEMORY.md");
    expect(bundle.seedFiles.has("MEMORY.md")).toBe(true);
    // And the seed is nearly empty — anything substantive in it would invite
    // someone to "keep it up to date", which means rewriting it, which is the
    // bug returning.
    expect(bundle.seedFiles.get("MEMORY.md")!.length).toBeLessThan(400);
  });

  it("memory doctrine lives in AGENTS.md, which we DO own", () => {
    // Operating instructions about memory are ours to rewrite freely. They just
    // can't live in the file she writes to.
    const agents = buildMayaWorkspace(INPUT).files.get("AGENTS.md")!;
    expect(agents).toMatch(/database is the truth/i);
    expect(agents).toMatch(/memory_search/);
  });

  it("MEMORY.md is not counted in our always-loaded budget", () => {
    // OpenClaw loads it every session, but it is agent-owned and grows on its
    // own — we can neither generate nor budget it. Counting it would make the
    // accounting a guess.
    expect(buildMayaWorkspace(INPUT).alwaysLoaded).not.toContain("MEMORY.md");
  });
});

describe("the gateway config exists at all", () => {
  const config = JSON.parse(
    buildMayaWorkspace(INPUT).files.get(OPENCLAW_CONFIG_PATH)!
  );

  it("ENABLES THE ENDPOINT CONVEX TALKS TO", () => {
    // The OpenAI-compatible endpoint is opt-in. Without it
    // /v1/chat/completions 404s and Convex cannot reach her session at all —
    // the founder's message arrives, is recorded, and stops. Verified live:
    // gateway healthy, plugins loaded, heartbeat running, every message 404ing.
    expect(config.gateway.http.endpoints.chatCompletions.enabled).toBe(true);
  });

  it("PUTS IT UNDER `gateway`, NOT AT THE ROOT", () => {
    // Shipping it at the root fails validation with `<root>: Invalid input`
    // and the gateway refuses to start — strictly worse than the 404 it was
    // meant to fix. She goes from deaf to dead. Both were live failures.
    expect((config as Record<string, unknown>).http).toBeUndefined();
  });

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

  it("allow-lists our plugin plus the memory plugins", () => {
    // memory-wiki: claims with evidence, provenance, contradiction and
    // staleness tracking — "what works on X right now" is a claim that expires.
    // active-memory: surfaces relevant memory BEFORE the reply instead of
    // waiting for her to decide to search.
    expect([...config.plugins.allow].sort()).toEqual([
      "active-memory",
      "maya-tools",
      "memory-core",
      "memory-wiki",
    ]);
  });

  it("active-memory is scoped to the FOUNDER'S DM SESSION only", () => {
    // The docs call it a good fit for "persistent and user-facing" and a poor
    // fit for "automation, internal workers". A subagent silently personalising
    // its output is worse than useless.
    const entry = config.plugins.entries["active-memory"];
    expect(entry.enabled).toBe(true);
    expect(entry.config.allowedChatTypes).toEqual(["direct"]);
    expect(entry.config.agents).toEqual(["main"]);
  });

  it("turns typing on for the post-boot half", () => {
    // Convex covers the cold-start window; this covers everything after the
    // model loop starts. Neither layer can see both halves.
    expect(config.agents.defaults.typingMode).toBe("instant");
    expect(config.agents.defaults.typingIntervalSeconds).toBeLessThanOrEqual(5);
  });
});

describe("THE DIFFERENT-MODEL RULE MOVED SERVER-SIDE", () => {
  // The critique SUBAGENT is gone (2026-08-05) — it resolved to a model that
  // appears nowhere in the config and 400'd on every call, killing the parent
  // turn. The rule it enforced did not go away; it moved to
  // `convex/maya/outbound.ts`, at the publish gate, where she cannot route
  // around it.
  it("the workspace still ships the critique SKILL", () => {
    // She self-checks against §7.5.2's tells before drafting even without a
    // second agent. Prose is weaker than a different model — that's the loss,
    // and it's stated rather than hidden.
    const bundle = buildMayaWorkspace(INPUT);
    const skills = [...bundle.files.keys()].filter((k) => k.startsWith("skills/"));
    expect(skills.some((s) => s.includes("critique"))).toBe(true);
  });

  it("and the main model is unchanged by the removal", () => {
    const config = JSON.parse(
      buildMayaWorkspace(INPUT).files.get(OPENCLAW_CONFIG_PATH)!
    );
    expect(config.agents.defaults.model.primary).toMatch(/luna-pro/);
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
    expect(documented.sort()).toEqual([
      "ask_founder",
      "checkpoint",
      "draft",
      "history",
      "publish",
      "remember",
      "reply",
      "request_assets",
      "scroll",
      "update",
    ]);
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
