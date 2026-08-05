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
    expect(manifest.contracts.tools.sort()).toEqual([
      "ask_founder",
      "checkpoint",
      "draft",
      "publish",
      "reply",
      "scroll",
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
    const schemas = index.match(/parameters:\s*Type\.Object\(\{[\s\S]*?\n\s*\}\)/g) ?? [];
    expect(schemas.length).toBe(6);
    for (const schema of schemas) {
      expect(schema).not.toMatch(/customerId|accountId|tenantId|customer_id/i);
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
    for (const tool of ["scroll", "draft", "publish", "reply", "ask_founder", "checkpoint"]) {
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

  it("publish does not let the model announce a queued post as live", () => {
    // Invariant 6: the unit of work is a placement — something live, with a
    // URL. Queued is not posted, and claiming otherwise is the fabrication this
    // product cannot afford.
    const publish = index.slice(index.indexOf('name: "publish"'));
    expect(publish).toMatch(/do not announce it as posted/i);
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
