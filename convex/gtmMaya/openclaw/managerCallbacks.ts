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
import type { Id } from "../../_generated/dataModel";
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
  // Sprint 2.18 — relaxed validation. Only idempotencyKey +
  // icpDescription are truly required; the rest default to [].
  // Maya's judgment layer (per maya-foundation-research SKILL.md
  // quality gates) catches thin output and steers the worker for
  // more — we don't enforce shape strictly at the HTTP edge.
  // Verified live: worker bounced 8+ times against strict validation
  // because the original task prompt's field enumeration was
  // ambiguous (intentPhrases is top-level vs nested in stages).
  if (
    !body.idempotencyKey ||
    typeof body.icpDescription !== "string" ||
    !body.icpDescription.trim()
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
      buyerJourneyStages: Array.isArray(body.buyerJourneyStages)
        ? body.buyerJourneyStages
        : [],
      intentPhrases: Array.isArray(body.intentPhrases) ? body.intentPhrases : [],
      trustedVoices: Array.isArray(body.trustedVoices) ? body.trustedVoices : [],
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
  // Sprint 2.18 — relaxed validation, see foundationBuyerMapHttp note.
  if (
    !body.idempotencyKey ||
    !body.competitorName ||
    !body.kind ||
    !["direct", "adjacent", "substitute"].includes(body.kind) ||
    typeof body.positioning !== "string"
  ) {
    return new Response("missing required fields", { status: 400 });
  }
  // Derive competitorKey from competitorName if missing — workers can
  // forget the lowercase-slug field but always have a name.
  const competitorKey = (body.competitorKey ?? body.competitorName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

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
      competitorKey,
      competitorName: body.competitorName,
      kind: body.kind,
      url: body.url,
      pricing: body.pricing,
      positioning: body.positioning,
      complaints: Array.isArray(body.complaints) ? body.complaints : [],
      vulnerabilities: Array.isArray(body.vulnerabilities)
        ? body.vulnerabilities
        : [],
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

// ───────────────────── Foundation: channel scorecard ─────────────────────

// Sprint 2.18 #46 — YouTube REMOVED from supported channels. Operator
// directive 2026-05-28: "we're not gonna focus on YouTube." Strip
// across product surface: schema enum, channel scorecard validator,
// playbook references, skills, TOOLS.md docs.
const CHANNEL_VALUES = [
  "reddit",
  "x",
  "hn",
  "linkedin",
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
  // Sprint 2.18 — relaxed: only channel + uniqueUnlock are mandatory.
  // Scores default to 0.5 if missing, bet defaults to false.
  if (
    !body.idempotencyKey ||
    !isChannel(body.channel) ||
    typeof body.uniqueUnlock !== "string"
  ) {
    return new Response("missing required fields", { status: 400 });
  }
  const audienceFit =
    typeof body.audienceFit === "number" ? body.audienceFit : 0.5;
  const cadenceFit =
    typeof body.cadenceFit === "number" ? body.cadenceFit : 0.5;
  const bet = typeof body.bet === "boolean" ? body.bet : false;

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
        audienceFit,
        cadenceFit,
        uniqueUnlock: body.uniqueUnlock,
        bet,
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
  // Sprint 2.18 — relaxed: angle + at least one hook variant.
  // angleKey derived from angle if missing. painCitation defaults to
  // a minimal stub if the worker forgot it — Maya's gate will catch.
  if (
    !body.idempotencyKey ||
    !body.angle ||
    !Array.isArray(body.hookVariants) ||
    body.hookVariants.length === 0
  ) {
    return new Response("missing required fields", { status: 400 });
  }
  const angleKey =
    body.angleKey ??
    body.angle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  const painCitation = body.painCitation ?? { quote: "", sourceUrl: "" };

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
      angleKey,
      angle: body.angle,
      painCitation,
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
  // Sprint 2.18 — relaxed: platform + handle + whyThem are mandatory.
  // engagementPlan + cadence default to stubs if missing — Maya's gate
  // catches sparse relationship rows on synthesis.
  if (
    !body.idempotencyKey ||
    !isRelationshipPlatform(body.platform) ||
    !body.handle ||
    !body.whyThem
  ) {
    return new Response("missing required fields", { status: 400 });
  }
  const engagementPlan =
    body.engagementPlan ?? "Reply weekly + retweet/quote when relevant.";
  const cadence =
    body.cadence && ["weekly", "monthly", "as_they_post"].includes(body.cadence)
      ? body.cadence
      : "weekly";

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
        engagementPlan,
        cadence,
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
  // Sprint 2.18 #8 — relaxed: competitorName + moveKind + sourceUrl required.
  if (
    !body.idempotencyKey ||
    !body.competitorName ||
    !(COMPETITOR_MOVE_KINDS as readonly string[]).includes(body.moveKind) ||
    !body.sourceUrl
  ) {
    return new Response("missing required fields", { status: 400 });
  }
  const summary = body.summary || `${body.competitorName} ${body.moveKind}`;
  const observedAt =
    typeof body.observedAt === "number" ? body.observedAt : Date.now();

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
        summary,
        sourceUrl: body.sourceUrl,
        observedAt,
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
  // Sprint 2.18 #8 — relaxed: pulseKind + name + evidenceUrl required.
  if (
    !body.idempotencyKey ||
    !(PULSE_KINDS as readonly string[]).includes(body.pulseKind) ||
    !body.name ||
    !body.evidenceUrl
  ) {
    return new Response("missing required fields", { status: 400 });
  }
  const momentumSignal = body.momentumSignal || "pending — Maya to fill in";
  const observedAtNiche =
    typeof body.observedAt === "number" ? body.observedAt : Date.now();
  const relevance =
    body.relevance && ["act_now", "monitor", "noise"].includes(body.relevance)
      ? body.relevance
      : "monitor";

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
      momentumSignal,
      observedAt: observedAtNiche,
      relevance,
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
  // Sprint 2.18 #8 — relaxed: kind + summary required. sentAt defaults to
  // now if missing. Invalid userResponse is coerced to "pending"
  // (the existing default in the mutation), no rejection.
  if (!body.idempotencyKey || !isActionKind(body.kind) || !body.summary) {
    return new Response("missing required fields", { status: 400 });
  }
  const sentAt = typeof body.sentAt === "number" ? body.sentAt : Date.now();
  const userResponse =
    body.userResponse &&
    (ACTION_RESPONSES as readonly string[]).includes(body.userResponse)
      ? body.userResponse
      : undefined; // mutation defaults to "pending"

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
      sentAt,
      userResponse,
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
  // Sprint 2.18 #8 — relaxed: learningKind + learning required.
  // learningKey derives from `learning` if missing. confidenceScore
  // clamps into [0,1], defaults to 0.5 if non-numeric.
  if (
    !body.idempotencyKey ||
    !isLearningKind(body.learningKind) ||
    !body.learning
  ) {
    return new Response("missing required fields", { status: 400 });
  }
  const learningKey = (body.learningKey ?? body.learning)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const confidenceScore =
    typeof body.confidenceScore === "number"
      ? Math.max(0, Math.min(1, body.confidenceScore))
      : 0.5;

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
      learningKey,
      learningKind: body.learningKind,
      learning: body.learning,
      confidenceScore,
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

// ───────────────────── Cost ledger (Sprint 2.25) ─────────────────────

/**
 * Sprint 2.25 — Maya logs her own spend after each major phase.
 *
 * Maya's foundation pass + heartbeat + cron work runs INSIDE OpenClaw
 * on the Fly machine, calling OpenRouter directly. Those calls bypass
 * our Convex callOpenRouter wrapper, so we can't auto-capture cost.
 *
 * Workaround: Maya curls THIS endpoint at the end of each phase with
 * her own self-reported usage + cost numbers. OpenClaw's session log
 * surfaces token counts and (when usage.include=true) cost USD per
 * call. Maya aggregates per phase and POSTs.
 *
 * Body:
 *   { idempotencyKey, provider, operation, reason, costUsd,
 *     units?, cacheStatus?, metadata? }
 *
 * Required: idempotencyKey, provider, operation, reason, costUsd.
 * Optional: units (token count), cacheStatus (defaults "called"),
 * metadata (free-form blob for forensics).
 *
 * Cross-tenant safety: agentId + accountId come from the
 * authenticated hookToken — body never names them.
 */
interface LogCostPayload {
  idempotencyKey: string;
  provider:
    | "openrouter"
    | "openclaw"
    | "scrapecreators"
    | "x_api"
    | "composio"
    | "gemini"
    | "other";
  operation: string;
  reason: string;
  costUsd: number;
  units?: number;
  cacheStatus?: "hit" | "miss" | "called" | "skipped" | "failed";
  metadata?: Record<string, unknown>;
}

const COST_PROVIDERS = new Set([
  "openrouter",
  "openclaw",
  "scrapecreators",
  "x_api",
  "composio",
  "gemini",
  "other",
]);
const CACHE_STATUSES = new Set(["hit", "miss", "called", "skipped", "failed"]);

export const logCostHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: LogCostPayload;
  try {
    body = (await request.json()) as LogCostPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !body.provider ||
    !COST_PROVIDERS.has(body.provider) ||
    !body.operation ||
    !body.reason ||
    typeof body.costUsd !== "number"
  ) {
    return new Response("missing required fields", { status: 400 });
  }
  if (body.costUsd < 0) {
    return new Response("costUsd cannot be negative", { status: 400 });
  }
  const cacheStatus =
    body.cacheStatus && CACHE_STATUSES.has(body.cacheStatus)
      ? body.cacheStatus
      : "called";

  // Idempotency-key dedupe via gtmHookCallbacks. Reuse "action_logged"
  // kind since cost-log is a fire-and-forget side observation, not a
  // first-class callback type. (We could add a new kind if we want
  // separate analytics — not worth it for v1.)
  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "action_logged",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") {
    return new Response("ok (replay)", { status: 200 });
  }

  try {
    await ctx.runMutation(internal.gtmMaya.costLedger.recordGtmCostInternal, {
      accountId: auth.accountId,
      provider: body.provider,
      operation: body.operation,
      reason: body.reason,
      costUsd: body.costUsd,
      units: body.units,
      cacheStatus,
      metadata: body.metadata,
    });
  } catch (err) {
    console.error(
      "[/lc_gtm/log_cost] recordGtmCostInternal failed:",
      (err as Error).message
    );
    return new Response("ok (cost not recorded; see logs)", { status: 200 });
  }
  return new Response(`ok (cost=${body.costUsd} recorded)`, { status: 200 });
});

