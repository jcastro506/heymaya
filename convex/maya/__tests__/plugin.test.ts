/**
 * Source-contract tests for the `maya-tools` OpenClaw plugin.
 *
 * These assert what a file can assert: that the manifest matches the code, that
 * no schema carries a tenant id, and that every transport path returns an
 * envelope. They do NOT prove the plugin loads, because nothing has loaded it —
 * there is no deployed machine. That proof is the Sprint 3 exit criterion and
 * it is still outstanding.
 *
 * Read as source rather than imported: `index.js` depends on `typebox` and the
 * OpenClaw plugin SDK, which live in the plugin's own node_modules and are not
 * resolvable from the repo root. Importing it here would test the resolver, not
 * the contract.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLED_MAYA_PLUGIN_TOOLS } from "../../agents/packs/maya/bundledPlugin";

const PLUGIN = join(
  __dirname,
  "..",
  "..",
  "..",
  "infra",
  "openclaw-runtime",
  "plugins",
  "maya-tools"
);

const index = readFileSync(join(PLUGIN, "index.js"), "utf8");
const manifest = JSON.parse(
  readFileSync(join(PLUGIN, "openclaw.plugin.json"), "utf8")
) as { id: string; contracts: { tools: string[] }; activation: { onStartup: boolean } };
const pkg = JSON.parse(readFileSync(join(PLUGIN, "package.json"), "utf8")) as {
  name: string;
  type: string;
  files: string[];
  openclaw: { extensions: string[] };
};

/** Tool names as actually registered in index.js. */
function registeredTools(): string[] {
  return [...index.matchAll(/name:\s*"([a-z_]+)",\s*\n\s*label:/g)].map((m) => m[1]);
}

describe("the manifest and the code agree", () => {
  it("every declared tool is registered, and vice versa", () => {
    // The manifest is the cold-discovery contract: OpenClaw advertises these
    // names before the module is evaluated. A name in one and not the other is
    // either a tool the model is told about and can't call, or one it can call
    // and never learns exists.
    expect(registeredTools().sort()).toEqual([...manifest.contracts.tools].sort());
  });

  it("ships exactly the tools this build supports", () => {
    // `checkpoint` joined in Sprint 2.9 — it mirrors MEMORY.md off the machine,
    // the one artifact on the volume that isn't reproducible.
    // `pending` joined 2026-08-06 — it is the only source of a draftId for a
    // draft offered on an earlier turn, without which an approved post could
    // never be published.
    expect(manifest.contracts.tools.sort()).toEqual([
      "ask_founder",
      "checkpoint",
  "confirm_preview",
      "draft",
      "history",
      "inbox",
      // ⭐ Joined 2026-08-09. It existed as an action with ZERO callers — built,
      // tested, verified live by hand, and unreachable by the agent, which is
      // this codebase's dominant defect class.
      "make_carousel",
      "pending",
      "publish",
      "remember",
      "reply",
      "request_assets",
      "rules",
      "scroll",
      "update",
      "weekly_read",
    ]);
  });

  it("ids match across manifest, package, and plugin definition", () => {
    expect(pkg.name).toBe("maya-tools");
    expect(manifest.id).toBe("maya-tools");
    expect(index).toMatch(/id:\s*"maya-tools"/);
  });

  it("activates on startup so tools exist before the first turn", () => {
    expect(manifest.activation.onStartup).toBe(true);
  });

  it("packs only what the tarball needs", () => {
    expect(pkg.type).toBe("module");
    expect(pkg.files.sort()).toEqual([
      "README.md",
      "index.js",
      "openclaw.plugin.json",
    ]);
    expect(pkg.openclaw.extensions).toEqual(["./index.js"]);
  });
});

