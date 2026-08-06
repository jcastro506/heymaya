/**
 * Sprint 13 (§18.13.4) — the copy rules, enforced in CI rather than by review.
 *
 * Two standing rules have lived only in prose and in the operator's head:
 *
 *   1. **Never the word "AI" in rendered copy.** The buyer has been sold "AI"
 *      nine times this year and it now reads as *unreliable*. Maya is a social
 *      media manager, described by what she does. `app/vibecoders/page.tsx`
 *      carries the rule as a hand-written comment — which is exactly the kind
 *      of rule that holds until the day someone doesn't read the comment.
 *
 *   2. **Never claim she creates UGC on TikTok/Instagram.** It isn't what she
 *      does (§7.5.3 — real screenshots first, generated video last), and unlike
 *      most marketing claims this one is checkable by the buyer.
 *
 * Scope is *rendered* copy: comments and import lines are stripped first, so
 * the rule may still be *described* in a code comment (and is).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Directories whose text a prospect or customer actually reads. */
const COPY_ROOTS = ["app", "components"];

/** Machinery, not copy — route handlers render no prose. */
const SKIP_SEGMENTS = new Set([
  "api",
  "node_modules",
  "__tests__",
  ".next",
  "auth-debug",
]);

/**
 * Legal pages are exempt from the no-"AI" rule, and deliberately so.
 *
 * `app/terms/page.tsx` carries an "AI Output" section warning that output "can
 * be wrong, incomplete, or out of date", and `app/privacy/page.tsx` discloses
 * that data reaches an AI model subprocessor. Those are *disclosures*. The
 * marketing rule exists because "AI" reads as unreliable — which is precisely
 * the thing a disclaimer is supposed to convey. Enforcing the rule here would
 * degrade a legal notice to protect a brand voice.
 */
const LEGAL_EXEMPT = new Set(["app/terms/page.tsx", "app/privacy/page.tsx"]);

function collect(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_SEGMENTS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, out);
    } else if (/\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip everything the user never sees: block comments, line comments, and
 * import statements. What remains is close enough to rendered text that a hit
 * is worth a human look.
 */
function renderedText(source: string): string {
  // ⚠️ Every replacement preserves the newline count of what it removes.
  // Collapsing a block comment to a single space shifts every line number
  // below it, and a violation report that points at the wrong line is worse
  // than no report — you go look, see nothing, and distrust the test.
  const blank = (chunk: string) => chunk.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^\s*\/\/.*$/gm, blank)
    .replace(/^\s*import\s[\s\S]*?from\s+["'][^"']+["'];?$/gm, blank)
    .replace(/^\s*import\s+["'][^"']+["'];?$/gm, blank);
}

/** 1-indexed line numbers of every match, for an error message you can act on. */
function hits(text: string, re: RegExp): Array<{ line: number; match: string }> {
  const found: Array<{ line: number; match: string }> = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(re)) {
      found.push({ line: i + 1, match: m[0].trim() });
    }
  });
  return found;
}

const FILES = COPY_ROOTS.flatMap((root) => collect(join(ROOT, root)));

describe("marketing copy rules (§18.13.4)", () => {
  it("finds the copy surfaces at all", () => {
    // A silent zero-file scan would pass every rule below forever. This is the
    // zero-caller defect class applied to a test: the assertion that the test
    // is actually looking at something.
    expect(FILES.length).toBeGreaterThan(5);
  });

  it("never says 'AI' in rendered copy", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      const rel = relative(ROOT, file);
      if (LEGAL_EXEMPT.has(rel)) continue;
      const text = renderedText(readFileSync(file, "utf8"));
      // ⚠️ Case-SENSITIVE on the acronym. Our own domain is `hey-maya.ai`, and
      // a case-insensitive `\bai\b` flags every support email on the site.
      for (const hit of hits(text, /\bAI\b/g)) {
        violations.push(`${rel}:${hit.line} — "${hit.match}"`);
      }
      // Spelled out, it's a phrase — no domain collision, so match any casing.
      for (const hit of hits(text, /\bartificial intelligence\b/gi)) {
        violations.push(`${rel}:${hit.line} — "${hit.match}"`);
      }
    }
    expect(
      violations,
      `Rendered copy must never say "AI" — she is a social media manager, ` +
        `described by what she does.\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("never claims she creates UGC", () => {
    const violations: string[] = [];
    // The banned claim is *creation*: "makes/creates/generates ... UGC", or
    // "UGC creator". Naming UGC as a concept is fine; promising it isn't.
    const CLAIM =
      /\b(?:makes?|create[sd]?|creating|generat(?:es?|ing)|produces?)\b[^.\n]{0,40}\bUGC\b|\bUGC\s+(?:creator|content\s+creator|videos?\s+for\s+you)\b/gi;
    for (const file of FILES) {
      const text = renderedText(readFileSync(file, "utf8"));
      for (const hit of hits(text, CLAIM)) {
        violations.push(`${relative(ROOT, file)}:${hit.line} — "${hit.match}"`);
      }
    }
    expect(
      violations,
      `Never claim she creates UGC (§7.5.3 — real screenshots first, ` +
        `generated video last). The buyer can check this one.\n` +
        violations.join("\n"),
    ).toEqual([]);
  });
});
