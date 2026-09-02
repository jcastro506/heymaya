/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as core_breaker from "../core/breaker.js";
import type * as core_cadence from "../core/cadence.js";
import type * as core_costs from "../core/costs.js";
import type * as core_delivery from "../core/delivery.js";
import type * as core_directives from "../core/directives.js";
import type * as core_embeddings from "../core/embeddings.js";
import type * as core_jobs from "../core/jobs.js";
import type * as core_llm from "../core/llm.js";
import type * as core_messages from "../core/messages.js";
import type * as core_pairing from "../core/pairing.js";
import type * as core_plainLanguage from "../core/plainLanguage.js";
import type * as core_quality from "../core/quality.js";
import type * as integrations_openrouter_client from "../integrations/openrouter/client.js";
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
  "core/breaker": typeof core_breaker;
  "core/cadence": typeof core_cadence;
  "core/costs": typeof core_costs;
  "core/delivery": typeof core_delivery;
  "core/directives": typeof core_directives;
  "core/embeddings": typeof core_embeddings;
  "core/jobs": typeof core_jobs;
  "core/llm": typeof core_llm;
  "core/messages": typeof core_messages;
  "core/pairing": typeof core_pairing;
  "core/plainLanguage": typeof core_plainLanguage;
  "core/quality": typeof core_quality;
  "integrations/openrouter/client": typeof integrations_openrouter_client;
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
