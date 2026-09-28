/**
 * W1's content inventory, read from the source (the page is server-rendered from these files).
 * Categories: sibling coherence (prices come only from billing/tiers; every CTA goes through
 * /join), and the copy rules the app and her texts already follow (no retired surfaces, no
 * vendor or internal names, no "AI", no "baseline").
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTERNAL_NAMES } from "../../../convex/core/plainLanguage";

const read = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
const FILES = ["Landing.tsx", "Screens.tsx"];

/** Visible text: JSX text and string literals, with comments, class names and SVG paths removed. */
function copyOf(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/(className|d|href|viewBox|kind|fill|stroke\w*|type|role|variant|where|id|from)=("[^"]*"|\{[^}]*\})/g, " ")
    .replace(/import[^;]+;/g, " ");
}

describe("the landing's copy", () => {
  const copy = FILES.map((f) => copyOf(read(f))).join("\n");

  it("never names the retired surfaces or says AI", () => {
    expect(copy).not.toMatch(/\bTelegram\b/i);
    expect(copy).not.toMatch(/\bdashboard\b/i);
    expect(copy).not.toMatch(/\bmission control\b/i);
    expect(copy).not.toMatch(/\bAI\b/);
    expect(copy).not.toMatch(/\bbaseline\b/i);
  });

  it("names no vendor or internal system", () => {
    for (const name of INTERNAL_NAMES) expect(copy, name).not.toMatch(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
  });

  it("finds the copy (the reader isn't silently empty)", () => {
    expect(copy).toMatch(/Your whole content team/);
    expect(copy).toMatch(/iMessage or SMS/);
  });
});

describe("prices and CTAs (sibling coherence)", () => {
  const landing = read("Landing.tsx");

  it("brand deals always name the plan they come on, from tiers", () => {
    expect(landing).toMatch(/Brand deals · \{PARTNER\.label\} plan/);
    expect(landing).toMatch(/const PARTNER = TIERS\.partner/);
    expect(landing).toMatch(/plan: "Partnerships plan"/);
  });

  it("hardcodes no price: every dollar figure comes from billing/tiers", () => {
    const withoutImports = landing.replace(/import[^;]+;/g, "");
    expect(withoutImports).not.toMatch(/\$\d/);
    expect(landing).toMatch(/price\(TIERS\[tier\]\.priceUsd\)/);
    expect(landing).toMatch(/TIER_NAMES\.map/);
  });

  it("every call to action goes through /join, so every install is attributed", () => {
    const hrefs = [...landing.matchAll(/<CtaLink href=\{?[`"]([^`"]+)[`"]/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
    for (const h of hrefs) expect(h).toMatch(/^\/join\?where=/);
    expect(landing).not.toMatch(/href="\/(sign-up|start|telegram)/);
  });
});
