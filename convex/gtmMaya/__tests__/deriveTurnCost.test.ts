import { describe, expect, it } from "vitest";
import { deriveTurnCostUsd } from "../openclaw/conversationCapture";

/**
 * The blind-ledger fix: when the OpenClaw runtime omits costUsd (the common
 * case), we derive cost from the reported tokens + model so the gtmCostLedger
 * mirror fires and the spend kill-switch is no longer summing $0.
 */
describe("deriveTurnCostUsd", () => {
  it("prices a Kimi K2 main-brain turn from tokens", () => {
    // 100k in @ $0.60/M + 20k out @ $2.50/M = 0.06 + 0.05 = $0.11
    const cost = deriveTurnCostUsd("moonshotai/kimi-k2-0905", 100_000, 20_000);
    expect(cost).toBeCloseTo(0.11, 6);
  });

  it("prices a Gemini 3 Flash worker turn", () => {
    // 50k in @ $0.50/M + 10k out @ $3.00/M = 0.025 + 0.03 = $0.055
    const cost = deriveTurnCostUsd("google/gemini-3-flash-preview", 50_000, 10_000);
    expect(cost).toBeCloseTo(0.055, 6);
  });

  it("prices Flash Lite at the cheaper rate", () => {
    // 40k in @ $0.25/M + 8k out @ $1.50/M = 0.01 + 0.012 = $0.022
    const cost = deriveTurnCostUsd("google/gemini-3.1-flash-lite", 40_000, 8_000);
    expect(cost).toBeCloseTo(0.022, 6);
  });

  it("uses a conservative (generous) fallback for an unknown model so a runaway is never undercounted", () => {
    // fallback $1.00/M in + $3.00/M out → 100k in + 20k out = 0.1 + 0.06 = $0.16
    const known = deriveTurnCostUsd("moonshotai/kimi-k2-0905", 100_000, 20_000)!;
    const unknown = deriveTurnCostUsd("some/unrecognized-model-v9", 100_000, 20_000)!;
    expect(unknown).toBeCloseTo(0.16, 6);
    expect(unknown).toBeGreaterThan(known); // fallback never undercounts
  });

  it("returns undefined only when there are no usable tokens (the fully-blind case)", () => {
    expect(deriveTurnCostUsd("moonshotai/kimi-k2-0905", undefined, undefined)).toBeUndefined();
    expect(deriveTurnCostUsd("moonshotai/kimi-k2-0905", 0, 0)).toBeUndefined();
    // a missing model still prices off tokens (via fallback), not undefined
    expect(deriveTurnCostUsd(undefined, 10_000, 1_000)).toBeGreaterThan(0);
  });
});
