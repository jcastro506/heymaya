/**
 * Deals screen queries.
 *
 * The Deals screen at `app/(creator)/deals/page.tsx` shows two pipelines:
 *   - Inbound  → `brandDeals` grouped by status (kanban-style)
 *   - Outbound → `pitchOutreach` grouped by status + opportunity matches
 *
 * Cross-tenant: same Clerk identity → creators row → creatorId chain as
 * the rest of the Creator HQ queries.
 *
 * Plan-tier:
 *   - `dealsByStatus` is universally available (every plan can manually
 *     enter or view inbound deals — the Gmail webhook integration is what
 *     gates Pro+, not the read of the pipeline itself).
 *   - `outreachByStatus` and `opportunityMatches` are Pro+ behaviors
 *     (`brandOutreachEnabled` + `opportunityScoutEnabled`); Starter sees
 *     empty arrays.
 *   - `dealDetail` / `outreachDetail` resolve a single record + drafts;
 *     gated to the matching tier on read.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { planFeatures } from "./lib/planFeatures";

async function getCurrentCreator(
  ctx: QueryCtx
): Promise<Doc<"creators"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
}

export type DealStatus =
  | "new"
  | "reviewing"
  | "negotiating"
  | "signed"
  | "shooting"
  | "submitted"
  | "paid"
  | "lost";

export type OutreachStatus =
  | "drafted"
  | "sent"
  | "replied"
  | "declined"
  | "no-response";

const DEAL_STATUS_ORDER: ReadonlyArray<DealStatus> = [
  "new",
  "reviewing",
  "negotiating",
  "signed",
  "shooting",
  "submitted",
  "paid",
  "lost",
];

const OUTREACH_STATUS_ORDER: ReadonlyArray<OutreachStatus> = [
  "drafted",
  "sent",
  "replied",
  "declined",
  "no-response",
];

/**
 * Inbound brand deals grouped by status. The UI renders this as a kanban
 * with one column per status — pre-bucketing on the server keeps the
 * client free of grouping logic and means an empty status renders as an
 * empty column rather than disappearing.
 */
export const dealsByStatus = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    const empty = emptyDealBuckets();
    if (!creator) return empty;

    const rows = await ctx.db
      .query("brandDeals")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .order("desc")
      .collect();

    for (const row of rows) {
      empty[row.status].push(row);
    }
    return empty;
  },
});

/**
 * Outbound pitch outreach grouped by status. Pro+ per
 * `planFeatures.brandOutreachEnabled`.
 */
export const outreachByStatus = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    const empty = emptyOutreachBuckets();
    if (!creator) return empty;
    if (!planFeatures(creator).brandOutreachEnabled) return empty;

    const rows = await ctx.db
      .query("pitchOutreach")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .order("desc")
      .collect();

    for (const row of rows) {
      empty[row.status].push(row);
    }
    return empty;
  },
});

/**
 * Latest opportunity-scout findings. Pro+ per
 * `planFeatures.opportunityScoutEnabled`.
 *
 * TODO(s5): the live opportunity surface table lands when the
 * `convex/agents/skills/opportunityScout.ts` action wires writes to a
 * dedicated `opportunitySurface` table. For Sprint 5 we shape the read
 * against that future table and currently return [] — the Outbound tab
 * still renders cleanly with the "no opportunities yet" empty state.
 *
 * Once the action lands, swap the body for:
 *   ctx.db.query("opportunitySurface")
 *     .withIndex("by_creator_and_observedAt", q => q.eq("creatorId", creator._id))
 *     .order("desc").take(20);
 *
 * The shape returned here matches the `Opportunity` type from
 * `agents/skills/maya-opportunity-scout/script.ts` so the UI can be wired
 * up against the final shape today and only the data-source flips later.
 */
export const opportunityMatches = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return [];
    if (!planFeatures(creator).opportunityScoutEnabled) return [];
    // Defensive: confirm the seen-cache exists so a future audit can grep
    // for the table being wired in. This read is bounded + cheap and acts
    // as the canary that the cron is firing for this creator at all.
    await ctx.db
      .query("opportunityScoutSeen")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .take(1);
    return [] as ReadonlyArray<{
      source: string;
      title: string;
      brandName?: string;
      fit: number;
      suggestedAction: "pitch" | "apply" | "monitor" | "skip";
      reasoning: string;
      url: string;
      estimatedRateRange?: { low: number; high: number };
      dueDate?: string;
      pitchStrategy?: "pitch-paid" | "pitch-free-build-book" | "pitch-gifted" | "decline";
    }>;
  },
});

/**
 * Single brand deal + the contract red-flag report (when present). The
 * detail panel reads this when a kanban card is clicked.
 *
 * Cross-tenant: validates `deal.creatorId === me._id` before returning —
 * the dealId is supplied by the client but never trusted.
 */
export const dealDetail = query({
  args: { dealId: v.id("brandDeals") },
  handler: async (ctx, args) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return null;
    const deal = await ctx.db.get(args.dealId);
    if (!deal) return null;
    if (deal.creatorId !== creator._id) return null;

    return {
      deal,
      replyVariants: deal.replyVariants,
      // Contract red-flag report lives on a separate table once Sprint 5
      // wires the `dealContracts` schema. For now we surface the report id
      // verbatim — the UI shows "report ready" or "no contract uploaded"
      // based on its presence.
      // TODO(s5): hydrate the actual report object via dealContracts table.
      redFlagReportId: deal.redFlagReportId ?? null,
      contractPdfId: deal.contractPdfId ?? null,
    };
  },
});

/**
 * Single pitch + follow-up cadence + reply thread surface. Pro+ per
 * brandOutreachEnabled.
 *
 * Cross-tenant: validates `pitch.creatorId === me._id` before returning.
 */
export const outreachDetail = query({
  args: { pitchId: v.id("pitchOutreach") },
  handler: async (ctx, args) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return null;
    if (!planFeatures(creator).brandOutreachEnabled) return null;

    const pitch = await ctx.db.get(args.pitchId);
    if (!pitch) return null;
    if (pitch.creatorId !== creator._id) return null;

    return {
      pitch,
      // Follow-up cadence is computed deterministically from sentAt /
      // lastFollowupAt — Maya re-derives it on every tick rather than
      // storing it. Ditto the reply thread, which lives in Gmail and is
      // surfaced in-UI via the Composio webhook payload (Sprint 5b agent).
      // TODO(s5): hydrate the follow-up cadence + Gmail thread mirror once
      // the parallel Composio agent's webhook handler lands.
      followUpCadence: null as ReadonlyArray<{
        at: number;
        kind: "first-followup" | "second-followup" | "final";
      }> | null,
      replyThread: null as ReadonlyArray<{
        from: string;
        body: string;
        ts: number;
      }> | null,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Pre-allocated empty bucket map — every status key is present so the UI
 * iterates a fixed set of columns even when none have rows. Keeps the
 * kanban shape stable across page loads.
 */
function emptyDealBuckets(): Record<DealStatus, Array<Doc<"brandDeals">>> {
  const out = {} as Record<DealStatus, Array<Doc<"brandDeals">>>;
  for (const s of DEAL_STATUS_ORDER) out[s] = [];
  return out;
}

function emptyOutreachBuckets(): Record<
  OutreachStatus,
  Array<Doc<"pitchOutreach">>
> {
  const out = {} as Record<OutreachStatus, Array<Doc<"pitchOutreach">>>;
  for (const s of OUTREACH_STATUS_ORDER) out[s] = [];
  return out;
}
