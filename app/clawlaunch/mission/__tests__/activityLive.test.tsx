/**
 * ⭐ Activity, from the live module — §16.8.6's "trust engine".
 *
 * Mission Control's Activity screen reads
 * `gtmMaya.missionControl.getMyAgentActivity`, backed by the frozen product's
 * tables. The live module writes to `placements`. So a v2 founder scrolled an
 * empty feed while her posts existed — the exact opposite of a trust engine.
 *
 * ⚠️ The archive backend was already correct and had **zero readers**:
 * `search`, `timeline` and `provenance` are all `internalQuery`, reachable by
 * her runtime and by nothing the founder can open.
 *
 * ## The rule this file exists to protect
 *
 * §16.8.1: a dead link renders as *"no longer live"* with the text preserved,
 * **never a broken tap**. `toEntry` sets `tappable` for exactly that, and a
 * surface that keys off `url` instead of `tappable` reintroduces the failure
 * that makes an archive feel like a lie rather than a record.
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
  api: { maya: { archive: { myActivity: "myActivity" } } },
}));

async function render(fixture: unknown): Promise<string> {
  h.fixture = fixture;
  const { ActivityLive } = await import("../_ActivityLive");
  return renderToString(createElement(ActivityLive));
}

const LIVE_ENTRY = {
  placementId: "p1",
  channel: "x",
  text: "DevPaulC saying no marketing after switching paid to free",
  publishedAt: Date.now() - 86_400_000,
  url: "https://twitter.com/i/web/status/1",
  tappable: true,
  views: 95,
  metricsAsOf: Date.now(),
};

describe("Activity (live)", () => {
  it("⭐ renders NOTHING without a live customer", async () => {
    // Additive, exactly like TodayLive — the accounts the frozen product still
    // serves must see what they saw before.
    expect(await render({ ok: false, error: "no account yet" })).toBe("");
    expect(await render(null)).toBe("");
  });

  it("shows her actual words, newest first, with a link out", async () => {
    const html = await render({ ok: true, entries: [LIVE_ENTRY] });
    expect(html).toContain("DevPaulC saying no marketing");
    expect(html).toContain("https://twitter.com/i/web/status/1");
    expect(html).toContain("95");
  });

  it("⚠️ a dead link is stated, never rendered as a tap", async () => {
    /**
     * The load-bearing case. `linkStatus: "gone"` produces `tappable: false`
     * with the text preserved. A feed that rendered an anchor here would send
     * the founder to a 404 from their own archive.
     */
    const html = await render({
      ok: true,
      entries: [
        {
          ...LIVE_ENTRY,
          url: undefined,
          tappable: false,
          linkNote: "no longer live",
        },
      ],
    });

    expect(html).toContain("no longer live");
    // The words survive the post.
    expect(html).toContain("DevPaulC saying no marketing");
    expect(html).not.toContain("<a");
  });

  it("⚠️ never taps through even when a url is present but not tappable", async () => {
    /**
     * The subtle version, and the reason `tappable` exists as its own flag: a
     * placement can carry a stale URL whose link status is unresolved. Keying
     * off `url` alone would render it as a normal entry.
     */
    const html = await render({
      ok: true,
      entries: [
        {
          ...LIVE_ENTRY,
          tappable: false,
          linkNote: "link not resolved yet",
        },
      ],
    });

    expect(html).toContain("link not resolved yet");
    expect(html).not.toContain("<a");
  });

  it("distinguishes 'zero views' from 'not measured yet'", async () => {
    // §16.4 — they are different claims, and collapsing them is how a
    // dashboard quietly starts lying.
    const measured = await render({
      ok: true,
      entries: [{ ...LIVE_ENTRY, views: 0 }],
    });
    expect(measured).toContain("as of");

    const unmeasured = await render({
      ok: true,
      entries: [{ ...LIVE_ENTRY, views: 0, metricsAsOf: undefined }],
    });
    expect(unmeasured).toContain("numbers not back yet");
    expect(unmeasured).not.toContain("as of");
  });

  it("has a designed empty state", async () => {
    // Day one is the moment of maximum doubt; a blank panel confirms the fear.
    const html = await render({ ok: true, entries: [] });
    expect(html).toContain("Nothing published yet");
    expect(html).toContain("the moment it goes live");
  });
});
