import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { FlyClient, FlyError, type FlyMachineConfig } from "../../lib/flyClient";
import { capturePosthogEvent } from "../../lib/posthog";
import { buildMayaGtmWorkspace } from "../../agents/packs/maya_gtm/generators";
import {
  BUNDLED_GTM_PLUGIN_TGZ_BASE64,
  BUNDLED_GTM_PLUGIN_TGZ_NAME,
} from "../../agents/packs/maya_gtm/bundledGtmPlugin";
import { mintHookToken } from "../../gtmMaya/openclaw/hookClient";
import {
  buildDeployTimeHelloText,
  sendDirectTelegramMessage,
} from "../../integrations/telegram/sendDirectMessage";

/**
 * Narrow a persisted gtmChannelScores.channel down to the live picker channel
 * set the workspace generator accepts. Ideal-product pillar 2 (EQUAL
 * SIX-CHANNEL RESEARCH) re-promotes youtube to a first-class Brief-only
 * channel, so a youtube primary/secondary now survives instead of resolving
 * to undefined. product_hunt stays excluded (never scored) and resolves to
 * undefined ("pending research").
 */
function toPickerChannel(
  channel: Doc<"gtmChannelScores">["channel"] | undefined
): "reddit" | "x" | "hn" | "linkedin" | "tiktok" | "youtube" | undefined {
  switch (channel) {
    case "reddit":
    case "x":
    case "hn":
    case "linkedin":
    case "tiktok":
    case "youtube":
      return channel;
    default:
      return undefined;
  }
}

/**
 * Ideal-product WARMUP pillar — seed an initial channelWarmthJson from the
 * founder-voice ScrapeCreators pull when one ran, so the per-channel warmth
 * arc starts GROUNDED instead of "unknown". Only consulted as a deploy-time
 * fallback: if the agent already persisted channelWarmthJson (via
 * set_channel_warmth), that authoritative map wins and this helper is skipped.
 *
 * The voice pull persists per-platform signal on gtmAgents.voiceProfileJson
 * (sources[] + perPlatform{}). For each platform we have a source for, derive
 * a starting warmth state from the cheap thresholds the pull captured
 * (sampleCount as a proxy for posting history, plus follower/age hints when
 * present): an established account (real history / follower base / aged) starts
 * "warm"; a thin or brand-new account starts "new_needs_warmup". Channels with
 * no voice source are left absent (the cron treats absent as cold/unknown).
 *
 * tiktokWarmupState is mirrored into channelWarmthJson.tiktok as the
 * back-compat alias so the legacy TikTok field and the generalized map agree.
 */
function seedChannelWarmthFromVoice(input: {
  voiceProfileJson?: string;
  existingChannelWarmthJson?: string;
  tiktokWarmupState?: Doc<"gtmApps">["tiktokWarmupState"];
  tiktokAccountAgeDays?: number;
}): string | undefined {
  // Authoritative map already exists — never overwrite the runtime's arc.
  if (input.existingChannelWarmthJson) {
    return input.existingChannelWarmthJson;
  }
  if (!input.voiceProfileJson) {
    return undefined;
  }

  type VoiceSource = {
    platform?: string;
    url?: string;
    sampleCount?: number;
    followerCount?: number;
    accountAgeDays?: number;
    kind?: string;
  };
  let parsed: {
    sources?: VoiceSource[];
    perPlatform?: Record<string, VoiceSource>;
  };
  try {
    parsed = JSON.parse(input.voiceProfileJson) as typeof parsed;
  } catch {
    // Malformed voice profile — fail open to "unknown" (return nothing).
    return undefined;
  }

  const now = Date.now();
  const warmth: Record<string, unknown> = {};

  const deriveState = (s: VoiceSource): "warm" | "new_needs_warmup" => {
    // Grounded thresholds: a channel with real posting history OR a follower
    // base OR an aged account is treated as already warm (skip warmup); a thin
    // or brand-new account needs the warmup arc first.
    const samples = s.sampleCount ?? 0;
    const followers = s.followerCount ?? 0;
    const ageDays = s.accountAgeDays ?? 0;
    const established = samples >= 10 || followers >= 100 || ageDays >= 30;
    return established ? "warm" : "new_needs_warmup";
  };

  const mergeSource = (platform: string, s: VoiceSource): void => {
    const key = platform.toLowerCase().trim();
    if (!key || warmth[key]) return;
    warmth[key] = {
      state: deriveState(s),
      accountAgeDays: s.accountAgeDays,
      baseline: {
        followers: s.followerCount,
        postCount: s.sampleCount,
      },
      lastUpdatedMs: now,
      seededFrom: "voice_pull",
    };
  };

  for (const s of parsed.sources ?? []) {
    if (s?.platform) mergeSource(s.platform, s);
  }
  for (const [platform, s] of Object.entries(parsed.perPlatform ?? {})) {
    if (s) mergeSource(platform, s);
  }

  // Back-compat alias: mirror tiktokWarmupState into channelWarmthJson.tiktok
  // so the legacy field and the generalized map never disagree. A TikTok voice
  // source (above) is overridden by the explicit warmup state when present.
  if (input.tiktokWarmupState) {
    const tiktokState =
      input.tiktokWarmupState === "ready" ? "warm" : input.tiktokWarmupState;
    warmth.tiktok = {
      ...(typeof warmth.tiktok === "object" && warmth.tiktok
        ? (warmth.tiktok as Record<string, unknown>)
        : {}),
      state: tiktokState,
      accountAgeDays: input.tiktokAccountAgeDays,
      lastUpdatedMs: now,
      seededFrom: "tiktok_warmup_state",
    };
  }

  if (Object.keys(warmth).length === 0) {
    return undefined;
  }
  return JSON.stringify(warmth);
}

export type DeployMayaGtmStage =
  | "load-agent"
  | "generate-workspace"
  | "upload-bundle"
  | "create-app"
  | "allocate-ips"
  | "set-secrets"
  | "create-machine"
  | "wait-for-state"
  | "set-telegram-webhook"
  | "patch-agent"
  | "complete";

export type DeployMayaGtmResult =
  | {
      ok: true;
      stage: "complete";
      flyAppId: string;
      machineId: string;
      durationMs: number;
    }
  | {
      ok: false;
      stage: DeployMayaGtmStage;
      message: string;
      retryable: boolean;
      durationMs: number;
    };

/**
 * OpenClaw runtime image.
 *
 * Sprint 13 (Part II of CLAWLAUNCH_GTM_MVP_EXECUTION_SPRINT.md) targets
 * `v2026.5.20` for the heartbeat-pollution fix, cron legacy-store fix, and
 * subagent allowlist tightening. The upgrade target is documented below as
 * `OPENCLAW_IMAGE_TARGET` so smoke scripts can verify the canonical value
 * without grepping. The default stays pinned to `v2026.4.23` until the
 * operator has pulled v2026.5.20 into the private registry AND run
 * `openclaw doctor` + `openclaw security audit --deep` on a throwaway Fly
 * app. To flip, set `MAYA_GTM_OPENCLAW_IMAGE=registry.fly.io/heymaya-openclaw:v2026.5.20`
 * on the Convex deployment. Roll back by clearing the env var.
 */
export const OPENCLAW_IMAGE_TARGET = "registry.fly.io/heymaya-openclaw:v2026.5.26";
// Sprint 2.18 — upgraded npm package 2026.4.23 → 2026.5.26 for the
// HEARTBEAT.md prose-drop fix (5.12), stream-establishment idle-timer
// fix (5.12, fixes the X subagent jam), multi-agent heartbeat
// Promise.all fan-out (5.12), Telegram ENETDOWN transient handling
// (5.26), dedicated agent:<id>:boot session (no main-session
// pollution), and subagent context default trim. The image is fully
// VANILLA — no patch-claw-messenger-plugin patches (file kept in
// source for reference; not copied into image). See Dockerfile.
export const OPENCLAW_IMAGE_PINNED =
  "registry.fly.io/heymaya-openclaw@sha256:49fa411e417ffe260789a9ea8d62a0122b54ee904995fca35e2a82a73c4bc7a2";

const OPENCLAW_IMAGE =
  process.env.MAYA_GTM_OPENCLAW_IMAGE ??
  process.env.MAYA_OPENCLAW_IMAGE ??
  OPENCLAW_IMAGE_PINNED;

export function resolveOpenClawImage(
  env: Partial<Record<string, string | undefined>> = process.env
): string {
  return (
    env.MAYA_GTM_OPENCLAW_IMAGE ??
    env.MAYA_OPENCLAW_IMAGE ??
    OPENCLAW_IMAGE_PINNED
  );
}

/**
 * Sprint 14 — resolve the Convex .convex.site URL OpenClaw posts to when a
 * cron's announce delivery fails. Pulls from MAYA_GTM_FAILURE_DESTINATION_URL
 * if explicitly set; otherwise derives from CONVEX_SITE_URL +
 * /lc_gtm/delivery_failure. Returns undefined if neither is set (in which
 * case OpenClaw silently drops failures, which is bad but not blocking).
 */
export function resolveDeliveryFailureUrl(
  env: Partial<Record<string, string | undefined>> = process.env
): string | undefined {
  if (env.MAYA_GTM_FAILURE_DESTINATION_URL) {
    return env.MAYA_GTM_FAILURE_DESTINATION_URL;
  }
  const siteUrl = env.CONVEX_SITE_URL ?? env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!siteUrl) return undefined;
  return `${siteUrl.replace(/\/$/, "")}/lc_gtm/delivery_failure`;
}

/**
 * Sprint 16 — base URL Maya uses when POSTing /lc_gtm/{research_callback,
 * approval_decision, calendar_proposal}. Pulls from CONVEX_SITE_URL or
 * the explicit override env. Always returns a trailing-slash-stripped URL
 * so workspace generator can concatenate `/lc_gtm/<route>` cleanly.
 */
export function resolveConvexHookCallbackBaseUrl(
  env: Partial<Record<string, string | undefined>> = process.env
): string | undefined {
  if (env.MAYA_GTM_CONVEX_CALLBACK_BASE_URL) {
    return env.MAYA_GTM_CONVEX_CALLBACK_BASE_URL.replace(/\/$/, "");
  }
  const siteUrl = env.CONVEX_SITE_URL ?? env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!siteUrl) return undefined;
  return siteUrl.replace(/\/$/, "");
}

