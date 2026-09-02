/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as integrations_scrapeCreators___tests___fixtures_instagram from "../integrations/scrapeCreators/__tests__/fixtures/instagram.js";
import type * as integrations_scrapeCreators___tests___fixtures_tiktok from "../integrations/scrapeCreators/__tests__/fixtures/tiktok.js";
import type * as integrations_scrapeCreators_client from "../integrations/scrapeCreators/client.js";
import type * as integrations_scrapeCreators_deps from "../integrations/scrapeCreators/deps.js";
import type * as integrations_scrapeCreators_fixtureClient from "../integrations/scrapeCreators/fixtureClient.js";
import type * as integrations_scrapeCreators_normalize from "../integrations/scrapeCreators/normalize.js";
import type * as integrations_scrapeCreators_platforms_cross from "../integrations/scrapeCreators/platforms/cross.js";
import type * as integrations_scrapeCreators_platforms_instagram from "../integrations/scrapeCreators/platforms/instagram.js";
import type * as integrations_scrapeCreators_platforms_tiktok from "../integrations/scrapeCreators/platforms/tiktok.js";
import type * as integrations_scrapeCreators_schemas from "../integrations/scrapeCreators/schemas.js";
import type * as reads_cache from "../reads/cache.js";
import type * as reads_key from "../reads/key.js";
import type * as reads_kinds from "../reads/kinds.js";
import type * as reads_read from "../reads/read.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "integrations/scrapeCreators/__tests__/fixtures/instagram": typeof integrations_scrapeCreators___tests___fixtures_instagram;
  "integrations/scrapeCreators/__tests__/fixtures/tiktok": typeof integrations_scrapeCreators___tests___fixtures_tiktok;
  "integrations/scrapeCreators/client": typeof integrations_scrapeCreators_client;
  "integrations/scrapeCreators/deps": typeof integrations_scrapeCreators_deps;
  "integrations/scrapeCreators/fixtureClient": typeof integrations_scrapeCreators_fixtureClient;
  "integrations/scrapeCreators/normalize": typeof integrations_scrapeCreators_normalize;
  "integrations/scrapeCreators/platforms/cross": typeof integrations_scrapeCreators_platforms_cross;
  "integrations/scrapeCreators/platforms/instagram": typeof integrations_scrapeCreators_platforms_instagram;
  "integrations/scrapeCreators/platforms/tiktok": typeof integrations_scrapeCreators_platforms_tiktok;
  "integrations/scrapeCreators/schemas": typeof integrations_scrapeCreators_schemas;
  "reads/cache": typeof reads_cache;
  "reads/key": typeof reads_key;
  "reads/kinds": typeof reads_kinds;
  "reads/read": typeof reads_read;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
