/**
 * ⭐ Today, from the live module.
 *
 * ## What this is guarding
 *
 * Mission Control's Today · Results · Activity read `gtmMaya` exclusively —
 * the frozen product. The live module writes to `placements` and
 * `dashboardState`.
 *
 * ⚠️ Verified on the dogfood account 2026-08-12: `placements` held real posts
 * including one published that day, while `gtmPostResults` — the table the
 * Results list renders — was **empty**. A founder asking §18.9's exit question,
 * *"is this working?"*, got a blank screen while she was working.
 *
 * ⭐ And `maya.dashboard.myDashboard` already existed with **zero readers**.
 * The answer was computed on every refresh and shown to nobody.
 *
 * ## The property that matters most
 *
 * This block is ADDITIVE. It must render nothing at all for an account without
 * a live customer — otherwise fixing the v2 dashboard breaks the very users the
 * frozen product still serves.
 */

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const h: { fixture: unknown } = { fixture: null };

vi.mock("convex/react", () => ({
  useQuery: () => h.fixture,
  useMutation: () => async () => ({ ok: true }),
  useAction: () => async () => ({}),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: { maya: { dashboard: { myDashboard: "myDashboard" } } },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

async function render(fixture: unknown): Promise<string> {
  h.fixture = fixture;
  const { TodayLive } = await import("../_TodayLive");
  return renderToString(createElement(TodayLive));
}

const BASE = {
  ok: true,
  statusLine: "Posted on X this morning.",
  todayPlacements: [
    {
      placementId: "p1",
      channel: "x",
      url: "https://twitter.com/i/web/status/1",
      views: 42,
    },
  ],
  ladder: [
    {
      channel: "x",
      rung: "L1",
      detail: "5 posts and 2 views — almost nobody saw them",
      versusNiche: "100% under the niche median",
    },
  ],
  metricsAsOf: Date.now(),
};

describe("Today (live)", () => {
  it("⭐ renders NOTHING without a live customer", async () => {
    /**
     * The load-bearing case. Every account the frozen product still serves
     * gets `ok: false` here, and must see exactly what it saw before — this
     * block adds a screen for v2 accounts, it does not change anyone else's.
     */
    expect(await render({ ok: false, error: "no account yet" })).toBe("");
    expect(await render(null)).toBe("");
    expect(await render(undefined)).toBe("");
  });

  it("shows today's placements with a link to the real post", async () => {
    const html = await render(BASE);
    // §2.6 — the unit of work is a placement: something live, with a URL.
    expect(html).toContain("https://twitter.com/i/web/status/1");
    expect(html).toContain("42");
    expect(html).toContain("Posted on X this morning.");
  });

  it("⚠️ puts what she's waiting on above everything else", async () => {
    const html = await render({
      ...BASE,
      needsYou: "Which of these two angles do you want me to run?",
    });
    expect(html).toContain("waiting on you");
    expect(html).toContain("Which of these two angles");
    /**
     * An unanswered question blocked her for two days on 2026-08-08 because
     * nothing surfaced it. It must appear BEFORE the day's results — a founder
     * scanning for 30 seconds reads top-down and stops.
     */
    expect(html.indexOf("waiting on you")).toBeLessThan(
      html.indexOf("https://twitter.com"),
    );
  });

  it("says a quiet day is quiet, rather than showing drafts", async () => {
    const html = await render({ ...BASE, todayPlacements: [] });
    // §12: honest silence beats fake activity. Drafts are inventory (§2.6) and
    // padding this list with them is the exact dishonesty that rule forbids.
    expect(html).toContain("Nothing published yet today");
  });

  it("stamps the age of the numbers", async () => {
    // §16.4 — a metric with no date is one that will eventually lie with
    // nothing to give it away.
    expect(await render(BASE)).toMatch(/Numbers last checked/);
    // ⚠️ No apostrophe in the pattern — JSX escapes it to `&#x27;` in the
    // rendered string, so matching the prose verbatim fails for a reason that
    // has nothing to do with the behaviour under test.
    expect(await render({ ...BASE, metricsAsOf: undefined })).toMatch(
      /come back yet/,
    );
  });

  it("carries her plain-language read, not just a number", async () => {
    const html = await render(BASE);
    expect(html).toContain("almost nobody saw them");
    // §16.3 — the benchmark is what makes the number readable at all.
    expect(html).toContain("100% under the niche median");
  });
});