const MODEL_ROUTING = {
  // Sprint 2.18 — operator-specified model stack. The architecture is
  // "intelligent boss + capable workers in a questioning loop":
  //
  //  Main Maya is the chief. She has vast judgment. Workers research
  //  for minutes if they need; they report findings to Maya. Maya
  //  questions: "why did you call this a direct competitor? show me
  //  the quotes. that's thin — go get more from r/X specifically."
  //  Workers go back. Loop until Maya is satisfied the research
  //  reflects reality. Only then does she write the synthesis to
  //  the operator. Maya never accepts blindly.
  //
  // Main Maya = google/gemini-3.5-flash (the new 3.5 just shipped on
  //   OpenRouter — strong reasoning, long context, fast).
  // Workers = google/gemini-3.5-flash too. Operator: "her subagents
  //   could also be Gemini 3.5 with medium thinking level." Same
  //   capability ceiling, thinking budget set per spawn payload.
  //
  // Env-var overrides remain so we can swap without code redeploys.
  // Sprint 2.18 #12 — Main Maya moved from gemini-3.5-flash to
  // claude-sonnet-4.6. Verified live failure mode on
  // clawlaunch-ws71zfg6c5p6w6k4sn: gemini-3.5-flash returned a
  // successful `stopReason: "stop"` with `content: []` and 0 output
  // tokens after a 27K-token context build-up — OpenClaw surfaced
  // that to Telegram as "Agent couldn't generate a response." This
  // is a Gemini-specific failure mode on long-context multi-step
  // reasoning. Sonnet 4.6 doesn't share it. Workers stay on gemini
  // 3.5 (they don't accumulate long context).
  // Sprint 2.18 #50 — RE-RESTORED Gemma 4 26B A4B with reasoning
  // hidden. Operator after #49 revert: "stick to Gemma 4 it's ok.
  // Can you research if we can not show that though."
  //
  // Found the fix in OpenClaw docs (concepts/messages.md +
  // gateway/config-agents.md):
  //   agents.list[].reasoningDefault: "off"
  // controls reasoning visibility per agent. Model still reasons
  // internally (better orchestration) but reasoning tokens DO NOT
  // appear in operator-facing output stream.
  // Applied on the "main" agent below (see agents.list).
  //
  // Plus OpenRouter passthrough `reasoning: { exclude: true }` is
  // added below via agents.defaults.models params for the model
  // route — provider-side cost saver (don't pay for hidden tokens).
  //
  // 2026-05-29 — Main brain switched OFF Gemma 4 → Kimi K2 0905.
  // Gemma 4 26B (3.8B-active MoE) was too weak for operator-facing
  // voice + agentic OpenClaw driving (the generic hello + cryptic
  // synthesis we saw live = Gemma 4). Kimi K2 0905 = 1T-param MoE
  // (32B active), tuned for agentic tool-use (Tau2/AceBench/SWE-bench),
  // 262K context — handles the long OpenClaw system prompt + workspace
  // + research build-up that broke gemini-3.5-flash at 27K tokens.
  // $0.60 in / $2.50 out — trivial vs the $99 tier; brain quality is
  // the anti-slop moat, so we don't cheap out here. Workers stay on
  // cheap Gemini 3 Flash. Env override preserved for fast swaps.
  //
  // 2026-06-05 — model PROVIDER routing saga (K2-0905 has only 3 OpenRouter
  // providers: Novita, AtlasCloud, Groq):
  //   - Default PRICE routing hit slow AtlasCloud (18.4s on a trivial call) →
  //     blew past OpenClaw's 120s idle timeout → an all-night stall.
  //   - ":nitro" (THROUGHPUT routing) fixed latency by pinning Groq (0.18s) BUT
  //     Groq's strict tool-call validator REJECTS our complex/parallel tool
  //     calls ("Upstream error from Groq: tool call validation") → it silently
  //     killed agent turns mid-reply. Measured: Groq 0.18s (breaks tools),
  //     Novita 1.4s (reliable), AtlasCloud 0.85s now / 18s under load.
  // We can't pin Novita via the model config — OpenClaw only passes the model
  // SLUG, and rejects extra model params (provider routing). So: DROP :nitro →
  // price routing to the cheap providers (Novita/AtlasCloud, both tool-reliable)
  // and AVOID Groq. The bulletproof version is an OpenRouter dashboard action:
  // Provider Preferences → prefer/only "Novita" (or ignore Groq + AtlasCloud) —
  // then routing is fast AND tool-safe regardless of slug. Env-overridable.
  mainMaya: process.env.MAYA_GTM_MODEL ?? "moonshotai/kimi-k2-0905",
  // Sprint 2.18 #42 — workers DOWNGRADED from gemini-3.5-flash to
  // gemini-3-flash-preview. Per OpenRouter pricing (verified 2026-05-28):
  //   gemini-3.5-flash:  $1.50 in / $9 out per M
  //   gemini-3-flash-preview: $0.50 in / $3 out per M  ← 3x cheaper
  // Operator: "we need them to be just Gemini 3 flash to stay low."
  // The Sprint 2.16a comment cited instability with 3-flash-preview
  // (stream stalls, validation bounce loops) — that was the OLD
  // preview snapshot months ago. Re-trying it now since OpenRouter
  // pricing makes the cost difference meaningful at our call volume.
  // If instability returns, fall back via env override.
  subagent:
    process.env.MAYA_GTM_SUBAGENT_MODEL ?? "google/gemini-3-flash-preview",
  // hard_research_beta is no longer a configured agent (Sprint 2.18 #3
  // removed it from agents.list). Routing entry retained for
  // narrative + future re-enablement; not actually used.
  hardResearchBeta:
    process.env.MAYA_GTM_HARD_RESEARCH_MODEL ??
    "google/gemini-3-flash-preview",
  futureDefaultResearch:
    process.env.MAYA_GTM_RESEARCH_MODEL ?? "google/gemini-3-flash-preview",
  extractionWorker:
    process.env.MAYA_GTM_EXTRACTION_MODEL ?? "google/gemini-3.1-flash-lite",
};

// Sprint 2.18 #51 — bumped from shared-cpu-1x:1024MB to
// shared-cpu-2x:2048MB. Runs #22 (DeepSeek V4 Flash) and #28
// (Gemma 4) both hit:
//   - eventLoopDelayP99=3.9s (4-sec event-loop lag)
//   - eventLoopUtilization=1.0 (100% saturated)
//   - SessionWriteLockTimeoutError / EmbeddedAttemptSessionTakeoverError
//     when operator inbounds collided with Maya's mid-turn locks
// Root cause: 1 CPU = Maya + active worker = 100% saturation, no
// headroom for inbound message processing. Doubling to 2 CPUs +
// doubling memory gives the gateway room to handle inbounds while
// Maya is mid-think. ~$5/mo per active Maya additional cost.
const MACHINE_GUEST: NonNullable<FlyMachineConfig["guest"]> = {
  cpu_kind: "shared",
  cpus: 2,
  memory_mb: 2048,
};

const WAIT_TIMEOUT_MS = 180_000;
const WAIT_INTERVAL_MS = 3_000;

export interface BuildGatewayConfigInput {
  /**
   * Sprint 1.3 — when set, the Telegram channel adapter is enabled with a
   * dmPolicy allowlist scoped to this user ID. Without this, OpenClaw boots
   * with 0 channels and the orchestrator's `delivery: { channel: telegram }`
   * silently drops. The bot token is read from the TELEGRAM_BOT_TOKEN env
   * var (must be present in Fly secrets via collectDeploySecrets).
   *
   * Pre-pairing creators get no Telegram channel — keeps the gateway config
   * valid in test fixtures and during onboarding. The orchestrator's handoff
   * + heartbeat tasks check for telegramChatId presence before scheduling
   * delivery, so an unset channel just means messages are deferred until
   * the user pairs.
   */
  telegramChatId?: string;
  /**
   * Sprint 2.16u-fix17 — webhook mode for Telegram. Per OpenClaw
   * docs/channels/telegram.md, "Default is long polling. For webhook mode set
   * channels.telegram.webhookUrl and channels.telegram.webhookSecret."
   *
   * Long polling on Fly machines has hit 4-12 minute stalls every deploy
   * because Fly's outbound network path to api.telegram.org is unreliable.
   * Webhook mode flips the direction — Telegram pushes updates to a public
   * URL on our Fly machine, no polling required.
   *
   * For our per-user product (one bot per user, one Fly machine per user),
   * each bot has a unique webhook URL pointing at its dedicated Fly machine.
   * No multi-tenant relay needed.
   *
   * webhookUrl is `https://<flyAppName>.fly.dev/telegram-webhook`.
   * webhookSecret is a 32-byte hex per machine for Telegram signature verify.
   */
  telegramWebhookUrl?: string;
  telegramWebhookSecret?: string;
}

