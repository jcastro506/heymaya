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
 * Record that the founder confirmed a specific preview.
 *
 * Written only from a real answer to a real question. There is deliberately no
 * argument here that lets a caller assert consent for a fingerprint nobody was
 * shown — the fingerprint is computed from the same assets that were sent.
 */
export const recordConfirmation = internalMutation({
  args: {
    customerId: v.id("customers"),
    draftId: v.optional(v.id("drafts")),
    fingerprint: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ recorded: boolean }> => {
    const now = args.now ?? Date.now();
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { recorded: false };

    let confirmations: Record<string, number> = {};
    try {
      confirmations = customer.tiktokConsentJson
        ? (JSON.parse(customer.tiktokConsentJson) as Record<string, number>)
        : {};
    } catch {
      confirmations = {};
    }

    confirmations[args.fingerprint] = now;

    /**
     * Keep the last 50. Consent is per-post and doesn't accumulate value —
     * an unbounded map on a customer row is a slow leak, and a fingerprint
     * nobody will publish again is dead weight.
     */
    const trimmed = Object.entries(confirmations)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50);

    await ctx.db.patch(args.customerId, {
      tiktokConsentJson: JSON.stringify(Object.fromEntries(trimmed)),
      updatedAt: now,
    });
    return { recorded: true };
  },
});

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
