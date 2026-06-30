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

import { httpAction, type ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { authenticate } from "./inboundCallback";

/**
 * W3.3 — best-effort live-pulse breadcrumb so Maya's foundation work narrates
 * as it lands (the gap where her best research was invisible in the Thinking
 * view). Written AFTER the row persists (Gate-1b: say only what's in the DB)
 * and never fails the underlying save — the breadcrumb is decorative.
 */
async function foundationBreadcrumb(
  ctx: ActionCtx,
  accountId: Id<"creators">,
  agentId: Id<"gtmAgents">,
  summary: string
): Promise<void> {
  try {
    await ctx.runMutation(internal.gtmMaya.missionControl.recordAgentActivity, {
      accountId,
      agentId,
      kind: "found",
      summary,
    });
  } catch {
    /* breadcrumb is best-effort; the foundation row already persisted */
  }
}

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
  const stageCount = Array.isArray(body.buyerJourneyStages)
    ? body.buyerJourneyStages.length
    : 0;
  await foundationBreadcrumb(
    ctx,
    auth.accountId,
    auth.agentId,
    `Mapped your buyer — ${stageCount} journey stage${stageCount === 1 ? "" : "s"}, grounded in real threads`
  );
  return new Response("ok", { status: 200 });
});

// ───────────────────── Sprint B: North Star + entry mode ─────────────────────

interface SetNorthStarPayload {
  idempotencyKey: string;
  entryMode?: "launch" | "manager";
  northStarMetric?: string;
  northStarTarget?: number;
  northStarDeadlineMs?: number;
  archetype?: string;
}

