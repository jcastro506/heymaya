/**
 * Sprint 2.17 Phase A — manager-mode HTTP handlers.
 *
 * Bearer-token authed (hookToken). Mirror the established pattern from
 * inboundCallback.ts:
 *   1. authenticate() → agentId + accountId from token
 *   2. JSON parse + field validation
 *   3. claimIdempotencyKey() → reject replays
 *   4. dispatch to managerStore mutation (or read query for GETs)
 *   5. 200 / 4xx response
 *
 * Cross-tenant safety: the body NEVER names agentId/accountId. They
 * come from the authenticated token, and the underlying mutation
 * re-verifies via assertAgentBelongsToAccount.
 */

import { httpAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { authenticate } from "./inboundCallback";

// ───────────────────── Foundation: buyer map ─────────────────────

interface FoundationBuyerMapPayload {
  idempotencyKey: string;
  icpDescription: string;
  buyerJourneyStages: Array<{
    stage: string;
    whereTheyHangOut: string;
    intentLanguage: string;
  }>;
  intentPhrases: string[];
  trustedVoices: Array<{
    handle: string;
    platform: string;
    whyTrusted: string;
  }>;
}

export const foundationBuyerMapHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: FoundationBuyerMapPayload;
  try {
    body = (await request.json()) as FoundationBuyerMapPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    typeof body.icpDescription !== "string" ||
    !body.icpDescription.trim() ||
    !Array.isArray(body.buyerJourneyStages) ||
    !Array.isArray(body.intentPhrases) ||
    !Array.isArray(body.trustedVoices)
  ) {
    return new Response("missing required fields", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "foundation_buyer_map",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  try {
    await ctx.runMutation(internal.gtmMaya.managerStore.upsertBuyerMap, {
      accountId: auth.accountId,
      agentId: auth.agentId,
      icpDescription: body.icpDescription,
      buyerJourneyStages: body.buyerJourneyStages,
      intentPhrases: body.intentPhrases,
      trustedVoices: body.trustedVoices,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

// ───────────────────── Foundation: competitor ─────────────────────

interface FoundationCompetitorPayload {
  idempotencyKey: string;
  competitorKey: string;
  competitorName: string;
  kind: "direct" | "adjacent" | "substitute";
  url?: string;
  pricing?: string;
  positioning: string;
  complaints: Array<{ quote: string; sourceUrl: string }>;
  vulnerabilities: string[];
}

export const foundationCompetitorHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: FoundationCompetitorPayload;
  try {
    body = (await request.json()) as FoundationCompetitorPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !body.competitorKey ||
    !body.competitorName ||
    !body.kind ||
    !["direct", "adjacent", "substitute"].includes(body.kind) ||
    typeof body.positioning !== "string" ||
    !Array.isArray(body.complaints) ||
    !Array.isArray(body.vulnerabilities)
  ) {
    return new Response("missing required fields", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "foundation_competitor",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  try {
    await ctx.runMutation(internal.gtmMaya.managerStore.upsertCompetitor, {
      accountId: auth.accountId,
      agentId: auth.agentId,
      competitorKey: body.competitorKey.toLowerCase().trim(),
      competitorName: body.competitorName,
      kind: body.kind,
      url: body.url,
      pricing: body.pricing,
      positioning: body.positioning,
      complaints: body.complaints,
      vulnerabilities: body.vulnerabilities,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

// ───────────────────── Foundation: channel scorecard ─────────────────────

const CHANNEL_VALUES = [
  "reddit",
  "x",
  "hn",
  "linkedin",
  "youtube",
  "tiktok",
  "instagram",
  "threads",
  "podcasts",
  "newsletters",
  "discord",
  "blog",
] as const;
type Channel = (typeof CHANNEL_VALUES)[number];
function isChannel(s: unknown): s is Channel {
  return typeof s === "string" && (CHANNEL_VALUES as readonly string[]).includes(s);
}

interface FoundationChannelPayload {
  idempotencyKey: string;
  channel: string;
  audienceFit: number;
  cadenceFit: number;
  uniqueUnlock: string;
  bet: boolean;
  notes?: string;
}

export const foundationChannelScorecardHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: FoundationChannelPayload;
  try {
    body = (await request.json()) as FoundationChannelPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !isChannel(body.channel) ||
    typeof body.audienceFit !== "number" ||
    typeof body.cadenceFit !== "number" ||
    typeof body.uniqueUnlock !== "string" ||
    typeof body.bet !== "boolean"
  ) {
    return new Response("missing required fields", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "foundation_channel_scorecard",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  try {
    await ctx.runMutation(
      internal.gtmMaya.managerStore.upsertChannelScorecard,
      {
        accountId: auth.accountId,
        agentId: auth.agentId,
        channel: body.channel,
        audienceFit: body.audienceFit,
        cadenceFit: body.cadenceFit,
        uniqueUnlock: body.uniqueUnlock,
        bet: body.bet,
        notes: body.notes,
      }
    );
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

// ───────────────────── Foundation: content angle ─────────────────────

interface FoundationContentAnglePayload {
  idempotencyKey: string;
  angleKey: string;
  angle: string;
  painCitation: { quote: string; sourceUrl: string };
  hookVariants: string[];
  voiceCheck?: string;
}

export const foundationContentAngleHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: FoundationContentAnglePayload;
  try {
    body = (await request.json()) as FoundationContentAnglePayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !body.angleKey ||
    !body.angle ||
    !body.painCitation?.quote ||
    !body.painCitation?.sourceUrl ||
    !Array.isArray(body.hookVariants) ||
    body.hookVariants.length === 0
  ) {
    return new Response("missing required fields", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "foundation_content_angle",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  try {
    await ctx.runMutation(internal.gtmMaya.managerStore.upsertContentAngle, {
      accountId: auth.accountId,
      agentId: auth.agentId,
      angleKey: body.angleKey.toLowerCase().trim(),
      angle: body.angle,
      painCitation: body.painCitation,
      hookVariants: body.hookVariants,
      voiceCheck: body.voiceCheck,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

// ───────────────────── Foundation: relationship target ─────────────────────

const RELATIONSHIP_PLATFORM_VALUES = [
  "reddit",
  "x",
  "hn",
  "linkedin",
  "instagram",
  "tiktok",
  "youtube",
  "threads",
] as const;
type RelationshipPlatform = (typeof RELATIONSHIP_PLATFORM_VALUES)[number];
function isRelationshipPlatform(s: unknown): s is RelationshipPlatform {
  return (
    typeof s === "string" &&
    (RELATIONSHIP_PLATFORM_VALUES as readonly string[]).includes(s)
  );
}

interface FoundationRelationshipPayload {
  idempotencyKey: string;
  platform: string;
  handle: string;
  displayName?: string;
  profileUrl?: string;
  whyThem: string;
  engagementPlan: string;
  cadence: "weekly" | "monthly" | "as_they_post";
  status?: "prospect" | "warming" | "engaged" | "reciprocal" | "dropped";
}

export const foundationRelationshipHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: FoundationRelationshipPayload;
  try {
    body = (await request.json()) as FoundationRelationshipPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !isRelationshipPlatform(body.platform) ||
    !body.handle ||
    !body.whyThem ||
    !body.engagementPlan ||
    !["weekly", "monthly", "as_they_post"].includes(body.cadence)
  ) {
    return new Response("missing required fields", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "foundation_relationship_target",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  try {
    await ctx.runMutation(
      internal.gtmMaya.managerStore.upsertRelationshipTarget,
      {
        accountId: auth.accountId,
        agentId: auth.agentId,
        platform: body.platform,
        handle: body.handle,
        displayName: body.displayName,
        profileUrl: body.profileUrl,
        whyThem: body.whyThem,
        engagementPlan: body.engagementPlan,
        cadence: body.cadence,
        status: body.status,
      }
    );
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

// ───────────────────── Continuous: competitor move ─────────────────────

interface CompetitorMovePayload {
  idempotencyKey: string;
  competitorName: string;
  moveKind:
    | "feature_ship"
    | "campaign"
    | "milestone"
    | "pricing_change"
    | "partnership"
    | "incident";
  summary: string;
  sourceUrl: string;
  observedAt: number;
  recommendedCounter?: string;
}

const COMPETITOR_MOVE_KINDS = [
  "feature_ship",
  "campaign",
  "milestone",
  "pricing_change",
  "partnership",
  "incident",
] as const;

export const competitorMoveHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: CompetitorMovePayload;
  try {
    body = (await request.json()) as CompetitorMovePayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !body.competitorName ||
    !(COMPETITOR_MOVE_KINDS as readonly string[]).includes(body.moveKind) ||
    !body.summary ||
    !body.sourceUrl ||
    typeof body.observedAt !== "number"
  ) {
    return new Response("missing required fields", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "competitor_move",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  try {
    await ctx.runMutation(
      internal.gtmMaya.managerStore.recordCompetitorMove,
      {
        accountId: auth.accountId,
        agentId: auth.agentId,
        competitorName: body.competitorName,
        moveKind: body.moveKind,
        summary: body.summary,
        sourceUrl: body.sourceUrl,
        observedAt: body.observedAt,
        recommendedCounter: body.recommendedCounter,
      }
    );
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

// ───────────────────── Continuous: niche pulse signal ─────────────────────

interface NichePulsePayload {
  idempotencyKey: string;
  pulseKind:
    | "new_community"
    | "rising_account"
    | "rising_keyword"
    | "rising_topic"
    | "declining_signal";
  name: string;
  platform?: string;
  evidenceUrl: string;
  momentumSignal: string;
  observedAt: number;
  relevance: "act_now" | "monitor" | "noise";
}

const PULSE_KINDS = [
  "new_community",
  "rising_account",
  "rising_keyword",
  "rising_topic",
  "declining_signal",
] as const;

export const nichePulseSignalHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: NichePulsePayload;
  try {
    body = (await request.json()) as NichePulsePayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !(PULSE_KINDS as readonly string[]).includes(body.pulseKind) ||
    !body.name ||
    !body.evidenceUrl ||
    !body.momentumSignal ||
    typeof body.observedAt !== "number" ||
    !["act_now", "monitor", "noise"].includes(body.relevance)
  ) {
    return new Response("missing required fields", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "niche_pulse_signal",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  try {
    await ctx.runMutation(internal.gtmMaya.managerStore.recordNichePulse, {
      accountId: auth.accountId,
      agentId: auth.agentId,
      pulseKind: body.pulseKind,
      name: body.name,
      platform: body.platform,
      evidenceUrl: body.evidenceUrl,
      momentumSignal: body.momentumSignal,
      observedAt: body.observedAt,
      relevance: body.relevance,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

// ───────────────────── Continuous: action log ─────────────────────

const ACTION_KINDS = [
  "morning_brief",
  "evening_recap",
  "weekly_review",
  "monthly_reset",
  "hot_alert",
  "inbound_triage",
  "calendar_event_created",
  "draft_proposed",
  "foundation_complete",
  "competitor_move_alert",
  "niche_pulse_alert",
  "other",
] as const;
type ActionKind = (typeof ACTION_KINDS)[number];
function isActionKind(s: unknown): s is ActionKind {
  return typeof s === "string" && (ACTION_KINDS as readonly string[]).includes(s);
}

const ACTION_RESPONSES = [
  "pending",
  "acknowledged",
  "acted",
  "ignored",
  "dismissed",
] as const;
type ActionResponse = (typeof ACTION_RESPONSES)[number];

interface ActionLogPayload {
  idempotencyKey: string;
  kind: string;
  summary: string;
  linkedEntities?: Array<{ entityKind: string; entityId: string }>;
  sentAt: number;
  userResponse?: ActionResponse;
  outcomeNotes?: string;
}

export const actionLoggedHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: ActionLogPayload;
  try {
    body = (await request.json()) as ActionLogPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !isActionKind(body.kind) ||
    !body.summary ||
    typeof body.sentAt !== "number"
  ) {
    return new Response("missing required fields", { status: 400 });
  }
  if (
    body.userResponse !== undefined &&
    !(ACTION_RESPONSES as readonly string[]).includes(body.userResponse)
  ) {
    return new Response("invalid userResponse", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "action_logged",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  try {
    await ctx.runMutation(internal.gtmMaya.managerStore.recordActionLog, {
      accountId: auth.accountId,
      agentId: auth.agentId,
      kind: body.kind,
      summary: body.summary,
      linkedEntities: body.linkedEntities,
      sentAt: body.sentAt,
      userResponse: body.userResponse,
      outcomeNotes: body.outcomeNotes,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

// ───────────────────── Continuous: niche learning ─────────────────────

const LEARNING_KINDS = [
  "timing",
  "channel_priority",
  "voice_angle",
  "community_quality",
  "format_preference",
  "hook_pattern",
  "other",
] as const;
type LearningKind = (typeof LEARNING_KINDS)[number];
function isLearningKind(s: unknown): s is LearningKind {
  return typeof s === "string" && (LEARNING_KINDS as readonly string[]).includes(s);
}

interface LearningExtractedPayload {
  idempotencyKey: string;
  learningKey: string;
  learningKind: string;
  learning: string;
  confidenceScore: number;
  evidenceCount?: number;
  retired?: boolean;
}

export const learningExtractedHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: LearningExtractedPayload;
  try {
    body = (await request.json()) as LearningExtractedPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !body.learningKey ||
    !isLearningKind(body.learningKind) ||
    !body.learning ||
    typeof body.confidenceScore !== "number"
  ) {
    return new Response("missing required fields", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "learning_extracted",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  try {
    await ctx.runMutation(internal.gtmMaya.managerStore.upsertNicheLearning, {
      accountId: auth.accountId,
      agentId: auth.agentId,
      learningKey: body.learningKey.toLowerCase().trim(),
      learningKind: body.learningKind,
      learning: body.learning,
      confidenceScore: body.confidenceScore,
      evidenceCount: body.evidenceCount,
      retired: body.retired,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

// ───────────────────── Read endpoints ─────────────────────

/** One-shot read of all five foundation outputs. Maya's BOOT.md and
 *  morning-brief skill curl this to pull her operating model. */
export const getMyFoundationHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const foundation = await ctx.runQuery(
    internal.gtmMaya.managerStore.getMyFoundation,
    { agentId: auth.agentId }
  );
  return new Response(JSON.stringify(foundation), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

export const getMyCompetitorMovesHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const url = new URL(request.url);
  const sinceMs = parseIntParam(url.searchParams.get("since_ms"));
  const limit = parseIntParam(url.searchParams.get("limit"));

  const moves = await ctx.runQuery(
    internal.gtmMaya.managerStore.listCompetitorMoves,
    { agentId: auth.agentId, sinceMs, limit }
  );
  return new Response(JSON.stringify({ moves }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

export const getMyNichePulseHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const url = new URL(request.url);
  const sinceMs = parseIntParam(url.searchParams.get("since_ms"));
  const limit = parseIntParam(url.searchParams.get("limit"));
  const relevanceParam = url.searchParams.get("relevance");
  const relevance =
    relevanceParam === "act_now" ||
    relevanceParam === "monitor" ||
    relevanceParam === "noise"
      ? relevanceParam
      : undefined;

  const signals = await ctx.runQuery(
    internal.gtmMaya.managerStore.listNichePulse,
    { agentId: auth.agentId, sinceMs, limit, relevance }
  );
  return new Response(JSON.stringify({ signals }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

export const getMyActionLogHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const url = new URL(request.url);
  const sinceMs = parseIntParam(url.searchParams.get("since_ms"));
  const limit = parseIntParam(url.searchParams.get("limit"));
  const kindParam = url.searchParams.get("kind");
  const kind = isActionKind(kindParam) ? kindParam : undefined;

  const actions = await ctx.runQuery(
    internal.gtmMaya.managerStore.listActionLog,
    { agentId: auth.agentId, sinceMs, limit, kind }
  );
  return new Response(JSON.stringify({ actions }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

export const getMyNicheLearningsHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const url = new URL(request.url);
  const includeRetired = url.searchParams.get("include_retired") === "true";

  const learnings = await ctx.runQuery(
    internal.gtmMaya.managerStore.listNicheLearnings,
    { agentId: auth.agentId, includeRetired }
  );
  return new Response(JSON.stringify({ learnings }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

// ───────────────────── Helpers ─────────────────────

function parseIntParam(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
