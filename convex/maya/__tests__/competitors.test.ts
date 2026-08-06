/**
 * Watching the accounts that keep showing up in this niche.
 *
 * The discovery half was already built — `rankAccounts` ranks by how many
 * DIFFERENT validated keywords an account appears under, so nobody is ever
 * asked to name their competitors.
 *
 * These tests are about the other half: what earns one of a handful of daily
 * messages.
 */

import { describe, expect, it } from "vitest";
import {
  isBreakout,
  BREAKOUT_MULTIPLE,
  MIN_KEYWORD_HITS,
  BREAKOUT_WINDOW_MS,
} from "../competitors";

describe("⭐ WHAT EARNS A MESSAGE", () => {
  it("⭐ NOT 'THEY POSTED' — they post constantly", () => {
    // A feed of every competitor post is a notification setting, not an
    // employee. Something at their usual rate is a normal day.
    expect(isBreakout(10, 10)).toBe(false);
    expect(isBreakout(19, 10)).toBe(false);
  });

  it("a post pulling far above their OWN usual does", () => {
    expect(isBreakout(10 * BREAKOUT_MULTIPLE, 10)).toBe(true);
  });

  it("⭐ COMPARED TO THEMSELVES, NEVER TO AN ABSOLUTE FLOOR", () => {
    /**
     * A 10k-view account and a 200-view account both have breakout posts. An
     * absolute threshold only ever surfaces the big accounts — who are the
     * least comparable to a founder starting out, and therefore the least
     * useful to study.
     */
    const smallAccountBreakout = isBreakout(6, 1);
    const bigAccountNormalDay = isBreakout(500, 500);
    expect(smallAccountBreakout).toBe(true);
    expect(bigAccountNormalDay).toBe(false);
  });

  it("⭐ NO BASELINE MEANS NO VERDICT, NOT AN INFINITE ONE", () => {
    // A naive divide by a zero median makes every post infinitely surprising,
    // so the first message a founder ever gets would be noise about an account
    // we know nothing about.
    expect(isBreakout(9_999, 0)).toBe(false);
    expect(isBreakout(9_999, undefined)).toBe(false);
  });

  it("the bar is high enough to be an event, not a good day", () => {
    // Twice their usual is a good day. This has to be worth interrupting for.
    expect(BREAKOUT_MULTIPLE).toBeGreaterThanOrEqual(4);
  });

  it("⭐ ONLY ACCOUNTS THAT APPEAR UNDER MORE THAN ONE NICHE TERM", () => {
    // One appearance is passing traffic. Two separate validated keywords is
    // evidence they live in this world — and it keeps the daily cost at three
    // requests rather than thirty.
    expect(MIN_KEYWORD_HITS).toBeGreaterThanOrEqual(2);
  });

  it("nothing older than a few days is news, however well it did", () => {
    expect(BREAKOUT_WINDOW_MS).toBeLessThanOrEqual(7 * 86_400_000);
  });
});
