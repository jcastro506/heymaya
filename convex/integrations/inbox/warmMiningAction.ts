/**
 * Sprint 11 — Layer 4 inbox warm-mining: runtime action.
 *
 * Wires the pure-function `warmMining.ts` heuristic to the live Gmail
 * API + Convex `brandContacts` table.
 *
 * Pipeline:
 *   1. Resolve creator's Gmail access token (direct OAuth via tokenResolver)
 *   2. Search inbox with the partnership-keyword `q` (filters most noise)
 *   3. For each result: fetch metadata (From/Subject/Date), score with
 *      `scoreInboxMessage`
 *   4. Upsert the candidate into `brandContacts` keyed by dedupeKey
 *
 * Idempotent: reruns won't duplicate. New threads write fresh rows;
 * recurring threads bump `lastInboundAt` + `warmth` based on age.
 *
 * Caller patterns:
 *   - Weekly cron from a Maya skill (maya-gmail-read or a dedicated
 *     warm-mining cron)
 *   - On-demand from creator chat ("scan my inbox for old brand emails")
 */
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { getMessageDetail, listInboxMessages } from "../google/gmail";
import {
  buildGmailSearchQuery,
  dedupeKey,
  scoreInboxMessage,
  type BrandContactCandidate,
  type InboxScanInput,
} from "./warmMining";
import type { Id, Doc } from "../../_generated/dataModel";

const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

/**
 * Check whether a brandContacts row already exists for this dedupeKey
 * + creator. Used by upsertBrandContact to decide insert vs patch.
 */
export const findBrandContactByDedupe = internalQuery({
  args: {
    creatorId: v.id("creators"),
    dedupeKey: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<"brandContacts"> | null> => {
    return await ctx.db
      .query("brandContacts")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", args.dedupeKey))
      .filter((q) => q.eq(q.field("creatorId"), args.creatorId))
      .first();
  },
});

export const upsertBrandContact = internalMutation({
  args: {
    creatorId: v.id("creators"),
    candidate: v.object({
      brand: v.string(),
      contactName: v.optional(v.string()),
      contactRole: v.optional(v.string()),
      contactEmail: v.string(),
      warmth: v.union(v.literal("hot"), v.literal("warm")),
      threadId: v.string(),
      messageId: v.string(),
      internalDateMs: v.number(),
      matchedKeywords: v.array(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<{ id: Id<"brandContacts">; created: boolean }> => {
    const c = args.candidate;
    const key = `${args.creatorId}::${c.brand.toLowerCase()}::${c.contactEmail.toLowerCase()}`;
    const existing = await ctx.db
      .query("brandContacts")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", key))
      .filter((q) => q.eq(q.field("creatorId"), args.creatorId))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        warmth: c.warmth,
        lastInboundAt: Math.max(existing.lastInboundAt ?? 0, c.internalDateMs),
        contactName: c.contactName ?? existing.contactName,
        contactRole: c.contactRole ?? existing.contactRole,
        sourceRef: c.threadId,
      });
      return { id: existing._id, created: false };
    }
    const id = await ctx.db.insert("brandContacts", {
      creatorId: args.creatorId,
      brand: c.brand,
      contactName: c.contactName,
      contactRole: c.contactRole,
      contactEmail: c.contactEmail,
      source: "inbox-warm",
      sourceRef: c.threadId,
      warmth: c.warmth,
      lastInboundAt: c.internalDateMs,
      dedupeKey: key,
      status: "active",
      discoveredAt: now,
      notes: c.matchedKeywords.slice(0, 3).join(", "),
    });
    return { id, created: true };
  },
});

/**
 * Sweep the creator's Gmail inbox for partnership-pattern threads,
 * upsert each hit into `brandContacts`. Returns a per-run summary.
 *
 * Caller-bounded recency: defaults to 365d. Caller-bounded result cap:
 * Gmail returns up to `maxResults` (default 50) message refs; each one
 * costs an additional metadata fetch, so this stays under ~10s of work.
 */
export const sweepCreatorInbox = internalAction({
  args: {
    creatorId: v.id("creators"),
    sinceDays: v.optional(v.number()),
    maxResults: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    scanned: number;
    candidates: number;
    inserted: number;
    updated: number;
    skipped: number;
  }> => {
    const sinceDays = args.sinceDays ?? 365;
    const maxResults = args.maxResults ?? 50;

    let token: { accessToken: string; grantedScopes: string[] };
    try {
      token = await ctx.runAction(
        internal.integrations.google.tokenResolver.resolveGoogleAccessTokenForCreator,
        { creatorId: args.creatorId, requiredScope: GMAIL_MODIFY_SCOPE }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Fail loudly — caller should distinguish "creator not connected" from
      // "Gmail outage". The two are different operator concerns.
      throw new Error(`tokenResolve:${msg}`);
    }

    const q = buildGmailSearchQuery({ sinceDays });
    const list = await listInboxMessages(token.accessToken, {
      maxResults,
      q,
    });

    let candidates = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const ref of list.messages) {
      let detail;
      try {
        detail = await getMessageDetail(token.accessToken, ref.id, "metadata");
      } catch {
        skipped += 1;
        continue;
      }
      const headers = detail.payload?.headers ?? [];
      const fromHeader = headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
      const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "";
      const internalDateMs = Number(detail.internalDate ?? 0) || 0;
      const snippet = detail.snippet ?? "";
      const scan: InboxScanInput = {
        fromHeader,
        subject,
        snippet,
        internalDateMs,
        threadId: detail.threadId ?? ref.threadId ?? "",
        messageId: detail.id ?? ref.id,
      };
      const candidate = scoreInboxMessage(scan);
      if (!candidate) continue;
      candidates += 1;

      const result = await ctx.runMutation(
        internal.integrations.inbox.warmMiningAction.upsertBrandContact,
        {
          creatorId: args.creatorId,
          candidate: candidateToMutationArg(candidate),
        }
      );
      if (result.created) inserted += 1;
      else updated += 1;
    }

    return {
      scanned: list.messages.length,
      candidates,
      inserted,
      updated,
      skipped,
    };
  },
});

function candidateToMutationArg(c: BrandContactCandidate) {
  return {
    brand: c.brand,
    contactName: c.contactName,
    contactRole: c.contactRole,
    contactEmail: c.contactEmail,
    warmth: c.warmth,
    threadId: c.threadId,
    messageId: c.messageId,
    internalDateMs: c.internalDateMs,
    matchedKeywords: [...c.matchedKeywords],
  };
}
