import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HANDLED_KINDS } from "../scheduler";

/**
 * Every job kind enqueued anywhere in convex/ has a handler (plan §16.1; scar tissue:
 * `wake_agent` and `publish_placement` dead-lettered for three PRs while every test
 * stayed green). Read from source, so a producer without a consumer fails the build.
 */
const CONVEX_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "_generated" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("job kinds", () => {
  it("every enqueued kind has a handler in this build", () => {
    const kinds = new Set<string>();
    for (const file of walk(CONVEX_DIR)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/jobs\.enqueue,\s*\{[\s\S]*?kind:\s*"([a-z_]+)"/g)) kinds.add(m[1]);
    }
    expect(kinds.size).toBeGreaterThan(0);
    for (const kind of kinds) expect(HANDLED_KINDS.has(kind), `no handler for enqueued kind "${kind}"`).toBe(true);
  });

  it("every handled kind is enqueued somewhere (no dead handlers)", () => {
    const src = walk(CONVEX_DIR).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const kind of HANDLED_KINDS) expect(src.includes(`kind: "${kind}"`), `handler for "${kind}" has no producer`).toBe(true);
  });
});
