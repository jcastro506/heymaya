/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account_deletion from "../account/deletion.js";
import type * as agent_classify from "../agent/classify.js";
import type * as agent_commands from "../agent/commands.js";
import type * as agent_consolidate from "../agent/consolidate.js";
import type * as agent_context from "../agent/context.js";
import type * as agent_converse from "../agent/converse.js";
import type * as agent_critic from "../agent/critic.js";
import type * as agent_history from "../agent/history.js";
import type * as agent_inbound from "../agent/inbound.js";
import type * as agent_investigate from "../agent/investigate.js";
import type * as agent_manage from "../agent/manage.js";
import type * as agent_memory from "../agent/memory.js";
import type * as agent_moment from "../agent/moment.js";
import type * as agent_opinion from "../agent/opinion.js";
import type * as agent_playbooks from "../agent/playbooks.js";
import type * as agent_profile from "../agent/profile.js";
import type * as agent_registry from "../agent/registry.js";
import type * as agent_remember from "../agent/remember.js";
import type * as agent_soul from "../agent/soul.js";
import type * as agent_tools from "../agent/tools.js";
import type * as agent_toolsData from "../agent/toolsData.js";
import type * as agent_voice from "../agent/voice.js";
import type * as billing_checkout from "../billing/checkout.js";
import type * as billing_plan from "../billing/plan.js";
import type * as billing_stripe from "../billing/stripe.js";
import type * as billing_webhook from "../billing/webhook.js";
import type * as calendar_blocks from "../calendar/blocks.js";
import type * as calendar_ics from "../calendar/ics.js";
import type * as calendar_oauth from "../calendar/oauth.js";
import type * as calendar_planning from "../calendar/planning.js";
import type * as calendar_postTime from "../calendar/postTime.js";
import type * as calendar_reminders from "../calendar/reminders.js";
import type * as calendar_sync from "../calendar/sync.js";
import type * as calendar_time from "../calendar/time.js";
import type * as calendar_tools from "../calendar/tools.js";
import type * as calendar_weekPlan from "../calendar/weekPlan.js";
import type * as config_thresholds from "../config/thresholds.js";
import type * as connections_zernio from "../connections/zernio.js";
import type * as contracts_dossier from "../contracts/dossier.js";
import type * as core_alerts from "../core/alerts.js";
import type * as core_breaker from "../core/breaker.js";
import type * as core_budgets from "../core/budgets.js";
import type * as core_cadence from "../core/cadence.js";
import type * as core_costs from "../core/costs.js";
import type * as core_delivery from "../core/delivery.js";
import type * as core_directives from "../core/directives.js";
import type * as core_embeddings from "../core/embeddings.js";
import type * as core_fakeModel from "../core/fakeModel.js";
import type * as core_identity from "../core/identity.js";
import type * as core_jobs from "../core/jobs.js";
import type * as core_llm from "../core/llm.js";
import type * as core_messages from "../core/messages.js";
import type * as core_pairing from "../core/pairing.js";
import type * as core_plainLanguage from "../core/plainLanguage.js";
import type * as core_quality from "../core/quality.js";
import type * as core_reconcile from "../core/reconcile.js";
import type * as core_retention from "../core/retention.js";
import type * as core_scheduler from "../core/scheduler.js";
import type * as core_smoke from "../core/smoke.js";
import type * as core_status from "../core/status.js";
import type * as core_telegram from "../core/telegram.js";
import type * as core_telegramFiles from "../core/telegramFiles.js";
import type * as crons from "../crons.js";
import type * as eval_checks from "../eval/checks.js";
import type * as eval_gate from "../eval/gate.js";
import type * as eval_judge from "../eval/judge.js";
import type * as eval_run from "../eval/run.js";
import type * as http from "../http.js";
import type * as integrations_gemini_client from "../integrations/gemini/client.js";
import type * as integrations_google_calendar from "../integrations/google/calendar.js";
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
import type * as integrations_zernio_index from "../integrations/zernio/index.js";
import type * as lib_encryption from "../lib/encryption.js";
import type * as onboarding_admired from "../onboarding/admired.js";
import type * as onboarding_dev from "../onboarding/dev.js";
import type * as onboarding_firstRead from "../onboarding/firstRead.js";
import type * as onboarding_ingest from "../onboarding/ingest.js";
import type * as onboarding_lane from "../onboarding/lane.js";
import type * as onboarding_start from "../onboarding/start.js";
import type * as onboarding_watch from "../onboarding/watch.js";
import type * as ops from "../ops.js";
import type * as reads_cache from "../reads/cache.js";
import type * as reads_key from "../reads/key.js";
import type * as reads_kinds from "../reads/kinds.js";
import type * as reads_read from "../reads/read.js";
import type * as review_predictions from "../review/predictions.js";
import type * as review_pulse from "../review/pulse.js";
import type * as review_rung from "../review/rung.js";
import type * as review_weekly from "../review/weekly.js";
import type * as scout_benchmarks from "../scout/benchmarks.js";
import type * as scout_firstWeek from "../scout/firstWeek.js";
import type * as scout_formats from "../scout/formats.js";
import type * as scout_gate from "../scout/gate.js";
import type * as scout_matchPost from "../scout/matchPost.js";
import type * as scout_readback from "../scout/readback.js";
import type * as scout_roster from "../scout/roster.js";
import type * as scout_sampler from "../scout/sampler.js";
import type * as scout_scout from "../scout/scout.js";
import type * as scout_sounds from "../scout/sounds.js";
import type * as scout_sweep from "../scout/sweep.js";
import type * as taste_affinities from "../taste/affinities.js";
import type * as taste_events from "../taste/events.js";
import type * as taste_outcomes from "../taste/outcomes.js";
import type * as taste_profile from "../taste/profile.js";
import type * as telegram_webhook from "../telegram/webhook.js";
import type * as ui from "../ui.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "account/deletion": typeof account_deletion;
  "agent/classify": typeof agent_classify;
  "agent/commands": typeof agent_commands;
  "agent/consolidate": typeof agent_consolidate;
  "agent/context": typeof agent_context;
  "agent/converse": typeof agent_converse;
  "agent/critic": typeof agent_critic;
  "agent/history": typeof agent_history;
  "agent/inbound": typeof agent_inbound;
  "agent/investigate": typeof agent_investigate;
  "agent/manage": typeof agent_manage;
  "agent/memory": typeof agent_memory;
  "agent/moment": typeof agent_moment;
  "agent/opinion": typeof agent_opinion;
  "agent/playbooks": typeof agent_playbooks;
  "agent/profile": typeof agent_profile;
  "agent/registry": typeof agent_registry;
  "agent/remember": typeof agent_remember;
  "agent/soul": typeof agent_soul;
  "agent/tools": typeof agent_tools;
  "agent/toolsData": typeof agent_toolsData;
  "agent/voice": typeof agent_voice;
  "billing/checkout": typeof billing_checkout;
  "billing/plan": typeof billing_plan;
  "billing/stripe": typeof billing_stripe;
  "billing/webhook": typeof billing_webhook;
  "calendar/blocks": typeof calendar_blocks;
  "calendar/ics": typeof calendar_ics;
  "calendar/oauth": typeof calendar_oauth;
  "calendar/planning": typeof calendar_planning;
  "calendar/postTime": typeof calendar_postTime;
  "calendar/reminders": typeof calendar_reminders;
  "calendar/sync": typeof calendar_sync;
  "calendar/time": typeof calendar_time;
  "calendar/tools": typeof calendar_tools;
  "calendar/weekPlan": typeof calendar_weekPlan;
  "config/thresholds": typeof config_thresholds;
  "connections/zernio": typeof connections_zernio;
  "contracts/dossier": typeof contracts_dossier;
  "core/alerts": typeof core_alerts;
  "core/breaker": typeof core_breaker;
  "core/budgets": typeof core_budgets;
  "core/cadence": typeof core_cadence;
  "core/costs": typeof core_costs;
  "core/delivery": typeof core_delivery;
  "core/directives": typeof core_directives;
  "core/embeddings": typeof core_embeddings;
  "core/fakeModel": typeof core_fakeModel;
  "core/identity": typeof core_identity;
  "core/jobs": typeof core_jobs;
  "core/llm": typeof core_llm;
  "core/messages": typeof core_messages;
  "core/pairing": typeof core_pairing;
  "core/plainLanguage": typeof core_plainLanguage;
  "core/quality": typeof core_quality;
  "core/reconcile": typeof core_reconcile;
  "core/retention": typeof core_retention;
  "core/scheduler": typeof core_scheduler;
  "core/smoke": typeof core_smoke;
  "core/status": typeof core_status;
  "core/telegram": typeof core_telegram;
  "core/telegramFiles": typeof core_telegramFiles;
  crons: typeof crons;
  "eval/checks": typeof eval_checks;
  "eval/gate": typeof eval_gate;
  "eval/judge": typeof eval_judge;
  "eval/run": typeof eval_run;
  http: typeof http;
  "integrations/gemini/client": typeof integrations_gemini_client;
  "integrations/google/calendar": typeof integrations_google_calendar;
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
  "integrations/zernio/index": typeof integrations_zernio_index;
  "lib/encryption": typeof lib_encryption;
  "onboarding/admired": typeof onboarding_admired;
  "onboarding/dev": typeof onboarding_dev;
  "onboarding/firstRead": typeof onboarding_firstRead;
  "onboarding/ingest": typeof onboarding_ingest;
  "onboarding/lane": typeof onboarding_lane;
  "onboarding/start": typeof onboarding_start;
  "onboarding/watch": typeof onboarding_watch;
  ops: typeof ops;
  "reads/cache": typeof reads_cache;
  "reads/key": typeof reads_key;
  "reads/kinds": typeof reads_kinds;
  "reads/read": typeof reads_read;
  "review/predictions": typeof review_predictions;
  "review/pulse": typeof review_pulse;
  "review/rung": typeof review_rung;
  "review/weekly": typeof review_weekly;
  "scout/benchmarks": typeof scout_benchmarks;
  "scout/firstWeek": typeof scout_firstWeek;
  "scout/formats": typeof scout_formats;
  "scout/gate": typeof scout_gate;
  "scout/matchPost": typeof scout_matchPost;
  "scout/readback": typeof scout_readback;
  "scout/roster": typeof scout_roster;
  "scout/sampler": typeof scout_sampler;
  "scout/scout": typeof scout_scout;
  "scout/sounds": typeof scout_sounds;
  "scout/sweep": typeof scout_sweep;
  "taste/affinities": typeof taste_affinities;
  "taste/events": typeof taste_events;
  "taste/outcomes": typeof taste_outcomes;
  "taste/profile": typeof taste_profile;
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
