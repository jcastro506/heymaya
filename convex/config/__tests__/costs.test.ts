/** COGS lines beyond the ledger (COGS model §7). Pure; checked against the model's worked numbers. */
import { describe, expect, it } from "vitest";
import { creatorCogs, isRealCreator, stripeFeeUsd, tierPriceUsd, zernioMonthlyUsd } from "../costs";

describe("costs", () => {
  it("Zernio bands are graduated", () => {
    expect(zernioMonthlyUsd(2)).toBe(0);
    expect(zernioMonthlyUsd(10)).toBe(48);
    expect(zernioMonthlyUsd(320)).toBe(48 + 270 + 220);
  });
  it("Stripe on $24.99 is about $1.20", () => {
    expect(stripeFeeUsd(24.99)).toBeCloseTo(1.2, 2);
    expect(stripeFeeUsd(0)).toBe(0);
  });
  it("only paying plans have a price", () => {
    expect(tierPriceUsd({ status: "active", tier: "duo" })).toBe(24.99);
    expect(tierPriceUsd({ status: "comped", tier: "partner" })).toBe(0);
  });
  it("eval, scenario and dev seeds are never customers", () => {
    for (const id of ["eval:vanessaalopezz", "eval-run:x", "eval-quality-tt", "devbare_1"]) expect(isRealCreator({ clerkUserId: id })).toBe(false);
    expect(isRealCreator({ clerkUserId: "user_2abc" })).toBe(true);
  });
  it("matches the model's typical duo at 200 creators (~$15, ~40%)", () => {
    const c = creatorCogs({ ledgerUsd: 5.94, messages: 210, accounts: 2, priceUsd: 24.99, fleet: { creators: 200, messages: 42_000, accounts: 300, lines: 1 } });
    expect(c.messagingUsd).toBeCloseTo(2.02, 1);
    expect(c.totalUsd).toBeGreaterThan(12);
    expect(c.totalUsd).toBeLessThan(16);
    expect(c.marginPct).toBeGreaterThan(35);
  });
});
