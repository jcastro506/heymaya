import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { executeCheck, executeChecks } from "../execute";
import type { SmokeCheck } from "../types";

const SCHEMA = z.strictObject({ ok: z.boolean() });

function check(overrides: Partial<SmokeCheck> = {}): SmokeCheck {
  return {
    vendor: "zernio",
    tier: 2,
    check: "zernio.getAccounts",
    requiredEnv: ["ZERNIO_API_KEY"],
    estCostUsd: 0,
    run: async () => ({ ok: true }),
    schema: SCHEMA,
    ...overrides,
  };
}

const env = (vars: Record<string, string>) => (key: string) => vars[key];
const CONFIGURED = env({ ZERNIO_API_KEY: "k" });

const opts = {
  runId: "run_1",
  budgetUsd: 1,
  getEnv: CONFIGURED,
};

describe("executeCheck", () => {
  it("a matching payload passes and records latency", async () => {
    const outcome = await executeCheck(check(), opts);
    expect(outcome.status).toBe("pass");
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(0);
    expect(outcome.drifts).toBeUndefined();
  });

  it("THE SCAR: a 200 carrying an unexpected field is a FAIL, not a pass", async () => {
    // The Zernio incident: a successful HTTP call whose body changed shape.
    const outcome = await executeCheck(
      check({ run: async () => ({ ok: true, platformResults: [] }) }),
      opts
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.detail).toMatch(/shape drift/);
    expect(outcome.drifts).toEqual(["unexpected:platformResults"]);
  });

  it("missing env is skipped, not failed — and says which var", async () => {
    const outcome = await executeCheck(check(), { ...opts, getEnv: env({}) });
    expect(outcome.status).toBe("skipped");
    expect(outcome.detail).toMatch(/ZERNIO_API_KEY/);
  });

  it("an empty-string env var counts as missing", async () => {
    const outcome = await executeCheck(check(), {
      ...opts,
      getEnv: env({ ZERNIO_API_KEY: "" }),
    });
    expect(outcome.status).toBe("skipped");
  });

  it("a thrown error is a fail, with the vendor status code surfaced", async () => {
    const error = Object.assign(new Error("Unauthorized"), { status: 401 });
    const outcome = await executeCheck(
      check({
        run: async () => {
          throw error;
        },
      }),
      opts
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.detail).toBe("call failed — 401: Unauthorized");
  });

  it("a hung vendor times out instead of hanging the suite", async () => {
    vi.useFakeTimers();
    try {
      const pending = executeCheck(
        check({ run: () => new Promise(() => {}) }),
        { ...opts, timeoutMs: 5_000 }
      );
      await vi.advanceTimersByTimeAsync(5_001);
      const outcome = await pending;
      expect(outcome.status).toBe("fail");
      expect(outcome.detail).toMatch(/timed out after 5000ms/);
    } finally {
      vi.clearAllTimers();
  vi.useRealTimers();
    }
  });

  it("a non-object payload (an HTML error page, say) fails at the root", async () => {
    const outcome = await executeCheck(
      check({ run: async () => "<html>502 Bad Gateway</html>" }),
      opts
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.drifts).toEqual(["notAnObject:<root>"]);
  });
});

describe("executeChecks", () => {
  it("runs everything and tallies the outcomes", async () => {
    const summary = await executeChecks(
      [
        check({ check: "a" }),
        check({ check: "b", run: async () => ({ ok: true, drift: 1 }) }),
        check({ check: "c", requiredEnv: ["ABSENT_KEY"] }),
      ],
      opts
    );
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.outcomes).toHaveLength(3);
  });

  it("one exploding check never takes down the rest of the sweep", async () => {
    const summary = await executeChecks(
      [
        check({
          check: "boom",
          run: async () => {
            throw new Error("vendor down");
          },
        }),
        check({ check: "fine" }),
      ],
      opts
    );
    expect(summary.failed).toBe(1);
    expect(summary.passed).toBe(1);
  });

  it("the budget cap stops spending and says so", async () => {
    const summary = await executeChecks(
      [
        check({ check: "a", estCostUsd: 0.4 }),
        check({ check: "b", estCostUsd: 0.4 }),
        check({ check: "c", estCostUsd: 0.4 }),
      ],
      { ...opts, budgetUsd: 1 }
    );
    expect(summary.spentUsd).toBeCloseTo(0.8, 5);
    expect(summary.budgetExhausted).toBe(true);
    const capped = summary.outcomes[2];
    expect(capped.status).toBe("skipped");
    expect(capped.detail).toMatch(/budget cap reached/);
  });

  it("a check skipped for missing env does NOT consume budget", async () => {
    // Otherwise an unconfigured vendor early in the registry would starve the
    // configured ones behind it.
    const summary = await executeChecks(
      [
        check({ check: "unconfigured", estCostUsd: 1, requiredEnv: ["ABSENT"] }),
        check({ check: "configured", estCostUsd: 0.5 }),
      ],
      { ...opts, budgetUsd: 1 }
    );
    expect(summary.spentUsd).toBeCloseTo(0.5, 5);
    expect(summary.budgetExhausted).toBe(false);
    expect(summary.outcomes[1].status).toBe("pass");
  });

  it("a failed call still counts against the budget — it hit the vendor", async () => {
    const summary = await executeChecks(
      [
        check({
          check: "spent-then-failed",
          estCostUsd: 0.5,
          run: async () => {
            throw new Error("500");
          },
        }),
      ],
      opts
    );
    expect(summary.spentUsd).toBeCloseTo(0.5, 5);
  });
});