export function buildGatewayConfig(
  input: BuildGatewayConfigInput = {}
): Record<string, unknown> {
  const mainModel = toOpenClawModelRef(MODEL_ROUTING.mainMaya);
  const subagentModel = toOpenClawModelRef(MODEL_ROUTING.subagent);
  // Sprint 2.18 — hardModel const dropped; hard_research_beta is no
  // longer a configured agent. The MODEL_ROUTING.hardResearchBeta
  // entry stays in the routing table for narrative / cost docs.
  const extractionModel = toOpenClawModelRef(MODEL_ROUTING.extractionWorker);
  const memorySearch = buildMemorySearchConfig();

  // Sprint 20 — Maya-side subagent lane. Registers per-platform research
  // subagents Maya can spawn via sessions_spawn({ agentId: "<id>" }). Each
  // subagent has its own context + token budget; cron-heartbeat-at-
  // thinking-0 can still spawn a thinking:high subagent for heavy work
  // without inheriting the cron's budget ban.
  //
  // Naming convention matches the AGENTS.md "Subagent Pattern" section
  // so Maya already knows the slugs by the time she reads them.
  // Sprint 2.16a — all channel-research subagents unify on
  // gemini-3-flash (the cheaper Gemini, NOT 3.5). Subagents do
  // focused platform work — they don't need 3.5's strategic
  // judgment. Was Claude Sonnet 4.5 on the heavy ones which is
  // 10x more expensive + slower for no quality lift on focused
  // tasks. With operator-approved `thinking: medium` budget in
  // the subagent prompts, Gemini 3 Flash has enough headroom to
  // do multi-step research per channel.
  // Sprint 2.16l — research subagents get the FULL coding profile by
  // omitting `tools.allow` (which is RESTRICTIVE in OpenClaw, not
  // additive). Prior config `allow: ["scrapecreators-api", "web_fetch"]`
  // restricted the subagent to only web_fetch (the fake "scrapecreators-
  // api"/"search-x"/"tiktok"/"instagram" entries got stripped silently
  // with a warning — they're not real tool IDs). That meant subagents
  // had NO tool that could POST with Bearer auth to /lc_gtm/* callbacks
  // — they tried web_fetch (GET-only) on POST endpoints, got 404s, gave
  // up, returned empty. Six deploys deep, that was the real bug.
  //
  // Full coding profile gives them: read, write, edit, exec, process,
  // web_fetch, web_search, x_search, memory_*, sessions_*. With `exec`
  // they can curl with auth headers; with web_fetch they can do GETs
  // (e.g. HN Algolia search, ScrapeCreators GET endpoints).
  const SUBAGENTS = [
    {
      id: "reddit_research",
      name: "Reddit Demand Researcher",
      model: subagentModel,
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      // Allow no further spawning — depth-1 max from main.
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "x_research",
      name: "X Founder-Led Researcher",
      model: subagentModel,
      // alsoAllow group:plugins — the `coding` profile does NOT include
      // plugin-owned tools, so without this the maya-gtm-tools typed tools
      // (research_* + save_*) are filtered out of the worker's tool set and
      // it falls back to fabricating. This is what makes the workers actually
      // persist instead of returning text.
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "tiktok_research",
      name: "TikTok Format Researcher",
      model: subagentModel,
      // alsoAllow group:plugins — the `coding` profile does NOT include
      // plugin-owned tools, so without this the maya-gtm-tools typed tools
      // (research_* + save_*) are filtered out of the worker's tool set and
      // it falls back to fabricating. This is what makes the workers actually
      // persist instead of returning text.
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "instagram_research",
      name: "Instagram Reuse Researcher",
      model: subagentModel,
      // alsoAllow group:plugins — the `coding` profile does NOT include
      // plugin-owned tools, so without this the maya-gtm-tools typed tools
      // (research_* + save_*) are filtered out of the worker's tool set and
      // it falls back to fabricating. This is what makes the workers actually
      // persist instead of returning text.
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "linkedin_research",
      name: "LinkedIn Fit Researcher",
      model: subagentModel,
      // alsoAllow group:plugins — the `coding` profile does NOT include
      // plugin-owned tools, so without this the maya-gtm-tools typed tools
      // (research_* + save_*) are filtered out of the worker's tool set and
      // it falls back to fabricating. This is what makes the workers actually
      // persist instead of returning text.
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      subagents: { allowAgents: [] as string[] },
    },
    {
      // Ideal-product pillar 2 (EQUAL SIX-CHANNEL RESEARCH) — youtube is
      // re-promoted to a first-class Brief-only channel. This worker mirrors
      // instagram_research / linkedin_research: it scrapes the founder's +
      // ICP's YouTube via scrape_creators, mines comments + transcripts for
      // native register and buyer language, and persists via save_target_thread
      // + save_foundation_channel_scorecard (with icpKnowledge) +
      // save_style_exemplars. Task contract lives in the maya-youtube-researcher
      // SKILL.md; this entry just gives it the plugin tools + coding profile so
      // its save_* calls actually land instead of fabricating.
      id: "youtube_research",
      name: "YouTube Demand Researcher",
      model: subagentModel,
      // alsoAllow group:plugins — the `coding` profile does NOT include
      // plugin-owned tools, so without this the maya-gtm-tools typed tools
      // (research_* + save_*) are filtered out of the worker's tool set and
      // it falls back to fabricating. This is what makes the workers actually
      // persist instead of returning text.
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      subagents: { allowAgents: [] as string[] },
    },
    {
      // HN via Algolia search — no API key required, GET-only.
      // Full coding profile here too so subagent can choose web_fetch
      // for the GET or curl-via-exec if needed.
      id: "hn_research",
      name: "Hacker News Demand Researcher",
      model: subagentModel,
      // alsoAllow group:plugins — the `coding` profile does NOT include
      // plugin-owned tools, so without this the maya-gtm-tools typed tools
      // (research_* + save_*) are filtered out of the worker's tool set and
      // it falls back to fabricating. This is what makes the workers actually
      // persist instead of returning text.
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "channel_judge",
      name: "Channel Strategy Judge",
      model: mainModel,
      // Pure synthesis — deny network-egress tools so the judge can't
      // burn external API budget mid-decision. (Removed fake
      // "scrapecreators-api"/"tiktok"/"search-x" entries which were
      // stripped silently anyway.)
      tools: { profile: "coding" as const, deny: ["web_fetch", "web_search", "exec", "process"] },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "slop_critic",
      name: "Slop Critic",
      model: mainModel,
      // Local-only — banned-phrase scan + voice match. Deny network
      // and exec so it can't accidentally make HTTP/shell calls.
      tools: { profile: "coding" as const, deny: ["web_fetch", "web_search", "exec", "process"] },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "extraction_worker",
      name: "Extraction Worker",
      // Cheap structured-output model for normalizing multimodal walkthrough
      // analysis output into ResearchRawItem-shaped data. Per TOOLS.md.
      model: extractionModel,
      // alsoAllow group:plugins — the `coding` profile does NOT include
      // plugin-owned tools, so without this the maya-gtm-tools typed tools
      // (research_* + save_*) are filtered out of the worker's tool set and
      // it falls back to fabricating. This is what makes the workers actually
      // persist instead of returning text.
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      subagents: { allowAgents: [] as string[] },
    },
    // ─── Sprint 2.17 Phase C — Manager-mode workers ────────────────────
    // Five foundation workers, spawned once at onboarding + monthly. They
    // populate gtmBuyerMap / CompetitiveMap / ChannelScorecard /
    // ContentAngles / RelationshipTargets via /lc_gtm/foundation_*
    // endpoints. Maya orchestrates with native session tools
    // (subagents list/kill/steer) — see SKILL.md maya-foundation-research.
    {
      id: "buyer_map_worker",
      name: "Buyer Map Researcher",
      model: subagentModel,
      // alsoAllow group:plugins — the `coding` profile does NOT include
      // plugin-owned tools, so without this the maya-gtm-tools typed tools
      // (research_* + save_*) are filtered out of the worker's tool set and
      // it falls back to fabricating. This is what makes the workers actually
      // persist instead of returning text.
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "competitive_worker",
      name: "Competitive Map Researcher",
      model: subagentModel,
      // alsoAllow group:plugins — the `coding` profile does NOT include
      // plugin-owned tools, so without this the maya-gtm-tools typed tools
      // (research_* + save_*) are filtered out of the worker's tool set and
      // it falls back to fabricating. This is what makes the workers actually
      // persist instead of returning text.
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "channel_worker",
      name: "Channel Scorecard Researcher",
      model: subagentModel,
      // alsoAllow group:plugins — the `coding` profile does NOT include
      // plugin-owned tools, so without this the maya-gtm-tools typed tools
      // (research_* + save_*) are filtered out of the worker's tool set and
      // it falls back to fabricating. This is what makes the workers actually
      // persist instead of returning text.
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "content_angle_worker",
      name: "Content Angle Vault Researcher",
      model: subagentModel,
      // alsoAllow group:plugins — the `coding` profile does NOT include
      // plugin-owned tools, so without this the maya-gtm-tools typed tools
      // (research_* + save_*) are filtered out of the worker's tool set and
      // it falls back to fabricating. This is what makes the workers actually
      // persist instead of returning text.
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "relationship_worker",
      name: "Relationship Target Researcher",
      model: subagentModel,
      // alsoAllow group:plugins — the `coding` profile does NOT include
      // plugin-owned tools, so without this the maya-gtm-tools typed tools
      // (research_* + save_*) are filtered out of the worker's tool set and
      // it falls back to fabricating. This is what makes the workers actually
      // persist instead of returning text.
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      subagents: { allowAgents: [] as string[] },
    },
    // Continuous-mode workers, spawned daily before the morning brief.
    // Map competitor moves + niche pulse. The per-channel continuous
    // workers reuse reddit_research / x_research / hn_research above —
    // Maya's task strings differentiate "foundation pass" vs
    // "continuous pass" semantics.
    {
      id: "competitor_move_worker",
      name: "Competitor Move Watcher",
      model: subagentModel,
      // alsoAllow group:plugins — the `coding` profile does NOT include
      // plugin-owned tools, so without this the maya-gtm-tools typed tools
      // (research_* + save_*) are filtered out of the worker's tool set and
      // it falls back to fabricating. This is what makes the workers actually
      // persist instead of returning text.
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "niche_pulse_worker",
      name: "Niche Pulse Watcher",
      model: subagentModel,
      // alsoAllow group:plugins — the `coding` profile does NOT include
      // plugin-owned tools, so without this the maya-gtm-tools typed tools
      // (research_* + save_*) are filtered out of the worker's tool set and
      // it falls back to fabricating. This is what makes the workers actually
      // persist instead of returning text.
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      subagents: { allowAgents: [] as string[] },
    },
    {
      // Calendar assembler. The week's plan (Phase 3) used to be a Maya-inline
      // step that K2 reliably SKIPPED — threads+drafts landed but the calendar
      // never did (0 events, every era). Moving it to a dedicated worker makes
      // it land the same way threads/drafts do: workers call tools reliably.
      // It reads the landed threads + foundation via get_my_* and calls
      // propose_calendar (stores DRAFTS — the Google Calendar push stays gated
      // on the operator's approval via approve_calendar).
      id: "calendar_worker",
      name: "Calendar Assembler",
      model: subagentModel,
      tools: {
        profile: "coding" as const,
        alsoAllow: ["group:plugins"] as const,
      },
      subagents: { allowAgents: [] as string[] },
    },
  ];

  // The set of subagent IDs main can spawn. Sprint 2.18 — removed
  // `hard_research_beta` from this list since it is no longer a
  // configured agent in agents.list[]. Per 5.26 changelog: "require
  // explicit subagent allowlist targets to be configured agents so
  // stale deleted-agent ids are omitted from agents_list and rejected
  // by sessions_spawn." Bundled skills that mention hard_research_beta
  // in their cost-discipline notes are stale narrative — they never
  // actually invoked it.
  const allowFromMain = ["main", ...SUBAGENTS.map((s) => s.id)];

  return {
    gateway: { mode: "local" },
    agents: {
      defaults: {
        workspace: "/data/workspace",
        // Sprint 2.18 #35 — raise bootstrap-injection cap from default
        // 12K → 30K. Per OpenClaw docs (concepts/agent-workspace.md):
        // "Large bootstrap files are truncated when injected; adjust
        // limits with agents.defaults.bootstrapMaxChars (default 12000)
        // and bootstrapTotalMaxChars (default 60000)." Verified live
        // 2026-05-27 run #14: BOOT.md=15K, TOOLS.md=17K, AGENTS.md=14.5K
        // all silently truncated to 12K, dropping end-of-file content
        // including the synthesis hard gate and several step
        // procedures. Raising to 30K per-file leaves total under 60K cap
        // (current sum 57.5K → ~57.5K still, no change to total since
        // none exceed 30K). With the canonical reorg, files should be
        // much smaller anyway — this is safety net.
        bootstrapMaxChars: 30000,
        // Sprint top-tier (2026-06-03) — raise the TOTAL bootstrap budget from
        // the 60K default. A live deploy-test proved the failure mode: TOOLS.md
        // had grown to 36K (12 new tools) and ate the whole 60K total, so BOOT.md
        // (the research kickoff) was SILENTLY SKIPPED and the agent stalled with
        // no instructions. TOOLS.md is now a terse ~8.5K index; total core ~85K.
        // 110K total leaves comfortable headroom so the kickoff never gets dropped.
        bootstrapTotalMaxChars: 110000,
        // Skip OpenClaw's first-run Q&A — Convex onboarding already
        // collected identity + user preferences + timezone. IDENTITY.md
        // is rendered by our own template.
        skipBootstrap: true,
        model: {
          primary: mainModel,
        },
        memorySearch,
        // Sprint 2.18 — `llm.idleTimeoutSeconds` REMOVED. The whole `llm`
        // sub-key was valid in 4.23 (added Sprint 2.16h to extend the
        // idle-watchdog from 120s → 300s for Gemini 3.5 Flash high-thinking
        // streams) but 5.x dropped it from the schema. OpenClaw 5.12's
        // stream-establishment idle-timer fix (catch SDK requests stuck at
        // TCP/TLS handshake) supersedes the per-config tunable — idle
        // detection now races against the same internal watchdog with no
        // user-facing knob. Verified via /tmp/openclaw-inspect diff:
        // `idleTimeoutSeconds` exists in 4.23 types.agent-defaults.d.ts:481
        // but is absent from 5.26 types.agent-defaults.d.ts. Live deploy
        // failed with "agents.defaults: Invalid input" until removed.
        // Sprint 2.16l — attempted `thinking: "minimal"` at this level
        // to avoid OpenRouter's "Reasoning is mandatory" 400 + auto-retry
        // round-trip on every LLM call with gemini-3.5-flash. But the
        // OpenClaw schema rejected it: "agents.defaults: Unrecognized
        // key: thinking". `thinking` is a per-payload field, not a
        // global default. Each cron's payload already sets it correctly.
        // The 400-then-auto-retry-with-minimal is annoying-but-not-fatal:
        // OpenClaw self-heals.
        subagents: {
          // Sprint 2.16j — bumped 4 → 8 per external-architect review.
          // We cap research lanes at 3 in the boot prompt, so 8 leaves
          // headroom for refinement waves + parallel weekly-review fans
          // without queuing.
          maxConcurrent: 8,
          maxChildrenPerAgent: 4,
          maxSpawnDepth: 1,
          // Sprint 2.32 — raised 900 → 1500. The deepened research skills
          // (full comment-tree descent, pagination, substitute-chain mining,
          // buyer-language comment scans) legitimately need more wall-clock
          // than the old 15-min cap allowed; competitor/foundation workers
          // now budget ~20-22 min. Maya still kills stuck workers via
          // `subagents kill` in her judgment, so the higher ceiling only
          // helps genuinely-deep digs finish instead of being guillotined.
          runTimeoutSeconds: 1500,
          archiveAfterMinutes: 60,
          // Sprint 2.18 #10 — default thinking="medium" for all spawned
          // workers. Per operator spec: "her subagents could also be
          // Gemini 3.5 with medium thinking level." Without this, the
          // session record shows `thinkingLevel: "off"` and workers
          // bypass reasoning entirely — they grep node_modules to
          // discover endpoint schemas instead of inferring from the
          // task brief + TOOLS.md. Verified live 2026-05-27 on
          // clawlaunch-ws78m7y8p6qvv7hhpq: buyer_map_worker spent ~6 min
          // grep'ing /usr/local/lib/node_modules/openclaw/ for
          // "foundation_buyer_map" rather than POSTing.
          thinking: "medium",
        },
        // Heartbeat is the watchdog/recovery lane. BOOT.md owns the
        // first launch workflow on gateway startup; heartbeat checks for
        // stalled flows, pending approvals, due calendar events, and
        // result scans.
        heartbeat: {
          // 30m: the heartbeat is only a watchdog/recovery net — foundation is
          // driven by the BOOT turn, and the daily cadence by dedicated crons.
          // 5m was a debug interval; at K2 prices a 5m tick that does real
          // reasoning (or flails reading non-existent state files) burns ~$150/day
          // on an idle agent. 30m = 6x fewer ticks. Most ticks must return
          // HEARTBEAT_OK silently (see HEARTBEAT.md).
          every: "30m",
          lightContext: true,
          isolatedSession: true,
          // Sprint 2.16u-fix2 — REMOVED activeHours because timezone was
          // shipping as the literal string "operator" (never templated to
          // a real IANA tz). OpenClaw silently fails closed when the tz
          // can't be resolved, suppressing every heartbeat tick. Active
          // hours are a nice-to-have we can re-enable once real timezone
          // wiring is guaranteed.
        },
      },
      list: [
        {
          id: "main",
          default: true,
          name: "Maya",
          workspace: "/data/workspace",
          model: mainModel,
          subagents: { allowAgents: allowFromMain },
          // alsoAllow group:plugins so the maya-gtm-tools typed tools
          // (persist + research) reach Maya — the `coding` profile excludes
          // plugin-owned tools by default (verified live: toolCount was 22
          // without this, the 46 plugin tools missing). Subagents get the
          // same via their per-agent tools above.
          tools: { profile: "coding", alsoAllow: ["group:plugins"] },
          // Sprint 2.18 #50 — hide reasoning tokens from operator-
          // facing output. Per OpenClaw docs: agents.list[].
          // reasoningDefault: "off" overrides the global default
          // and blocks reasoning from being emitted to channels.
          // Critical for Gemma 4 which inlines reasoning with output.
          // Model still reasons internally — gateway just doesn't
          // forward the reasoning content to Telegram.
          reasoningDefault: "off" as const,
          // Sprint 2.18 #38 attempted thinking:"medium" here — OpenClaw
          // schema REJECTED it at the per-agent entry level. `thinking`
          // is per-session-payload only — Maya invokes it explicitly
          // per sessions_spawn call.
        },
        // Sprint 2.18 — hard_research_beta REMOVED from agents.list[].
        // boot-md iterates listAgentIds(cfg) and runs BOOT.md FOR EACH
        // entry. Two top-level agents meant BOOT.md was running twice
        // (once for main, once for hard_research_beta with its different
        // tools/model). hard_research_beta is still callable from main
        // via the `allowFromMain` allowlist below — it just isn't a
        // top-level agent that bootstraps its own session.
        ...SUBAGENTS.map((s) => ({
          ...s,
          workspace: "/data/workspace",
        })),
      ],
    },
    plugins: {
      // Sprint 2.16j — restrictive allowlist per external-architect
      // recommendation. `plugins.allow` is deny-by-default: any plugin
      // not listed here cannot load (and therefore cannot install
      // runtime deps). This is the canonical OpenClaw way to skip
      // unused channel/voice/microsoft-style plugins entirely.
      //
      // Why not just plugins.entries.<id>.enabled: false? Known
      // OpenClaw bug (issue against 2026.4.22): doctor-bundled-plugin-
      // runtime-deps still installed disabled-channel dependencies via
      // a health path that forced includeConfiguredChannels: true.
      //
      // Plugin IDs verified against /tmp/openclaw-source plugin
      // registry (grep "pluginId:") — only the ones actually
      // registered as plugins. cron/taskflow/hooks/run/openrouter
      // are built-in subsystems, NOT plugins, so don't need allowing.
      // (openrouter auto-enables via model config; verified by reading
      // /data/openclaw.json after gateway start.)
      // `maya-gtm-tools` is our typed-tool plugin (persist + research),
      // installed at boot via `openclaw plugins install npm-pack:`. It must be
      // in this deny-by-default allowlist or the gateway won't load it — and
      // its tools won't reach Maya or her subagents. Subagents inherit the
      // parent's plugin tools (OpenClaw subagent tool-policy), so listing it
      // once here makes it available to every research worker too.
      allow: ["telegram", "maya-gtm-tools"],
      entries: {
        // Keep telegram explicitly enabled. Channel-config in
        // `channels.telegram` (lower in this config) does the actual
        // dmPolicy + allowFrom wiring; this just confirms enablement.
        telegram: { enabled: true },
      },
    },
    // Enable internal hook runtime so BOOT.md fires on gateway startup
    // as a real native primitive (not just a workspace file Maya happens
    // to read). BOOT.md owns the immediate hello and first GTM launch
    // wave. HEARTBEAT.md is only the watchdog/recovery lane.
    //
    // `hooks` is a TOP-LEVEL config key per OpenClaw 2026.4.23 zod
    // schema (sibling of `gateway`, `agents`, `plugins`) — NOT a key
    // under `agents.defaults`. The first 2.16j deploy attempt placed
    // it under `agents.defaults` and the gateway rejected the config
    // with "agents.defaults: Unrecognized key: hooks".
    hooks: {
      internal: {
        enabled: true,
      },
    },
    // Sprint 1.3 — native OpenClaw Telegram channel. Without this block
    // OpenClaw boots with 0 channels and `delivery: { channel: telegram }`
    // is a no-op. With it, cron jobs that fire `mode: announce, channel:
    // telegram, to: <chatId>` deliver via the bot token (read from
    // TELEGRAM_BOT_TOKEN env). dmPolicy allowlist scoped to the paired
    // user means inbound DMs from any other Telegram user are dropped —
    // critical when multiple Mayas share the same staging bot token.
    // Pre-pairing creators (no telegramChatId yet) get the channel
    // OMITTED — cleanest behavior since handoff/heartbeat code already
    // checks for telegramChatId presence before scheduling delivery.
    ...(input.telegramChatId
      ? {
          channels: {
            telegram: {
              enabled: true,
              dmPolicy: "allowlist" as const,
              allowFrom: [Number(input.telegramChatId)].filter(Number.isFinite),
              streaming: { mode: "off" as const },
              // Sprint 2.16u-fix17 — webhook mode to bypass Fly's flaky
              // outbound long-poll path to api.telegram.org. Per
              // docs/channels/telegram.md "Long polling vs webhook":
              //   set channels.telegram.webhookUrl + webhookSecret;
              //   optional webhookPath (default /telegram-webhook),
              //   webhookHost (default 127.0.0.1 — we override to
              //   0.0.0.0 so Fly's public proxy can route to it),
              //   webhookPort (default 8787).
              ...(input.telegramWebhookUrl && input.telegramWebhookSecret
                ? {
                    webhookUrl: input.telegramWebhookUrl,
                    webhookSecret: input.telegramWebhookSecret,
                    webhookHost: "0.0.0.0" as const,
                    webhookPort: 8787,
                    webhookPath: "/telegram-webhook" as const,
                  }
                : {}),
            },
          },
        }
      : {}),
    discovery: { mdns: { mode: "off" } },
    skills: { load: { watch: true } },
  };
}

