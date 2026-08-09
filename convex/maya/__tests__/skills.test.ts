/**
 * Sibling-file coherence for the `maya` skill pack.
 *
 * Skills are prose, so they can't be typechecked — which is exactly why they
 * rot. The failures this catches are all ones that have actually happened in
 * this repo's history: a skill naming a tool that doesn't exist, a skill copied
 * from the frozen pack still talking about a dead channel, a rule stated in one
 * file and contradicted in another.
 *
 * Asserting on structure and stable identifiers, never on generated prose — the
 * wording of these skills will change weekly and a substring match on a
 * sentence is a false-alarm generator.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PACK = join(__dirname, "..", "..", "..", "agents", "skills", "maya");
const HOOKS = join(__dirname, "..", "hooks.ts");
const HTTP = join(__dirname, "..", "..", "http.ts");

function skillDirs(): string[] {
  return readdirSync(PACK).filter(
    (name) =>
      // ⚠️ `PLATFORM_ALGO/` is channel expertise, not a skill: it holds
      // `{channel}.md`, not a `SKILL.md`. Every check here reads `SKILL.md`
      // from each directory, so leaving it in makes the whole file ENOENT
      // rather than fail one assertion.
      name !== PLATFORM_ALGO_DIR && statSync(join(PACK, name)).isDirectory()
  );
}

/** Channel prose the skills cite. Covered by its own checks below. */
const PLATFORM_ALGO_DIR = "PLATFORM_ALGO";

function read(name: string): string {
  return readFileSync(join(PACK, name, "SKILL.md"), "utf8");
}

