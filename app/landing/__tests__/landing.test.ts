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
    expect(copy).toMatch(/Your whole content team/);
    expect(copy).toMatch(/iMessage or SMS/);
  });
});

describe("prices and CTAs (sibling coherence)", () => {
  const landing = read("Landing.tsx");

  it("brand deals always name the plan they come on, from tiers", () => {
    expect(landing).toMatch(/Brand deals · \{c\.partnerLabel\} plan/);
    expect(landing).toMatch(/const PARTNER = TIERS\.partner/);
    expect(landing).toMatch(/plan: `\$\{c\.partnerLabel\} plan`/);
  });

  it("hardcodes no price: every dollar figure comes from billing/tiers", () => {
    const withoutImports = landing.replace(/import[^;]+;/g, "");
    expect(withoutImports).not.toMatch(/\$\d/);
    expect(landing).toMatch(/price\(TIERS\[tier\]\.priceUsd\)/);
    expect(landing).toMatch(/offeredTiers\(igOn\)\.map/);
    expect(landing).not.toMatch(/TIER_NAMES/);
  });

  it("every call to action goes through /join, so every install is attributed", () => {
    const hrefs = [...landing.matchAll(/<CtaLink href=\{?[`"]([^`"]+)[`"]/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
    for (const h of hrefs) expect(h).toMatch(/^\/join\?where=/);
    expect(landing).not.toMatch(/href="\/(sign-up|start|telegram)/);
  });
});

/** The page itself, rendered, with the Instagram switch each way (convex/config/platforms). */
async function render(igOn: boolean): Promise<string> {
  return renderToStaticMarkup(await Landing({ igOn }));
}
const cards = (html: string) => [...html.matchAll(/<span class="price-name">([^<]+)<\/span>/g)].map((m) => m[1]);

describe("the landing with Instagram off (the default)", () => {
  it("never says Instagram, Reels or two accounts, anywhere on the page", async () => {
    const html = await render(false);
    expect(html).toMatch(/Your whole content team/);
    expect(html).not.toMatch(/Instagram|Reels|plat-ig/i);
    expect(html).toMatch(/For TikTok creators/);
  });

  it("offers exactly the two TikTok plans, at the prices in billing/tiers, one of them featured", async () => {
    const html = await render(false);
    expect(cards(html)).toEqual(["Maya", "Maya + Deals"]);
    expect(html).toContain(`${price(TIERS.solo.priceUsd)}<small>/month</small>`);
    expect(html).toContain(`${price(TIERS.partner.priceUsd)}<small>/month</small>`);
    expect(html).not.toContain(price(TIERS.duo.priceUsd));
    expect(html.match(/price-feat/g)?.length).toBe(1);
    expect(html).toContain("Brand deals · Maya + Deals plan");
  });

  it("the copy helper and the terms line agree with the cards", () => {
    const c = platformCopy(false);
    expect(c.platforms).toBe("TikTok");
    expect(c.partnerLabel).toBe("Maya + Deals");
    const line = paymentLine(false);
    expect(line).toContain(price(TIERS.solo.priceUsd));
    expect(line).toContain(price(TIERS.partner.annualUsd));
    expect(line).not.toContain(price(TIERS.duo.priceUsd));
  });
});

describe("the landing with Instagram on", () => {
  it("names both platforms and shows the Instagram account", async () => {
    const html = await render(true);
    expect(html).toMatch(/For TikTok and Instagram creators/);
    expect(html).toMatch(/plat-ig/);
    expect(html).toMatch(/Reels watch time/);
  });

  it("offers all three plans, the middle one featured", async () => {
    const html = await render(true);
    expect(cards(html)).toEqual([TIERS.solo.label, TIERS.duo.label, TIERS.partner.label]);
    expect(html).toContain(`${price(TIERS.duo.priceUsd)}<small>/month</small>`);
    expect(html.match(/price-feat/g)?.length).toBe(1);
    expect(paymentLine(true)).toContain(price(TIERS.duo.annualUsd));
  });
});