function buildMemorySearchConfig(): Record<string, unknown> {
  const geminiKey =
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!geminiKey) {
    return { enabled: false };
  }

  return {
    enabled: true,
    provider: "gemini",
    model: "gemini-embedding-001",
    outputDimensionality: 768,
    fallback: "none",
    store: {
      path: "/data/openclaw-memory/{agentId}.sqlite",
      vector: { enabled: true },
      fts: { tokenizer: "unicode61" },
    },
    query: {
      maxResults: 8,
      minScore: 0.25,
      hybrid: {
        enabled: true,
        vectorWeight: 0.65,
        textWeight: 0.35,
        temporalDecay: { enabled: true, halfLifeDays: 45 },
      },
    },
    sync: {
      onSessionStart: true,
      onSearch: true,
      watch: true,
      intervalMinutes: 30,
      sessions: {
        deltaBytes: 100000,
        deltaMessages: 50,
        postCompactionForce: true,
      },
    },
  };
}

export const getGtmAgentForDeploy = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{
    agent: Doc<"gtmAgents">;
    creator: Pick<Doc<"creators">, "_id" | "email" | "displayName">;
    app: Doc<"gtmApps">;
    channelScores: Doc<"gtmChannelScores">[];
    latestResearchJobId?: Id<"gtmResearchJobs">;
    walkthroughVideoUrl?: string;
  } | null> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    const creator = await ctx.db.get(agent.accountId);
    if (!creator || creator.accountType !== "gtm-agent") return null;
    if (!agent.appId) return null;
    const app = await ctx.db.get(agent.appId);
    if (!app || app.accountId !== creator._id) return null;
    // Sprint 2.32 — surface the founder's walkthrough video so Maya can watch
    // it herself on boot (full-migration direction: OpenClaw owns digestion,
    // not a Convex-side Gemini pass). Storage URL is resolved here because the
    // workspace generator can't reach Convex storage.
    const latestWalkthrough = await ctx.db
      .query("gtmWalkthroughUploads")
      .withIndex("by_app", (q) => q.eq("appId", app._id))
      .collect()
      .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt)[0]);
    const walkthroughVideoUrl = latestWalkthrough
      ? (await ctx.storage.getUrl(latestWalkthrough.storageId)) ?? undefined
      : undefined;
    const latestJob = await ctx.db
      .query("gtmResearchJobs")
      .withIndex("by_app", (q) => q.eq("appId", app._id))
      .collect()
      .then((jobs) => jobs.sort((a, b) => b.createdAt - a.createdAt)[0]);
    const channelScores = latestJob
      ? await ctx.db
          .query("gtmChannelScores")
          .withIndex("by_research_job", (q) =>
            q.eq("researchJobId", latestJob._id)
          )
          .collect()
      : [];
    return {
      agent,
      // Sprint 2.16q — include displayName for the deploy-time hello
      // template ("Hey <firstName> — Maya here ...").
      creator: { _id: creator._id, email: creator.email, displayName: creator.displayName },
      app,
      latestResearchJobId: latestJob?._id,
      channelScores,
      walkthroughVideoUrl,
    };
  },
});

