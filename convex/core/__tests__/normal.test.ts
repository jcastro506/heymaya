/** One definition of "normal" (audit B1). Pure. */
import { describe, expect, it } from "vitest";
import { appendHistory, multipleFor, normalsByPlatform, normalViews, shapeOf } from "../normal";

const H = 3_600_000;
const now = Date.UTC(2026, 8, 23, 12);
const post = (platform: string, views: number, ageH: number, history?: Array<{ at: number; views: number }>) => ({ platform, createTime: now - ageH * H, metrics: { views }, history });

describe("their normal", () => {
  it("ignores fresh posts, so posting doesn't drag it down", () => {
    const settled = [1000, 1100, 900, 1200, 1000].map((v, i) => post("tiktok", v, 72 + i * 24));
    const fresh = [50, 60, 40].map((v, i) => post("tiktok", v, 2 + i));
    expect(normalViews([...settled, ...fresh], "tiktok", now)?.value).toBe(1000);
  });

  it("is per platform", () => {
    const tt = [1000, 1000, 1000, 1000, 1000].map((v, i) => post("tiktok", v, 72 + i));
    const ig = [100, 100, 100, 100, 100].map((v, i) => post("instagram", v, 72 + i));
    const n = normalsByPlatform([...tt, ...ig], now);
    expect([n.get("tiktok")?.value, n.get("instagram")?.value]).toEqual([1000, 100]);
    expect(multipleFor(post("instagram", 300, 100), n)).toBe(3);
  });

  it("one viral post can't move it", () => {
    const base = [1000, 1000, 1000, 1000, 1000, 1000].map((v, i) => post("tiktok", v, 72 + i));
    expect(normalViews([...base, post("tiktok", 800_000, 80)], "tiktok", now)?.value).toBe(1000);
  });

  it("has no normal until five settled posts", () => {
    expect(normalViews([1, 2, 3, 4].map((v, i) => post("tiktok", v * 100, 72 + i)), "tiktok", now)).toBeNull();
  });

  it("a fresh post's multiple is a lower bound that only grows", () => {
    const n = normalsByPlatform([1000, 1000, 1000, 1000, 1000].map((v, i) => post("tiktok", v, 72 + i)), now);
    expect(multipleFor(post("tiktok", 110_000, 6), n)).toBe(110);
  });
});

describe("how the views arrived", () => {
  it("spike: most views in the first two days", () => {
    const p = post("tiktok", 10_000, 24 * 10, [{ at: now - 240 * H, views: 0 }, { at: now - 200 * H, views: 9000 }, { at: now - 24 * H, views: 10_000 }]);
    expect(shapeOf(p, now)).toBe("spike");
  });

  it("slow burn: a big share after the first week", () => {
    const p = post("tiktok", 10_000, 24 * 20, [{ at: now - 470 * H, views: 1000 }, { at: now - 300 * H, views: 3000 }, { at: now - 10 * H, views: 10_000 }]);
    expect(shapeOf(p, now)).toBe("slow_burn");
  });

  it("early under two days; unknown without readings", () => {
    expect(shapeOf(post("tiktok", 500, 5), now)).toBe("early");
    expect(shapeOf(post("tiktok", 500, 100), now)).toBe("unknown");
  });

  it("history keeps changes only, bounded, first reading kept", () => {
    let h = appendHistory(undefined, { at: 1, views: 1 });
    h = appendHistory(h, { at: 2, views: 1 }); // unchanged: dropped
    for (let i = 3; i < 100; i++) h = appendHistory(h, { at: i, views: i });
    expect(h.length).toBe(48);
    expect(h[0]).toEqual({ at: 1, views: 1 });
    expect(h[h.length - 1]).toEqual({ at: 99, views: 99 });
  });
});