describe("NO TOOL CAN NAME A TENANT", () => {
  it("no parameter schema accepts a customerId", () => {
    // The server resolves tenancy from the bearer token alone. A tenant
    // parameter here would hand the model the ability to name an account it
    // isn't — re-opening the exact class of bug the server surface was shaped
    // to eliminate, at the one layer that isn't guarded by it.
    //
    // ⚠️ Sliced PER TOOL, not by one regex over the whole file. The previous
    // matcher required a newline before the closing `})`, so a single-line
    // `Type.Object({})` — which `scroll` has always had — made the match run
    // on into the NEXT tool. It still caught tenant fields (a longer match
    // reads more, not less), but the count it asserted was never the number
    // of schemas, so a tool could be added with nothing checking its own.
    const blocks = index
      .split(/tool\(\{/)
      .slice(1)
      .map((block) => {
        const name = /name:\s*"([a-z_]+)"/.exec(block)?.[1] ?? "";
        // Parameters end where the executable body begins.
        const params = block.split(/execute:/)[0];
        return { name, params };
      });

    expect(blocks.map((b) => b.name).sort()).toEqual(
      [...BUNDLED_MAYA_PLUGIN_TOOLS].sort()
    );
    for (const { name, params } of blocks) {
      expect(
        /customerId|accountId|tenantId|customer_id/i.test(params),
        `${name} takes a tenant id`
      ).toBe(false);
    }
  });

  it("nothing in the plugin's EXECUTABLE code sends a tenant id", () => {
    // Prose is stripped first — both `//` comments and description strings.
    // The header and the plugin description both state this rule BY NAME, and
    // a matcher that flags its own documentation gets deleted by the next
    // person rather than fixed. What must stay clean is the code that can
    // actually carry a value into a request.
    const code = index
      .split("\n")
      .filter((line) => {
        const trimmed = line.trimStart();
        return !trimmed.startsWith("//") && !trimmed.startsWith("description:");
      })
      .join("\n")
      // Multi-line description strings continue onto the following line.
      .replace(/^\s*"[^"]*",?$/gm, "");
    expect(code).not.toMatch(/customerId|accountId|tenantId/);
  });

  it("the payload reaching the server is exactly the validated params", () => {
    // The only route a tenant id could travel is a schema field, which the test
    // above covers — because `call` forwards the validated params verbatim and
    // adds nothing of its own. If this ever built a body by hand, the schema
    // test would stop being sufficient.
    expect(index).toMatch(/body: JSON\.stringify\(payload \?\? \{\}\)/);
    for (const tool of ["scroll", "draft", "publish", "reply", "remember", "rules", "update", "history", "inbox", "weekly_read", "request_assets", "ask_founder", "checkpoint"]) {
      expect(index).toContain(`call("${tool}", p, ctx.signal)`);
    }
  });
});

describe("THE ENVELOPE SURVIVES THE TRANSPORT", () => {
  it("every failure path returns ok/why/next rather than throwing", () => {
    // A transport that sometimes returns an envelope and sometimes throws
    // forces the model to handle two shapes, and it will get one wrong. Missing
    // env, network error, non-JSON body, and unrecognized body all produce the
    // same shape.
    const returns = [...index.matchAll(/return \{\s*\n?\s*ok: false,[\s\S]*?\};/g)];
    expect(returns.length).toBeGreaterThanOrEqual(4);
    for (const [block] of returns) {
      expect(block).toMatch(/why:/);
      expect(block).toMatch(/next:/);
    }
  });

  it("a successful server envelope is passed through UNTOUCHED", () => {
    // The failure this prevents: a tool that unwraps to `data` and silently
    // deletes `next` — the field that stops a retry loop.
    expect(index).toMatch(/if \(parsed && typeof parsed === "object" && "ok" in parsed\) return parsed;/);
    // And no reshaping on the way out.
    expect(index).not.toMatch(/return parsed\.data/);
    expect(index).not.toMatch(/\.\.\.parsed,/);
  });

  it("uses its own credential, not the frozen pack's HOOK_TOKEN", () => {
    // gtmMaya is frozen and a machine mid-migration can carry both. Sharing the
    // variable would let a v1 credential authenticate a v2 call.
    expect(index).toMatch(/MAYA_AGENT_TOKEN/);
    expect(index).not.toMatch(/"HOOK_TOKEN"/);
  });

  it("posts to /maya/* routes only", () => {
    const routes = [...index.matchAll(/\/maya\/\$\{route\}|"\/maya\//g)];
    expect(routes.length).toBeGreaterThan(0);
    expect(index).not.toMatch(/lc_gtm/);
  });
});

describe("tool descriptions carry the choreography the model needs", () => {
  it("publish tells the model a hold is an ANSWER and not to retry", () => {
    // The description is the model's only cold-read of what ok:false means.
    // Without this it reads a false as an error and retries — which is how a
    // machine burns a day's spend on a decision that will never change.
    const publish = index.slice(index.indexOf('name: "publish"'));
    expect(publish).toMatch(/DO NOT RETRY/i);
    expect(publish).toMatch(/holdReason/);
  });

  it("publish does not let the model announce an in-flight post as live", () => {
    // Invariant 6: the unit of work is a placement — something live, with a
    // URL. In flight is not posted, and claiming otherwise is the fabrication
    // this product cannot afford.
    //
    // ⚠️ Asserts the RULE, not the sentence. This matched the literal string
    // "do not announce it as posted" until 2026-08-06, when that description
    // had to be rewritten — it used our internal nouns ("the placement row
    // with its URL is the proof") and she paraphrased them straight back to
    // the founder. A test pinned to prose blocks the fix for the leak it
    // wasn't watching for. Conventions: assert on structure, never on wording.
    const publish = index.slice(index.indexOf('name: "publish"'));
    expect(publish).toMatch(/live link|went live|is up/i);
    expect(publish).toMatch(/not that it is up|before you tell them it posted/i);
  });

  it("no tool teaches her a word the founder must never hear", () => {
    // The root cause of the 2026-08-06 leak: SOUL says "never a table or a
    // queue or a job", and the publish description said "the placement row
    // with its URL is the proof it went live". The specific instruction won,
    // and she replied "I'll need its placement URL before I can say it
    // posted." You cannot forbid a vocabulary in the prompt and then model it
    // in the instruction being executed.
    //
    // Tools legitimately need precise nouns (draftId, ok:false) — so the rule
    // is not that they're absent, it's that any tool using OUR internal nouns
    // must also carry the translation instruction.
    const INTERNAL_NOUNS = /\bplacement row\b|\bqueued successfully\b/i;
    expect(index).not.toMatch(INTERNAL_NOUNS);
  });

  it("ask_founder frames the one-question refusal as correct, not broken", () => {
    const ask = index.slice(index.indexOf('name: "ask_founder"'));
    expect(ask).toMatch(/ONLY ONE QUESTION/i);
    expect(ask).toMatch(/not a failure/i);
  });

  it("every tool documents the envelope's four fields somewhere", () => {
    for (const field of ["ok", "data", "next", "why"]) {
      expect(index).toContain(field);
    }
    expect(index).toMatch(/\{ok, data, next, why\}/);
  });
});

/**
 * ⭐ WHAT SHE READS BACK IS THE `next` FIELD, NOT THE PROMPT.
 *
 * On 2026-08-06 the operator flagged that she'd said *"I'll need its placement
 * URL before I can say it posted."* The plugin description and SOUL were both
 * corrected. **On 2026-08-07 she said it again, twice.**
 *
 * The cause was never the prompt. `hooks.ts` returned
 *
 *     next: "don't announce it as live yet; the placement row with its URL
 *            is the proof"
 *
 * §2.8: *choreography rides in tool responses, never in prompts.* That makes
 * `why`/`next` the STRONGEST instruction she gets — handed to her on the exact
 * turn she acts. A prompt rule cannot outrank the sentence she just received,
 * and by then her own transcript held the phrase three times as worked
 * examples.
 *
 * Checking the prompt three times missed it because the prompt was never where
 * it lived.
 */
describe("the envelope speaks the founder's language too", () => {
  const HOOKS = readFileSync(
    join(__dirname, "..", "hooks.ts"),
    "utf8"
  );

  /** Our nouns. Correct for us, meaningless or alarming to a founder. */
  const INTERNAL = [
    "placement row",
    "draft row",
    "idempotency",
    "dedupe key",
    "envelope",
    "payloadJson",
    "mutation",
  ];

  it("no why/next hands her a word we forbid her to say", () => {
    const offenders: string[] = [];
    HOOKS.split("\n").forEach((line, i) => {
      const m = /\b(why|next):\s*"([^"]+)"/.exec(line);
      if (!m) return;
      for (const term of INTERNAL) {
        if (m[2].toLowerCase().includes(term)) {
          offenders.push(`hooks.ts:${i + 1} — ${term}`);
        }
      }
    });
    expect(
      offenders,
      "These are the sentences she repeats verbatim to the founder.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("publish still tells her NOT to claim it's live", () => {
    // The guidance was right; only the vocabulary was ours. Publishing is
    // queued, so there is no link yet and claiming one would be a fabricated
    // fact about the founder's own account (§2.7).
    // Window past the explanatory comment to the `next` itself. Kept as a
    // slice rather than a regex on the whole file so this asserts the PUBLISH
    // response specifically, not any sentence anywhere that happens to match.
    const idx = HOOKS.indexOf('data: { published: false, queued: true, jobId }');
    const near = HOOKS.slice(idx, idx + 2000);
    expect(near).toMatch(/do NOT say it's posted yet|don't say it'?s posted/i);
    expect(near).toMatch(/link when it'?s up|send the link/i);
  });
});