export const patchGtmAgentOnDeploySuccess = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    openClawFlyAppId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const now = Date.now();
    await ctx.db.patch(args.agentId, {
      openClawFlyAppId: args.openClawFlyAppId,
      deployedAt: now,
      onboardingStep: "active",
      updatedAt: now,
    });
  },
});

/**
 * Sprint 2.14a.6 — trace Sprint 2.11 deploy-time hello attempts.
 * Always called after sendDirectTelegramMessage so we know:
 *   - was the code path reached (attemptedAt set)
 *   - what was the result (sent / firewall_blocked / etc)
 *   - what was the Telegram message_id on success
 */
export const recordDeployTimeHelloResult = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    result: v.string(),
    messageId: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const now = Date.now();
    const agent = await ctx.db.get(args.agentId);
    await ctx.db.patch(args.agentId, {
      deployTimeHelloAttemptedAt: now,
      deployTimeHelloResult: args.result.slice(0, 200),
      deployTimeHelloMessageId: args.messageId,
      // #15 — when the deploy-time hello actually SENT, set the durable
      // lifecycle marker too so BOOT's get_agent_lifecycle sees helloSent=true
      // and never re-introduces Maya like a stranger on the next boot/restart.
      ...(args.result === "sent" && !agent?.helloSentAt
        ? { helloSentAt: now }
        : {}),
      updatedAt: now,
    });
  },
});

/**
 * Sprint 16 — provision (or rotate) the per-agent hookToken before the
 * workspace bundle is built. The token is the shared secret between the
 * Convex deployment and the agent's OpenClaw gateway. Returns the freshly
 * provisioned token so the caller can template it into the workspace
 * config; subsequent re-builds read it from the gtmAgents row.
 */
export const ensureGtmAgentHookToken = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<string> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error(`gtmAgent ${args.agentId} not found`);
    if (agent.hookToken && agent.hookToken.length >= 32) {
      return agent.hookToken;
    }
    const token = mintHookToken();
    await ctx.db.patch(args.agentId, {
      hookToken: token,
      updatedAt: Date.now(),
    });
    return token;
  },
});

