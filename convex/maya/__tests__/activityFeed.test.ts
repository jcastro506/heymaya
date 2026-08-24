/**
 * "Is she actually working?" — answered from the spend ledger.
 */
import { describe, expect, it } from "vitest";
import { groupWork, WORK_LABELS, FEED_DAYS } from "../activityFeed";

// 2026-08-22, 03:30 UTC — which is still the 21st in New York.
const LATE_UTC = Date.parse("2026-08-22T03:30:00.000Z");
const MIDDAY = Date.parse("2026-08-22T16:00:00.000Z");

describe("⭐ WORK IS READ FROM SPEND, WHICH CANNOT BE PADDED", () => {
  /**
   * ⚠️ 111 cost events and 182 jobs, read by nothing. Four days in, a founder's
   * only signal about whether she was working was a watchdog announcing that
   * nothing had gone out. Their question, verbatim: "so are you still doing
   * stuff or".
   *
   * `costEvents` records work that ACTUALLY HAPPENED and cost money. It cannot
   * report an intention and cannot be inflated, which is the property this
   * answer needs — and why it reads the ledger rather than her account of her
   * own day.
   */
  it("groups a day's work and counts repeats", () => {
    const days = groupWork(
      [
        { at: MIDDAY, purpose: "trend_shape" },
        { at: MIDDAY, purpose: "trend_shape" },
        { at: MIDDAY, purpose: "complaint_mining" },
      ],
      "UTC",
      14
    );
    expect(days).toHaveLength(1);
    expect(days[0].total).toBe(3);
    expect(days[0].items[0]).toEqual({
      what: "worked out which shapes are landing",
      times: 2,
    });
  });

  it("⚠️ THE FOUNDER'S DAY, NOT UTC", () => {
    /**
     * 03:30 UTC on the 22nd is 23:30 on the 21st in New York. A UTC boundary
     * has already broken the recap dedupe and the daily message budget in this
     * codebase — the 20:00 recap on 2026-08-07 was filed as the 8th.
     */
    const [ny] = groupWork(
      [{ at: LATE_UTC, purpose: "trend_shape" }],
      "America/New_York",
      14
    );
    expect(ny.day).toBe("2026-08-21");

    const [utc] = groupWork([{ at: LATE_UTC, purpose: "trend_shape" }], "UTC", 14);
    expect(utc.day).toBe("2026-08-22");
  });

  it("newest day first — a founder checks today, not last Tuesday", () => {
    const days = groupWork(
      [
        { at: MIDDAY - 2 * 86_400_000, purpose: "trend_shape" },
        { at: MIDDAY, purpose: "trend_shape" },
      ],
      "UTC",
      14
    );
    expect(days[0].day > days[1].day).toBe(true);
  });

  it("⚠️ UNTRANSLATED WORK IS DROPPED, NEVER SHOWN RAW", () => {
    /**
     * `ad_competitor_search_terms` is OUR word. A founder reading our internals
     * learns to think in our vocabulary instead of their business — the same
     * failure as her leaking tool names into Telegram. An unnamed line is worse
     * than a shorter list.
     */
    const days = groupWork(
      [
        { at: MIDDAY, purpose: "trend_shape" },
        { at: MIDDAY, purpose: "some_internal_thing_we_added_later" },
      ],
      "UTC",
      14
    );
    expect(days[0].total).toBe(1);
    expect(JSON.stringify(days)).not.toContain("some_internal_thing");
  });

  it("a day of only-untranslated work does not render as an empty day", () => {
    expect(groupWork([{ at: MIDDAY, purpose: "unknown_x" }], "UTC", 14)).toEqual([]);
  });

  it("caps the days returned", () => {
    const events = Array.from({ length: 30 }, (_, i) => ({
      at: MIDDAY - i * 86_400_000,
      purpose: "trend_shape",
    }));
    expect(groupWork(events, "UTC", 5)).toHaveLength(5);
  });

  it("⭐ every label is written in the founder's language, not ours", () => {
    // No snake_case, no tool names, no module names leaking through.
    for (const [purpose, label] of Object.entries(WORK_LABELS)) {
      expect(label, purpose).not.toMatch(/_/);
      expect(label, purpose).toMatch(/^[a-z]/);
    }
  });

  it("a fortnight is enough to see a rhythm", () => {
    expect(FEED_DAYS).toBe(14);
  });
});