function frontmatter(source: string): Record<string, string> {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

const EXPECTED = ["write-post", "critique", "answer-people"];

describe("the pack is shaped the way the loader expects", () => {
  it("ships exactly the Sprint 3 skills", () => {
    expect(skillDirs().sort()).toEqual([...EXPECTED].sort());
  });

  it("every skill has frontmatter whose name matches its directory", () => {
    // A mismatch here loads a skill under a name nothing invokes — it's present,
    // it's in the prompt budget, and it never fires.
    for (const dir of skillDirs()) {
      const fm = frontmatter(read(dir));
      expect(fm.name, `${dir} frontmatter name`).toBe(dir);
      expect(fm.description?.length ?? 0).toBeGreaterThan(40);
    }
  });

  it("every skill defers to CONVENTIONS.md rather than restating it", () => {
    // A rule stated in four files drifts in four directions.
    for (const dir of skillDirs()) {
      expect(read(dir), `${dir} should point at CONVENTIONS.md`).toMatch(
        /CONVENTIONS\.md/
      );
    }
  });
});

describe("DEAD CHANNELS STAY DEAD", () => {
  it("no skill mentions LinkedIn or Reddit", () => {
    // Both belonged to a product that was deleted. The frozen maya-gtm pack is
    // still full of them, so a copy-paste from there is the likeliest way one
    // reappears — and it would have Maya confidently working a channel that has
    // no connection, no tool, and no wrapper.
    for (const dir of [...skillDirs(), null]) {
      const source = dir ? read(dir) : readFileSync(join(PACK, "CONVENTIONS.md"), "utf8");
      const label = dir ?? "CONVENTIONS.md";
      // CONVENTIONS.md names them once, to say they are NOT channels.
      const mentions = (source.match(/linkedin|reddit/gi) ?? []).length;
      if (label === "CONVENTIONS.md") {
        expect(mentions).toBeGreaterThan(0); // the explicit "these are not channels" note
      } else {
        expect(mentions, `${label} mentions a dead channel`).toBe(0);
      }
    }
  });

  it("the four live channels are the only ones CONVENTIONS names as channels", () => {
    const source = readFileSync(join(PACK, "CONVENTIONS.md"), "utf8");
    for (const channel of ["TikTok", "Instagram", "YouTube", "X"]) {
      expect(source).toContain(channel);
    }
  });
});

describe("SKILLS ONLY NAME THINGS THAT ACTUALLY EXIST", () => {
  /**
   * Prose in backticks that is deliberately NOT a callable.
   *
   * An explicit allowlist rather than a clever regex: the first version of this
   * test matched only a hand-written list of tool names, which meant a
   * *fabricated* name — the entire failure being guarded against — was skipped
   * rather than caught. It missed a real one (`listCommentedPosts`, named in
   * the spec, never wrapped). Anything not listed here must resolve to real
   * code, so a new invented name fails by default instead of slipping through.
   */
  const NOT_A_TOOL = new Set([
    "exec", // named to forbid it
    "maya", // the pack
    "next", // envelope fields
    "why",
    "ok",
    "data",
    "preflight", // a server step, not an agent-callable tool
  ]);

  function calledNames(source: string): string[] {
    return [...source.matchAll(/`([a-z][A-Za-z0-9_]{2,})`/g)].map((m) => m[1]);
  }

  it("every backticked identifier is a real route, wrapper, or skill", () => {
    // The failure this prevents: a skill instructs the model to call something
    // that was never built. The model tries, gets nothing, and — as observed on
    // the live machine with the research workers — fabricates the result rather
    // than reporting the gap.
    const http = readFileSync(HTTP, "utf8");
    const zernio = readFileSync(
      join(__dirname, "..", "..", "integrations", "zernio", "endpoints.ts"),
      "utf8"
    );

    const real = new Set<string>(EXPECTED);
    for (const m of http.matchAll(/path: "\/maya\/([a-z_]+)"/g)) real.add(m[1]);
    for (const m of zernio.matchAll(/^export (?:async )?function (\w+)/gm)) {
      real.add(m[1]);
    }

    const unknown: string[] = [];
    for (const dir of skillDirs()) {
      // Blockquotes are where a skill documents something that does NOT exist,
      // which is the honest way to record a gap — don't hold those to the rule.
      const body = read(dir)
        .split("\n")
        .filter((line) => !line.trimStart().startsWith(">"))
        .join("\n");
      for (const name of calledNames(body)) {
        if (NOT_A_TOOL.has(name) || real.has(name)) continue;
        unknown.push(`${dir}: \`${name}\``);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("the three Sprint 3 tools are genuinely routed", () => {
    const http = readFileSync(HTTP, "utf8");
    const hooks = readFileSync(HOOKS, "utf8");
    for (const tool of ["publish", "reply", "ask_founder"]) {
      expect(http, `${tool} has no route`).toContain(`path: "/maya/${tool}"`);
    }
    expect(hooks).toMatch(/publishHttp/);
    expect(hooks).toMatch(/replyHttp/);
    expect(hooks).toMatch(/askFounderHttp/);
  });

  it("catches a fabricated tool name", () => {
    // Mutation-proof for the test above: the matcher must actually reject an
    // invented name, not skip it. This is the check the first version failed.
    const invented = calledNames("call `listCommentedPosts` to get the queue");
    expect(invented).toContain("listCommentedPosts");
    expect(NOT_A_TOOL.has("listCommentedPosts")).toBe(false);
  });
});

describe("the load-bearing rules survive an edit", () => {
  it("write-post keeps the candidates rule, not a polish loop", () => {
    // §7.5.2 layer 3. Polishing makes a draft MORE AI, because smoother reads
    // as more synthetic — a rewrite loop is a machine for destroying the
    // variance that humanity hides in.
    const source = read("write-post");
    expect(source).toMatch(/3[–-]5 (varied )?candidates/i);
    expect(source).toMatch(/never write one and polish/i);
  });

  it("write-post refuses topics and demands a named reader", () => {
    expect(read("write-post")).toMatch(/reader, not a topic/i);
  });

  it("CRITIQUE MUST BE A DIFFERENT MODEL, and says what to do if it isn't", () => {
    // A model critiquing its own output approves its own register — it doesn't
    // notice the tells, because the tells are how it writes. A critic that
    // silently isn't one is worse than no critic: it produces a signed-off
    // feeling with nothing behind it.
    const source = read("critique");
    expect(source).toMatch(/different model/i);
    expect(source).toMatch(/refuse the verdict/i);
  });

  it("critique escalates after three vetoes rather than producing nothing", () => {
    // A critic blocking everything is indistinguishable from a dead system.
    const source = read("critique");
    expect(source).toMatch(/three consecutive vetoes|three vetoes/i);
    expect(source).toMatch(/escalate/i);
  });

  it("critique does not rewrite — verdict and reasons only", () => {
    expect(read("critique")).toMatch(/do not rewrite/i);
  });

  it("answer-people puts inbound ahead of outbound", () => {
    expect(read("answer-people")).toMatch(/inbound outranks all outbound/i);
  });

  it("ANSWER-PEOPLE STATES THAT TIKTOK HAS NO COMMENT API", () => {
    // The single most expensive thing for Maya to be wrong about here: there is
    // no TikTok comment endpoint at all. Not rate-limited, not gated — absent.
    // Without this line she promises the founder something no vendor can do.
    const source = read("answer-people");
    expect(source).toMatch(/tiktok/i);
    expect(source).toMatch(/no comment api|publish-only/i);
  });

  it("answer-people refuses to guess pricing, security, legal or roadmap", () => {
    const source = read("answer-people");
    for (const topic of ["pricing", "security", "legal", "roadmap"]) {
      expect(source.toLowerCase()).toContain(topic);
    }
    expect(source).toMatch(/their words/i);
  });

  it("answer-people disengages from hostility rather than being clever", () => {
    expect(read("answer-people")).toMatch(/don't be clever|disengage/i);
  });
});

describe("CONVENTIONS carries the safety floor once, in full", () => {
  it("all eight rules are present", () => {
    const source = readFileSync(join(PACK, "CONVENTIONS.md"), "utf8");
    for (let n = 1; n <= 8; n += 1) {
      expect(source, `safety floor rule ${n}`).toMatch(
        new RegExp(`^${n}\\. `, "m")
      );
    }
  });

  it("the envelope contract and the 'next wins' rule are stated", () => {
    // Principle 8. `next` is what stops a retry loop, and a skill that treats
    // it as commentary is how the loop comes back.
    const source = readFileSync(join(PACK, "CONVENTIONS.md"), "utf8");
    expect(source).toMatch(/\{\s*ok,\s*data,\s*next,\s*why\s*\}/);
    expect(source).toMatch(/do not retry/i);
  });

  it("forbids hand-written HTTP and shell as a route around a missing tool", () => {
    // Observed live on the frozen pack: workers that couldn't call a tool
    // improvised with `exec`, failed the shell quoting, and fabricated the
    // research report rather than reporting the gap.
    const source = readFileSync(join(PACK, "CONVENTIONS.md"), "utf8");
    expect(source).toMatch(/never hand-write an http call/i);
  });
});
