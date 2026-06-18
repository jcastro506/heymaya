/**
 * Phase-1 ① — event-driven conversion ping (pure composer).
 *
 * Pure-function tests for composeConversionPing — no DB / no codegen required,
 * so they run under vitest standalone. Covers: grounded-with-channel vs
 * generic, the count phrasing (singular/plural), the per-kind verb phrasing,
 * the "that's N today" tail, and grounded-or-silent (no link without channel).
 */

import { describe, expect, it } from "vitest";
import { composeConversionPing } from "../conversionPing";

describe("composeConversionPing", () => {
  it("grounds the channel + link when both resolve", () => {
    const text = composeConversionPing({
      kind: "signup",
      count: 1,
      totalToday: 3,
      channel: "reddit",
      link: "https://x.convex.site/r/abc123",
    });
    expect(text).toBe(
      "🎉 a signup just came in — from your Reddit post 👉 https://x.convex.site/r/abc123. That's 3 today."
    );
  });

  it("stays generic (no source clause) when there is no channel", () => {
    const text = composeConversionPing({
      kind: "signup",
      count: 1,
      totalToday: 3,
    });
    expect(text).toBe("🎉 a signup just came in. That's 3 today.");
    expect(text).not.toContain("from your");
    expect(text).not.toContain("👉");
  });

  it("never appends a bare link without a grounded channel", () => {
    // Grounded-or-silent: a link with no channel must not surface.
    const text = composeConversionPing({
      kind: "signup",
      count: 1,
      totalToday: 1,
      channel: null,
      link: "https://x.convex.site/r/abc123",
    });
    expect(text).not.toContain("👉");
    expect(text).not.toContain("abc123");
  });

  it("names the channel but omits 👉 when there is no link", () => {
    const text = composeConversionPing({
      kind: "signup",
      count: 1,
      totalToday: 2,
      channel: "x",
    });
    expect(text).toBe("🎉 a signup just came in — from your X post. That's 2 today.");
    expect(text).not.toContain("👉");
  });

  it("pluralizes the count phrasing", () => {
    const text = composeConversionPing({ kind: "signup", count: 4, totalToday: 4 });
    expect(text).toContain("4 signups just came in");
  });

  it("uses singular phrasing for count 1", () => {
    const text = composeConversionPing({ kind: "signup", count: 1, totalToday: 1 });
    expect(text).toContain("a signup just came in");
    expect(text).not.toContain("1 signups");
  });

  it("phrases each kind correctly (singular)", () => {
    expect(composeConversionPing({ kind: "demo", count: 1 })).toContain(
      "a demo request just came in"
    );
    expect(composeConversionPing({ kind: "feedback", count: 1 })).toContain(
      "a piece of feedback just landed"
    );
    expect(composeConversionPing({ kind: "revenue", count: 1 })).toContain(
      "a sale just came in"
    );
    expect(composeConversionPing({ kind: "activated", count: 1 })).toContain(
      "a user came back"
    );
  });

  it("phrases each kind correctly (plural)", () => {
    expect(composeConversionPing({ kind: "demo", count: 3 })).toContain(
      "3 demo requests"
    );
    expect(composeConversionPing({ kind: "revenue", count: 2 })).toContain(
      "2 sales"
    );
    expect(composeConversionPing({ kind: "activated", count: 5 })).toContain(
      "5 users came back"
    );
  });

  it("omits the today tail when totalToday is absent or non-positive", () => {
    expect(composeConversionPing({ kind: "signup", count: 1 })).toBe(
      "🎉 a signup just came in."
    );
    expect(
      composeConversionPing({ kind: "signup", count: 1, totalToday: 0 })
    ).toBe("🎉 a signup just came in.");
  });

  it("falls back to count 1 for non-finite / non-positive counts", () => {
    const text = composeConversionPing({
      kind: "signup",
      count: 0,
      totalToday: 1,
    });
    expect(text).toContain("a signup just came in");
  });

  it("is short and anti-sycophantic — one emoji, no hype words", () => {
    const text = composeConversionPing({
      kind: "signup",
      count: 1,
      totalToday: 2,
      channel: "linkedin",
      link: "https://x.convex.site/r/zzz",
    });
    // Single celebratory emoji only.
    expect((text.match(/🎉/g) ?? []).length).toBe(1);
    for (const banned of ["amazing", "incredible", "huge", "congrats", "!!"]) {
      expect(text.toLowerCase()).not.toContain(banned);
    }
    expect(text.length).toBeLessThan(280);
  });

  it("trims and pretty-labels known channel aliases", () => {
    expect(composeConversionPing({ kind: "signup", count: 1, channel: " hn " })).toContain(
      "from your Hacker News post"
    );
    expect(composeConversionPing({ kind: "signup", count: 1, channel: "TIKTOK" })).toContain(
      "from your TikTok post"
    );
  });
});