export const setNorthStarHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: SetNorthStarPayload;
  try {
    body = (await request.json()) as SetNorthStarPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.idempotencyKey) {
    return new Response("missing required fields", { status: 400 });
  }
  // Must set at least one field.
  if (
    body.entryMode === undefined &&
    body.northStarMetric === undefined &&
    body.northStarTarget === undefined &&
    body.northStarDeadlineMs === undefined &&
    body.archetype === undefined
  ) {
    return new Response("nothing to set", { status: 400 });
  }
  if (
    body.entryMode !== undefined &&
    body.entryMode !== "launch" &&
    body.entryMode !== "manager"
  ) {
    return new Response("invalid entryMode", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "set_north_star",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  try {
    await ctx.runMutation(internal.gtmMaya.managerStore.setNorthStarAndMode, {
      accountId: auth.accountId,
      agentId: auth.agentId,
      entryMode: body.entryMode,
      northStarMetric: body.northStarMetric,
      northStarTarget: body.northStarTarget,
      northStarDeadlineMs: body.northStarDeadlineMs,
      archetype: body.archetype,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

interface UpdateProductFactPayload {
  idempotencyKey: string;
  name?: string;
  differentiator?: string;
  founderWhy?: string;
  stage?: "idea" | "live-beta" | "paid" | "unknown";
  weekGoal?: "feedback" | "signups" | "demos" | "revenue" | "unknown";
  userCountBand?: "none" | "1-100" | "100-1k" | "1k+" | "unknown";
}

export const updateProductFactHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: UpdateProductFactPayload;
  try {
    body = (await request.json()) as UpdateProductFactPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.idempotencyKey) {
    return new Response("missing required fields", { status: 400 });
  }
  if (
    body.name === undefined &&
    body.differentiator === undefined &&
    body.founderWhy === undefined &&
    body.stage === undefined &&
    body.weekGoal === undefined &&
    body.userCountBand === undefined
  ) {
    return new Response("nothing to set", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "update_product_fact",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  try {
    await ctx.runMutation(internal.gtmMaya.managerStore.updateProductFact, {
      accountId: auth.accountId,
      agentId: auth.agentId,
      name: body.name,
      differentiator: body.differentiator,
      founderWhy: body.founderWhy,
      stage: body.stage,
      weekGoal: body.weekGoal,
      userCountBand: body.userCountBand,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

interface SetStrategyApprovalPayload {
  idempotencyKey: string;
  state: "proposed" | "approved" | "iterating";
}

export const setStrategyApprovalHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: SetStrategyApprovalPayload;
  try {
    body = (await request.json()) as SetStrategyApprovalPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.idempotencyKey) {
    return new Response("missing required fields", { status: 400 });
  }
  if (
    body.state !== "proposed" &&
    body.state !== "approved" &&
    body.state !== "iterating"
  ) {
    return new Response("invalid state", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "set_strategy_approval",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  try {
    await ctx.runMutation(internal.gtmMaya.managerStore.setStrategyApproval, {
      accountId: auth.accountId,
      agentId: auth.agentId,
      state: body.state,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

interface PostActivityPayload {
  idempotencyKey: string;
  kind:
    | "researching"
    | "found"
    | "drafted"
    | "plan_changed"
    | "posted"
    | "thinking"
    | "status";
  summary: string;
  detail?: string;
  linkedRef?: string;
}

export const postActivityHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: PostActivityPayload;
  try {
    body = (await request.json()) as PostActivityPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const validKinds = [
    "researching",
    "found",
    "drafted",
    "plan_changed",
    "posted",
    "thinking",
    "status",
  ];
  if (
    !body.idempotencyKey ||
    !body.summary ||
    !validKinds.includes(body.kind)
  ) {
    return new Response("missing required fields", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "post_activity",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  await ctx.runMutation(internal.gtmMaya.missionControl.recordAgentActivity, {
    accountId: auth.accountId,
    agentId: auth.agentId,
    kind: body.kind,
    summary: body.summary,
    detail: body.detail,
    linkedRef: body.linkedRef,
  });
  return new Response("ok", { status: 200 });
});

interface ProposeSkillImprovementPayload {
  idempotencyKey: string;
  targetSkill: string;
  archetype?: string;
  proposal: string;
  groundedInOutcome: string;
}

export const proposeSkillImprovementHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: ProposeSkillImprovementPayload;
  try {
    body = (await request.json()) as ProposeSkillImprovementPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !body.targetSkill ||
    !body.proposal ||
    !body.groundedInOutcome
  ) {
    return new Response("missing required fields", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "propose_skill_improvement",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  try {
    await ctx.runMutation(
      internal.gtmMaya.managerStore.proposeSkillImprovement,
      {
        agentId: auth.agentId,
        accountId: auth.accountId,
        targetSkill: body.targetSkill,
        archetype: body.archetype,
        proposal: body.proposal,
        groundedInOutcome: body.groundedInOutcome,
      }
    );
  } catch (err) {
    // Core-contract guard rejections land here as 400 (not self-editable).
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
  await foundationBreadcrumb(
    ctx,
    auth.accountId,
    auth.agentId,
    `Sized up ${body.competitorName} (${body.kind}) — found where they're weak`
  );
  return new Response("ok", { status: 200 });
});

// ───────────────────── Foundation: channel scorecard ─────────────────────

// Ideal-product pillar 2 — YouTube REVIVED 2026-06-02 (operator: all 6
// channels first-class — TikTok/Instagram/Reddit/YouTube/X/LinkedIn). YouTube
// is a first-class Brief-only channel again; it must persist scorecards +
// style exemplars like any other. (product_hunt stays out.)
const CHANNEL_VALUES = [
  "reddit",
  "x",
  "hn",
  "linkedin",
  "tiktok",
  "instagram",
  "youtube",
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
  // Pillar 2 — per-channel ICP knowledge + native-style exemplars. Sent by the
  // plugin as either a structured object or a pre-serialized JSON string; we
  // normalize to a JSON string for managerStore (which validates + persists it).
  icpKnowledge?: unknown;
  styleExemplars?: unknown;
  styleExemplarsJson?: unknown;
}

function toJsonStringOrUndefined(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
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
        icpKnowledge: toJsonStringOrUndefined(body.icpKnowledge),
        styleExemplarsJson: toJsonStringOrUndefined(
          body.styleExemplarsJson ?? body.styleExemplars
        ),
      }
    );
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  await foundationBreadcrumb(
    ctx,
    auth.accountId,
    auth.agentId,
    bet
      ? `Betting on ${body.channel} — your buyer is there (audience fit ${Math.round(audienceFit * 100)}%)`
      : `Scored ${body.channel} — parked it for now (audience fit ${Math.round(audienceFit * 100)}%)`
  );
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
  await foundationBreadcrumb(
    ctx,
    auth.accountId,
    auth.agentId,
    painCitation.quote
      ? `New angle: "${body.angle.slice(0, 60)}" — grounded in a real complaint`
      : `New angle: "${body.angle.slice(0, 60)}"`
  );
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
  await foundationBreadcrumb(
    ctx,
    auth.accountId,
    auth.agentId,
    `Found someone worth knowing: ${body.handle} on ${body.platform}`
  );
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

// ───────────────────── Weekly: strategic review ─────────────────────

/**
 * Sun-9pm weekly strategic review. Maya authors it agent-side (the
 * `maya-results-reviewer` skill) and POSTs the structured form here so it
 * persists durably and surfaces in the Results UI's "Strategic Review"
 * section — previously it only ever reached Telegram as prose and evaporated.
 *
 * `weekStartLocal` is the Monday of the reviewed week as YYYY-MM-DD.
 *
 * Idempotency is structural, not key-based: the underlying mutation upserts on
 * (account, weekStartLocal), so any number of POSTs for the same week collapse
 * to one row — a retry AND a genuine re-author both land on the single row for
 * that week. This is a stronger guarantee than a per-POST idempotency key
 * (which would only de-dup byte-identical retries), so this callback does not
 * claim a `gtmHookCallbacks` key. `idempotencyKey` is accepted-but-ignored for
 * wire-shape parity with the other manager callbacks.
 */
interface WeeklyReviewPayload {
  idempotencyKey?: string;
  weekStartLocal: string;
  markdown: string;
  winsArray?: string[];
  lossesArray?: string[];
  nextWeekRecommendations?: string[];
}

/** YYYY-MM-DD shape check — keeps the lexicographic-ordering contract on the
 *  index honest (the query relies on string order == chronological order). */
function isWeekStartLocal(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

export const weeklyReviewHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: WeeklyReviewPayload;
  try {
    body = (await request.json()) as WeeklyReviewPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!isWeekStartLocal(body.weekStartLocal) || !body.markdown) {
    return new Response("missing required fields", { status: 400 });
  }

  try {
    await ctx.runMutation(internal.gtmMaya.managerStore.upsertWeeklyReview, {
      accountId: auth.accountId,
      agentId: auth.agentId,
      weekStartLocal: body.weekStartLocal,
      markdown: body.markdown,
      winsArray: toStringArray(body.winsArray),
      lossesArray: toStringArray(body.lossesArray),
      nextWeekRecommendations: toStringArray(body.nextWeekRecommendations),
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }

  await foundationBreadcrumb(
    ctx,
    auth.accountId,
    auth.agentId,
    `Weekly strategic review saved (week of ${body.weekStartLocal}).`
  );
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
  /** Sprint 8 — structured {venue,hook,format,timeBucket,outcome} for the
   *  cross-tenant archetype rollup. */
  structured?: {
    venue?: string;
    hook?: string;
    format?: string;
    timeBucket?: string;
    outcome?: string;
  };
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
    const structuredJson =
      body.structured && typeof body.structured === "object"
        ? JSON.stringify(body.structured)
        : undefined;
    await ctx.runMutation(internal.gtmMaya.managerStore.upsertNicheLearning, {
      accountId: auth.accountId,
      agentId: auth.agentId,
      learningKey,
      learningKind: body.learningKind,
      learning: body.learning,
      confidenceScore,
      evidenceCount: body.evidenceCount,
      retired: body.retired,
      structuredJson,
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

// ───────────────────── Durable lifecycle (#15) ─────────────────────
//
// The agent reads/writes its lifecycle through these instead of MEMORY.md
// markers. MEMORY.md is wiped on every Fly restart; these are durable in
// Convex, which is what stops the foundation watchdog from re-running the
// whole onboarding pipeline forever.

/** GET — read the durable lifecycle (phase, helloSent, foundationComplete,
 *  lease state, evidence counts). */
export const getAgentLifecycleHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const lifecycle = await ctx.runQuery(
    internal.gtmMaya.agentLifecycle.getAgentLifecycle,
    { agentId: auth.agentId }
  );
  return new Response(JSON.stringify({ lifecycle }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/** POST — check-and-set the foundation lease before running the pass.
 *  Body (all optional): { ttlMs }. Returns { acquired, alreadyComplete,
 *  leaseActive, leaseUntil }. */
export const acquireFoundationLeaseHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let ttlMs: number | undefined;
  try {
    const body = (await request.json()) as { ttlMs?: number };
    if (typeof body?.ttlMs === "number" && body.ttlMs > 0) ttlMs = body.ttlMs;
  } catch {
    // empty/invalid body is fine — use the default lease window.
  }

  const result = await ctx.runMutation(
    internal.gtmMaya.agentLifecycle.acquireFoundationLease,
    { agentId: auth.agentId, ttlMs }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/** POST — set a durable lifecycle marker. Body: { marker }.
 *  marker ∈ hello_sent | foundation_complete | morning_brief | release_lease. */
export const markLifecycleHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let marker: string | undefined;
  try {
    const body = (await request.json()) as { marker?: string };
    marker = body?.marker;
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  if (!marker) return new Response("missing 'marker'", { status: 400 });

  switch (marker) {
    case "hello_sent": {
      const r = await ctx.runMutation(
        internal.gtmMaya.agentLifecycle.markHelloSent,
        { agentId: auth.agentId }
      );
      return new Response(JSON.stringify({ ok: true, ...r }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    case "strategy_delivered": {
      // Belt-and-suspenders: a successful strategic send_update already stamps
      // this server-side, but the synthesis skill may also mark it explicitly.
      const r = await ctx.runMutation(
        internal.gtmMaya.agentLifecycle.markStrategyDelivered,
        { agentId: auth.agentId }
      );
      return new Response(JSON.stringify({ ok: true, ...r }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // `plan_ready` is the enum-refactor name; `foundation_complete` is the
    // back-compat alias — both mark Maya's onboarding WORK done (plan generated).
    // Delivery to the founder's channel is handled for the agent (Convex re-pushes
    // on connect), so this no longer gates on the plan having reached them.
    case "plan_ready":
    case "foundation_complete": {
      const r = await ctx.runMutation(
        internal.gtmMaya.agentLifecycle.markFoundationComplete,
        { agentId: auth.agentId }
      );
      // Surface ok:false only when there's literally no plan/research yet (so the
      // agent sees BLOCKED, not a silent success) — never for an undelivered send.
      return new Response(JSON.stringify({ ok: r.completed, ...r }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    case "morning_brief": {
      await ctx.runMutation(
        internal.gtmMaya.agentLifecycle.markMorningBrief,
        { agentId: auth.agentId }
      );
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    case "release_lease": {
      await ctx.runMutation(
        internal.gtmMaya.agentLifecycle.releaseFoundationLease,
        { agentId: auth.agentId }
      );
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    default:
      return new Response(`unknown marker '${marker}'`, { status: 400 });
  }
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
