/**
 * C1 (app spec): the copy check, extended to the iPhone app, the share extension and the widget.
 * Every user-facing string literal is checked against the same internal-names list the server
 * uses before any message goes out, plus the product's own bans: "AI" (marketing rule), "baseline"
 * (her soul bans it to a human), and the two retired surfaces, Telegram and the web dashboard.
 * Identifiers, SF Symbol names, URLs, Convex function names and patterns are not copy.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTERNAL_NAMES } from "../plainLanguage";

const ROOTS = ["Maya", "MayaShare", "MayaWidget", "Shared"].map((d) => join(__dirname, "../../../apps/ios", d));

function swiftFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? swiftFiles(p) : p.endsWith(".swift") ? [p] : [];
  });
}

/** Pure: the user-facing string literals on a line (skips code-ish strings). */
export function copyOn(line: string): string[] {
  if (/systemName:|forInfoDictionaryKey|forHTTPHeaderField|print\(|range\(of:|#"|UTType|convex\.(mutation|query)|Live<|withIndex|Env\.|static let (appGroup|key)|kind: "ai\.heymaya/.test(line)) return [];
  const out: string[] = [];
  for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    const s = m[1];
    if (!/[a-z]{2,}\s+[a-z]/i.test(s)) continue; // copy has words with spaces; ids, keys and names don't
    if (/^(https?|maya|sms|tg):|^[\w-]+:[\w-]+$|\\\(/.test(s) && !/\s[a-z]{3,}\s/i.test(s)) continue;
    out.push(s);
  }
  return out;
}

const BANNED: Array<[RegExp, string]> = [
  [/\bAI\b/, "no \"AI\" in anything a creator reads"],
  [/\bbaseline\b/i, "her soul bans \"baseline\" to a human; say \"your normal\""],
  [/\bTelegram\b/i, "she lives in Messages now"],
  [/\bdashboard\b/i, "there is no dashboard; there's the app"],
  [/\bmission control\b/i, "retired name"],
];

describe("the app's copy (C1)", () => {
  const strings: Array<{ file: string; line: number; text: string }> = [];
  for (const root of ROOTS) for (const f of swiftFiles(root)) readFileSync(f, "utf8").split("\n").forEach((l, i) => { for (const text of copyOn(l)) strings.push({ file: f.split("/apps/ios/")[1], line: i + 1, text }); });

  it("finds the copy (the extractor isn't silently empty)", () => {
    expect(strings.length).toBeGreaterThan(40);
    expect(strings.some((s) => /She'll text you/.test(s.text))).toBe(true);
  });

  it("no internal names, vendor names or banned words", () => {
    const offenders: string[] = [];
    for (const s of strings) {
      for (const name of INTERNAL_NAMES) if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(s.text)) offenders.push(`${s.file}:${s.line} "${s.text}" names ${name}`);
      for (const [re, why] of BANNED) if (re.test(s.text)) offenders.push(`${s.file}:${s.line} "${s.text}": ${why}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("the extractor", () => {
  it("catches copy and skips code", () => {
    expect(copyOn(`Text("Open Telegram to talk to her")`)).toEqual(["Open Telegram to talk to her"]);
    expect(copyOn(`Image(systemName: "bubble.left.and.text.bubble.right")`)).toEqual([]);
    expect(copyOn(`await ok("ui:passIdea", ["id": ideaId])`)).toEqual([]);
  });
});
