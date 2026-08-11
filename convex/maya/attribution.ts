/**
 * ⭐ Attribution (§14.45, Sprint 8) — "one signup traced end to end, with links."
 *
 * §18 Sprint 8 says **reuse, don't rebuild**, and the reusable part is real:
 * `gtmMaya/attribution.ts` already owns a token redirect at `/r/<token>` that
 * logs the click, appends UTM so the founder's own analytics sees it too, and
 * hands `lc_ref` to the destination so a pixel can echo it back on signup.
 *
 * That machinery is entirely generic — it works off a token and a destination
 * URL. Only the **owner** was tied to `gtmAgents`, the deleted product's
 * entity. So this adds the new module's half rather than a second redirect.
 *
 * ## The chain, and where it actually breaks
 *
 * ```
 * idea → draft → placement → linkWrap → click → conversion
 * ```
 *
 * ⚠️ Everything up to and including the **click** is ours and certain. The
 * conversion is not: it depends on the founder's own site reporting back,
 * either through the pixel or by telling us. §14.45 names this as the honest
 * hard part, and `traceConversion` says which hops are evidence and which are
 * inference rather than presenting one confident line.
 *
 * That distinction is the whole reason this exists. "Which post got the
 * signup" is the product's central claim, and a claim built on a hop we
 * guessed at is worse than one that says where it stops being sure.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/** Short, unguessable enough for a public redirect, short enough for a caption. */
export const TOKEN_LENGTH = 10;

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * ⚠️ No `l`, `o`, `0` or `1`. A founder reads these aloud and types them by
 * hand more often than you'd expect, and a token that resolves to the wrong
 * post is worse than one that resolves to nothing.
 */
export function makeToken(random: () => number): string {
  let out = "";
  for (let i = 0; i < TOKEN_LENGTH; i += 1) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return out;
}

/**
 * ⭐ Wrap the product link that goes out with a placement.
 *
 * `placementId` is the point. A wrap with no placement is a link we can count
 * clicks on and never explain — and "which post got the signup" is the entire
 * question this table exists to answer.
 */
export const wrapForPlacement = internalMutation({
  args: {
    customerId: v.id("customers"),
    placementId: v.id("placements"),
    destinationUrl: v.string(),
    channel: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; token?: string; reason?: string }> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { ok: false, reason: "no such account" };

    const placement = (await ctx.db.get(args.placementId)) as Doc<"placements"> | null;
    // Cross-tenant guard: a placement from another account never resolves.
    if (!placement || placement.customerId !== args.customerId) {
      return { ok: false, reason: "that placement belongs to a different account" };
    }

    /**
     * One wrap per placement. A second would split the same post's clicks
     * across two tokens and make the totals quietly wrong — which is the kind
     * of error that survives because both halves look plausible.
     */
    const existing = (await ctx.db
      .query("gtmLinkWraps")
      .withIndex("by_account", (q) => q.eq("accountId", customer.accountId))
      .collect()) as Doc<"gtmLinkWraps">[];
    const already = existing.find((w) => w.placementId === args.placementId);
    if (already) return { ok: true, token: already.token };

    const now = args.now ?? Date.now();
    const taken = new Set(existing.map((w) => w.token));
    let token = makeToken(Math.random);
    // Collisions are vanishingly unlikely and catastrophic — a token pointing
    // at someone else's destination — so check rather than assume.
    for (let i = 0; i < 5 && taken.has(token); i += 1) token = makeToken(Math.random);
    if (taken.has(token)) return { ok: false, reason: "couldn't mint a link" };

    await ctx.db.insert("gtmLinkWraps", {
      accountId: customer.accountId,
      customerId: args.customerId,
      placementId: args.placementId,
      token,
      destinationUrl: args.destinationUrl,
      platform: args.channel ?? placement.channel,
      utmSource: args.channel ?? placement.channel,
      utmMedium: "social",
      utmCampaign: "maya",
      createdAt: now,
    });

    return { ok: true, token };
  },
});

/**
 * Record a conversion the founder told us about, or the pixel reported.
 *
 * ⚠️ `source` is kept because the two are not equally good evidence. A pixel
 * carries `lc_ref` back and names the exact post; a self-report is the founder
 * saying "we got three signups" and may attach to the wrong one. §12's
 * freshness rule, applied to certainty.
 */
export const recordConversion = internalMutation({
  args: {
    customerId: v.id("customers"),
    kind: v.union(
      v.literal("signup"),
      v.literal("demo"),
      v.literal("feedback"),
      v.literal("revenue"),
      v.literal("activated")
    ),
    count: v.number(),
    source: v.union(v.literal("self_report"), v.literal("pixel")),
    /** Present when the pixel echoed `lc_ref` — the difference between knowing and guessing. */
    token: v.optional(v.string()),
    note: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; conversionId?: Id<"gtmConversions">; reason?: string }> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { ok: false, reason: "no such account" };
    if (args.count <= 0) return { ok: false, reason: "a conversion needs a count" };

    let linkWrapId: Id<"gtmLinkWraps"> | undefined;
    if (args.token) {
      const wrap = (await ctx.db
        .query("gtmLinkWraps")
        .withIndex("by_token", (q) => q.eq("token", args.token!))
        .unique()
        .catch(() => null)) as Doc<"gtmLinkWraps"> | null;
      // ⚠️ A token from another account is ignored rather than trusted. The
      // pixel is on the founder's own site and its input is not ours.
      if (wrap && wrap.customerId === args.customerId) linkWrapId = wrap._id;
    }

    const conversionId = await ctx.db.insert("gtmConversions", {
      accountId: customer.accountId,
      customerId: args.customerId,
      kind: args.kind,
      count: args.count,
      source: args.source,
      linkWrapId,
      occurredAt: args.now ?? Date.now(),
      note: args.note,
    });
    return { ok: true, conversionId };
  },
});