export const buildAndUploadGtmWorkspace = internalAction({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{
    flyAppName: string;
    workspaceBundleUrl: string;
    pluginBundleUrl: string;
  }> => {
    const row = await ctx.runQuery(
      internal.onboarding.gtm.deployMayaGtm.getGtmAgentForDeploy,
      { agentId: args.agentId }
    );
    if (!row) throw new Error(`GTM agent ${args.agentId} not deployable.`);

    // Sprint 16 — provision hookToken before bundling so cron.hooks.token
    // can be templated into openclaw.json. Idempotent — re-builds keep
    // the same token.
    const hookToken = await ctx.runMutation(
      internal.onboarding.gtm.deployMayaGtm.ensureGtmAgentHookToken,
      { agentId: args.agentId }
    );

    const { files } = buildMayaGtmWorkspace({
      accountEmail: row.creator.email,
      timezone: row.agent.timezone,
      // Verification/test deploys set this on the agent to force all-platform
      // coverage; undefined/false in production (agents stay focused).
      verifyAllPlatforms: row.agent.verifyAllPlatforms,
      app: {
        name: row.app.name ?? "Untitled app",
        url: row.app.url,
        stage: row.app.stage,
        weekGoal: row.app.weekGoal,
        userCountBand: row.app.userCountBand,
        founderWhy: row.app.founderWhy,
        canRecordScreen: row.app.canRecordScreen,
        canShowFace: row.app.canShowFace,
        canRecordVoice: row.app.canRecordVoice,
        canProvideScreenshots: row.app.canProvideScreenshots,
        canPostTikTokManually: row.app.canPostTikTokManually,
        canPostInstagramManually: row.app.canPostInstagramManually,
        existingTikTokUrl: row.app.existingTikTokUrl,
        existingInstagramUrl: row.app.existingInstagramUrl,
        existingYoutubeUrl: row.app.existingYoutubeUrl,
        existingLinkedinUrl: row.app.existingLinkedinUrl,
        tiktokWarmupState: row.app.tiktokWarmupState,
        tiktokAccountAgeDays: row.app.tiktokAccountAgeDays,
        tiktokAccountStatusChecked: row.app.tiktokAccountStatusChecked,
        openToUgcCreators: row.app.openToUgcCreators,
        creatorBudgetMonthlyUsd: row.app.creatorBudgetMonthlyUsd,
        maxWeeklyVisualPosts: row.app.maxWeeklyVisualPosts,
        excludedAudiences: row.app.excludedAudiences,
        // Sprint B — journey-stage fork + North Star contract. Thread the
        // stored values so a redeploy renders the resolved mode + the
        // approved North Star into GTM.md (else GTM.md shows the
        // propose-at-synthesis path).
        entryMode: row.app.entryMode,
        northStarMetric: row.app.northStarMetric,
        northStarTarget: row.app.northStarTarget,
        northStarDeadlineMs: row.app.northStarDeadlineMs,
      },
      // Sprint 2.32 — hand the digested product understanding (URL inspection
      // + walkthrough-video Gemini analysis, merged on gtmApps.diagnosis) into
      // the workspace so APP.md boots with a real product picture instead of an
      // empty "Research To Fill" stub. Previously computed at onboarding and
      // silently dropped here.
      appDiagnosis: row.app.diagnosis,
      // Sprint 2.32 — the founder's walkthrough video, for Maya to watch
      // herself on boot rather than relying on a Convex-side pre-digest.
      walkthroughVideoUrl: row.walkthroughVideoUrl,
      primaryChannel: toPickerChannel(
        row.channelScores.find((s) => s.decision === "primary")?.channel
      ),
      secondaryChannel: toPickerChannel(
        row.channelScores.find((s) => s.decision === "secondary")?.channel
      ),
      activeResearchJobId: row.latestResearchJobId
        ? String(row.latestResearchJobId)
        : undefined,
      // Sprint 14 — native cron delivery target. When the user has paired
      // Telegram (Sprint 15), every cron's delivery envelope becomes
      // `mode: "announce", channel: "telegram", to: <chatId>`. Pre-pairing
      // falls back to mode:none so the workspace bundle is still
      // generatable mid-onboarding.
      telegramChatId: row.agent.telegramChatId,
      channelPreference: row.agent.channelPreference,
      deliveryFailureDestination: resolveDeliveryFailureUrl(),
      // Sprint 16 — Convex ↔ Maya hook bridge configuration. The
      // workspace generator templates these into openclaw.json so the
      // gateway exposes /hooks/{agent,wake} and Maya's TOOLS.md knows
      // where to POST /lc_gtm/* callbacks.
      hookToken,
      convexHookCallbackUrl: resolveConvexHookCallbackBaseUrl(),
      // Ideal-product pillar 1 (VOICE) — thread the founder's persisted voice
      // fingerprint so a redeploy re-renders the USER.md "Voice fingerprint"
      // section instead of resetting it to "not yet built". Built in Phase 0
      // from the founder's own handles (save_voice_profile).
      voiceProfileJson: row.agent.voiceProfileJson,
      // Ideal-product pillar 4 (WARMUP) — thread the per-channel warmth map so a
      // redeploy re-renders the per-channel warmth block. If the runtime already
      // persisted channelWarmthJson (via set_channel_warmth) it wins; otherwise
      // seed an initial grounded arc from the voice pull's per-platform signal
      // (and mirror the legacy tiktokWarmupState into .tiktok).
      channelWarmthJson: seedChannelWarmthFromVoice({
        voiceProfileJson: row.agent.voiceProfileJson,
        existingChannelWarmthJson: row.agent.channelWarmthJson,
        tiktokWarmupState: row.app.tiktokWarmupState,
        tiktokAccountAgeDays: row.app.tiktokAccountAgeDays,
      }),
      // Which channels the founder connected, so USER.md tells Maya who she can
      // post for (auto-post vs one-tap-confirm vs not-connected).
      connectedAccountsJson: row.agent.connectedAccountsJson,
    });
    const tarBytes = buildPosixTar(files);
    const tarBuffer = tarBytes.buffer.slice(
      tarBytes.byteOffset,
      tarBytes.byteOffset + tarBytes.byteLength
    ) as ArrayBuffer;
    const storage = await ctx.storage.store(
      new Blob([tarBuffer], { type: "application/x-tar" })
    );
    const url = (await ctx.storage.getUrl(storage)) ?? "";
    if (!url) throw new Error("Convex storage returned empty workspace URL.");

    // Upload the typed-tool plugin tarball as its own binary blob (the tar
    // builder is UTF-8 only, so a tgz can't ride inside the workspace tar).
    // The Fly bootstrap downloads this and runs
    // `openclaw plugins install npm-pack:<tgz>` before the gateway starts.
    const pluginBytes = Uint8Array.from(
      atob(BUNDLED_GTM_PLUGIN_TGZ_BASE64),
      (c) => c.charCodeAt(0)
    );
    const pluginBuffer = pluginBytes.buffer.slice(
      pluginBytes.byteOffset,
      pluginBytes.byteOffset + pluginBytes.byteLength
    ) as ArrayBuffer;
    const pluginStorage = await ctx.storage.store(
      new Blob([pluginBuffer], { type: "application/gzip" })
    );
    const pluginUrl = (await ctx.storage.getUrl(pluginStorage)) ?? "";
    if (!pluginUrl) throw new Error("Convex storage returned empty plugin URL.");

    return {
      flyAppName: flyAppNameForGtmAgent(args.agentId),
      workspaceBundleUrl: url,
      pluginBundleUrl: pluginUrl,
    };
  },
});

export const deployMayaGtm = internalAction({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<DeployMayaGtmResult> => {
    const startedAt = Date.now();
    const fail = (
      stage: DeployMayaGtmStage,
      message: string,
      retryable = false
    ): DeployMayaGtmResult => ({
      ok: false,
      stage,
      message,
      retryable,
      durationMs: Date.now() - startedAt,
    });

    const row = await ctx.runQuery(
      internal.onboarding.gtm.deployMayaGtm.getGtmAgentForDeploy,
      { agentId: args.agentId }
    );
    if (!row) return fail("load-agent", `GTM agent ${args.agentId} not deployable.`);

    let bundle: {
      flyAppName: string;
      workspaceBundleUrl: string;
      pluginBundleUrl: string;
    };
    try {
      bundle = await ctx.runAction(
        internal.onboarding.gtm.deployMayaGtm.buildAndUploadGtmWorkspace,
        { agentId: args.agentId }
      );
    } catch (err) {
      return fail("upload-bundle", (err as Error).message);
    }

    const fly = newFlyClient();
    try {
      await fly.createApp({ appName: bundle.flyAppName });
    } catch (err) {
      if (!isAlreadyExists(err)) {
        return fail("create-app", (err as Error).message, isRetryable(err));
      }
    }

    try {
      // Sprint 2.18 — mint a per-deploy OPENCLAW_GATEWAY_TOKEN. OpenClaw
      // 2026.5.x refuses to start the gateway in container environments
      // without explicit auth ("Refusing to bind gateway to <bind>
      // without auth"). The 4.x flow auto-generated and persisted a
      // token in gateway.auth.token; 5.x removed that for security and
      // requires the operator to supply credentials. We mint a fresh
      // 32-byte hex token per deploy and inject as env so the runtime
      // satisfies the auth check without us baking a secret into the
      // openclaw.json that lives on the volume.
      const gatewayToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      // Sprint 2.18 #22 — push the per-agent hookToken as a Fly secret so
      // $HOOK_TOKEN actually resolves at curl time. Before today the token
      // was only baked as a literal into TOOLS.md, and curl commands
      // referencing $HOOK_TOKEN silently resolved to empty → 401 on every
      // POST. The literal got Maya to leak the secret to Telegram on run #10;
      // stripping the literal in commit ef673fb fixed the leak but broke
      // every callback. The right fix is what the system always claimed it
      // was doing: env-resolve only, no literal in workspace files.
      const agentForSecret = await ctx.runQuery(
        internal.onboarding.gtm.deployMayaGtm.getGtmAgentForDeploy,
        { agentId: args.agentId }
      );
      const hookTokenForFly = agentForSecret?.agent.hookToken;
      if (!hookTokenForFly) {
        return fail(
          "set-secrets",
          `gtmAgent ${args.agentId} has no hookToken at deploy time — ensureGtmAgentHookToken should have minted one earlier`,
          false
        );
      }
      // Sprint 2.26 — per-operator Telegram bot. If the operator has
      // pasted their own bot token (via setPersonalTelegramBot), use it.
      // Otherwise fall back to the shared dev/test bot in env (multi-
      // tenant prod hardening will surface this as a productionReadiness
      // warning).
      const personalBot = await ctx.runQuery(
        internal.gtmMaya.telegramBotPerTenant.getDecryptedBotToken,
        { agentId: args.agentId }
      );
      const sharedTelegramSecrets = collectDeploySecrets();
      const telegramBotToken =
        personalBot.token ?? sharedTelegramSecrets.TELEGRAM_BOT_TOKEN;
      await fly.setAppSecrets(bundle.flyAppName, {
        ...sharedTelegramSecrets,
        OPENCLAW_GATEWAY_TOKEN: gatewayToken,
        HOOK_TOKEN: hookTokenForFly,
        ...(telegramBotToken
          ? { TELEGRAM_BOT_TOKEN: telegramBotToken }
          : {}),
      });
      if (personalBot.token) {
        console.log(
          `[deployMayaGtm] using per-tenant Telegram bot for agent ${args.agentId} (source: per_tenant)`
        );
      } else if (sharedTelegramSecrets.TELEGRAM_BOT_TOKEN) {
        console.warn(
          `[deployMayaGtm] using shared Telegram bot fallback for agent ${args.agentId} — operator should call setPersonalTelegramBot before prod`
        );
      } else {
        console.warn(
          `[deployMayaGtm] NO Telegram bot token for agent ${args.agentId} — outbound delivery will fail`
        );
      }
    } catch (err) {
      return fail("set-secrets", (err as Error).message, isRetryable(err));
    }

    // Sprint 2.16u-fix17 — allocate public IPs so <flyApp>.fly.dev resolves.
    // Apps created via machines API have no public DNS by default. Telegram
    // setWebhook needs to resolve the host to register the URL.
    if (row.agent.telegramChatId) {
      try {
        await fly.allocateSharedV4(bundle.flyAppName);
        await fly.allocateV6(bundle.flyAppName);
      } catch (err) {
        // Idempotent — if IPs are already allocated, ignore "already exists"
        const msg = (err as Error).message;
        if (!msg.includes("already") && !msg.includes("duplicate")) {
          return fail("allocate-ips", msg, isRetryable(err));
        }
      }
    }

    // Sprint 2.16u-fix17 — mint a per-machine webhook secret. OpenClaw's
    // telegram channel uses this to verify incoming webhook signatures
    // (X-Telegram-Bot-Api-Secret-Token header). 32 hex bytes is plenty.
    const telegramWebhookSecret = row.agent.telegramChatId
      ? Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
      : undefined;

    // Sprint 2.16u-fix18 — register the Telegram webhook from CONVEX,
    // not from OpenClaw on Fly. Fly's outbound network to api.telegram.org
    // is unreliable; setWebhook from inside the Fly machine fails with
    // "Network request for 'setWebhook' failed!" (verified live
    // 2026-05-27 on clawlaunch-ws74j011acjqk48b7s).
    //
    // Convex's network → api.telegram.org IS reliable (verified earlier
    // — direct sendMessage curl from Convex worked instantly with
    // message_id 129). So we register the webhook here once, idempotent.
    if (row.agent.telegramChatId && telegramWebhookSecret) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return fail(
          "set-telegram-webhook",
          "TELEGRAM_BOT_TOKEN env var missing — required for Sprint 2.16u-fix18 webhook registration",
          false
        );
      }
      const webhookUrl = `https://${bundle.flyAppName}.fly.dev/telegram-webhook`;
      try {
        const swRes = await fetch(
          `https://api.telegram.org/bot${botToken}/setWebhook`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              url: webhookUrl,
              secret_token: telegramWebhookSecret,
              drop_pending_updates: true,
            }),
          }
        );
        const swBody = (await swRes.json()) as { ok?: boolean; description?: string };
        if (!swRes.ok || !swBody.ok) {
          return fail(
            "set-telegram-webhook",
            `Telegram setWebhook returned ${swRes.status}: ${swBody.description ?? "unknown"}`,
            swRes.status >= 500
          );
        }
        console.log(`[deployMayaGtm] registered Telegram webhook → ${webhookUrl}`);
      } catch (err) {
        return fail("set-telegram-webhook", (err as Error).message, true);
      }
    }

    // #15 deploy-harness hardening — DESTROY any existing machine on this app
    // BEFORE creating a new one. A redeploy used to leave the old machine
    // running, so two machines = two HEARTBEAT watchdogs = doubled work (a
    // direct contributor to the re-doing loop: two foundation passes, two sets
    // of crons). Idempotent + best-effort: list, force-destroy each, never let a
    // teardown error block the fresh deploy (the new machine + the durable
    // foundation lease are the real guards).
    try {
      const existing = await fly.listMachines(bundle.flyAppName);
      for (const m of existing) {
        try {
          await fly.destroyMachine(bundle.flyAppName, m.id, { force: true });
          console.log(
            `[deployMayaGtm] destroyed stale machine ${m.id} on ${bundle.flyAppName} before redeploy`
          );
        } catch (err) {
          console.warn(
            `[deployMayaGtm] could not destroy stale machine ${m.id}: ${(err as Error).message}`
          );
        }
      }
    } catch (err) {
      console.warn(
        `[deployMayaGtm] listMachines pre-destroy failed (continuing): ${(err as Error).message}`
      );
    }

    let machine;
    try {
      machine = await fly.createMachine({
        appName: bundle.flyAppName,
        name: bundle.flyAppName,
        config: buildGtmMachineConfig({
          agentId: args.agentId,
          flyAppName: bundle.flyAppName,
          workspaceBundleUrl: bundle.workspaceBundleUrl,
          pluginBundleUrl: bundle.pluginBundleUrl,
          telegramChatId: row.agent.telegramChatId,
          telegramWebhookSecret,
        }),
      });
    } catch (err) {
      return fail("create-machine", (err as Error).message, isRetryable(err));
    }

    let final = machine;
    if (machine.state !== "started") {
      try {
        final = await fly.waitForState(
          bundle.flyAppName,
          machine.id,
          "started",
          { timeoutMs: WAIT_TIMEOUT_MS, intervalMs: WAIT_INTERVAL_MS }
        );
      } catch (err) {
        return fail("wait-for-state", (err as Error).message, isRetryable(err));
      }
    }

    // Sprint 2.18 #40 — Convex stub hello PERMANENTLY REMOVED.
    // Operator (twice — Sprint #37 + #40): "Convex should never send
    // messages to the operator. Only when Maya boots up via OpenClaw."
    // This is an architectural invariant, not a tunable. If Maya
    // doesn't send the hello, fix Maya's prompt — never substitute
    // Convex-side hardcoded text.
    await ctx.runMutation(
      internal.onboarding.gtm.deployMayaGtm.recordDeployTimeHelloResult,
      { agentId: args.agentId, result: "skipped:openclaw_owns_all_operator_comms" }
    );

    try {
      await ctx.runMutation(
        internal.onboarding.gtm.deployMayaGtm.patchGtmAgentOnDeploySuccess,
        {
          agentId: args.agentId,
          openClawFlyAppId: bundle.flyAppName,
        }
      );
    } catch (err) {
      return fail("patch-agent", (err as Error).message, true);
    }

    // Server-truth analytics: the agent is live. Terminal step of the
    // onboarding funnel in PostHog. Best-effort; never fails the deploy.
    try {
      const accountId = row.agent.accountId;
      const distinctId = await ctx.runQuery(
        internal.gtmMaya.openclaw.conversationCapture.getAccountDistinctId,
        { accountId }
      );
      await capturePosthogEvent({
        distinctId,
        event: "agent_deployed",
        properties: {
          account_id: accountId,
          fly_app_id: bundle.flyAppName,
          duration_ms: Date.now() - startedAt,
        },
      });
    } catch {
      // analytics is non-critical
    }

    return {
      ok: true,
      stage: "complete",
      flyAppId: bundle.flyAppName,
      machineId: final.id,
      durationMs: Date.now() - startedAt,
    };
  },
});

