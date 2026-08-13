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
import { internalMutation, internalQuery, query } from "../_generated/server";
import { internal } from "../_generated/api";
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
      v.literal("activated"),
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
    args,
  ): Promise<{
    ok: boolean;
    conversionId?: Id<"gtmConversions">;
    reason?: string;
  }> => {
    const customer = (await ctx.db.get(
      args.customerId,
    )) as Doc<"customers"> | null;
    if (!customer) return { ok: false, reason: "no such account" };
    if (args.count <= 0)
      return { ok: false, reason: "a conversion needs a count" };

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
    const conv = (await ctx.db.get(
      args.conversionId,
    )) as Doc<"gtmConversions"> | null;
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

    const wrap = (await ctx.db.get(
      conv.linkWrapId,
    )) as Doc<"gtmLinkWraps"> | null;
    if (!wrap)
      return { ok: false, hops, breaksAt: "link", detail: "that link is gone" };

    const clicks = (await ctx.db
      .query("gtmLinkClicks")
      .withIndex("by_link_wrap", (q) => q.eq("linkWrapId", wrap._id))
      .collect()) as Doc<"gtmLinkClicks">[];

    hops.push({
      step: "link",
      detail: `came through a link I made${
        clicks.length > 0
          ? `, clicked ${clicks.length} time${clicks.length === 1 ? "" : "s"}`
          : ""
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

    const placement = (await ctx.db.get(
      wrap.placementId,
    )) as Doc<"placements"> | null;
    if (!placement) {
      return {
        ok: false,
        hops,
        breaksAt: "placement",
        detail: "that post is gone",
      };
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
    args,
  ): Promise<
    Array<{
      conversionId: Id<"gtmConversions">;
      kind: string;
      count: number;
      source: string;
      occurredAt: number;
      traced: boolean;
    }>
  > => {
    /**
     * ⚠️ Scoped by INDEX, not by a post-hoc filter.
     *
     * This used to scan `by_account` with no `.eq()`, take the newest 200 rows
     * fleet-wide, and filter to the customer in JS. It looks scoped and is
     * not: with more than one customer, a founder's conversions can be pushed
     * out of that 200 entirely and the screen reports zero signups to someone
     * who had some. §16.2 calls Results "the reason they don't cancel".
     */
    const rows = (await ctx.db
      .query("gtmConversions")
      .withIndex("by_customer_and_occurredAt", (q) =>
        q.eq("customerId", args.customerId),
      )
      .order("desc")
      .take(args.limit ?? 20)) as Doc<"gtmConversions">[];

    return rows.map((r) => ({
      conversionId: r._id,
      kind: r.kind,
      count: r.count,
      source: r.source,
      occurredAt: r.occurredAt,
      traced: Boolean(r.linkWrapId),
    }));
  },
});

/* -------------------------------------------------------------------------- */

/**
 * ⭐ Read a signup count out of a founder's reply — §14.45 rung 4.
 *
 * > *"Weekly self-report — 'roughly how many signups this week?' | A total,
 * > unattributed | one sentence | **Lossy, but universal**."*
 *
 * ⚠️ Returns `null` when there is no number, and null means RECORD NOTHING.
 * "not sure yet" is not zero, and writing a 0 for it would put a fabricated
 * data point on the one screen §16.2 says they cancel over.
 *
 * Deliberately simple: the first plain number wins. "like 4 or 5" reads as 4,
 * which the spec already accepts as lossy — a model call to split that hair
 * would cost more than the answer is worth and could hallucinate a figure the
 * founder never said.
 */
export function parseSignupCount(text: string): number | null {
  const t = text.toLowerCase().trim();

  // Words for nothing, which people use far more often than "0".
  if (/^(none|nope|no|zero|nothing|not one|nada)\b/.test(t)) return 0;

  /**
   * ⚠️ They answered about a DIFFERENT metric.
   *
   * "got 2000 impressions" would otherwise book 2000 signups and make every
   * later number meaningless. Magnitude alone can't catch this — 2000 is
   * absurd for signups and ordinary for views, but a genuinely great week is
   * also a big number, and rejecting it would punish the customer we most want
   * to keep. The NOUN is the signal, so that is what's checked.
   */
  /**
   * ⚠️ "like" is NOT in this list, deliberately. It is the commonest filler
   * word in English — "like 4 or 5" is a normal answer, and treating it as
   * Instagram likes rejected a perfectly good number. A signal that fires on
   * ordinary speech is worse than no signal.
   */
  if (/\b(impression|view|click|follower|reply|comment|visit)/.test(t)) {
    // Unless they named signups too, in which case the number is probably ours.
    if (!/\b(signup|sign-up|sign up|customer|user|trial)/.test(t)) return null;
  }

  const m = t.match(/\d[\d,]*/);
  if (!m) return null;

  const n = Number(m[0].replace(/,/g, ""));
  // A generous ceiling — high enough never to reject a real week for this
  // ICP, low enough that a pasted timestamp or id is not read as a result.
  if (!Number.isFinite(n) || n < 0 || n > 100_000) return null;
  return n;
}

/* -------------------------------------------------------------------------- */

/**
 * ⭐ Results, for the founder's own screen (§16.2 — "the retention screen. The
 * reason they don't cancel.")
 *
 * ⚠️ Every function above is `internalQuery`/`internalMutation`. So the
 * attribution chain — the thing §14.45 exists for — was computed and reachable
 * by nobody the founder could ask. Mission Control's Results screen reads
 * `gtmMaya.missionControl.getMyConversions` and `gtmPostResults`, both of which
 * the live module never writes.
 *
 * ## What this deliberately reports
 *
 * §5.0.0's sentence, stated plainly: how many of the results we can point at a
 * post for, **and how many we can't**. An attribution number without its
 * untraced remainder is a number that flatters us — and §14.45's whole design
 * is that a broken chain is REPORTED, never guessed at.
 */
export interface MyResults {
  ok: boolean;
  /** Signups, calls, sales — whatever their KPI counts. */
  total: number;
  /** ⭐ The ones we can point at a specific post for. */
  traced: number;
  /** ⚠️ Stated, not omitted. The gap is the honest part. */
  untraced: number;
  windowDays: number;
  error?: string;
}

export const myResults = query({
  args: { windowDays: v.optional(v.number()) },
  handler: async (ctx, args): Promise<MyResults> => {
    const empty = { total: 0, traced: 0, untraced: 0, windowDays: 30 };

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, ...empty, error: "sign in first" };

    const creator = (await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first()) as Doc<"creators"> | null;
    if (!creator) return { ok: false, ...empty, error: "no account yet" };

    const customer = (await ctx.db
      .query("customers")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first()) as Doc<"customers"> | null;
    if (!customer) return { ok: false, ...empty, error: "no account yet" };

    const windowDays = args.windowDays ?? 30;
    const since = Date.now() - windowDays * 86_400_000;

    const rows = (await ctx.db
      .query("gtmConversions")
      .withIndex("by_customer_and_occurredAt", (q) =>
        q.eq("customerId", customer._id).gte("occurredAt", since),
      )
      .collect()) as Doc<"gtmConversions">[];

    // `linkWrapId` is the chain: a conversion carrying one can be walked back
    // to the placement that produced it (§14.45).
    const traced = rows
      .filter((r) => r.linkWrapId)
      .reduce((sum, r) => sum + r.count, 0);
    const total = rows.reduce((sum, r) => sum + r.count, 0);

    return { ok: true, total, traced, untraced: total - traced, windowDays };
  },
});

/* -------------------------------------------------------------------------- */

/**
 * ⭐ §14.45 rung 1 — the bio link. "None — always on."
 *
 * ## Why a bio link and not a link in every post
 *
 * §16.3's own worked example names it:
 *
 * > *"the gap is the bio link — 310 people looked at your profile and 38
 * > clicked. I'd rewrite the bio before making more videos."*
 *
 * And §14.2's L3 measures *"profile visits, link clicks"* — profile, then bio,
 * then click. On TikTok and Instagram an in-post link is not clickable at all,
 * so the bio is the ONLY bridge. Jamming a URL into every caption would also
 * cost reach on the one channel where it does work, which trades the product's
 * core job for a metric.
 *
 * ## ⚠️ The property that makes this rock solid: it NEVER changes
 *
 * The founder pastes this into their profile by hand — we have no bio-write
 * API and the product never logs in as them (§5). So a token that rotates
 * silently points every already-pasted bio at nothing, and the clicks simply
 * stop with no error anywhere.
 *
 * Find-or-create, per customer per channel, forever. There is deliberately no
 * "regenerate".
 */
export const ensureBioLink = internalMutation({
  args: {
    customerId: v.id("customers"),
    channel: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; token?: string; reason?: string }> => {
    const customer = (await ctx.db.get(
      args.customerId,
    )) as Doc<"customers"> | null;
    if (!customer) return { ok: false, reason: "no such account" };

    /**
     * ⚠️ Grounded or silent (§2.7). With no product URL there is nothing to
     * point at, and a bio link to a placeholder is worse than none — the
     * founder pastes it once and it is wrong forever.
     */
    let destination = "";
    try {
      const truth = JSON.parse(customer.productTruthJson ?? "{}") as {
        url?: unknown;
      };
      if (typeof truth.url === "string") destination = truth.url;
    } catch {
      destination = "";
    }
    if (!/^https?:\/\/.+\..+/.test(destination)) {
      return { ok: false, reason: "no product URL yet" };
    }

    const existing = (await ctx.db
      .query("gtmLinkWraps")
      .withIndex("by_account", (q) => q.eq("accountId", customer.accountId))
      .collect()) as Doc<"gtmLinkWraps">[];

    /**
     * ⭐ The reuse check, and the whole point of this function. A bio wrap is
     * identified by having no placement and `utmMedium: "bio"` — one per
     * channel, returned unchanged for the life of the account.
     */
    const already = existing.find(
      (w) =>
        w.customerId === args.customerId &&
        w.utmMedium === "bio" &&
        w.platform === args.channel,
    );
    if (already) return { ok: true, token: already.token };

    const taken = new Set(existing.map((w) => w.token));
    let token = makeToken(Math.random);
    for (let i = 0; i < 5 && taken.has(token); i += 1) {
      token = makeToken(Math.random);
    }
    if (taken.has(token)) return { ok: false, reason: "couldn't mint a link" };

    await ctx.db.insert("gtmLinkWraps", {
      accountId: customer.accountId,
      customerId: args.customerId,
      // ⚠️ No placementId, deliberately — a bio link belongs to the PROFILE
      // and outlives every individual post.
      token,
      destinationUrl: destination,
      platform: args.channel,
      utmSource: args.channel,
      utmMedium: "bio",
      utmCampaign: "maya",
      createdAt: args.now ?? Date.now(),
    });

    return { ok: true, token };
  },
});

/**
 * The URL the founder actually pastes.
 *
 * ⚠️ Absolute, and built from `APP_URL` — a relative path in someone's
 * Instagram bio is not a link. Returns null rather than a broken string when
 * the base is unset, because a half-formed URL pasted into a profile is
 * permanent damage.
 */
export function bioLinkUrl(appUrl: string, token: string): string | null {
  const base = appUrl.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) return null;
  return `${base}/r/${token}`;
}

/* -------------------------------------------------------------------------- */

/**
 * ⭐ Wrap the product link that a draft already contains — §14.45 rung 1,
 * in-post.
 *
 * ## Why at draft time and not at publish
 *
 * `publish.ts` is explicit: *"The text we publish is the text that was
 * approved. Re-generating or re-formatting here would break the snapshot
 * guarantee — the founder said yes to a specific string."*
 *
 * ⚠️ So swapping a URL at publish would publish something they never read. The
 * tracked link has to be in the text BEFORE they approve it, which means the
 * wrap is minted here and bound to the placement afterwards.
 *
 * ## ⚠️ It never invents a link
 *
 * This only rewrites a product URL the draft already contains. Adding one
 * would change what she wrote to serve our metrics — and on TikTok and
 * Instagram an in-post link isn't even clickable, so it would be noise in the
 * caption for nothing.
 */
export const wrapForDraft = internalMutation({
  args: {
    customerId: v.id("customers"),
    draftId: v.id("drafts"),
    destinationUrl: v.string(),
    channel: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; token?: string; reason?: string }> => {
    const customer = (await ctx.db.get(
      args.customerId,
    )) as Doc<"customers"> | null;
    if (!customer) return { ok: false, reason: "no such account" };

    const existing = (await ctx.db
      .query("gtmLinkWraps")
      .withIndex("by_maya_draft", (q) => q.eq("mayaDraftId", args.draftId))
      .collect()) as Doc<"gtmLinkWraps">[];
    // One wrap per draft — a second would split the same post's clicks.
    if (existing[0]) return { ok: true, token: existing[0].token };

    const all = (await ctx.db
      .query("gtmLinkWraps")
      .withIndex("by_account", (q) => q.eq("accountId", customer.accountId))
      .collect()) as Doc<"gtmLinkWraps">[];
    const taken = new Set(all.map((w) => w.token));

    let token = makeToken(Math.random);
    for (let i = 0; i < 5 && taken.has(token); i += 1) {
      token = makeToken(Math.random);
    }
    if (taken.has(token)) return { ok: false, reason: "couldn't mint a link" };

    await ctx.db.insert("gtmLinkWraps", {
      accountId: customer.accountId,
      customerId: args.customerId,
      mayaDraftId: args.draftId,
      token,
      destinationUrl: args.destinationUrl,
      platform: args.channel,
      utmSource: args.channel,
      utmMedium: "social",
      utmCampaign: "maya",
      createdAt: args.now ?? Date.now(),
    });

    return { ok: true, token };
  },
});

/**
 * Bind a draft's wrap to the placement it became.
 *
 * ⚠️ Called immediately after `recordPlacement`. Clicks are counted through
 * `by_link_wrap` rather than `placementId`, so a click landing in the
 * milliseconds before this runs is still attributed — `recordClick` copies
 * `placementId` off the wrap at click time, and one that arrived early would
 * otherwise be orphaned forever.
 */
export const bindWrapToPlacement = internalMutation({
  args: {
    draftId: v.id("drafts"),
    placementId: v.id("placements"),
    customerId: v.id("customers"),
  },
  handler: async (ctx, args): Promise<{ bound: boolean }> => {
    const wraps = (await ctx.db
      .query("gtmLinkWraps")
      .withIndex("by_maya_draft", (q) => q.eq("mayaDraftId", args.draftId))
      .collect()) as Doc<"gtmLinkWraps">[];

    let bound = false;
    for (const wrap of wraps) {
      // Cross-tenant guard, same as everywhere else a caller supplies an id.
      if (wrap.customerId !== args.customerId) continue;
      if (wrap.placementId) continue;
      await ctx.db.patch(wrap._id, { placementId: args.placementId });
      bound = true;
    }
    return { bound };
  },
});

/**
 * ⭐ Clicks for a placement, counted through its WRAP.
 *
 * Not through `gtmLinkClicks.placementId`: that field is stamped at click time
 * from whatever the wrap knew then, so a click that beat the bind would be
 * missing. The wrap is the stable identity.
 */
export const clicksForPlacements = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<Record<string, number>> => {
    const customer = (await ctx.db.get(
      args.customerId,
    )) as Doc<"customers"> | null;
    if (!customer) return {};

    const wraps = (await ctx.db
      .query("gtmLinkWraps")
      .withIndex("by_account", (q) => q.eq("accountId", customer.accountId))
      .collect()) as Doc<"gtmLinkWraps">[];

    const out: Record<string, number> = {};
    for (const wrap of wraps) {
      if (wrap.customerId !== args.customerId || !wrap.placementId) continue;
      const clicks = (await ctx.db
        .query("gtmLinkClicks")
        .withIndex("by_link_wrap", (q) => q.eq("linkWrapId", wrap._id))
        .collect()) as Doc<"gtmLinkClicks">[];
      const key = String(wrap.placementId);
      out[key] = (out[key] ?? 0) + clicks.length;
    }
    return out;
  },
});

/* -------------------------------------------------------------------------- */

/**
 * ⭐ §14.45 rung 2 — the conversion pixel, for the live module.
 *
 * > *"**Pixel** — one snippet on their site | **Per-signup attribution to a
 * > specific post** | one paste | **Precise**"*
 *
 * The pixel, the redirect's `lc_ref` handoff and the CORS plumbing have all
 * existed since Sprint 8 — but the public handler refuses any wrap without an
 * `agentId`, which is every wrap the live module mints. The comment there says
 * so outright. This is the half that was missing.
 *
 * ## ⚠️ The token is PUBLIC
 *
 * It sits in a bio and in published posts. Anyone who reads one can POST to an
 * unauthenticated pixel endpoint, so the token alone cannot be the credential —
 * and a forged signup is not harmless: it corrupts the one number §16.2 says
 * they cancel over, and §14.45's honesty rule is the whole point of the layer.
 *
 * So the request's `Origin` must match the product it claims to convert for.
 * A browser sets `Origin` on cross-origin POSTs and a page cannot forge it.
 */
export const recordPixelConversion = internalMutation({
  args: {
    token: v.string(),
    kind: v.union(
      v.literal("signup"),
      v.literal("demo"),
      v.literal("feedback"),
      v.literal("revenue"),
      v.literal("activated"),
    ),
    origin: v.optional(v.string()),
    note: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ recorded: boolean; reason?: string }> => {
    const wrap = (await ctx.db
      .query("gtmLinkWraps")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first()) as Doc<"gtmLinkWraps"> | null;
    // Unknown token — nothing to attribute, and never an error to a stranger.
    if (!wrap?.customerId) return { recorded: false, reason: "unknown token" };

    const customer = (await ctx.db.get(
      wrap.customerId,
    )) as Doc<"customers"> | null;
    if (!customer) return { recorded: false, reason: "no such account" };

    /**
     * ⚠️ Origin must match the product. Checked only when present: a browser
     * always sends it on a cross-origin POST, and rejecting its ABSENCE would
     * break `sendBeacon` in the environments that omit it while doing nothing
     * to stop a determined forger, who would simply omit it too.
     *
     * The real protection is that a page on someone else's domain CANNOT set
     * `Origin` to the founder's.
     */
    if (args.origin) {
      let productHost = "";
      try {
        const truth = JSON.parse(customer.productTruthJson ?? "{}") as {
          url?: unknown;
        };
        if (typeof truth.url === "string") {
          productHost = new URL(truth.url).host.replace(/^www\./, "");
        }
      } catch {
        productHost = "";
      }

      let originHost = "";
      try {
        originHost = new URL(args.origin).host.replace(/^www\./, "");
      } catch {
        originHost = "";
      }

      // Subdomains count: app.theirsite.com converting for theirsite.com is
      // the normal shape, not an attack.
      const matches =
        productHost.length > 0 &&
        (originHost === productHost || originHost.endsWith(`.${productHost}`));
      if (!matches) {
        return { recorded: false, reason: "origin does not match the product" };
      }
    }

    /**
     * ⚠️ Dedupe within a day, per token per kind.
     *
     * A signup page that reloads, or a beacon that retries, would otherwise
     * book the same person twice — and an inflated number is worse than a
     * missing one here, because it is the number that decides whether they
     * believe any of the rest.
     */
    const now = args.now ?? Date.now();
    const since = now - 24 * 60 * 60 * 1000;
    const recent = (await ctx.db
      .query("gtmConversions")
      .withIndex("by_customer_and_occurredAt", (q) =>
        q.eq("customerId", wrap.customerId!).gte("occurredAt", since),
      )
      .collect()) as Doc<"gtmConversions">[];

    if (recent.some((c) => c.linkWrapId === wrap._id && c.kind === args.kind)) {
      return { recorded: false, reason: "already counted today" };
    }

    await ctx.runMutation(internal.maya.attribution.recordConversion, {
      customerId: wrap.customerId,
      kind: args.kind,
      count: 1,
      source: "pixel",
      token: args.token,
      note: args.note ?? "conversion pixel",
    });

    return { recorded: true };
  },
});
