/**
 * ⭐ Convex queries and mutations cannot do dynamic imports.
 *
 * `await import("./x")` inside a query or mutation **typechecks cleanly** and
 * fails at runtime with `dynamic module import unsupported`. Actions can do it;
 * queries and mutations cannot.
 *
 * ⚠️ This exists because the trap caught me three times in two days —
 * `messages.expireStaleQuestions`, `founder/fleetHealth.aggregateLearning`, and
 * `ladder.diagnoseBenchmarked` — and every time it got through typecheck, got
 * through review, and died on the first real call. Knowing the rule is
 * evidently not enough to follow it.
 *
 * ⚠️ The span is found by BRACE MATCHING, not by reading to the next `export`.
 *
 * The first version did the latter and produced five false positives in one
 * run — every one a non-exported helper sitting between two exports, taking an
 * `ActionCtx` and therefore called from an action. A guard that cries wolf gets
 * switched off, so it has to be right about what it is pointing at.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CONVEX = join(process.cwd(), "convex");

/** Declarations whose bodies run in the query/mutation runtime. */
const SYNC_RUNTIME = [
  "internalQuery({",
  "internalMutation({",
  "query({",
  "mutation({",
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "_generated" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Spans of source that run in the sync runtime, with their declaration name. */
function syncRuntimeSpans(source: string): Array<{ name: string; body: string }> {
  const spans: Array<{ name: string; body: string }> = [];
  const declaration = /export const (\w+) = (\w+)\(\{/g;
  let match: RegExpExecArray | null;

  while ((match = declaration.exec(source)) !== null) {
    const [, name, kind] = match;
    if (!SYNC_RUNTIME.some((s) => s.startsWith(kind + "("))) continue;

    /**
     * Walk braces from the opening `({` to its match. Anything a non-exported
     * helper does further down the file belongs to that helper, not to this
     * declaration — which is exactly what the naive version got wrong.
     */
    let depth = 1;
    let i = match.index + match[0].length;
    for (; i < source.length && depth > 0; i += 1) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    spans.push({
      name,
      body: source.slice(match.index + match[0].length, i),
    });
  }
  return spans;
}

describe("no dynamic imports in Convex queries or mutations", () => {
  it("every query and mutation uses static imports only", () => {
    const offenders: string[] = [];

    for (const file of tsFiles(CONVEX)) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("await import(")) continue;

      for (const span of syncRuntimeSpans(source)) {
        if (span.body.includes("await import(")) {
          offenders.push(`${file.replace(process.cwd() + "/", "")} → ${span.name}`);
        }
      }
    }

    expect(
      offenders,
      "these run in Convex's sync runtime and will throw `dynamic module import " +
        "unsupported` on their first real call — typecheck cannot catch it. " +
        "Move the import to the top of the file."
    ).toEqual([]);
  });

  it("catches the pattern it is meant to catch", () => {
    // ⚠️ A guard nobody has seen fail is a guard nobody knows works. This is the
    // shape of all three real instances.
    const bad = `
export const thing = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { helper } = await import("./helper");
    return helper();
  },
});
`;
    const spans = syncRuntimeSpans(bad);
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("thing");
    expect(spans[0].body).toContain("await import(");
  });

  it("leaves actions alone, which may import dynamically", () => {
    const fine = `
export const thing = internalAction({
  handler: async (ctx) => {
    const { helper } = await import("./helper");
    return helper();
  },
});
`;
    expect(syncRuntimeSpans(fine)).toHaveLength(0);
  });
});
