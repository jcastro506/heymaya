/**
 * W1's content inventory, read from the source (the page is server-rendered from these files).
 * Categories: sibling coherence (prices come only from billing/tiers; every CTA goes through
 * /join), and the copy rules the app and her texts already follow (no retired surfaces, no
 * vendor or internal names, no "AI", no "baseline").
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TIERS, price } from "../../../convex/billing/tiers";
import { paymentLine, platformCopy } from "../platformCopy";
import Landing from "../Landing";
import { INTERNAL_NAMES } from "../../../convex/core/plainLanguage";

const read = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
const FILES = ["Landing.tsx", "Screens.tsx", "platformCopy.ts"];

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
    expect(copy).toMatch(/Your TikTok assistant/);
    expect(copy).toMatch(/iMessage or SMS/);
  });
});

describe("prices and CTAs (sibling coherence)", () => {
  const landing = read("Landing.tsx");

  it("brand deals always name the plan they come on, from tiers", () => {
    expect(landing).toMatch(/Brand deals · \{c\.partnerLabel\} plan/);
    expect(landing).toMatch(/const PARTNER = TIERS\.partner/);
  });

  it("hardcodes no price: every dollar figure comes from billing/tiers", () => {
    const withoutImports = landing.replace(/import[^;]+;/g, "");
    expect(withoutImports).not.toMatch(/\$\d/);
    expect(landing).toMatch(/price\(TIERS\[tier\]\.priceUsd\)/);
    expect(landing).toMatch(/offeredTiers\(\)\.map/);
    expect(landing).not.toMatch(/TIER_NAMES/);
  });

  it("every call to action goes through /join, so every install is attributed", () => {
    const hrefs = [...landing.matchAll(/<CtaLink href=\{?[`"]([^`"]+)[`"]/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
    for (const h of hrefs) expect(h).toMatch(/^\/join\?where=/);
    expect(landing).not.toMatch(/href="\/(sign-up|start|telegram)/);
  });
});

/** The page itself, rendered. TikTok only (2026-11-13). */
async function render(): Promise<string> {
  return renderToStaticMarkup(await Landing());
}
const cards = (html: string) => [...html.matchAll(/<span class="price-name">([^<]+)<\/span>/g)].map((m) => m[1]);

describe("the landing: TikTok only", () => {
  it("never says Instagram, Reels or two accounts, anywhere on the page", async () => {
    const html = await render();
    expect(html).toMatch(/Your TikTok assistant, <em>in your texts\.<\/em>/);
    expect(html).not.toMatch(/Instagram|Reels|plat-ig/i);
    expect(html).toMatch(/For TikTok creators/);
  });

  it("offers exactly the two TikTok plans, at the prices in billing/tiers, one of them featured", async () => {
    const html = await render();
    expect(cards(html)).toEqual(["Maya", "Maya + Deals"]);
    expect(html).toContain(`${price(TIERS.solo.priceUsd)}<small>/month</small>`);
    expect(html).toContain(`${price(TIERS.partner.priceUsd)}<small>/month</small>`);
    expect(html).not.toContain(price(TIERS.duo.priceUsd));
    expect(html.match(/price-feat/g)?.length).toBe(1);
    expect(html).toContain("Brand deals · Maya + Deals plan");
  });

  it("the copy helper and the terms line agree with the cards", () => {
    const c = platformCopy();
    expect(c.platforms).toBe("TikTok");
    expect(c.partnerLabel).toBe("Maya + Deals");
    const line = paymentLine();
    expect(line).toContain(price(TIERS.solo.priceUsd));
    expect(line).toContain(price(TIERS.partner.annualUsd));
    expect(line).not.toContain(price(TIERS.duo.priceUsd));
  });
});

describe("what the page promises is what she does today", () => {
  it("claims nothing that's switched off: no storyboards, no sending from their inbox, no reply tracking, no posting", async () => {
    const html = await render();
    expect(html).not.toMatch(/show me what that would look like|from your own inbox|tracks (the )?repl|three captions|3 captions/i);
    expect(html).toMatch(/She never posts for you/);
  });

  it("her texts arrive with typing dots, and the phones below the hero wait until they're on screen", async () => {
    const html = await render();
    expect(html.match(/class="msg-typing"/g)?.length).toBeGreaterThanOrEqual(6);
    expect(html.match(/class="iv"/g)?.length).toBe(3);
    const css = read("landing.css");
    expect(css).toMatch(/\.iv:not\(\.iv-go\) \.msg-live \*[^}]*animation-play-state: paused/);
    expect(html).toMatch(/<noscript><style>\.iv \.msg-live \*[^<]*running/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.mx \*[^}]*animation: none !important/);
  });
});
