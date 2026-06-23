import { describe, expect, it } from "vitest";
import {
  PERIOD_MS,
  PER_RENDER_BUFFER_CREDITS,
  evaluateCreativeBudget,
  getBillingPeriodWindow,
  isCountableCreativeRow,
  proratedAllowanceCredits,
  summarizeCreativeSpend,
} from "../creativeBudgetGate";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

describe("proratedAllowanceCredits — the daily drip", () => {
  const start = 1_000_000_000_000;
  const end = start + PERIOD_MS;

  it("day 1 (start) unlocks ~0 credits", () => {
    expect(proratedAllowanceCredits(60, start, end, start)).toBe(0);
  });

  it("day 15 (~halfway) unlocks ~half the month", () => {
    const mid = start + 15 * DAY;
    const v = proratedAllowanceCredits(60, start, end, mid);
    expect(v).toBeGreaterThan(28);
    expect(v).toBeLessThan(32);
  });

  it("day 30 (end) unlocks the full cap, clamped", () => {
    expect(proratedAllowanceCredits(60, start, end, end)).toBe(60);
    // past the end stays clamped at the cap
    expect(proratedAllowanceCredits(60, start, end, end + 10 * DAY)).toBe(60);
  });

  it("cap 0 unlocks 0; degenerate window returns the cap (never under-blocks)", () => {
    expect(proratedAllowanceCredits(0, start, end, end)).toBe(0);
    expect(proratedAllowanceCredits(60, start, start, start)).toBe(60); // zero span
  });
});

describe("isCountableCreativeRow + summarizeCreativeSpend", () => {
  it("counts ONLY creative:true rows, summing units (credits)", () => {
    expect(isCountableCreativeRow({ creative: true })).toBe(true);
    expect(isCountableCreativeRow({ creative: false })).toBe(false);
    expect(isCountableCreativeRow({})).toBe(false);
  });

  it("sums credits in-period and in the last hour", () => {
    const now = 2_000_000_000_000;
    const periodStart = now - 10 * DAY;
    const rows = [
      { creative: true, units: 7.5, createdAt: now - 5 * DAY }, // in period, not hour
      { creative: true, units: 8, createdAt: now - 30 * 60 * 1000 }, // in hour
      { creative: false, units: 100, createdAt: now - 1 * DAY }, // not creative → ignored
      { creative: true, units: 5, createdAt: periodStart - DAY }, // before period → ignored
      { creative: true, units: 9, createdAt: now + DAY }, // future → ignored
    ];
    const s = summarizeCreativeSpend(rows, periodStart, now);
    expect(s.usedCreditsThisPeriod).toBe(15.5);
    expect(s.usedCreditsThisHour).toBe(8);
  });
});

describe("evaluateCreativeBudget — full / graceful_degrade / hard_block", () => {
  const base = {
    usedCreditsThisHour: 0,
    perRenderBufferCredits: PER_RENDER_BUFFER_CREDITS,
  };

  it("full when under the drip line", () => {
    const v = evaluateCreativeBudget({
      ...base,
      usedCreditsThisPeriod: 5,
      proratedAllowanceCredits: 10,
      monthlyCapCredits: 60,
    });
    expect(v.mode).toBe("full");
    expect(v.allowed).toBe(true);
  });

  it("graceful_degrade when over drip + buffer but under the ceiling", () => {
    // drip 5 + buffer 8 = 13 allowed-through-now; used 20 → degrade
    const v = evaluateCreativeBudget({
      ...base,
      usedCreditsThisPeriod: 20,
      proratedAllowanceCredits: 5,
      monthlyCapCredits: 60,
    });
    expect(v.mode).toBe("graceful_degrade");
    expect(v.allowed).toBe(false);
  });

  it("burst buffer keeps a single render under the drip line allowed", () => {
    // drip 2, used 9 → 9 <= 2 + 8 (=10) → still full (one-render burst)
    const v = evaluateCreativeBudget({
      ...base,
      usedCreditsThisPeriod: 9,
      proratedAllowanceCredits: 2,
      monthlyCapCredits: 60,
    });
    expect(v.mode).toBe("full");
  });

  it("hard_block at the monthly ceiling", () => {
    const v = evaluateCreativeBudget({
      ...base,
      usedCreditsThisPeriod: 60,
      proratedAllowanceCredits: 60,
      monthlyCapCredits: 60,
    });
    expect(v.mode).toBe("hard_block");
    expect(v.allowed).toBe(false);
  });

  it("cap 0 (starter/growth/fail-closed) → hard_block on the FIRST credit", () => {
    const v = evaluateCreativeBudget({
      ...base,
      usedCreditsThisPeriod: 0,
      proratedAllowanceCredits: 0,
      monthlyCapCredits: 0,
    });
    expect(v.mode).toBe("hard_block");
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/Studio/i);
  });
});

describe("getBillingPeriodWindow — periodStart + rolling fallback", () => {
  const now = 3_000_000_000_000;

  it("uses periodStart when present", () => {
    const ps = now - 12 * DAY;
    const w = getBillingPeriodWindow(JSON.stringify({ periodStart: ps }), now);
    expect(w.periodStart).toBe(ps);
    expect(w.periodEnd).toBe(ps + PERIOD_MS);
  });

  it("falls back to a rolling 30-day window when periodStart is missing/null", () => {
    const w = getBillingPeriodWindow(JSON.stringify({ periodStart: null }), now);
    expect(w.periodStart).toBe(now - PERIOD_MS);
    expect(w.periodEnd).toBe(now);
  });

  it("falls back on corrupt JSON and on a future-dated periodStart", () => {
    const corrupt = getBillingPeriodWindow("{not json", now);
    expect(corrupt.periodStart).toBe(now - PERIOD_MS);
    const future = getBillingPeriodWindow(
      JSON.stringify({ periodStart: now + DAY }),
      now
    );
    expect(future.periodStart).toBe(now - PERIOD_MS);
  });
});

describe("failed renders are free (adversarial)", () => {
  it("a row with no/zero units adds nothing to the period spend", () => {
    const now = 4_000_000_000_000;
    const periodStart = now - DAY;
    const rows = [
      { creative: true, units: 0, createdAt: now - HOUR }, // failed render, 0 credits
      { creative: true, createdAt: now - HOUR }, // units absent
    ];
    const s = summarizeCreativeSpend(rows, periodStart, now);
    expect(s.usedCreditsThisPeriod).toBe(0);
  });
});
