/**
 * Vendor smoke suite — the execution core (§18.0.5).
 *
 * Pure with respect to Convex: checks in, outcomes out. No `ctx`, no database.
 * That's what lets the whole policy surface — env gating, budget enforcement,
 * timeouts, drift classification, failure isolation — be tested exhaustively
 * with fake checks and zero vendor keys.
 *
 * The Convex action in `runner.ts` is a thin shell around this.
 */

import { detectDrift } from "./drift";
import type { CheckOutcome, RunSummary, SmokeCheck } from "./types";

export interface ExecuteOptions {
  /** Groups the run's rows. Callers pass a real id; tests pass a fixed one. */
  runId: string;
  /**
   * Hard ceiling on what one invocation may spend. Checks are attempted in
   * registry order; the first one whose `estCostUsd` doesn't fit is skipped
   * with a budget reason, and so is everything after it that doesn't fit.
   */
  budgetUsd: number;
  /** Reads env. Injected so tests never touch `process.env`. */
  getEnv: (key: string) => string | undefined;
  /** Per-check wall-clock limit. A hung vendor must not hang the suite. */
  timeoutMs?: number;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function describeError(error: unknown): string {
  if (error instanceof Error) {
    // Vendor clients attach a status; surfacing it turns "it failed" into
    // "it 401'd", which is the difference between a page and a shrug.
    const status = (error as { status?: number }).status;
    return status ? `${status}: ${error.message}` : error.message;
  }
  return String(error);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run one check. Never throws — a check that explodes is a `fail` outcome, so
 * one broken vendor can't take down the rest of the sweep.
 */
export async function executeCheck(
  check: SmokeCheck,
  options: ExecuteOptions
): Promise<CheckOutcome> {
  const now = options.now ?? Date.now;
  const base = { vendor: check.vendor, tier: check.tier, check: check.check };

  const missingEnv = check.requiredEnv.filter((key) => {
    const value = options.getEnv(key);
    return value === undefined || value === "";
  });
  if (missingEnv.length > 0) {
    return {
      ...base,
      status: "skipped",
      detail: `not configured — missing ${missingEnv.join(", ")}`,
    };
  }

  const startedAt = now();
  let payload: unknown;
  try {
    payload = await withTimeout(
      check.run(),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );
  } catch (error) {
    return {
      ...base,
      status: "fail",
      detail: `call failed — ${describeError(error)}`,
      latencyMs: now() - startedAt,
      costUsd: check.estCostUsd,
    };
  }
  const latencyMs = now() - startedAt;

  const drift = detectDrift(payload, check.schema);
  if (drift.ok) {
    return { ...base, status: "pass", latencyMs, costUsd: check.estCostUsd };
  }

  return {
    ...base,
    status: "fail",
    detail: `shape drift — ${drift.summary}`,
    drifts: drift.drifts.map((d) => `${d.kind}:${d.path === "" ? "<root>" : d.path}`),
    latencyMs,
    costUsd: check.estCostUsd,
  };
}

/**
 * Run a set of checks under one budget.
 *
 * Sequential on purpose: these hit rate-limited vendor APIs, and a smoke suite
 * that trips a rate limit reports a failure it caused itself.
 */
export async function executeChecks(
  checks: ReadonlyArray<SmokeCheck>,
  options: ExecuteOptions
): Promise<RunSummary> {
  const outcomes: CheckOutcome[] = [];
  let spentUsd = 0;
  let budgetExhausted = false;

  for (const check of checks) {
    if (spentUsd + check.estCostUsd > options.budgetUsd) {
      budgetExhausted = true;
      outcomes.push({
        vendor: check.vendor,
        tier: check.tier,
        check: check.check,
        status: "skipped",
        detail: `budget cap reached — $${spentUsd.toFixed(
          4
        )} of $${options.budgetUsd.toFixed(4)} spent`,
      });
      continue;
    }

    const outcome = await executeCheck(check, options);
    // Only a check that actually reached the vendor spent anything. A skip
    // for missing env is free, so it must not eat the budget.
    if (outcome.status !== "skipped") spentUsd += outcome.costUsd ?? 0;
    outcomes.push(outcome);
  }

  return {
    runId: options.runId,
    outcomes,
    passed: outcomes.filter((o) => o.status === "pass").length,
    failed: outcomes.filter((o) => o.status === "fail").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    spentUsd,
    budgetExhausted,
  };
}
