/**
 * ⭐ Sprint 11's exit criterion, as a test.
 *
 * > *"a visitor can paste a URL on the landing page and watch her be
 * > specifically right about their company, in under 20 seconds, without
 * > signing up."*
 *
 * ⚠️ The component, the API route and all four guardrails were built and live
 * on `/start` — and the landing page never imported it. The one block that
 * DEMONSTRATES the product rather than describing it was the one block missing
 * from the page whose entire job is acquisition.
 *
 * Asserted against the source rather than a render, because what broke was the
 * wiring — the component itself has always worked.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LANDING = readFileSync(
  join(process.cwd(), "app/clawlaunch/page.tsx"),
  "utf8",
);
const DEMO = readFileSync(
  join(process.cwd(), "app/_components/DemoRead.tsx"),
  "utf8",
);

describe("the landing page demonstrates rather than claims", () => {
  it("⭐ renders the live URL read", () => {
    expect(LANDING).toContain("DemoRead");
    expect(LANDING).toContain("<DemoSection />");
  });

  it("⭐ puts it above the fold, right after the hero", () => {
    /**
     * Ordering as argument, not decoration. Every competitor CLAIMS to
     * understand your business; this proves it on the visitor's own site before
     * they give us anything. Below the fold it is a feature — here it is the
     * reason to keep reading.
     */
    const hero = LANDING.indexOf("<Hero />");
    const demo = LANDING.indexOf("<DemoSection />");
    const problems = LANDING.indexOf("<ProblemQuotes />");
    expect(demo).toBeGreaterThan(hero);
    expect(demo).toBeLessThan(problems);
  });

  it("⚠️ promises no signup, because the exit criterion says without one", () => {
    expect(LANDING).toMatch(/no signup/i);
  });

  it("⚠️ the read is guarded before it is public", () => {
    /**
     * §18 Sprint 11: "Guardrails on the public demo: IP rate limit · URL cache
     * · daily spend cap · graceful degrade on scrape failure." An unguarded
     * public LLM read on an acquisition page is a bill someone else controls.
     */
    const demoModule = readFileSync(
      join(process.cwd(), "convex/maya/demo.ts"),
      "utf8",
    );
    expect(demoModule).toContain("IP_DAILY_LIMIT");
    expect(demoModule).toContain("GLOBAL_DAILY_READS");
    expect(demoModule).toContain("CACHE_TTL_SEC");
  });

  it("⚠️ a failed read is shown, never swallowed", () => {
    // "That page needs a login" is the honest, specific answer, and a visitor
    // learns something true about us from a straight reason rather than a
    // spinner that ends in nothing. §12.
    expect(DEMO).toContain('status: "failed"');
  });
});
