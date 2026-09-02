/**
 * A ScrapeCreators client that answers from fixtures instead of the network.
 *
 * Two uses: every integration test (plan §17.1), and zero-credit development
 * (`SCRAPE_FIXTURES=spec`). Fixtures are keyed by endpoint path; the default set
 * is generated from the vendor's OpenAPI examples by `scripts/fixtures-from-spec.mjs`
 * and marked `spec-example`. `npm run fixtures:record` replaces them with live
 * recordings (`recorded`) once credits exist.
 */

import { ScrapeCreatorsClient, ScrapeCreatorsHttpError, type RequestOptions } from "./client";

export type FixtureSource = "spec-example" | "recorded";

export interface FixtureStore {
  /** Returns the fixture body for a path, or undefined when none exists. */
  get(path: string, query?: Record<string, unknown>): unknown | undefined;
  source: FixtureSource;
}

/** In-memory store built from an object map (tests) or the generated index (dev). */
export function fixtureStoreFrom(map: Record<string, unknown>, source: FixtureSource = "spec-example"): FixtureStore {
  return {
    source,
    get(path) {
      return map[path];
    },
  };
}

export class FixtureScrapeCreatorsClient extends ScrapeCreatorsClient {
  public readonly calls: Array<{ path: string; query?: Record<string, unknown> }> = [];

  constructor(private readonly store: FixtureStore) {
    super({ apiKey: "fixture", baseUrl: "https://fixtures.invalid" });
  }

  override async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const query = (options as { query?: Record<string, unknown> }).query;
    this.calls.push({ path, query });
    const body = this.store.get(path, query);
    if (body === undefined) {
      // Same error class the real client throws on a 404, so callers exercise the
      // named-failure path rather than a fixture-specific one.
      throw new ScrapeCreatorsHttpError(404, `https://fixtures.invalid${path}`, `no fixture for ${path}`);
    }
    return structuredClone(body) as T;
  }
}
