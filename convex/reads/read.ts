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
import { getDefaultClient, ScrapeCreatorsClient } from "../integrations/scrapeCreators/client";
import { FixtureScrapeCreatorsClient, fixtureStoreFrom } from "../integrations/scrapeCreators/fixtureClient";
import specFixtures from "../integrations/scrapeCreators/fixtures.spec.json";
import recordedFixtures from "../integrations/scrapeCreators/fixtures.recorded.json";
import { fakeRead } from "../eval/dealsWorldData";
import { faultFetch, faultFor, type Fault } from "../eval/faults";

const USD_PER_CREDIT = Number(process.env.SCRAPE_CREATORS_USD_PER_CREDIT ?? "0.00188"); // $47 / 25,000
const WAIT_MS = 400;
const MAX_WAITS = 60; // ~24 s, under the action ceiling and over any single vendor call

/**
 * ⚠️ Cached per mode, not globally. `recorded` used to be labelled `recorded` while still
 * being served the spec examples, so a recording run changed nothing and every read looked
 * healthy against the wrong shapes. The recorded set falls back to spec per path, so a path
 * that failed to record still answers.
 */
let fixtureClients: Partial<Record<"spec" | "recorded", FixtureScrapeCreatorsClient>> = {};
export function clientForEnv(): { client: ScrapeCreatorsClient; fixture?: "spec-example" | "recorded" } {
  const mode = process.env.SCRAPE_FIXTURES;
  if (mode === "spec" || mode === "recorded") {
    const map = mode === "recorded"
      ? { ...(specFixtures as Record<string, unknown>), ...(recordedFixtures as Record<string, unknown>) }
      : (specFixtures as Record<string, unknown>);
    fixtureClients[mode] ??= new FixtureScrapeCreatorsClient(
      fixtureStoreFrom(map, mode === "recorded" ? "recorded" : "spec-example"),
    );
    return { client: fixtureClients[mode]!, fixture: mode === "recorded" ? "recorded" : "spec-example" };
  }
  return { client: getDefaultClient() };
}

/**
 * The outage drill (eval/faults.ts): the real client, retries and typed errors included, against a
 * fetch that fails the way ScrapeCreators does. No waiting between retries: the drill measures what
 * happens after the failure, not the backoff.
 */
export function faultClient(fault: Fault): ScrapeCreatorsClient {
  return new ScrapeCreatorsClient({ apiKey: "fault-injected", fetchImpl: faultFetch(fault), sleep: async () => undefined });
}

/** Test hook: drop the cached fixture clients so a test can switch modes. */
export function resetFixtureClients(): void { fixtureClients = {}; }

/** Test hook: how many vendor calls the fixture client has served (in-flight dedupe test). */
export function fixtureCallCount(): number {
  const mode = process.env.SCRAPE_FIXTURES === "recorded" ? "recorded" : "spec";
  return fixtureClients[mode]?.calls.length ?? 0;
}

export class ReadFailed extends Error {
  constructor(public readonly kind: string, public readonly key: string, cause: unknown) {
    super(`read(${kind}) failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ReadFailed";
  }
}


/**
 * ⚠️ Cache what the readers use, not what the vendor sent.
 *
 * The whole vendor payload was being stored, and a live keyword search is ~2.2 MiB against
 * Convex's 1 MiB document limit, so EVERY lane sweep failed with "Value is too large" and
 * the "shape" signal source had never once worked in production. It passed on fixtures only
 * because the recorded fixtures are trimmed to six posts.
 *
 * Downstream code touches exactly three fields of a post's `raw`: `is_ad`, `music.id/id_str`
 * (the sound), and `author.unique_id`. Everything else is bitrate ladders and cover images.
 */
const CACHE_MAX_BYTES = 900_000; // under Convex's 1 MiB, with room for the wrapper

function slimRaw(raw: unknown): unknown {
  const r = raw as { is_ad?: unknown; music?: { id?: unknown; id_str?: unknown; title?: unknown; author?: unknown }; author?: { unique_id?: unknown } } | null;
  if (!r || typeof r !== "object") return undefined;
  return {
    is_ad: r.is_ad,
    // the sound's name travels with the post, so a post line can say which sound, not just an id
    music: r.music ? { id: r.music.id, id_str: r.music.id_str, title: r.music.title, author: r.music.author } : undefined,
    author: r.author ? { unique_id: r.author.unique_id } : undefined,
  };
}

function slimPost(p: unknown): unknown {
  if (!p || typeof p !== "object") return p;
  const post = p as { raw?: unknown };
  return post.raw === undefined ? p : { ...post, raw: slimRaw(post.raw) };
}

export function slimForCache(value: unknown): unknown {
  let out: unknown = value;
  if (Array.isArray(value)) out = value.map(slimPost);
  else if (value && typeof value === "object") {
    const v = value as { posts?: unknown; raw?: unknown };
    // Drop the top-level raw entirely: only `creditsCharged` reads it, and that happens
    // before we ever get here.
    if (Array.isArray(v.posts)) out = { ...v, posts: v.posts.map(slimPost), raw: undefined };
    else if (v.raw !== undefined) out = { ...v, raw: undefined };
  }
  // Last resort: a payload still over the limit loses its tail rather than the whole read.
  let json = JSON.stringify(out) ?? "";
  if (json.length > CACHE_MAX_BYTES && out && typeof out === "object") {
    const v = out as { posts?: unknown[] };
    if (Array.isArray(v.posts)) {
      while (v.posts.length > 1 && json.length > CACHE_MAX_BYTES) {
        v.posts = v.posts.slice(0, Math.floor(v.posts.length / 2));
        json = JSON.stringify(out) ?? "";
      }
      console.warn(`[read] payload over ${CACHE_MAX_BYTES} bytes; kept ${v.posts.length} posts`);
    }
  }
  return out;
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
    // Outage drill: an injected fault skips the cache (the vendor must be reached for it to fail) and
    // takes the real failure path below. Null in production and for every real creator.
    const fault = await faultFor(ctx, creatorId, "scrapecreators", { purpose: `read:${k}`, ref: `${k}|${key}` });
    // Eval fixtures (the partnership gauntlet, the deals world) never reach ScrapeCreators or the shared
    // cache: a local deployment with EVAL_FAKES=1 answers them from the fake world. Real creators never get here.
    if (!fault && creatorId && process.env.EVAL_FAKES === "1" && process.env.ENVIRONMENT_NAME === "local" && await ctx.runQuery(internal.eval.fakes.isFixture, { creatorId })) {
      return { value: fakeRead(k, normalized), cached: true, key };
    }

    if (!force && !fault) {
      const hit = await ctx.runQuery(internal.reads.cache.getFresh, { kind: k, key, now });
      if (hit.state === "fresh") return { value: hit.value, cached: true, key };
      if (hit.state === "failed") throw new ReadFailed(k, key, `remembered: ${hit.error}`);
    }

    for (let attempt = 0; attempt <= MAX_WAITS; attempt++) {
      const claim = await ctx.runMutation(internal.reads.cache.claim, { kind: k, key, params: normalized, now: Date.now(), force: attempt === 0 ? Boolean(force || fault) : undefined });
      if (claim.claimed) {
        try {
          // Inside the try: a missing key used to throw before it, leaving the claim in flight so
          // every reader of this key waited out the 24 s wait loop and then failed without a name.
          const { client, fixture } = fault ? { client: faultClient(fault), fixture: undefined } : clientForEnv();
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
            value: slimForCache(value),
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
