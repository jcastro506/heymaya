/**
 * ⭐ TikTok's rendered-preview consent (Sprint 7) — recorded, not assumed.
 *
 * TikTok requires that a human sees what will be posted and confirms it before
 * anything published through the API goes out. Zernio exposes this as
 * `contentPreviewConfirmed` and `expressConsentGiven` on `tiktokSettings`.
 *
 * ⚠️ **Nothing in the product set either flag.** The only occurrences in the
 * repo were inside a vendor contract test. So the choices were to publish
 * without them, or to hardcode them true — and hardcoding them is worse than
 * the bug: it is a compliance statement about a human action that never
 * happened, made by a machine, on the founder's account.
 *
 * `PLATFORM_ALGO/tiktok.md` states the framing this file exists to honour:
 * *"the founder must confirm the rendered preview before anything posts. That's
 * TikTok's legal requirement, and I say so as theirs, not as my caution."*
 * Framed as our carefulness, a founder can reasonably ask us to skip it.
 *
 * ## Why consent is bound to a fingerprint
 *
 * The obvious implementation — a boolean on the draft, or a "founder said yes"
 * flag — authorises *the next post*, not *the post they saw*. Slides get
 * re-rendered, a caption gets edited after approval, a set gets rebuilt from a
 * different idea. Each of those produces something the founder never looked at,
 * carrying a confirmation they gave for something else.
 *
 * So the record is keyed to a fingerprint of exactly what was shown. Change any
 * asset or a character of the caption and the consent no longer matches, which
 * is the correct answer rather than an inconvenience.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * What the founder actually saw, as one stable string.
 *
 * ⚠️ Order-sensitive on the assets, deliberately. A carousel is a sequence — a
 * set reordered is a different post, and slide 1 is the one that decides whether
 * anyone swipes. Sorting here would let a reshuffle inherit consent.
 */
export function previewFingerprint(input: {
  assetUrls: string[];
  caption: string;
}): string {
  const material = `${input.assetUrls.join("|")}::${input.caption.trim()}`;
  // FNV-1a. Not a security boundary — this detects change, and the record it
  // guards is server-side and never supplied by a caller.
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `pv_${hash.toString(36)}_${material.length.toString(36)}`;
}


/**
 * ⚠️ Consent expires.
 *
 * A confirmation from three weeks ago is not consent to post today — the
 * founder has forgotten what they looked at, and the surrounding context (a
 * launch, an outage, something in the news) has moved. Seven days is long
 * enough for an approved post to sit in a queue over a weekend and short
 * enough that nobody is surprised by it.
 */
export const CONSENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const consentFor = internalQuery({
  args: {
    customerId: v.id("customers"),
    fingerprint: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ confirmed: boolean; confirmedAt?: number; reason?: string }> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { confirmed: false, reason: "no such account" };

    let confirmations: Record<string, number> = {};
    try {
      confirmations = customer.tiktokConsentJson
        ? (JSON.parse(customer.tiktokConsentJson) as Record<string, number>)
        : {};
    } catch {
      return { confirmed: false, reason: "no confirmation on file" };
    }

    const at = confirmations[args.fingerprint];
    if (!at) {
      /**
       * The message names the real situation. "Not approved" reads as a
       * process failure; this reads as what it is — the thing about to go out
       * isn't the thing they looked at.
       */
      return {
        confirmed: false,
        reason: "this isn't the version you looked at",
      };
    }

    const now = args.now ?? Date.now();
    if (now - at > CONSENT_TTL_MS) {
      return {
        confirmed: false,
        confirmedAt: at,
        reason: "you okayed this over a week ago — worth a fresh look",
      };
    }
    return { confirmed: true, confirmedAt: at };
  },
});

/**
 * ⭐ The one function that decides whether TikTok may publish.
 *
 * Pure, so the rule is checkable without a database or a vendor. Returns the
 * platform settings to send rather than a boolean, so there is exactly one
 * place those flags can originate — a caller cannot set them a different way
 * without going around this, and going around it is visible in review.
 */
export function tiktokSettingsFor(input: {
  confirmed: boolean;
}): { contentPreviewConfirmed: true; expressConsentGiven: true } | null {
  // ⚠️ No third state. Either a matching confirmation exists and both flags are
  // true, or nothing publishes. A partial send would assert one form of consent
  // while lacking the other.
  return input.confirmed
    ? { contentPreviewConfirmed: true, expressConsentGiven: true }
    : null;
}

/**
 * ⭐ Record a confirmation from server-side rows only.
 *
 * The caller names a draft and some assets. Everything the fingerprint is built
 * from — the caption, the URLs — is read here, from the database. Nothing the
 * caller says about *what was approved* is trusted, which is what stops an
 * agent from attesting to an approval of something nobody saw.
 */
export const confirmFromDraft = internalMutation({
  args: {
    customerId: v.id("customers"),
    draftId: v.id("drafts"),
    assetIds: v.array(v.id("mediaAssets")),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; fingerprint?: string; reason?: string }> => {
    const draft = (await ctx.db.get(args.draftId)) as Doc<"drafts"> | null;
    if (!draft || draft.customerId !== args.customerId) {
      return { ok: false, reason: "that draft isn't on this account" };
    }

    /**
     * ⚠️ Order is preserved from the caller's list, not from the database.
     *
     * The founder saw a sequence, and a carousel's order is part of what they
     * approved. Reading the assets back in insertion order would quietly
     * approve a different arrangement than the one on their screen.
     */
    const assetUrls: string[] = [];
    for (const assetId of args.assetIds) {
      const asset = (await ctx.db.get(assetId)) as Doc<"mediaAssets"> | null;
      if (!asset || asset.customerId !== args.customerId) {
        return { ok: false, reason: "one of those images isn't on this account" };
      }
      if (!asset.publicUrl) {
        // An asset with no URL can't have been shown to anyone.
        return { ok: false, reason: "one of those images has no link to show" };
      }
      assetUrls.push(asset.publicUrl);
    }

    const fingerprint = previewFingerprint({
      assetUrls,
      /**
       * `snapshotText` is documented as "the exact text shown to the founder;
       * publishing reads THIS" — so consent and publication are computed from
       * the same field, and cannot describe different sentences.
       */
      caption: draft.snapshotText,
    });

    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { ok: false, reason: "no such account" };

    const now = args.now ?? Date.now();
    let confirmations: Record<string, number> = {};
    try {
      confirmations = customer.tiktokConsentJson
        ? (JSON.parse(customer.tiktokConsentJson) as Record<string, number>)
        : {};
    } catch {
      confirmations = {};
    }
    confirmations[fingerprint] = now;

    const trimmed = Object.entries(confirmations)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50);
    await ctx.db.patch(args.customerId, {
      tiktokConsentJson: JSON.stringify(Object.fromEntries(trimmed)),
      updatedAt: now,
    });

    return { ok: true, fingerprint };
  },
});
