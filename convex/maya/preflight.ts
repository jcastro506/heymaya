/**
 * Publish preflight (§18 Sprint 3, §11).
 *
 * Everything here runs BEFORE the founder is told a post is going out. That
 * ordering is the whole point: a preflight that runs after approval turns a
 * "yes" into an apology, which is the sequence §7.5.7 exists to prevent.
 *
 * These are *named* failures, not booleans (§17.x). "It didn't post" is the
 * thing this product was built to stop saying. Each failure carries what went
 * wrong and what the founder can do about it, in their language.
 *
 * Note what preflight is NOT: it is not a gate on publish-or-hold. That is
 * `publishDecision.decide`, and it stays the only thing that decides. Preflight
 * runs earlier, on the draft, so a draft that would be rejected never reaches
 * the founder in the first place.
 */

import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/* -------------------------------------------------------------------------- */
/* X's character counting — which is not String.length                        */
/* -------------------------------------------------------------------------- */

/**
 * X counts a "weighted length", not characters, and getting this wrong is a
 * rejection after we've already promised the post.
 *
 * Two rules that bite:
 *
 *   1. **Every URL counts as exactly 23**, however long it is. A 180-character
 *      tracking link costs 23. Counting it literally means we'd reject posts
 *      that are actually fine — which is worse than the reverse, because the
 *      founder never learns their good post was silently shortened.
 *   2. **Anything outside the Latin/general-punctuation ranges weighs 2** —
 *      CJK, and every emoji. One 🎉 is two characters.
 *
 * Ranges are twitter-text's default weighted config, normalized from its
 * hundredths scale to whole characters.
 */
const URL_LENGTH = 23;

/** Matches http(s) URLs and bare www./domain-style links the way t.co wraps them. */
const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9][-a-z0-9]*\.(?:com|org|net|io|dev|ai|co|app|xyz)\b(?:\/[^\s<>"']*)?/gi;

/** Code-point ranges that weigh 1. Everything else weighs 2. */
const LIGHT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
];

function weightOf(codePoint: number): number {
  for (const [lo, hi] of LIGHT_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return 1;
  }
  return 2;
}

/**
 * X's weighted length for a piece of text.
 *
 * Exported because the writer needs it too — a model told "under 280" will
 * count characters, and be wrong about exactly the posts that contain links.
 */
export function xWeightedLength(text: string): number {
  const withoutUrls = text.replace(URL_PATTERN, "");
  const urlCount = (text.match(URL_PATTERN) ?? []).length;

  let weight = 0;
  for (const char of withoutUrls) {
    weight += weightOf(char.codePointAt(0) ?? 0);
  }
  return weight + urlCount * URL_LENGTH;
}

/** Per-channel hard limits. X free tier is 280; the others are far looser. */
export const CHANNEL_LIMITS: Record<string, number> = {
  x: 280,
  instagram: 2200,
  tiktok: 2200,
  youtube: 5000,
};

/* -------------------------------------------------------------------------- */
/* Named failures                                                              */
/* -------------------------------------------------------------------------- */

export type PreflightFailure =
  | { kind: "empty" }
  | { kind: "over_length"; limit: number; actual: number; overBy: number }
  | { kind: "token_expired" }
  | { kind: "channel_missing" }
  | { kind: "duplicate"; existingUrl?: string };

export type PreflightResult =
  | { ok: true; weightedLength: number }
  | { ok: false; failure: PreflightFailure; message: string };

/**
 * Every failure gets a sentence a founder can act on. No status codes, no
 * field names — this text is written to be read by a person who did not build
 * the system.
 */
function messageFor(failure: PreflightFailure): string {
  switch (failure.kind) {
    case "empty":
      return "there's nothing written yet";
    case "over_length":
      return `this is ${failure.overBy} characters too long for the limit of ${failure.limit} — I'll tighten it`;
    case "token_expired":
      return "that account needs reconnecting before I can post";
    case "channel_missing":
      return "that account isn't connected yet";
    case "duplicate":
      return failure.existingUrl
        ? `I've already posted this one — ${failure.existingUrl}`
        : "I've already posted this one";
  }
}

function fail(failure: PreflightFailure): PreflightResult {
  return { ok: false, failure, message: messageFor(failure) };
}

/**
 * Pure preflight over the facts. Separated from the loading so every branch is
 * testable without a database.
 */
export function check(input: {
  channel: string;
  text: string;
  channelRow: Doc<"channels"> | null;
  duplicateOf?: { url?: string } | null;
}): PreflightResult {
  const { channel, text, channelRow, duplicateOf } = input;

  if (text.trim().length === 0) return fail({ kind: "empty" });

  if (!channelRow) return fail({ kind: "channel_missing" });
  // A channel in `error` is the token-health signal: Zernio marks the grant
  // dead and we surface it once, here, rather than as a 401 mid-publish.
  if (channelRow.status === "error" || channelRow.status === "disconnected") {
    return fail({ kind: "token_expired" });
  }

  if (duplicateOf) {
    return fail({ kind: "duplicate", existingUrl: duplicateOf.url });
  }

  const limit = CHANNEL_LIMITS[channel] ?? 2200;
  const weightedLength = xWeightedLength(text);
  if (weightedLength > limit) {
    return fail({
      kind: "over_length",
      limit,
      actual: weightedLength,
      overBy: weightedLength - limit,
    });
  }

  return { ok: true, weightedLength };
}

async function getDoc<T>(ctx: QueryCtx, id: string): Promise<T | null> {
  // Schema is at the TS instantiation ceiling; `db.get` no longer narrows.
  return (await ctx.db.get(id as Id<"drafts">)) as T | null;
}

/**
 * Preflight a draft.
 *
 * Duplicate detection compares against this customer's own recent placements
 * by exact snapshot text. Cross-tenant by construction: the index is scoped to
 * the customer, so two founders posting the same sentence never collide.
 */
export const preflightDraft = internalQuery({
  args: { customerId: v.id("customers"), draftId: v.id("drafts") },
  handler: async (ctx, args): Promise<PreflightResult> => {
    const draft = await getDoc<Doc<"drafts">>(ctx, args.draftId);
    if (!draft || draft.customerId !== args.customerId) {
      return fail({ kind: "empty" });
    }

    const channelRow = (await ctx.db
      .query("channels")
      .withIndex("by_customer_and_channel", (q) =>
        q
          .eq("customerId", args.customerId)
          .eq(
            "channel",
            draft.channel as "tiktok" | "instagram" | "youtube" | "x"
          )
      )
      .first()) as Doc<"channels"> | null;

    const recent = await ctx.db
      .query("placements")
      .withIndex("by_customer_and_publishedAt", (q) =>
        q
          .eq("customerId", args.customerId)
          .gte("publishedAt", Date.now() - 30 * 24 * 60 * 60 * 1000)
      )
      .collect();
    const duplicate = recent.find(
      (row) =>
        row.channel === draft.channel &&
        row.snapshotText.trim() === draft.snapshotText.trim()
    );

    return check({
      channel: draft.channel,
      text: draft.snapshotText,
      channelRow,
      duplicateOf: duplicate ? { url: duplicate.url } : null,
    });
  },
});
