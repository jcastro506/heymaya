/**
 * `read(kind, params)`: the only path to ScrapeCreators (plan §3.2, §12.1).
 *
 * Normalize → key → cache hit? → claim (in-flight lock) → vendor call → store +
 * costEvents. Concurrent readers of the same key wait on the claim instead of
 * calling the vendor. Fixture mode (`SCRAPE_FIXTURES=spec|recorded`) answers from
 * bundled fixtures so development and tests spend nothing.
 */

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { KINDS, pathFor, type ReadKind } from "./kinds";
import { readKey } from "./key";
import { CREDITS_BY_PATH } from "../integrations/scrapeCreators/platforms/cross";
import { getDefaultClient, type ScrapeCreatorsClient } from "../integrations/scrapeCreators/client";
import { FixtureScrapeCreatorsClient, fixtureStoreFrom } from "../integrations/scrapeCreators/fixtureClient";
import specFixtures from "../integrations/scrapeCreators/fixtures.spec.json";

const USD_PER_CREDIT = Number(process.env.SCRAPE_CREATORS_USD_PER_CREDIT ?? "0.00188"); // $47 / 25,000
const WAIT_MS = 400;
const MAX_WAITS = 60; // ~24 s, under the action ceiling and over any single vendor call

let fixtureClient: FixtureScrapeCreatorsClient | null = null;
export function clientForEnv(): { client: ScrapeCreatorsClient; fixture?: "spec-example" | "recorded" } {
  const mode = process.env.SCRAPE_FIXTURES;
  if (mode === "spec" || mode === "recorded") {
    fixtureClient ??= new FixtureScrapeCreatorsClient(
      fixtureStoreFrom(specFixtures as Record<string, unknown>, mode === "recorded" ? "recorded" : "spec-example"),
    );
    return { client: fixtureClient, fixture: mode === "recorded" ? "recorded" : "spec-example" };
  }
  return { client: getDefaultClient() };
}

/** Test hook: how many vendor calls the fixture client has served (in-flight dedupe test). */
export function fixtureCallCount(): number {
  return fixtureClient?.calls.length ?? 0;
}

export class ReadFailed extends Error {
  constructor(public readonly kind: string, public readonly key: string, cause: unknown) {
    super(`read(${kind}) failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ReadFailed";
  }
}

export const read = internalAction({
  args: {
    kind: v.string(),
    params: v.any(),
    creatorId: v.optional(v.id("creators")),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { kind, params, creatorId, force }): Promise<{ value: unknown; cached: boolean; key: string }> => {
    if (!(kind in KINDS)) throw new Error(`unknown read kind: ${kind}`);
    const k = kind as ReadKind;
    const specEntry = KINDS[k] as (typeof KINDS)[ReadKind];
    const normalized = (specEntry.normalize as unknown as (p: Record<string, unknown>) => Record<string, unknown>)(params ?? {});
    const key = readKey(k, normalized);
    const now = Date.now();

    if (!force) {
      const hit = await ctx.runQuery(internal.reads.cache.getFresh, { kind: k, key, now });
      if (hit.state === "fresh") return { value: hit.value, cached: true, key };
    }

    for (let attempt = 0; attempt <= MAX_WAITS; attempt++) {
      const claim = await ctx.runMutation(internal.reads.cache.claim, { kind: k, key, params: normalized, now: Date.now() });
      if (claim.claimed) {
        const { client, fixture } = clientForEnv();
        try {
          const value = await (specEntry.call as unknown as (p: Record<string, unknown>, deps: { client: ScrapeCreatorsClient }) => Promise<unknown>)(
            normalized,
            { client },
          );
          const path = pathFor(k, normalized);
          const reported = creditsCharged(value);
          const credits = fixture ? 0 : (reported ?? CREDITS_BY_PATH[path] ?? missingCost(path));
          await ctx.runMutation(internal.reads.cache.store, {
            kind: k,
            key,
            value,
            now: Date.now(),
            ttlMs: specEntry.ttlMs,
            credits,
            costUsd: credits * USD_PER_CREDIT,
            costSource: reported !== null ? "vendor_reported" : "endpoint_table",
            fixture,
            creatorId,
            environment: process.env.ENVIRONMENT_NAME ?? "local",
          });
          return { value, cached: false, key };
        } catch (err) {
          await ctx.runMutation(internal.reads.cache.fail, { kind: k, key, error: String(err), now: Date.now() });
          throw new ReadFailed(k, key, err);
        }
      }
      if ("value" in claim && claim.value !== undefined) return { value: claim.value, cached: true, key };
      await new Promise((r) => setTimeout(r, WAIT_MS));
    }
    throw new ReadFailed(k, key, "in-flight wait exceeded");
  },
});

/** ScrapeCreators responses carry `credits_charged`; prefer it over the endpoint table when present. */
function creditsCharged(value: unknown): number | null {
  const candidates = [value, (value as { raw?: unknown } | null)?.raw];
  for (const c of candidates) {
    const n = (c as { credits_charged?: unknown } | null)?.credits_charged;
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return null;
}

function missingCost(path: string): never {
  // A wrapper path without a cost row is a bug, not a free call.
  throw new Error(`no credit cost registered for ${path} (CREDITS_BY_PATH)`);
}