// ───────────────────── Record published post (Sprint 2.27) ─────────────────────

/**
 * Sprint 2.27 — /lc_gtm/record_published.
 *
 * Maya calls this when the operator confirms they posted (e.g., reply
 * on a calendar event: "I posted!"). Flips the draft to status:
 * "published", schedules engagement polls at T+2h, T+24h, T+7d.
 *
 * Body: { idempotencyKey, draftId, providerPostId, platform,
 *         permalink?, postedAtMs? }
 *
 * Required: idempotencyKey, draftId, providerPostId, platform.
 * Optional: permalink (full URL to the post), postedAtMs (default now).
 */
interface RecordPublishedPayload {
  idempotencyKey: string;
  draftId: string;
  providerPostId: string;
  platform: "reddit" | "x" | "hn" | "linkedin" | "instagram" | "tiktok";
  permalink?: string;
  postedAtMs?: number;
}

const PUBLISHED_PLATFORMS = new Set([
  "reddit",
  "x",
  "hn",
  "linkedin",
  "instagram",
  "tiktok",
]);

export const recordPublishedHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: RecordPublishedPayload;
  try {
    body = (await request.json()) as RecordPublishedPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !body.draftId ||
    !body.providerPostId ||
    !body.platform ||
    !PUBLISHED_PLATFORMS.has(body.platform)
  ) {
    return new Response("missing required fields", { status: 400 });
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
  if (claim === "duplicate") {
    return new Response("ok (replay)", { status: 200 });
  }

  try {
    const result = await ctx.runMutation(
      internal.gtmMaya.recordPublished.recordDraftPublished,
      {
        agentId: auth.agentId,
        accountId: auth.accountId,
        draftId: body.draftId as Id<"gtmDraftedContent">,
        providerPostId: body.providerPostId,
        platform: body.platform,
        permalink: body.permalink,
        postedAtMs: body.postedAtMs,
      }
    );
    return new Response(
      `ok (draft ${result.draftId} published; polls scheduled)`,
      { status: 200 }
    );
  } catch (err) {
    console.error(
      "[/lc_gtm/record_published] failed:",
      (err as Error).message
    );
    return new Response(`error: ${(err as Error).message}`, { status: 400 });
  }
});

// ───────────────────── Helpers ─────────────────────

function parseIntParam(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
