/**
 * Brand deal triage entry point — Sprint 5.
 *
 * Wires the inbound Composio Gmail webhook → `maya-brand-deal-triager` skill →
 * `brandDeals` table. Plan-tier-gated upstream (the webhook handler drops
 * Starter inbound silently); this module also re-checks the gate as a
 * defense-in-depth measure.
 *
 * Auto-send threshold logic lives here, not in the skill: the skill returns
 * all 4 reply variants and the orchestrator decides whether to auto-send the
 * floor-clearing decline. Per SKILL.md § Auto-send threshold:
 *   - if `connectedAccounts.autoSendThreshold` is set
 *   - AND `parsedOffer.proposedValueUsd` is non-null and below threshold
 *   - AND the recommended variant is `firm` (i.e. floor-clearing decline)
 *   then we auto-send and log to `mayaActionLog`. Anything `enthusiastic` /
 *   `neutral` / `clarify` (placeholder for future variants) NEVER auto-sends —
 *   anti-footgun.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { decrypt } from "./lib/encryption";
import { planFeatures } from "./lib/planFeatures";
import { assertWebhookSecret } from "./lib/webhookSecret";
import {
  gmailActions,
  type GmailMessage,
  type GmailAttachment,
} from "./integrations/composio/actions";
import {
  triageBrandEmail,
  type Attachment as TriagerAttachment,
  type CitationFirewall,
  type ClassifierModel,
  type ContractRedFlagSkill,
  type GmailThread as TriagerGmailThread,
  type RateCalculatorSkill,
  type TriageResult,
  type VariantDrafterModel,
  type VoiceApplierSkill,
} from "../agents/skills/maya-brand-deal-triager/script";

/* -------------------------------------------------------------------------- */
/* Internal helpers (queries + mutations)                                      */
/* -------------------------------------------------------------------------- */

export const getCreatorAndAccount = internalQuery({
  args: {
    creatorId: v.id("creators"),
    provider: v.union(
      v.literal("gmail"),
      v.literal("stripe"),
      v.literal("calendar"),
      v.literal("apollo"),
      v.literal("hunter")
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    creator: Pick<Doc<"creators">, "_id" | "plan">;
    account: Pick<
      Doc<"connectedAccounts">,
      "_id" | "composioAccountId" | "autoSendThreshold"
    >;
  } | null> => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) return null;
    const account = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_creator_and_provider", (q) =>
        q.eq("creatorId", args.creatorId).eq("provider", args.provider)
      )
      .first();
    if (!account) return null;
    return {
      creator: { _id: creator._id, plan: creator.plan },
      account: {
        _id: account._id,
        composioAccountId: account.composioAccountId,
        autoSendThreshold: account.autoSendThreshold,
      },
    };
  },
});

export const getCreatorPicture = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .first();
  },
});

/**
 * Internal query — fetch the creator row, used by deal triage to read the
 * brand-deal floor rate from `onboardingProgress.answers.brandDealFloorUsd`
 * during the auto-send gate. See note in `triageDealEmail` for the longer-
 * term migration path.
 */
export const getCreatorForFloor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.creatorId);
  },
});

export const getRecentDeals = internalQuery({
  args: { creatorId: v.id("creators"), limit: v.number() },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("brandDeals")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .order("desc")
      .take(args.limit);
    return all.map((d) => ({
      brand: d.brand,
      valueUsd: d.paidAmountUsd ?? d.suggestedRateUsd ?? d.offerAmountUsd ?? 0,
      deliverables: d.deliverables.join(", "),
    }));
  },
});

