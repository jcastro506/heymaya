/**
 * Sprint 3.5 — `maya-content-cross-poster` unit tests.
 *
 * Pure-logic tests for the helper module. The Convex action that wires
 * model-router + voice-applier + best-practice + firewall is tested
 * separately by the lead.
 *
 * Coverage:
 *   - happy path: format choice per platform / media type, deep-link URL
 *     assembly, posting-order spacing
 *   - adversarial: null/undefined deep-link cases (YouTube), text source on
 *     visual platforms, anchor-only emission for single-platform creators
 */

import { describe, it, expect } from "vitest";
import {
  fallbackInstructionFor,
  hashtagGuidanceFor,
  oneTapUrlFor,
  pickFormat,
  recommendPostingOrder,
  type Platform,
} from "../script";

describe("maya-content-cross-poster — pickFormat", () => {
  it("video source: every platform returns a sane format", () => {
    const platforms: Platform[] = ["tiktok", "instagram", "youtube", "linkedin", "x"];
    for (const p of platforms) {
      const f = pickFormat("video", p);
      expect(f.format).toBeTruthy();
      expect(f.aspectRatioGuidance).toBeTruthy();
    }
  });

  it("TikTok always vertical 9:16", () => {
    expect(pickFormat("video", "tiktok").aspectRatioGuidance).toMatch(/9:16/);
  });

  it("LinkedIn text source returns text-post (not square video)", () => {
    expect(pickFormat("text", "linkedin").format).toContain("text post");
  });

  it("YouTube image source returns Community post (no Shorts)", () => {
    expect(pickFormat("image", "youtube").format).toContain("Community");
  });

  it("X video source carries a duration trim suggestion", () => {
    expect(pickFormat("video", "x").durationCutSuggestion).toMatch(/2:20|trim/i);
  });
});

describe("maya-content-cross-poster — oneTapUrlFor", () => {
  it("TikTok and Instagram return iOS sharesheet deep links", () => {
    const url = "https://convex-storage.example/file.mp4";
    expect(oneTapUrlFor("tiktok", url, "")).toContain("tiktok://");
    expect(oneTapUrlFor("instagram", url, "")).toContain("instagram://");
  });

  it("YouTube returns null (deep link unreliable; force fallback)", () => {
    expect(oneTapUrlFor("youtube", "https://x.com/file.mp4", "")).toBeNull();
  });

  it("X uses the web intent URL with the caption draft", () => {
    const url = oneTapUrlFor("x", "https://convex-storage.example/file.mp4", "Hello world");
    expect(url).toContain("twitter.com/intent/tweet");
    expect(url).toContain("Hello%20world");
  });

  // ── adversarial ──────────────────────────────────────────────────────
  it("LinkedIn with empty caption returns null (no media-supporting deep link)", () => {
    expect(oneTapUrlFor("linkedin", "https://x.com/file.mp4", "")).toBeNull();
  });
});

describe("maya-content-cross-poster — fallbackInstructionFor", () => {
  it("every platform has a non-empty fallback string", () => {
    const platforms: Platform[] = ["tiktok", "instagram", "youtube", "linkedin", "x"];
    for (const p of platforms) {
      const s = fallbackInstructionFor(p);
      expect(s.length).toBeGreaterThan(20);
    }
  });

  it("never says 'Maya posts' — the principle is no auto-publish", () => {
    const platforms: Platform[] = ["tiktok", "instagram", "youtube", "linkedin", "x"];
    for (const p of platforms) {
      const s = fallbackInstructionFor(p).toLowerCase();
      expect(s).not.toMatch(/maya (will )?post/);
      expect(s).not.toMatch(/auto[-\s]?publish/);
    }
  });
});

describe("maya-content-cross-poster — recommendPostingOrder", () => {
  it("anchor first; visually distinct platforms next; format-similar last with ≥12h gap", () => {
    const order = recommendPostingOrder("tiktok", ["tiktok", "linkedin", "x", "instagram", "youtube"]);
    expect(order[0]).toEqual({ platform: "tiktok", offsetHours: 0 });
    // LinkedIn + X come next (visually distinct)
    const linkedinIdx = order.findIndex((o) => o.platform === "linkedin");
    const xIdx = order.findIndex((o) => o.platform === "x");
    const igIdx = order.findIndex((o) => o.platform === "instagram");
    const ytIdx = order.findIndex((o) => o.platform === "youtube");
    expect(linkedinIdx).toBeGreaterThan(0);
    expect(xIdx).toBeGreaterThan(0);
    expect(igIdx).toBeGreaterThan(linkedinIdx);
    expect(igIdx).toBeGreaterThan(xIdx);
    // Format-similar variants land at ≥12h
    expect(order[igIdx].offsetHours).toBeGreaterThanOrEqual(12);
    expect(order[ytIdx].offsetHours).toBeGreaterThanOrEqual(12);
  });

  // ── adversarial ──────────────────────────────────────────────────────
  it("anchor-only: emits only the anchor at offset 0", () => {
    const order = recommendPostingOrder("tiktok", ["tiktok"]);
    expect(order).toEqual([{ platform: "tiktok", offsetHours: 0 }]);
  });

  it("does not double-emit the anchor when it appears in targets", () => {
    const order = recommendPostingOrder("instagram", ["instagram", "tiktok"]);
    const igCount = order.filter((o) => o.platform === "instagram").length;
    expect(igCount).toBe(1);
  });
});

describe("maya-content-cross-poster — hashtagGuidanceFor", () => {
  it("X recommends 0-2 (rarely useful), IG 3-5 (nearly dead)", () => {
    expect(hashtagGuidanceFor("x").count.max).toBeLessThanOrEqual(2);
    expect(hashtagGuidanceFor("instagram").count.max).toBeLessThanOrEqual(5);
  });
});
