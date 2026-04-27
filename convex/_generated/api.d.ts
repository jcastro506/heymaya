/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _test_serviceFixtures from "../_test/serviceFixtures.js";
import type * as agents_modelRouter_logCall from "../agents/modelRouter/logCall.js";
import type * as agents_modelRouter_maya from "../agents/modelRouter/maya.js";
import type * as agents_modelRouter_openRouterClient from "../agents/modelRouter/openRouterClient.js";
import type * as agents_modelRouter_taskTags from "../agents/modelRouter/taskTags.js";
import type * as agents_packs_maya_configGeneratorMaya from "../agents/packs/maya/configGeneratorMaya.js";
import type * as agents_packs_maya_serializeWorkspaceBundle from "../agents/packs/maya/serializeWorkspaceBundle.js";
import type * as agents_packs_maya_workspace_assembleWorkspaceBundle from "../agents/packs/maya/workspace/assembleWorkspaceBundle.js";
import type * as agents_packs_maya_workspace_buildCronJobsJson from "../agents/packs/maya/workspace/buildCronJobsJson.js";
import type * as agents_packs_maya_workspace_generateAgentsMd from "../agents/packs/maya/workspace/generateAgentsMd.js";
import type * as agents_packs_maya_workspace_generateBootMd from "../agents/packs/maya/workspace/generateBootMd.js";
import type * as agents_packs_maya_workspace_generateDreamingMd from "../agents/packs/maya/workspace/generateDreamingMd.js";
import type * as agents_packs_maya_workspace_generateHeartbeatMd from "../agents/packs/maya/workspace/generateHeartbeatMd.js";
import type * as agents_packs_maya_workspace_generateMemoryMdSeed from "../agents/packs/maya/workspace/generateMemoryMdSeed.js";
import type * as agents_packs_maya_workspace_generateToolsMd from "../agents/packs/maya/workspace/generateToolsMd.js";
import type * as agents_packs_maya_workspace_generateUserMd from "../agents/packs/maya/workspace/generateUserMd.js";
import type * as agents_packs_maya_workspace_standingOrders from "../agents/packs/maya/workspace/standingOrders.js";
import type * as agents_packs_maya_workspace_types from "../agents/packs/maya/workspace/types.js";
import type * as agents_packs_maya_service_buildJobsJson from "../agents/packs/maya_service/buildJobsJson.js";
import type * as agents_packs_maya_service_generateAgents from "../agents/packs/maya_service/generateAgents.js";
import type * as agents_packs_maya_service_generateBoot from "../agents/packs/maya_service/generateBoot.js";
import type * as agents_packs_maya_service_generateBusinessPicture from "../agents/packs/maya_service/generateBusinessPicture.js";
import type * as agents_packs_maya_service_generateDreaming from "../agents/packs/maya_service/generateDreaming.js";
import type * as agents_packs_maya_service_generateHeartbeat from "../agents/packs/maya_service/generateHeartbeat.js";
import type * as agents_packs_maya_service_generateMemorySeed from "../agents/packs/maya_service/generateMemorySeed.js";
import type * as agents_packs_maya_service_generateSoul from "../agents/packs/maya_service/generateSoul.js";
import type * as agents_packs_maya_service_generateTools from "../agents/packs/maya_service/generateTools.js";
import type * as agents_packs_maya_service_memoryWikiConfig from "../agents/packs/maya_service/memoryWikiConfig.js";
import type * as agents_packs_maya_service_voiceCallConfig from "../agents/packs/maya_service/voiceCallConfig.js";
import type * as agents_packs_maya_service_standingOrders from "../agents/packs/maya_service/standingOrders.js";
import type * as agents_packs_maya_service_types from "../agents/packs/maya_service/types.js";
import type * as agents_packs_maya_service_wikiInitialPages from "../agents/packs/maya_service/wikiInitialPages.js";
import type * as billing_checkout from "../billing/checkout.js";
import type * as billing_portal from "../billing/portal.js";
import type * as billing_priceIds from "../billing/priceIds.js";
import type * as billing_stripeClient from "../billing/stripeClient.js";
import type * as billing_webhook from "../billing/webhook.js";
import type * as businessReadiness from "../businessReadiness.js";
import type * as creators from "../creators.js";
import type * as dealTriage from "../dealTriage.js";
import type * as deals from "../deals.js";
import type * as integrations_aggregators_unified_client from "../integrations/aggregators/unified/client.js";
import type * as integrations_aggregators_unified_types from "../integrations/aggregators/unified/types.js";
import type * as integrations_composio_actions_calendar from "../integrations/composio/actions/calendar.js";
import type * as integrations_composio_actions_gmail from "../integrations/composio/actions/gmail.js";
import type * as integrations_composio_actions_index from "../integrations/composio/actions/index.js";
import type * as integrations_composio_actions_stripe from "../integrations/composio/actions/stripe.js";
import type * as integrations_composio_client from "../integrations/composio/client.js";
import type * as integrations_composio_oauth from "../integrations/composio/oauth.js";
import type * as integrations_composio_universalRunner from "../integrations/composio/universalRunner.js";
import type * as integrations_crm_quickbooks from "../integrations/crm/quickbooks.js";
import type * as integrations_crm_nango from "../integrations/crm/nango.js";
import type * as integrations_crm_jobber from "../integrations/crm/jobber.js";
import type * as integrations_crm_housecallpro from "../integrations/crm/housecallpro.js";
import type * as integrations_crm_nerExtractor from "../integrations/crm/nerExtractor.js";
import type * as integrations_crm_index from "../integrations/crm/index.js";
import type * as jobs from "../jobs.js";
import type * as webhooks_crm from "../webhooks/crm.js";
import type * as integrations_gbp_direct_client from "../integrations/gbp/direct/client.js";
import type * as integrations_gbp_index from "../integrations/gbp/index.js";
import type * as integrations_gbp_zernio from "../integrations/gbp/zernio.js";
import type * as gbp_computeHealthScore from "../gbp/computeHealthScore.js";
import type * as integrations_openclaw_channels from "../integrations/openclaw/channels.js";
import type * as integrations_openclaw_cliClient from "../integrations/openclaw/cliClient.js";
import type * as integrations_photoBridgeWorker_client from "../integrations/photoBridgeWorker/client.js";
import type * as integrations_r2_client from "../integrations/r2/client.js";
import type * as integrations_r2_endpoints from "../integrations/r2/endpoints.js";
import type * as integrations_stripe_checkout from "../integrations/stripe/checkout.js";
import type * as integrations_stripe_customerPortal from "../integrations/stripe/customerPortal.js";
import type * as integrations_stripe_priceIds from "../integrations/stripe/priceIds.js";
import type * as integrations_stripe_voiceMetering from "../integrations/stripe/voiceMetering.js";
import type * as integrations_stripe_webhooks from "../integrations/stripe/webhooks.js";
import type * as integrations_scrapeCreators___tests___fixtures_instagram from "../integrations/scrapeCreators/__tests__/fixtures/instagram.js";
import type * as integrations_scrapeCreators___tests___fixtures_linkedin from "../integrations/scrapeCreators/__tests__/fixtures/linkedin.js";
import type * as integrations_scrapeCreators___tests___fixtures_tiktok from "../integrations/scrapeCreators/__tests__/fixtures/tiktok.js";
import type * as integrations_scrapeCreators___tests___fixtures_x from "../integrations/scrapeCreators/__tests__/fixtures/x.js";
import type * as integrations_scrapeCreators___tests___fixtures_youtube from "../integrations/scrapeCreators/__tests__/fixtures/youtube.js";
import type * as integrations_scrapeCreators_cache from "../integrations/scrapeCreators/cache.js";
import type * as integrations_scrapeCreators_client from "../integrations/scrapeCreators/client.js";
import type * as integrations_scrapeCreators_endpoints from "../integrations/scrapeCreators/endpoints.js";
import type * as integrations_scrapeCreators_runFullScrapePull from "../integrations/scrapeCreators/runFullScrapePull.js";
import type * as integrations_scrapeCreators_verifyHandle from "../integrations/scrapeCreators/verifyHandle.js";
import type * as integrations_twilio_client from "../integrations/twilio/client.js";
import type * as integrations_twilio_configureWebhooks from "../integrations/twilio/configureWebhooks.js";
import type * as integrations_twilio_provisionNumber from "../integrations/twilio/provisionNumber.js";
import type * as integrations_videoSynthWorker_client from "../integrations/videoSynthWorker/client.js";
import type * as integrations_zernio_client from "../integrations/zernio/client.js";
import type * as integrations_zernio_endpoints from "../integrations/zernio/endpoints.js";
import type * as integrations_zernio_oauth from "../integrations/zernio/oauth.js";
import type * as integrations_zernio_types from "../integrations/zernio/types.js";
import type * as integrations_zernio_webhooks from "../integrations/zernio/webhooks.js";
import type * as lib_encryption from "../lib/encryption.js";
import type * as lib_flyClient from "../lib/flyClient.js";
import type * as lib_planFeatures from "../lib/planFeatures.js";
import type * as lib_webhookSecret from "../lib/webhookSecret.js";
import type * as mediaAssets_enqueueCatalog from "../mediaAssets/enqueueCatalog.js";
import type * as mediaAssets_ingest from "../mediaAssets/ingest.js";
import type * as mediaAssets_listAssets from "../mediaAssets/listAssets.js";
import type * as mediaAssets_processCatalogerQueue from "../mediaAssets/processCatalogerQueue.js";
import type * as onboarding_business_deployServiceMaya from "../onboarding/business/deployServiceMaya.js";
import type * as onboarding_business_pipeline from "../onboarding/business/pipeline.js";
import type * as outcomes_attribution from "../outcomes/attribution.js";
import type * as outcomes_gbpInsightsPoller from "../outcomes/gbpInsightsPoller.js";
import type * as outcomes_metaInsightsPoller from "../outcomes/metaInsightsPoller.js";
import type * as outcomes_reviewReplyVerifier from "../outcomes/reviewReplyVerifier.js";
import type * as agents_packs_maya_service_runLearningsExtractor from "../agents/packs/maya_service/runLearningsExtractor.js";
import type * as onboarding_maya_deployMaya from "../onboarding/maya/deployMaya.js";
import type * as onboarding_maya_jobs from "../onboarding/maya/jobs.js";
import type * as onboarding_maya_synthesizeCreatorPicture from "../onboarding/maya/synthesizeCreatorPicture.js";
import type * as onboarding_maya_videoBatching from "../onboarding/maya/videoBatching.js";
import type * as performance from "../performance.js";
import type * as plan from "../plan.js";
import type * as planService from "../planService.js";
import type * as prePostReview from "../prePostReview.js";
import type * as prePostReviewQueries from "../prePostReviewQueries.js";
import type * as profile from "../profile.js";
import type * as serviceTelemetry from "../serviceTelemetry.js";
import type * as queries_business_customers from "../queries/business/customers.js";
import type * as queries_business_growth from "../queries/business/growth.js";
import type * as queries_business_jobs from "../queries/business/jobs.js";
import type * as queries_business_posts from "../queries/business/posts.js";
import type * as queries_business_profile from "../queries/business/profile.js";
import type * as queries_business_reviews from "../queries/business/reviews.js";
import type * as queries_business_today from "../queries/business/today.js";
import type * as today from "../today.js";
import type * as trends from "../trends.js";
import type * as voice_pinChallenge from "../voice/pinChallenge.js";
import type * as voice_sensitiveOps from "../voice/sensitiveOps.js";
import type * as voice_transcriptHttp from "../voice/transcriptHttp.js";
import type * as voice_transcripts from "../voice/transcripts.js";
import type * as webhooks_qbo from "../webhooks/qbo.js";
import type * as wikiProjections from "../wikiProjections.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_test/serviceFixtures": typeof _test_serviceFixtures;
  "agents/modelRouter/logCall": typeof agents_modelRouter_logCall;
  "agents/modelRouter/maya": typeof agents_modelRouter_maya;
  "agents/modelRouter/openRouterClient": typeof agents_modelRouter_openRouterClient;
  "agents/modelRouter/taskTags": typeof agents_modelRouter_taskTags;
  "agents/packs/maya/configGeneratorMaya": typeof agents_packs_maya_configGeneratorMaya;
  "agents/packs/maya/serializeWorkspaceBundle": typeof agents_packs_maya_serializeWorkspaceBundle;
  "agents/packs/maya/workspace/assembleWorkspaceBundle": typeof agents_packs_maya_workspace_assembleWorkspaceBundle;
  "agents/packs/maya/workspace/buildCronJobsJson": typeof agents_packs_maya_workspace_buildCronJobsJson;
  "agents/packs/maya/workspace/generateAgentsMd": typeof agents_packs_maya_workspace_generateAgentsMd;
  "agents/packs/maya/workspace/generateBootMd": typeof agents_packs_maya_workspace_generateBootMd;
  "agents/packs/maya/workspace/generateDreamingMd": typeof agents_packs_maya_workspace_generateDreamingMd;
  "agents/packs/maya/workspace/generateHeartbeatMd": typeof agents_packs_maya_workspace_generateHeartbeatMd;
  "agents/packs/maya/workspace/generateMemoryMdSeed": typeof agents_packs_maya_workspace_generateMemoryMdSeed;
  "agents/packs/maya/workspace/generateToolsMd": typeof agents_packs_maya_workspace_generateToolsMd;
  "agents/packs/maya/workspace/generateUserMd": typeof agents_packs_maya_workspace_generateUserMd;
  "agents/packs/maya/workspace/standingOrders": typeof agents_packs_maya_workspace_standingOrders;
  "agents/packs/maya/workspace/types": typeof agents_packs_maya_workspace_types;
  "agents/packs/maya_service/buildJobsJson": typeof agents_packs_maya_service_buildJobsJson;
  "agents/packs/maya_service/generateAgents": typeof agents_packs_maya_service_generateAgents;
  "agents/packs/maya_service/generateBoot": typeof agents_packs_maya_service_generateBoot;
  "agents/packs/maya_service/generateBusinessPicture": typeof agents_packs_maya_service_generateBusinessPicture;
  "agents/packs/maya_service/generateDreaming": typeof agents_packs_maya_service_generateDreaming;
  "agents/packs/maya_service/generateHeartbeat": typeof agents_packs_maya_service_generateHeartbeat;
  "agents/packs/maya_service/generateMemorySeed": typeof agents_packs_maya_service_generateMemorySeed;
  "agents/packs/maya_service/generateSoul": typeof agents_packs_maya_service_generateSoul;
  "agents/packs/maya_service/generateTools": typeof agents_packs_maya_service_generateTools;
  "agents/packs/maya_service/memoryWikiConfig": typeof agents_packs_maya_service_memoryWikiConfig;
  "agents/packs/maya_service/voiceCallConfig": typeof agents_packs_maya_service_voiceCallConfig;
  "agents/packs/maya_service/standingOrders": typeof agents_packs_maya_service_standingOrders;
  "agents/packs/maya_service/types": typeof agents_packs_maya_service_types;
  "agents/packs/maya_service/wikiInitialPages": typeof agents_packs_maya_service_wikiInitialPages;
  "billing/checkout": typeof billing_checkout;
  "billing/portal": typeof billing_portal;
  "billing/priceIds": typeof billing_priceIds;
  "billing/stripeClient": typeof billing_stripeClient;
  "billing/webhook": typeof billing_webhook;
  businessReadiness: typeof businessReadiness;
  creators: typeof creators;
  dealTriage: typeof dealTriage;
  deals: typeof deals;
  "integrations/aggregators/unified/client": typeof integrations_aggregators_unified_client;
  "integrations/aggregators/unified/types": typeof integrations_aggregators_unified_types;
  "integrations/composio/actions/calendar": typeof integrations_composio_actions_calendar;
  "integrations/composio/actions/gmail": typeof integrations_composio_actions_gmail;
  "integrations/composio/actions/index": typeof integrations_composio_actions_index;
  "integrations/composio/actions/stripe": typeof integrations_composio_actions_stripe;
  "integrations/composio/client": typeof integrations_composio_client;
  "integrations/composio/oauth": typeof integrations_composio_oauth;
  "integrations/composio/universalRunner": typeof integrations_composio_universalRunner;
  "integrations/crm/quickbooks": typeof integrations_crm_quickbooks;
  "integrations/crm/nango": typeof integrations_crm_nango;
  "integrations/crm/jobber": typeof integrations_crm_jobber;
  "integrations/crm/housecallpro": typeof integrations_crm_housecallpro;
  "integrations/crm/nerExtractor": typeof integrations_crm_nerExtractor;
  "integrations/crm/index": typeof integrations_crm_index;
  jobs: typeof jobs;
  "webhooks/crm": typeof webhooks_crm;
  "integrations/gbp/direct/client": typeof integrations_gbp_direct_client;
  "integrations/gbp/index": typeof integrations_gbp_index;
  "integrations/gbp/zernio": typeof integrations_gbp_zernio;
  "gbp/computeHealthScore": typeof gbp_computeHealthScore;
  "integrations/openclaw/channels": typeof integrations_openclaw_channels;
  "integrations/openclaw/cliClient": typeof integrations_openclaw_cliClient;
  "integrations/photoBridgeWorker/client": typeof integrations_photoBridgeWorker_client;
  "integrations/r2/client": typeof integrations_r2_client;
  "integrations/r2/endpoints": typeof integrations_r2_endpoints;
  "integrations/stripe/checkout": typeof integrations_stripe_checkout;
  "integrations/stripe/customerPortal": typeof integrations_stripe_customerPortal;
  "integrations/stripe/priceIds": typeof integrations_stripe_priceIds;
  "integrations/stripe/voiceMetering": typeof integrations_stripe_voiceMetering;
  "integrations/stripe/webhooks": typeof integrations_stripe_webhooks;
  "integrations/scrapeCreators/__tests__/fixtures/instagram": typeof integrations_scrapeCreators___tests___fixtures_instagram;
  "integrations/scrapeCreators/__tests__/fixtures/linkedin": typeof integrations_scrapeCreators___tests___fixtures_linkedin;
  "integrations/scrapeCreators/__tests__/fixtures/tiktok": typeof integrations_scrapeCreators___tests___fixtures_tiktok;
  "integrations/scrapeCreators/__tests__/fixtures/x": typeof integrations_scrapeCreators___tests___fixtures_x;
  "integrations/scrapeCreators/__tests__/fixtures/youtube": typeof integrations_scrapeCreators___tests___fixtures_youtube;
  "integrations/scrapeCreators/cache": typeof integrations_scrapeCreators_cache;
  "integrations/scrapeCreators/client": typeof integrations_scrapeCreators_client;
  "integrations/scrapeCreators/endpoints": typeof integrations_scrapeCreators_endpoints;
  "integrations/scrapeCreators/runFullScrapePull": typeof integrations_scrapeCreators_runFullScrapePull;
  "integrations/scrapeCreators/verifyHandle": typeof integrations_scrapeCreators_verifyHandle;
  "integrations/twilio/client": typeof integrations_twilio_client;
  "integrations/twilio/configureWebhooks": typeof integrations_twilio_configureWebhooks;
  "integrations/twilio/provisionNumber": typeof integrations_twilio_provisionNumber;
  "integrations/videoSynthWorker/client": typeof integrations_videoSynthWorker_client;
  "integrations/zernio/client": typeof integrations_zernio_client;
  "integrations/zernio/endpoints": typeof integrations_zernio_endpoints;
  "integrations/zernio/oauth": typeof integrations_zernio_oauth;
  "integrations/zernio/types": typeof integrations_zernio_types;
  "integrations/zernio/webhooks": typeof integrations_zernio_webhooks;
  "lib/encryption": typeof lib_encryption;
  "lib/flyClient": typeof lib_flyClient;
  "lib/planFeatures": typeof lib_planFeatures;
  "lib/webhookSecret": typeof lib_webhookSecret;
  "mediaAssets/enqueueCatalog": typeof mediaAssets_enqueueCatalog;
  "mediaAssets/ingest": typeof mediaAssets_ingest;
  "mediaAssets/listAssets": typeof mediaAssets_listAssets;
  "mediaAssets/processCatalogerQueue": typeof mediaAssets_processCatalogerQueue;
  "onboarding/business/deployServiceMaya": typeof onboarding_business_deployServiceMaya;
  "onboarding/business/pipeline": typeof onboarding_business_pipeline;
  "outcomes/attribution": typeof outcomes_attribution;
  "outcomes/gbpInsightsPoller": typeof outcomes_gbpInsightsPoller;
  "outcomes/metaInsightsPoller": typeof outcomes_metaInsightsPoller;
  "outcomes/reviewReplyVerifier": typeof outcomes_reviewReplyVerifier;
  "agents/packs/maya_service/runLearningsExtractor": typeof agents_packs_maya_service_runLearningsExtractor;
  "onboarding/maya/deployMaya": typeof onboarding_maya_deployMaya;
  "onboarding/maya/jobs": typeof onboarding_maya_jobs;
  "onboarding/maya/synthesizeCreatorPicture": typeof onboarding_maya_synthesizeCreatorPicture;
  "onboarding/maya/videoBatching": typeof onboarding_maya_videoBatching;
  performance: typeof performance;
  plan: typeof plan;
  planService: typeof planService;
  prePostReview: typeof prePostReview;
  prePostReviewQueries: typeof prePostReviewQueries;
  profile: typeof profile;
  serviceTelemetry: typeof serviceTelemetry;
  "queries/business/customers": typeof queries_business_customers;
  "queries/business/growth": typeof queries_business_growth;
  "queries/business/jobs": typeof queries_business_jobs;
  "queries/business/posts": typeof queries_business_posts;
  "queries/business/profile": typeof queries_business_profile;
  "queries/business/reviews": typeof queries_business_reviews;
  "queries/business/today": typeof queries_business_today;
  today: typeof today;
  trends: typeof trends;
  "voice/pinChallenge": typeof voice_pinChallenge;
  "voice/sensitiveOps": typeof voice_sensitiveOps;
  "voice/transcriptHttp": typeof voice_transcriptHttp;
  "voice/transcripts": typeof voice_transcripts;
  "webhooks/qbo": typeof webhooks_qbo;
  wikiProjections: typeof wikiProjections;
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