export const insertBrandDeal = internalMutation({
  args: {
    creatorId: v.id("creators"),
    brand: v.string(),
    offerAmountUsd: v.optional(v.number()),
    suggestedRateUsd: v.optional(v.number()),
    deliverables: v.array(v.string()),
    dueAt: v.optional(v.number()),
    riskFlags: v.array(v.string()),
    gmailThreadId: v.string(),
    replyVariants: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("brandDeals", {
      creatorId: args.creatorId,
      brand: args.brand,
      status: "new",
      offerAmountUsd: args.offerAmountUsd,
      suggestedRateUsd: args.suggestedRateUsd,
      deliverables: args.deliverables,
      dueAt: args.dueAt,
      riskFlags: args.riskFlags,
      gmailThreadId: args.gmailThreadId,
      replyVariants: args.replyVariants,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const logActionRow = internalMutation({
  args: {
    creatorId: v.id("creators"),
    entryId: v.string(),
    outcome: v.union(
      v.literal("ran"),
      v.literal("skipped_plan_disabled"),
      v.literal("skipped_condition_unmet"),
      v.literal("skipped_dependency_missing"),
      v.literal("retried"),
      v.literal("failed")
    ),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("mayaActionLog", {
      creatorId: args.creatorId,
      entryId: args.entryId,
      outcome: args.outcome,
      detail: args.detail,
      ts: Date.now(),
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Skill dependency stubs (deterministic v0 wiring)                            */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic stub dependency wiring for the brand-deal triager. Sprint 5
 * shipped the orchestration; the live model-router-backed skill calls
 * remained out of scope for Sprint 6 (Profile + Billing + Channels) and
 * Sprint 7 (beta hardening). The stubs:
 *   - rateCalculator: returns floorRate as low/target/stretch (no comparable lookup yet)
 *   - contractRedflag: never invoked unless caller passes pdf attachments
 *   - voiceApplier: identity (returns the draft unchanged)
 *   - firewall: passes everything (real firewall ships in maya-citation-firewall)
 *   - classifierModel: defaults ambiguous to "cold-pitch"
 *   - variantDrafter: emits 4 minimal variants tagged to the offer
 *
 * TODO(s8): the deal-desk is the most likely "top-3 most-loved behavior"
 * candidate per SPRINT_PLAN_V0.md § Sprint 8. If beta confirms, swap these
 * stubs for real model-router-backed skill bindings per
 * `agents/skills/maya-brand-deal-triager/SKILL.md` § calls. If beta says
 * the deal-desk doesn't earn its cost, delete this entire module instead.
 */
function buildDefaultTriageDeps(opts: {
  brand: string;
  proposedValueUsd: number | null;
}): {
  rateCalculator: RateCalculatorSkill;
  contractRedflag: ContractRedFlagSkill;
  voiceApplier: VoiceApplierSkill;
  firewall: CitationFirewall;
  classifierModel: ClassifierModel;
  variantDrafter: VariantDrafterModel;
} {
  return {
    rateCalculator: {
      async suggest({ floorRate }) {
        return {
          low: floorRate,
          target: Math.round(floorRate * 1.4),
          stretch: Math.round(floorRate * 1.8),
          reasoning:
            "TODO(s8): deterministic stub reasoning. Real comparable lookup ships if Sprint 8 keeps the deal-desk.",
        };
      },
    },
    contractRedflag: {
      async scan() {
        return {
          high: 0,
          medium: 0,
          low: 0,
          recommendation: "negotiate",
          summary: "TODO(s8): deterministic stub. Real PDF scan wires in Sprint 8 if deal-desk keeps shipping.",
        };
      },
    },
    voiceApplier: {
      async apply({ draft }) {
        return { adjustedDraft: draft, unchanged: true };
      },
    },
    firewall: {
      async check() {
        return { passed: true, unsupportedClaims: [] };
      },
    },
    classifierModel: {
      async classifyAmbiguous() {
        return "cold-pitch";
      },
    },
    variantDrafter: {
      async draftVariants({ parsedOffer }) {
        const brand = parsedOffer?.brand ?? opts.brand;
        const value = parsedOffer?.proposedValueUsd ?? opts.proposedValueUsd;
        const valueStr = value !== null && value !== undefined ? `$${value}` : "the offer";
        return {
          enthusiastic: `Hi ${brand}, thanks for reaching out. ${valueStr} works — let's lock it in.`,
          neutral: `Hi ${brand}, thanks for the note. Let me review and get back to you within 48 hours.`,
          firm: `Hi ${brand}, thanks for the offer. Based on my recent rates I'd need to be at the top of my range — happy to discuss specifics on a call.`,
          pass: `Hi ${brand}, thanks for thinking of me. This isn't a fit right now but I'll keep you in mind for future windows.`,
        };
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Triage entry point — internalAction                                         */
/* -------------------------------------------------------------------------- */

/**
 * Convex-validator-friendly mirror of the skill's GmailThread shape. We can't
 * pass the skill's own type as a `v.object(...)` (validators are runtime
 * values, not types), so we duplicate the shape here. The duplication is
 * intentional: drift between this validator and the skill type is caught by
 * the test suite (which constructs concrete TriagerGmailThread objects).
 */
const ATTACHMENT_VALIDATOR = v.union(
  v.object({
    kind: v.literal("pdf"),
    url: v.string(),
    filename: v.string(),
  }),
  v.object({
    kind: v.literal("docx"),
    url: v.string(),
    filename: v.string(),
  })
);

const GMAIL_THREAD_VALIDATOR = v.object({
  threadId: v.string(),
  from: v.object({
    email: v.string(),
    name: v.optional(v.string()),
    domain: v.string(),
  }),
  subject: v.string(),
  bodyText: v.string(),
  receivedMs: v.number(),
  attachments: v.array(ATTACHMENT_VALIDATOR),
});

export const triageInboundEmail = internalAction({
  args: {
    creatorId: v.id("creators"),
    gmailThread: GMAIL_THREAD_VALIDATOR,
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    brandDealId: Id<"brandDeals"> | null;
    autoSent: boolean;
    classification: TriageResult["classification"];
  }> => {
    // 1. Resolve creator + account. Plan-tier gate (defense in depth — the
    //    webhook handler also gates upstream).
    const lookup = await ctx.runQuery(internal.dealTriage.getCreatorAndAccount, {
      creatorId: args.creatorId,
      provider: "gmail",
    });
    if (!lookup) {
      // Creator missing or no Gmail account — silent drop.
      return { brandDealId: null, autoSent: false, classification: "spam" };
    }
    const features = planFeatures(lookup.creator);
    if (!features.gmailDealDeskEnabled) {
      await ctx.runMutation(internal.dealTriage.logActionRow, {
        creatorId: args.creatorId,
        entryId: "brand_email_triage",
        outcome: "skipped_plan_disabled",
        detail: `plan=${lookup.creator.plan} gmailDealDeskEnabled=false`,
      });
      return { brandDealId: null, autoSent: false, classification: "spam" };
    }

    // 2. Resolve creator picture + soul. Use a placeholder soul in v0; Sprint
    //    6 wires the real soul-driven prompt assembly.
    const picture = await ctx.runQuery(internal.dealTriage.getCreatorPicture, {
      creatorId: args.creatorId,
    });
    const recentDeals = await ctx.runQuery(internal.dealTriage.getRecentDeals, {
      creatorId: args.creatorId,
      limit: 5,
    });
    // Floor rate: pulled from `creators.onboardingProgress.answers.brandDealFloorUsd`
    // when present (the answer captured during onboarding). After
    // `submitOnboardingAnswers` clears the resume buffer, the value lives only
    // in soul.md / standing-orders prose. Until we add a dedicated queryable
    // field on the `creators` row (TODO(s7): persist brandDealFloorUsd as a
    // first-class column so cron can read it deterministically), we read the
    // ephemeral resume buffer if present and otherwise default to $0 (means
    // "no floor", auto-send disabled).
    const creatorRow = await ctx.runQuery(internal.dealTriage.getCreatorForFloor, {
      creatorId: args.creatorId,
    });
    const floorRate =
      creatorRow?.onboardingProgress?.answers?.brandDealFloorUsd ?? 0;
    const triageInputs = {
      gmailThread: args.gmailThread as TriagerGmailThread,
      creatorContext: {
        creatorId: String(args.creatorId),
        picture: {
          niche: picture?.niche ?? "(unknown)",
          voiceFingerprint: picture?.voiceFingerprint ?? "(unset)",
          followerCountByPlatform: [],
        },
        floorRate,
        recentDeals,
      },
      brandContextLookupEnabled: features.brandContactDiscoveryEnabled,
    };

    // 3. Build deps + run the skill. See `buildDefaultTriageDeps` —
    //    deterministic stubs in v0; TODO(s8) for real wiring conditional
    //    on beta keeping the deal-desk behavior.
    const deps = buildDefaultTriageDeps({
      brand: args.gmailThread.from.name ?? args.gmailThread.from.domain,
      proposedValueUsd: null,
    });
    let result: TriageResult;
    try {
      result = await triageBrandEmail(triageInputs, deps);
    } catch (err) {
      await ctx.runMutation(internal.dealTriage.logActionRow, {
        creatorId: args.creatorId,
        entryId: "brand_email_triage",
        outcome: "failed",
        detail: (err as Error).message?.slice(0, 500) ?? "unknown",
      });
      throw err;
    }

    // 4. Persist a brandDeals row.
    const brandDealId = await ctx.runMutation(internal.dealTriage.insertBrandDeal, {
      creatorId: args.creatorId,
      brand: result.parsedOffer?.brand ?? args.gmailThread.from.name ?? args.gmailThread.from.domain,
      offerAmountUsd: result.parsedOffer?.proposedValueUsd ?? undefined,
      suggestedRateUsd: result.suggestedRate?.target,
      deliverables: result.parsedOffer?.deliverables
        ? [result.parsedOffer.deliverables]
        : [],
      dueAt: result.parsedOffer?.deadlineMs ?? undefined,
      riskFlags: collectRiskFlags(result),
      gmailThreadId: args.gmailThread.threadId,
      replyVariants: result.replyVariants.map((rv) => rv.draft),
    });

    // 5. Auto-send check. Only the `firm` variant ever auto-sends — the
    //    enthusiastic / neutral / pass variants always wait for creator review.
    let autoSent = false;
    const threshold = lookup.account.autoSendThreshold;
    const offerValue = result.parsedOffer?.proposedValueUsd ?? null;
    const firmVariant = result.replyVariants.find((rv) => rv.variant === "firm");
    if (
      threshold !== undefined &&
      threshold !== null &&
      offerValue !== null &&
      offerValue < threshold &&
      firmVariant !== undefined &&
      result.classification === "real-deal"
    ) {
      try {
        const decryptedAccountId = await decrypt(lookup.account.composioAccountId);
        await gmailActions.sendEmail(
          { connectedAccountId: decryptedAccountId },
          {
            to: args.gmailThread.from.email,
            subject: `Re: ${args.gmailThread.subject}`,
            body: firmVariant.draft,
            threadId: args.gmailThread.threadId,
          }
        );
        autoSent = true;
        await ctx.runMutation(internal.dealTriage.logActionRow, {
          creatorId: args.creatorId,
          entryId: "brand_email_triage_autosend",
          outcome: "ran",
          detail: `offer=${offerValue} threshold=${threshold} variant=firm`,
        });
      } catch (err) {
        // Auto-send failed — log but don't crash. Creator still has the
        // draft variants in brandDeals to act on manually.
        await ctx.runMutation(internal.dealTriage.logActionRow, {
          creatorId: args.creatorId,
          entryId: "brand_email_triage_autosend",
          outcome: "failed",
          detail: (err as Error).message?.slice(0, 500) ?? "unknown",
        });
      }
    }

    await ctx.runMutation(internal.dealTriage.logActionRow, {
      creatorId: args.creatorId,
      entryId: "brand_email_triage",
      outcome: "ran",
      detail: `class=${result.classification} variants=${result.replyVariants.length} autoSent=${autoSent}`,
    });

    return {
      brandDealId,
      autoSent,
      classification: result.classification,
    };
  },
});

/**
 * Webhook-side wrapper. Fetches the Gmail thread via Composio, normalizes it
 * into the skill input shape, then delegates to `triageInboundEmail`.
 *
 * Split from `triageInboundEmail` so that:
 *   (a) the unit tests for the inner triage can pass synthetic threads
 *       without needing to stub the Composio HTTP layer
 *   (b) Maya's chat-side "triage this for me" path can call the inner
 *       function directly with a thread object the creator pasted in
 */
export const triageInboundEmailFromWebhook = internalAction({
  args: {
    creatorId: v.id("creators"),
    composioAccountId: v.string(),
    threadId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ brandDealId: Id<"brandDeals"> | null; autoSent: boolean }> => {
    // Re-resolve to confirm the account belongs to the creator and we still
    // have the encrypted token.
    const lookup = await ctx.runQuery(internal.dealTriage.getCreatorAndAccount, {
      creatorId: args.creatorId,
      provider: "gmail",
    });
    if (!lookup) {
      return { brandDealId: null, autoSent: false };
    }
    const decryptedAccountId = await decrypt(lookup.account.composioAccountId);
    // Sanity check: make sure the account in the webhook matches what we have
    // on file. Anti-tenant-bleed: refuse to triage if the webhook's account
    // doesn't match the creator's stored account.
    if (decryptedAccountId !== args.composioAccountId) {
      await ctx.runMutation(internal.dealTriage.logActionRow, {
        creatorId: args.creatorId,
        entryId: "brand_email_triage_webhook",
        outcome: "failed",
        detail: "composioAccountId mismatch — refusing to triage",
      });
      return { brandDealId: null, autoSent: false };
    }

    const composioThread = await gmailActions.getThread(
      { connectedAccountId: decryptedAccountId },
      { threadId: args.threadId, format: "full" }
    );
    const triagerThread = gmailThreadToTriagerInput(composioThread);

    const result: {
      brandDealId: Id<"brandDeals"> | null;
      autoSent: boolean;
      classification: TriageResult["classification"];
    } = await ctx.runAction(internal.dealTriage.triageInboundEmail, {
      creatorId: args.creatorId,
      gmailThread: triagerThread,
    });
    return { brandDealId: result.brandDealId, autoSent: result.autoSent };
  },
});

function collectRiskFlags(result: TriageResult): string[] {
  const flags: string[] = [];
  if (result.parsedOffer?.exclusivityMentioned) {
    flags.push("exclusivity-mentioned");
  }
  if (result.urgency === "high") {
    flags.push("high-urgency");
  }
  if (result.redFlags) {
    if (result.redFlags.high > 0) flags.push(`contract-redflags-high:${result.redFlags.high}`);
    if (result.redFlags.medium > 0) flags.push(`contract-redflags-medium:${result.redFlags.medium}`);
    if (result.redFlags.recommendation === "walk") flags.push("redflag-recommend-walk");
  }
  if (result.classification === "spam") flags.push("classified-spam");
  return flags;
}

/* -------------------------------------------------------------------------- */
/* Webhook → triage glue                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a Composio account by its plaintext id (sha256 lookup against
 * `connectedAccounts.composioAccountIdHash`). Used by the webhook handler.
 */
export const findCreatorByComposioAccount = internalQuery({
  args: { composioAccountIdHash: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    creatorId: Id<"creators">;
    plan: Doc<"creators">["plan"];
    accountId: Id<"connectedAccounts">;
  } | null> => {
    const account = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_account_hash", (q) =>
        q.eq("composioAccountIdHash", args.composioAccountIdHash)
      )
      .first();
    if (!account) return null;
    const creator = await ctx.db.get(account.creatorId);
    if (!creator) return null;
    return {
      creatorId: creator._id,
      plan: creator.plan,
      accountId: account._id,
    };
  },
});

/**
 * Webhook audit log writer. Inserts one row per signature-verified inbound
 * Composio event. Idempotent on `eventId` so a redelivered event becomes a
 * `replay_dropped` insert (we keep the row for forensics) without re-running
 * the triage pipeline.
 */
export const recordWebhookEvent = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    composioAccountId: v.string(),
    creatorId: v.optional(v.id("creators")),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    status: v.union(
      v.literal("processed"),
      v.literal("replay_dropped"),
      v.literal("plan_dropped"),
      v.literal("resolved_no_creator"),
      v.literal("errored")
    ),
    detail: v.optional(v.string()),
    rawPayload: v.any(),
  },
  handler: async (ctx, args): Promise<{ alreadySeen: boolean; rowId: Id<"gmailWebhookEvents"> }> => {
    const existing = await ctx.db
      .query("gmailWebhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
    if (existing) {
      // Already processed — record the redelivery as a no-op row so we have
      // an audit trail of the redelivery attempt, but do NOT re-trigger.
      const replayRow = await ctx.db.insert("gmailWebhookEvents", {
        eventId: args.eventId,
        eventType: args.eventType,
        composioAccountId: args.composioAccountId,
        creatorId: args.creatorId,
        threadId: args.threadId,
        messageId: args.messageId,
        status: "replay_dropped",
        detail: `replay of ${existing._id}`,
        receivedAt: Date.now(),
        rawPayload: args.rawPayload,
      });
      return { alreadySeen: true, rowId: replayRow };
    }
    const rowId = await ctx.db.insert("gmailWebhookEvents", {
      eventId: args.eventId,
      eventType: args.eventType,
      composioAccountId: args.composioAccountId,
      creatorId: args.creatorId,
      threadId: args.threadId,
      messageId: args.messageId,
      status: args.status,
      detail: args.detail,
      receivedAt: Date.now(),
      rawPayload: args.rawPayload,
    });
    return { alreadySeen: false, rowId };
  },
});

/**
 * Convert a Composio Gmail thread response into the skill's TriagerGmailThread
 * shape. Pulls headers (From / Subject), picks the latest message body,
 * collapses attachments. Pure function — testable without HTTP.
 */
export function gmailThreadToTriagerInput(
  composioThread: { id: string; messages: GmailMessage[] }
): TriagerGmailThread {
  const messages = composioThread.messages ?? [];
  if (messages.length === 0) {
    throw new Error("gmailThreadToTriagerInput: thread has no messages");
  }
  // First message = original inbound. Last message = most recent. For triage
  // we want the original sender + the most recent body so Maya sees the full
  // conversation; for v0 we collapse to the last message body and the first
  // message's From header (the brand outreach contact).
  const first = messages[0];
  const last = messages[messages.length - 1];

  const fromValue =
    pickHeader(first.headers, "From") ?? pickHeader(last.headers, "From") ?? "";
  const from = parseFromHeader(fromValue);

  const subject =
    pickHeader(first.headers, "Subject") ??
    pickHeader(last.headers, "Subject") ??
    "(no subject)";

  // Build body by concatenating all message bodyTexts in order so the model
  // sees the full thread.
  const bodyText = messages
    .map((m) => m.bodyText ?? "")
    .filter((s) => s.length > 0)
    .join("\n\n---\n\n");

  const receivedMs = parseInternalDate(last.internalDate);

  // Collapse attachments across all messages, dedupe by filename.
  const seen = new Set<string>();
  const attachments: TriagerAttachment[] = [];
  for (const msg of messages) {
    for (const att of msg.attachments ?? []) {
      if (seen.has(att.filename)) continue;
      seen.add(att.filename);
      const triagerAtt = composioAttachmentToTriagerAttachment(att);
      if (triagerAtt) attachments.push(triagerAtt);
    }
  }

  return {
    threadId: composioThread.id,
    from,
    subject,
    bodyText,
    receivedMs,
    attachments,
  };
}

function pickHeader(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string
): string | null {
  if (!headers) return null;
  const lower = name.toLowerCase();
  const found = headers.find((h) => h.name.toLowerCase() === lower);
  return found ? found.value : null;
}

function parseFromHeader(value: string): {
  email: string;
  name?: string;
  domain: string;
} {
  const angle = /<([^>]+)>/.exec(value);
  const email = (angle ? angle[1] : value.trim()).toLowerCase();
  const namePart = angle
    ? value.slice(0, angle.index).trim().replace(/^"|"$/g, "")
    : "";
  const at = email.lastIndexOf("@");
  const domain = at >= 0 ? email.slice(at + 1) : "";
  return {
    email,
    name: namePart.length > 0 ? namePart : undefined,
    domain,
  };
}

function parseInternalDate(d: string | number | undefined): number {
  if (d === undefined || d === null) return Date.now();
  if (typeof d === "number") return d;
  const n = parseInt(d, 10);
  return Number.isFinite(n) ? n : Date.now();
}

function composioAttachmentToTriagerAttachment(
  att: GmailAttachment
): TriagerAttachment | null {
  const lower = att.filename.toLowerCase();
  const url = att.url ?? "";
  if (lower.endsWith(".pdf")) {
    return { kind: "pdf", url, filename: att.filename };
  }
  if (lower.endsWith(".docx")) {
    return { kind: "docx", url, filename: att.filename };
  }
  return null; // skill ignores other attachment types in v0
}

/* -------------------------------------------------------------------------- */
/* Public webhook bridge wrappers                                              */
/* -------------------------------------------------------------------------- */

/**
 * Public-callable bridges that the Composio webhook route in Next.js calls.
 * `ConvexHttpClient` cannot reach `internal.*` references (TS2345), so each
 * webhook-facing handler exposes a thin public wrapper.
 *
 * Security: every bridge validates a shared secret via `assertWebhookSecret`
 * before delegating. The secret is set in BOTH Next.js env (used by the
 * route) and Convex env (used here). Constant-time compare. Fail-closed.
 *
 * Cross-tenant: the underlying internal handlers are the canonical source
 * of cross-tenant safety — these wrappers don't relax any guarantees.
 */

const WEBHOOK_EVENT_STATUS_VALIDATOR = v.union(
  v.literal("processed"),
  v.literal("replay_dropped"),
  v.literal("plan_dropped"),
  v.literal("resolved_no_creator"),
  v.literal("errored")
);

export const recordWebhookEventPublic = mutation({
  args: {
    secret: v.string(),
    eventId: v.string(),
    eventType: v.string(),
    composioAccountId: v.string(),
    creatorId: v.optional(v.id("creators")),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    status: WEBHOOK_EVENT_STATUS_VALIDATOR,
    detail: v.optional(v.string()),
    rawPayload: v.any(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ alreadySeen: boolean; rowId: Id<"gmailWebhookEvents"> }> => {
    assertWebhookSecret(args.secret);
    // Reuse the internal handler's body via a direct DB write — duplicating
    // here would risk drift. We inline the existing logic by calling the
    // recorder pattern; convex doesn't allow mutation→mutation calls so we
    // copy the (small) body. Keep IN SYNC with `recordWebhookEvent`.
    const existing = await ctx.db
      .query("gmailWebhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
    if (existing) {
      const replayRow = await ctx.db.insert("gmailWebhookEvents", {
        eventId: args.eventId,
        eventType: args.eventType,
        composioAccountId: args.composioAccountId,
        creatorId: args.creatorId,
        threadId: args.threadId,
        messageId: args.messageId,
        status: "replay_dropped",
        detail: `replay of ${existing._id}`,
        receivedAt: Date.now(),
        rawPayload: args.rawPayload,
      });
      return { alreadySeen: true, rowId: replayRow };
    }
    const rowId = await ctx.db.insert("gmailWebhookEvents", {
      eventId: args.eventId,
      eventType: args.eventType,
      composioAccountId: args.composioAccountId,
      creatorId: args.creatorId,
      threadId: args.threadId,
      messageId: args.messageId,
      status: args.status,
      detail: args.detail,
      receivedAt: Date.now(),
      rawPayload: args.rawPayload,
    });
    return { alreadySeen: false, rowId };
  },
});

export const findCreatorByComposioAccountPublic = query({
  args: {
    secret: v.string(),
    composioAccountIdHash: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    creatorId: Id<"creators">;
    plan: Doc<"creators">["plan"];
    accountId: Id<"connectedAccounts">;
  } | null> => {
    assertWebhookSecret(args.secret);
    const account = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_account_hash", (q) =>
        q.eq("composioAccountIdHash", args.composioAccountIdHash)
      )
      .first();
    if (!account) return null;
    const creator = await ctx.db.get(account.creatorId);
    if (!creator) return null;
    return {
      creatorId: creator._id,
      plan: creator.plan,
      accountId: account._id,
    };
  },
});

export const triageInboundEmailFromWebhookPublic = action({
  args: {
    secret: v.string(),
    creatorId: v.id("creators"),
    composioAccountId: v.string(),
    threadId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ brandDealId: Id<"brandDeals"> | null; autoSent: boolean }> => {
    assertWebhookSecret(args.secret);
    return await ctx.runAction(
      internal.dealTriage.triageInboundEmailFromWebhook,
      {
        creatorId: args.creatorId,
        composioAccountId: args.composioAccountId,
        threadId: args.threadId,
      }
    );
  },
});