export const runMyGtmDeploy = action({
  args: {},
  handler: async (ctx: ActionCtx): Promise<DeployMayaGtmResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        ok: false,
        stage: "load-agent",
        message: "runMyGtmDeploy: signed-in Clerk user required.",
        retryable: false,
        durationMs: 0,
      };
    }
    const creator = await ctx.runQuery(internal.gtmMaya.researchLifecycle.getGtmCreatorForDeploy, {
      clerkUserId: identity.subject,
    });
    if (!creator?.agentId) {
      return {
        ok: false,
        stage: "load-agent",
        message: "runMyGtmDeploy: no GTM agent row for signed-in user.",
        retryable: false,
        durationMs: 0,
      };
    }
    return await ctx.runAction(internal.onboarding.gtm.deployMayaGtm.deployMayaGtm, {
      agentId: creator.agentId,
    });
  },
});

export function buildGtmMachineConfig(input: {
  agentId: Id<"gtmAgents"> | string;
  flyAppName: string;
  workspaceBundleUrl: string;
  /** Typed-tool plugin tarball (Convex storage URL). The bootstrap installs
   *  it via `openclaw plugins install npm-pack:<tgz>` before gateway start so
   *  Maya + her subagents persist/research through schema-validated tools
   *  instead of hand-written curl. */
  pluginBundleUrl?: string;
  /** Sprint 1.3 — passed through to buildGatewayConfig so the OpenClaw
   *  channels.telegram adapter is enabled with allowlist scoped to this
   *  user. Pre-pairing agents pass undefined; the channel is omitted. */
  telegramChatId?: string;
  /** Sprint 2.16u-fix17 — webhook secret. Random 32-byte hex per machine
   *  used for Telegram signature verification. Convex deploy action mints
   *  this + passes it down; OpenClaw config uses it; setWebhook registers
   *  it with Telegram. Per docs/channels/telegram.md webhook mode. */
  telegramWebhookSecret?: string;
}): FlyMachineConfig {
  return {
    image: OPENCLAW_IMAGE,
    env: {
      OPENCLAW_STATE_DIR: "/data",
      OPENCLAW_CONFIG_PATH: "/data/openclaw.json",
      // 2026-05-30 — force IPv4-first DNS so outbound to api.telegram.org is
      // reliable. Root cause of the intermittent "sendMessage failed /
      // DNS-resolved IP unreachable" reply failures: Fly's IPv6 egress to
      // Telegram is flaky, while IPv4 egress (NAT) is reliable. Node's
      // --dns-result-order=ipv4first makes the telegram plugin's fetch resolve
      // IPv4 first (falls back to IPv6 if IPv4 fails — safe, reversible). This
      // lets OpenClaw own the reply send natively instead of proxying through
      // Convex. Research reads (ScrapeCreators/TwitterAPI) already worked, so
      // this is scoped to the Telegram-host quirk, not general egress.
      NODE_OPTIONS: "--dns-result-order=ipv4first",
      // Sprint 2.14a.8 — point OpenClaw at the pre-installed
      // pi-coding-agent + Bedrock SDK + companions baked into the
      // Docker image at /opt/openclaw-runtime-preseed (Dockerfile
      // lines 62-80). Without this, OpenClaw npm-installs the deps
      // on first agent turn — observed ~28 min cold-start latency
      // live on 2026-05-25 that triggered the 12-min LLM timeout.
      // The creator-product deployMaya.ts uses the same env var
      // (line 295).
      OPENCLAW_PLUGIN_STAGE_DIR: "/opt/openclaw-runtime-preseed/plugin-runtime-deps",
      // Sprint 2.15.5 — REVERTED OPENCLAW_PREFER_PNPM. Operator
      // verified live 2026-05-25 that the prior deploys (before this
      // env var) worked. Adding PREFER_PNPM correlates with Fly
      // machine getting stuck in "created" state and never reaching
      // "started" within the deployMayaGtm 180s wait window. Best
      // guess: the env var changes OpenClaw's package-manager
      // selection in a way that affects gateway bind/startup timing.
      // Diagnostic deferred to Sprint 2.16; for now stick with what
      // works.
      MAYA_GTM_AGENT_ID: String(input.agentId),
      MAYA_GTM_APP_NAME: input.flyAppName,
      MAYA_WORKSPACE_BUNDLE_URL: input.workspaceBundleUrl,
      // Typed-tool plugin tarball — the bootstrap installs it via
      // `openclaw plugins install npm-pack:` before the gateway starts.
      ...(input.pluginBundleUrl
        ? { MAYA_PLUGIN_BUNDLE_URL: input.pluginBundleUrl }
        : {}),
      OPENCLAW_MODEL: toOpenClawModelRef(MODEL_ROUTING.mainMaya),
      OPENCLAW_DISABLE_BONJOUR: "1",
      MAYA_GTM_MODEL_ROUTING_JSON: JSON.stringify(MODEL_ROUTING),
      MAYA_BOOTSTRAP_JSON: JSON.stringify({
        agentId: String(input.agentId),
        product: "clawlaunch-gtm",
        flyAppName: input.flyAppName,
        workspaceBundleUrl: input.workspaceBundleUrl,
        modelRouting: MODEL_ROUTING,
        directPingSmoke: true,
        gatewayConfig: buildGatewayConfig({
          telegramChatId: input.telegramChatId,
          // Sprint 2.16u-fix17 — webhook URL is deterministic from the
          // Fly app name. Telegram POSTs to https://<app>.fly.dev:443/
          // telegram-webhook → Fly proxy → internal 8787 → OpenClaw.
          telegramWebhookUrl: input.telegramWebhookSecret
            ? `https://${input.flyAppName}.fly.dev/telegram-webhook`
            : undefined,
          telegramWebhookSecret: input.telegramWebhookSecret,
        }),
      }),
    },
    guest: MACHINE_GUEST,
    restart: { policy: "always" },
    // Sprint 2.16u-fix17 — services block exposes OpenClaw's Telegram
    // webhook port (8787) publicly so Telegram can push updates to this
    // machine. Per docs/channels/telegram.md "Long polling vs webhook":
    // webhookHost:0.0.0.0 + webhookPort:8787 + Fly proxy → https://<flyApp>.fly.dev
    // routes external 443 traffic to internal 8787.
    //
    // Gateway WebSocket port (18789) stays loopback-only (no controlUi
    // exposure on the public internet — only the webhook surface).
    services: [
      {
        protocol: "tcp" as const,
        internal_port: 8787,
        ports: [
          { port: 443, handlers: ["tls" as const, "http" as const] },
          { port: 80, handlers: ["http" as const] },
        ],
      },
    ],
    metadata: {
      agent_id: String(input.agentId),
      kind: "maya-gtm",
      schema_version: "1",
    },
    init: {
      cmd: ["/bin/sh", "-c", buildBootstrapShell()],
    },
  };
}

