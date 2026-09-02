/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent_context from "../agent/context.js";
import type * as agent_converse from "../agent/converse.js";
import type * as agent_critic from "../agent/critic.js";
import type * as agent_registry from "../agent/registry.js";
import type * as agent_soul from "../agent/soul.js";
import type * as config_thresholds from "../config/thresholds.js";
import type * as contracts_dossier from "../contracts/dossier.js";
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
import type * as core_scheduler from "../core/scheduler.js";
import type * as core_telegram from "../core/telegram.js";
import type * as core_telegramFiles from "../core/telegramFiles.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as integrations_gemini_client from "../integrations/gemini/client.js";
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
import type * as integrations_telegram_client from "../integrations/telegram/client.js";
import type * as onboarding_admired from "../onboarding/admired.js";
import type * as onboarding_dev from "../onboarding/dev.js";
import type * as onboarding_firstRead from "../onboarding/firstRead.js";
import type * as onboarding_ingest from "../onboarding/ingest.js";
import type * as onboarding_start from "../onboarding/start.js";
import type * as onboarding_watch from "../onboarding/watch.js";
import type * as reads_cache from "../reads/cache.js";
import type * as reads_key from "../reads/key.js";
import type * as reads_kinds from "../reads/kinds.js";
import type * as reads_read from "../reads/read.js";
import type * as scout_gate from "../scout/gate.js";
import type * as scout_readback from "../scout/readback.js";
import type * as scout_sampler from "../scout/sampler.js";
import type * as scout_scout from "../scout/scout.js";
import type * as scout_sweep from "../scout/sweep.js";
import type * as telegram_webhook from "../telegram/webhook.js";
import type * as ui from "../ui.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agent/context": typeof agent_context;
  "agent/converse": typeof agent_converse;
  "agent/critic": typeof agent_critic;
  "agent/registry": typeof agent_registry;
  "agent/soul": typeof agent_soul;
  "config/thresholds": typeof config_thresholds;
  "contracts/dossier": typeof contracts_dossier;
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
  "core/scheduler": typeof core_scheduler;
  "core/telegram": typeof core_telegram;
  "core/telegramFiles": typeof core_telegramFiles;
  crons: typeof crons;
  http: typeof http;
  "integrations/gemini/client": typeof integrations_gemini_client;
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
  "integrations/telegram/client": typeof integrations_telegram_client;
  "onboarding/admired": typeof onboarding_admired;
  "onboarding/dev": typeof onboarding_dev;
  "onboarding/firstRead": typeof onboarding_firstRead;
  "onboarding/ingest": typeof onboarding_ingest;
  "onboarding/start": typeof onboarding_start;
  "onboarding/watch": typeof onboarding_watch;
  "reads/cache": typeof reads_cache;
  "reads/key": typeof reads_key;
  "reads/kinds": typeof reads_kinds;
  "reads/read": typeof reads_read;
  "scout/gate": typeof scout_gate;
  "scout/readback": typeof scout_readback;
  "scout/sampler": typeof scout_sampler;
  "scout/scout": typeof scout_scout;
  "scout/sweep": typeof scout_sweep;
  "telegram/webhook": typeof telegram_webhook;
  ui: typeof ui;
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
