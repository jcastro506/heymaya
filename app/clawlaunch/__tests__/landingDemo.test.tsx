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
    expect(LANDING).toContain("<DemoRead />");
  });

  it("⭐ puts it early — after the proof, before the explanation", () => {
    /**
     * Ordering as argument, not decoration.
     *
     * ⚠️ It moved on the 2026-08-17 rebuild, deliberately. It used to sit
     * immediately after the hero; now the three real videos come first.
     * §19: *"founders don't doubt that software can write. They doubt that it
     * knows anything."* The videos settle the easy doubt in three seconds,
     * which buys the attention that the live read and the format card need.
     *
     * What must stay true is that it is EARLY — before `SheWatches` explains
     * anything. A demo below the explanation is a demo nobody reaches.
     */
    /**
     * ⚠️ Asserted on the ARTIFACTS, not on component names. Three redesigns in
     * one afternoon each renamed the wrapper and broke this test without
     * anything about the page actually regressing — the assertion was pinned to
     * scaffolding rather than to the property that matters.
     *
     * What must stay true: the live read is the first proof a visitor meets
     * after the hero, before the market feed and before the format card. §19 —
     * "she does the homework" is the argument, and the read is the cheapest
     * possible demonstration of it, on their own company, before she has
     * claimed anything.
     */
    const hero = LANDING.indexOf("<Hero />");
    const demo = LANDING.indexOf("<TryIt />");
    const watches = LANDING.indexOf("<SheWatches />");
    const work = LANDING.indexOf("<WorkGallery />");
    expect(demo).toBeGreaterThan(hero);
    expect(demo).toBeLessThan(watches);
    expect(demo).toBeLessThan(work);
  });

  it("⚠️ promises no signup, because the exit criterion says without one", () => {
    /**
     * ⚠️ Asserted on the COMPONENT, not the page. The page used to repeat the
     * promise in a caption and the component already carried it — the visitor
     * read the same sentence twice. The caption was cut, so this now checks
     * where the promise actually lives.
     */
    expect(DEMO).toMatch(/no signup/i);
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