export function flyAppNameForGtmAgent(agentId: Id<"gtmAgents"> | string): string {
  const short = String(agentId)
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .slice(0, 18);
  return `clawlaunch-${short}`;
}

function buildBootstrapShell(): string {
  return [
    "mkdir -p /data/workspace /data/cron",
    'curl -fsSL "$MAYA_WORKSPACE_BUNDLE_URL" -o /tmp/workspace.tar',
    // Sprint 1.4 diagnostic — capture workspace state at every stage so we
    // can see when files vanish. Bug observed 2026-05-24: 6 of 12 root .md
    // files (AGENTS, APP, GTM, BOOT, HEARTBEAT, DREAMING) disappear between
    // tar-extract and openclaw startup; manually re-extracting after gateway
    // is up restores them. Hypothesis: race between tar-extract and
    // openclaw's own workspace initialization.
    'echo "[bootstrap] tar size: $(wc -c < /tmp/workspace.tar)"',
    "tar -xf /tmp/workspace.tar -C /data/workspace",
    'echo "[bootstrap] post-tar root files:" && ls /data/workspace/ | sort | tr "\\n" " " && echo',
    // Sprint 1.4 defensive — re-extract a second time after a 1s pause to
    // overwrite any files that vanished. tar's default is to overwrite, so
    // this is safe if all 12 files survived the first extract.
    "sleep 1",
    "tar -xf /tmp/workspace.tar -C /data/workspace",
    'echo "[bootstrap] post-reextract root files:" && ls /data/workspace/ | sort | tr "\\n" " " && echo',
    "if [ -f /data/workspace/jobs.json ]; then cp /data/workspace/jobs.json /data/cron/jobs.json; fi",
    "chmod 700 /data/cron",
    "chmod 600 /data/cron/jobs.json",
    'echo "$MAYA_BOOTSTRAP_JSON" | jq .gatewayConfig > /data/openclaw.json',
    // Install the typed-tool plugin (maya-gtm-tools) BEFORE the gateway starts.
    // npm-pack uses OpenClaw's managed install root (~/.openclaw/npm = /data/
    // .openclaw/npm here, HOME=/data), which resolves typebox + the openclaw
    // peer correctly. The plugin id is already in the config's plugins.allow,
    // so a fresh /data volume just needs the package + its install record.
    // `|| echo WARN` keeps the boot chain alive if install fails — the gateway
    // still starts (degraded) and the failure is visible in `flyctl logs`.
    'if [ -n "$MAYA_PLUGIN_BUNDLE_URL" ]; then ' +
      'curl -fsSL "$MAYA_PLUGIN_BUNDLE_URL" -o /tmp/maya-gtm-tools.tgz && ' +
      'echo "[bootstrap] installing maya-gtm-tools plugin..." && ' +
      'openclaw plugins install "npm-pack:/tmp/maya-gtm-tools.tgz" --force 2>&1 | tail -30 ' +
      '|| echo "[bootstrap] WARN maya-gtm-tools plugin install failed — gateway will start without typed tools"; ' +
      'else echo "[bootstrap] WARN no MAYA_PLUGIN_BUNDLE_URL — skipping typed-tool plugin"; fi',
    'echo "[bootstrap] launching openclaw gateway..."',
    // Sprint 2.18 — `--bind lan` is REQUIRED in OpenClaw 2026.5.x
    // container environments. Without it, the gateway defaults to
    // bind=auto (0.0.0.0) and 5.x refuses to start with "Refusing to
    // bind gateway to auto without auth." (security hardening, no
    // longer auto-generates a token). We bind to LAN-only since the
    // gateway is internal to the Fly machine — the Telegram webhook
    // is the only public surface, and that's listening on a separate
    // port via the channel config.
    "exec openclaw gateway --bind lan --allow-unconfigured",
  ].join(" && ");
}

export function collectDeploySecrets(
  env: Partial<Record<string, string | undefined>> = process.env
): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const key of [
    "CONVEX_URL",
    "CONVEX_SITE_URL",
    "COMPOSIO_API_KEY",
    "SCRAPE_CREATORS_API_KEY",
    "SCRAPECREATORS_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "OPENROUTER_API_KEY",
    "ENCRYPTION_KEY",
    // Sprint 1.3 — without TELEGRAM_BOT_TOKEN reaching the Fly machine,
    // OpenClaw's native channels.telegram adapter can't authenticate and
    // delivery silently fails (cron's `delivery.mode: announce, channel:
    // telegram` drops with no recipient). Verified live 2026-05-24:
    // synth Maya booted with 0 channels because token wasn't propagated.
    "TELEGRAM_BOT_TOKEN",
    // Sprint 1.1 — TwitterAPI.io is now the X keyword-search backend (the
    // Convex-side wrapper calls it from researchWorker, but Maya's runtime
    // skills may also reference it via the kaitoInfra/twitterapi-io skill
    // once pinned, so secret needs to be available on the machine too).
    "TWITTERAPI_IO_KEY",
    "APIFY_API_TOKEN",
  ]) {
    const value = env[key];
    if (value) secrets[key] = value;
  }
  if (!secrets.SCRAPE_CREATORS_API_KEY && env.SCRAPECREATORS_API_KEY) {
    secrets.SCRAPE_CREATORS_API_KEY = env.SCRAPECREATORS_API_KEY;
  }
  if (!secrets.SCRAPECREATORS_API_KEY && env.SCRAPE_CREATORS_API_KEY) {
    secrets.SCRAPECREATORS_API_KEY = env.SCRAPE_CREATORS_API_KEY;
  }
  if (!secrets.GEMINI_API_KEY && env.GOOGLE_GENERATIVE_AI_API_KEY) {
    secrets.GEMINI_API_KEY = env.GOOGLE_GENERATIVE_AI_API_KEY;
  }
  if (!secrets.GOOGLE_GENERATIVE_AI_API_KEY && env.GEMINI_API_KEY) {
    secrets.GOOGLE_GENERATIVE_AI_API_KEY = env.GEMINI_API_KEY;
  }
  const stage = (env.CONVEX_DEPLOYMENT ?? "").includes("precise-canary-781")
    ? "staging"
    : "production";
  const stageTelegramToken =
    stage === "staging"
      ? env.TELEGRAM_BOT_TOKEN_STAGING
      : env.TELEGRAM_BOT_TOKEN_PRODUCTION;
  if (stageTelegramToken) {
    secrets.TELEGRAM_BOT_TOKEN = stageTelegramToken;
  }
  return secrets;
}

function toOpenClawModelRef(model: string): string {
  if (model.includes("/")) {
    return model.startsWith("openrouter/") ? model : `openrouter/${model}`;
  }
  return model;
}

function buildPosixTar(files: Map<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const [name, content] of files) {
    const data = enc.encode(content);
    blocks.push(buildTarHeader(name, data.length));
    blocks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad > 0) blocks.push(new Uint8Array(pad));
  }
  blocks.push(new Uint8Array(1024));
  let total = 0;
  for (const block of blocks) total += block.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out;
}

function buildTarHeader(name: string, size: number): Uint8Array {
  const buf = new Uint8Array(512);
  const enc = new TextEncoder();
  const writeAscii = (value: string, offset: number, len: number): void => {
    const bytes = enc.encode(value);
    buf.set(bytes.subarray(0, Math.min(bytes.length, len)), offset);
  };
  if (name.length > 100) {
    throw new Error(`filename too long for USTAR: ${name}`);
  }
  writeAscii(name, 0, 100);
  writeAscii("0000644", 100, 7);
  writeAscii("0000000", 108, 7);
  writeAscii("0000000", 116, 7);
  writeAscii(size.toString(8).padStart(11, "0"), 124, 11);
  writeAscii("00000000000", 136, 11);
  for (let i = 148; i < 156; i++) buf[i] = 0x20;
  writeAscii("0", 156, 1);
  writeAscii("ustar", 257, 5);
  writeAscii("00", 263, 2);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  writeAscii(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return buf;
}

let __injectedFlyClient: FlyClient | null = null;
export function __setMayaGtmFlyClient(client: FlyClient | null): void {
  __injectedFlyClient = client;
}

function newFlyClient(): FlyClient {
  if (__injectedFlyClient) return __injectedFlyClient;
  return new FlyClient();
}

function isAlreadyExists(err: unknown): boolean {
  if (!(err instanceof FlyError)) return false;
  if (err.status !== 422 && err.status !== 409) return false;
  const text = (err.body ?? "").toLowerCase();
  return text.includes("already") || text.includes("exists") || text.includes("taken");
}

function isRetryable(err: unknown): boolean {
  if (err instanceof FlyError) return err.retryable;
  return false;
}