/* -------------------------------------------------------------------------- */

export interface TraceHop {
  step: "conversion" | "link" | "click" | "placement" | "draft" | "idea";
  /** What we know at this hop, in plain language. */
  detail: string;
  /** ⭐ Openable. §6: a source you can't open isn't a source. */
  url?: string;
  /** False when this hop is inferred rather than recorded. */
  evidence: boolean;
}

export interface Trace {
  ok: boolean;
  hops: TraceHop[];
  /** Where the chain stopped being certain — named, never smoothed over. */
  breaksAt?: string;
  detail: string;
}

/**
 * ⭐ Sprint 8's exit criterion: one signup, traced end to end, with links.
 *
 * ⚠️ Reports where the chain BREAKS rather than presenting a confident line.
 * A self-reported signup with no token is a real signup and an unproven
 * attribution — saying "this post got it" would be exactly the invented
 * certainty §2.7 forbids, and it is the specific lie this product exists not
 * to tell.
 */
export const traceConversion = internalQuery({
  args: { conversionId: v.id("gtmConversions") },
  handler: async (ctx, args): Promise<Trace> => {
    const conv = (await ctx.db.get(args.conversionId)) as Doc<"gtmConversions"> | null;
    if (!conv) return { ok: false, hops: [], detail: "no such conversion" };

    const hops: TraceHop[] = [
      {
        step: "conversion",
        detail: `${conv.count} ${conv.kind}${conv.count === 1 ? "" : "s"}, ${
          conv.source === "pixel" ? "reported by your site" : "you told me"
        }`,
        evidence: true,
      },
    ];

    if (!conv.linkWrapId) {
      return {
        ok: false,
        hops,
        breaksAt: "link",
        detail:
          conv.source === "self_report"
            ? "you told me about this one, but it didn't come through a link I made — so I can't say which post it was"
            : "no link came back with it, so I can't tie it to a post",
      };
    }

    const wrap = (await ctx.db.get(conv.linkWrapId)) as Doc<"gtmLinkWraps"> | null;
    if (!wrap) return { ok: false, hops, breaksAt: "link", detail: "that link is gone" };

    const clicks = (await ctx.db
      .query("gtmLinkClicks")
      .withIndex("by_link_wrap", (q) => q.eq("linkWrapId", wrap._id))
      .collect()) as Doc<"gtmLinkClicks">[];

    hops.push({
      step: "link",
      detail: `came through a link I made${
        clicks.length > 0 ? `, clicked ${clicks.length} time${clicks.length === 1 ? "" : "s"}` : ""
      }`,
      evidence: true,
    });

    if (!wrap.placementId) {
      return {
        ok: false,
        hops,
        breaksAt: "placement",
        detail: "that link wasn't attached to a post I made",
      };
    }

    const placement = (await ctx.db.get(wrap.placementId)) as Doc<"placements"> | null;
    if (!placement) {
      return { ok: false, hops, breaksAt: "placement", detail: "that post is gone" };
    }

    hops.push({
      step: "placement",
      detail: `${placement.channel} post`,
      url: placement.url ?? undefined,
      evidence: true,
    });

    /**
     * The last two hops are provenance rather than attribution: they say what
     * the post was BUILT from. Absent is normal for an older placement and is
     * reported as such, not as a break.
     */
    if (placement.ideaId) {
      const idea = (await ctx.db.get(placement.ideaId)) as Doc<"ideas"> | null;
      if (idea) {
        let sourceUrl: string | undefined;
        try {
          const evidence = idea.evidenceJson
            ? (JSON.parse(idea.evidenceJson) as { sourceUrls?: string[] })
            : null;
          sourceUrl = evidence?.sourceUrls?.[0];
        } catch {
          sourceUrl = undefined;
        }
        hops.push({
          step: "idea",
          detail: idea.angle,
          url: sourceUrl,
          evidence: true,
        });
      }
    }

    return {
      ok: true,
      hops,
      detail:
        conv.source === "pixel"
          ? `traced: your site reported it and named the link, so this is the post that got it`
          : `traced through the link, though you reported the signup rather than your site doing it`,
    };
  },
});

/**
 * Every conversion for a customer, newest first, with its trace.
 *
 * ⚠️ Untraceable conversions are INCLUDED. A results view that quietly shows
 * only the attributable ones overstates how much we can explain — which is the
 * failure §18's "never report inventory as results" test exists to catch,
 * pointed at attribution instead of drafts.
 */
export const recentConversions = internalQuery({
  args: { customerId: v.id("customers"), limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<Array<{ conversionId: Id<"gtmConversions">; kind: string; count: number; source: string; occurredAt: number; traced: boolean }>> => {
    const rows = (await ctx.db
      .query("gtmConversions")
      .withIndex("by_account")
      .order("desc")
      .take(200)) as Doc<"gtmConversions">[];

    return rows
      .filter((r) => r.customerId === args.customerId)
      .slice(0, args.limit ?? 20)
      .map((r) => ({
        conversionId: r._id,
        kind: r.kind,
        count: r.count,
        source: r.source,
        occurredAt: r.occurredAt,
        traced: Boolean(r.linkWrapId),
      }));
  },
});
