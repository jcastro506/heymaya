/**
 * ⭐ The live URL read — and why it is NOT on the landing page.
 *
 * §18.9.2 block ② and Sprint 11's exit criterion ask for it there: *"a visitor
 * can paste a URL on the landing page and watch her be specifically right about
 * their company, in under 20 seconds, without signing up."*
 *
 * ⚠️ **Removed from the landing page 2026-08-17 by operator decision, and the
 * reason is a property of the read rather than of the design.** The public read
 * is cached per URL for 24 hours and capped globally per day
 * (`convex/maya/demo.ts`) — guardrails that exist so an acquisition page cannot
 * become an unbounded model bill. Which means the second visitor to paste a
 * given URL gets a replay, not a live read, and the block promises a wow it
 * cannot reliably deliver on the page whose entire job is a first impression.
 *
 * So the criterion is **not currently met as written**, and that is recorded
 * here rather than quietly dropped. The read still exists and still works — it
 * lives on `/start`, where the visitor has already chosen to begin and a cached
 * answer reads as fast rather than as stale.
 *
 * What these tests protect now is the read itself: that it stays reachable,
 * stays guarded, and fails honestly.
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
const START = readFileSync(join(process.cwd(), "app/start/page.tsx"), "utf8");

describe("the live read is reachable, and guarded", () => {
  it("⭐ still exists, on the page where a cached answer is fine", () => {
    // `/start` is post-intent: they have already decided to begin, so a replay
    // of an earlier read reads as fast rather than as stale.
    expect(START).toContain("/api/demo/read");
  });

  it("⚠️ and is NOT on the landing page — a decision, not a regression", () => {
    /**
     * Pinned so nobody re-adds it without reading the header above. The block
     * is not broken; it is mismatched to a first impression, because the 24h
     * URL cache means the second visitor to try a given site gets a replay.
     */
    expect(LANDING).not.toContain("<DemoRead />");
  });

  it("⚠️ the read is guarded before it is public", () => {
    /**
     * §18 Sprint 11: "Guardrails on the public demo: IP rate limit · URL cache
     * · daily spend cap · graceful degrade on scrape failure." An unguarded
     * public model call on an open page is a bill somebody else controls — and
     * these same guardrails are why it left the landing page.
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
    // "That page loads with JavaScript" is the honest, specific answer, and a
    // visitor learns something true about us from a straight reason rather than
    // a spinner that ends in nothing. §12.
    expect(DEMO).toContain('status: "failed"');
  });

  it("⚠️ it promises no signup, where it does appear", () => {
    expect(DEMO).toMatch(/no signup/i);
  });
});
