/**
 * ⭐ Results, from the live module — §16.2's "reason they don't cancel".
 *
 * The Results screen reads `gtmMaya.missionControl.getMyConversions` and
 * `gtmPostResults`, neither of which the live module writes. Its `LadderBlock`
 * was already live; everything around it was blank.
 *
 * ⚠️ And `maya/attribution.ts` was entirely `internal*` — the chain §14.45
 * exists to build was computed and reachable by nobody the founder could ask.
 * Sixth zero-reader backend found today.
 *
 * ## The property under test
 *
 * §5.0.0 / §14.45: a broken attribution chain is **reported**, never guessed
 * at. The untraced remainder must always be visible when it is non-zero —
 * an attribution figure without it is one that flatters us, and a founder who
 * later finds an untracked signup stops believing the whole screen.
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
  api: { maya: { attribution: { myResults: "myResults" } } },
}));

async function render(fixture: unknown): Promise<string> {
  h.fixture = fixture;
  const { ResultsLive } = await import("../results/_ResultsLive");
  return renderToString(createElement(ResultsLive));
}

describe("Results (live)", () => {
  it("⭐ renders NOTHING without a live customer", async () => {
    expect(await render({ ok: false, error: "no account yet" })).toBe("");
    expect(await render(null)).toBe("");
  });

  it("⭐ always shows the untraced remainder", async () => {
    const html = await render({
      ok: true,
      total: 3,
      traced: 2,
      untraced: 1,
      windowDays: 30,
    });

    expect(html).toContain("3");
    // §5.0.0's sentence, with the gap stated — not a bare "2 attributed".
    expect(html).toMatch(/point to the post for 2/);
    expect(html).toMatch(/can&#x27;t for the other 1|can't for the other 1/);
  });

  it("says so plainly when everything traces", async () => {
    const html = await render({
      ok: true,
      total: 4,
      traced: 4,
      untraced: 0,
      windowDays: 30,
    });
    expect(html).toMatch(/point to the post for each one/);
    // No phantom remainder when there isn't one.
    expect(html).not.toMatch(/can&#x27;t for the other/);
  });

  it("handles a single traced result without reading like a robot", async () => {
    const html = await render({
      ok: true,
      total: 1,
      traced: 1,
      untraced: 0,
      windowDays: 30,
    });
    // "1 signup", not "1 signups" — §11, she counts like a person.
    expect(html).toContain("signup");
    expect(html).not.toContain("signups");
    expect(html).toMatch(/point to the post for it/);
  });

  it("a zero week says what it is, not what it isn't", async () => {
    /**
     * §12 — honest silence beats fake activity, and §2.6 — reach is not a
     * result. A zero here must not be padded with views or drafts to look
     * like motion.
     */
    const html = await render({
      ok: true,
      total: 0,
      traced: 0,
      untraced: 0,
      windowDays: 30,
    });
    expect(html).toContain("No signups traced back to her yet");
    // ⚠️ React SSR inserts `<!-- -->` between literal text and an interpolated
    // value, so "30 days" never appears contiguously. Matching the prose
    // verbatim fails for a reason unrelated to the behaviour under test.
    expect(html).toMatch(/30<!-- --> days|30 days/);
    expect(html).not.toMatch(/views|drafts/i);
  });
});
