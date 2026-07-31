/**
 * Vendor smoke suite — the check contract (§18.0.5).
 *
 * A check is a thunk that performs one real vendor call and hands back the RAW
 * payload, plus the strict schema that payload is expected to satisfy. The
 * runner owns everything else: env gating, budget, timing, drift
 * classification, and recording.
 *
 * Keeping `run` and `schema` separate is deliberate — the check does no
 * parsing of its own, so a check can never accidentally launder a drifted
 * response into a "success" the way production's lenient client does.
 */

import type { z } from "zod";

export type Vendor =
  | "zernio"
  | "scrapecreators"
  | "twitterapiio"
  | "creatify"
  | "openrouter"
  | "r2"
  | "gemini";

export type Tier = 1 | 2 | 3;

export const ALL_VENDORS: Vendor[] = [
  "zernio",
  "scrapecreators",
  "twitterapiio",
  "creatify",
  "openrouter",
  "r2",
  "gemini",
];

export interface SmokeCheck {
  vendor: Vendor;
  tier: Tier;
  /** Stable identifier — `by_vendor_and_check` history hangs off this, so
   *  renaming one loses its history. Format: `namespace.endpoint`. */
  check: string;
  /**
   * Env vars this check needs. If any is absent the runner records `skipped`
   * rather than `fail` — an unconfigured vendor is not a broken vendor. The
   * skip stays visible in the report so "unverified" never reads as "healthy".
   */
  requiredEnv: string[];
  /** Worst-case spend for one run, in USD. Reads are ~0; tier 3 is real money. */
  estCostUsd: number;
  /** Performs the call. Returns the raw payload — no parsing, no normalizing. */
  run: () => Promise<unknown>;
  /**
   * STRICT schema. Must be strict at every level: a `z.object()` nested inside
   * a `z.strictObject()` reopens exactly the blind spot this suite closes.
   * `findNonStrictObjects()` guards this and the registry test asserts it.
   */
  schema: z.ZodType;
  /**
   * The ONLY way to ship a non-strict schema, and it costs you a sentence.
   *
   * Some payloads are catalogues — OpenRouter's model list, Gemini's model
   * list — where the vendor adds fields we don't consume and a strict schema
   * would cry wolf weekly until someone silences the whole check. That's a
   * worse outcome than lax parsing, but it is still a real hole, so it has to
   * be declared here rather than achieved quietly by typing `z.object`.
   *
   * The registry test fails any check whose schema is non-strict without one.
   * Reach for a narrower assertion before reaching for this.
   */
  laxReason?: string;
}

export interface CheckOutcome {
  vendor: Vendor;
  tier: Tier;
  check: string;
  status: "pass" | "fail" | "skipped";
  detail?: string;
  drifts?: string[];
  latencyMs?: number;
  costUsd?: number;
}

export interface RunSummary {
  runId: string;
  outcomes: CheckOutcome[];
  passed: number;
  failed: number;
  skipped: number;
  spentUsd: number;
  /** True when the budget cap stopped checks from running. */
  budgetExhausted: boolean;
}
