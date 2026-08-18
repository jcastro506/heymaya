/**
 * ⭐ `dashboardState` (§16.5, Sprint 8) — one subscription drives the screen.
 *
 * > *"The sweeps write hundreds of `observations` rows a day. A dashboard
 * > subscribed to that table re-runs its query on every insert — burning
 * > function calls and re-rendering constantly for data the user doesn't care
 * > about. **So: watchers maintain a small denormalized `dashboardState` row
 * > per customer, and the UI subscribes to that.**"*
 *
 * The heavy tables are queried on demand when someone opens Activity or
 * Results, paginated, never subscribed. That is what keeps a live dashboard
 * costing effectively nothing per user.
 *
 * ## ⚠️ A cache is a promise about freshness
 *
 * Everything here is denormalized, which means every field can be wrong in a
 * way the founder cannot see. `metricsAsOf` is what makes that honest — §16.4:
 * *"not all data is equally fresh, and pretending otherwise makes the product
 * look broken."* A number with no age is a number that will eventually lie.
 *
 * ## ⚠️ And it holds placements, never drafts
 *
 * §2.6: *"the unit of work is a placement — something live, with a URL. Drafts
 * and found threads are inventory, not results."* A home screen that counts
 * drafts makes a week with nothing published look busy, which is the single
 * most tempting dishonesty in a dashboard.
 */

import { v } from "convex/values";
import { internalMutation, query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { dayKeyInZone } from "./cadence";
import { diagnoseFrom } from "./ladder";
import { compareToNiche, type ChannelBenchmark } from "./benchmarks";
import { availableFrom, ladderKindFor, planAssets } from "./assetFloor";

export type LivenessState = "healthy" | "degraded" | "breached";

export interface DashboardPlacement {
  placementId: Id<"placements">;
  channel: string;
  url: string | null;
  views: number;
}

export interface LadderRow {
  channel: string;
  rung: string;
  detail: string;
  /** Null when the niche corpus can't support a comparison yet. */
  versusNiche: string | null;
}

/**
 * ⭐ How alive is she, in one word.
 *
 * ⚠️ Derived from placements and the open question, NOT from whether jobs ran.
 * A machine that woke, swept, drafted and published nothing had a breached day
 * — and a liveness signal based on activity would call that healthy, which is
 * precisely the reassuring lie §16.6 exists to prevent.
 */
export function livenessFrom(input: {
  placementsToday: number;
  daysSinceLastPlacement: number | null;
  hasOpenQuestion: boolean;
}): LivenessState {
  if (input.placementsToday > 0) return "healthy";
  /**
   * An outstanding question is not a breach — she is waiting on a person, which
   * is a legitimate state and the founder's move to make. Calling it broken
   * would blame them for her silence.
   */
  if (input.hasOpenQuestion) return "degraded";
  if (input.daysSinceLastPlacement === null) return "degraded";
  return input.daysSinceLastPlacement >= 2 ? "breached" : "degraded";
}

/**
 * The status line — §16.6's answer to *"is this thing even alive."*
 *
 * Plain language, and specific. "Working on it" tells a founder nothing they
 * couldn't have assumed; naming the actual state is what makes it reassuring.
 */
export function statusLineFrom(input: {
  liveness: LivenessState;
  placementsToday: number;
  needsYou?: string;
  daysSinceLastPlacement: number | null;
}): string {
  if (input.needsYou) return "Waiting on you.";
  if (input.placementsToday > 0) {
    return input.placementsToday === 1
      ? "Posted once today."
      : `Posted ${input.placementsToday} times today.`;
  }
  if (input.liveness === "breached") {
    // ⚠️ Named plainly. §12 — honest silence beats fake activity, and a quiet
    // status line on a broken week is fake activity by omission.
    return input.daysSinceLastPlacement === null
      ? "Nothing posted yet."
      : `Nothing posted for ${input.daysSinceLastPlacement} days.`;
  }
  return "Nothing posted yet today.";
}

/* -------------------------------------------------------------------------- */

/**
 * ⭐ Rebuild the row. Called by the watchers, and after a publish.
 *
 * A mutation rather than an action: everything it needs is already in Convex,
 * and a cache that can only refresh when a vendor is reachable is a cache that
 * goes stale exactly when things are going wrong.
 */
export const refresh = internalMutation({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { ok: false };

    const now = args.now ?? Date.now();
    const timezone = customer.timezone ?? "UTC";
    const today = dayKeyInZone(now, timezone);

    const placements = (await ctx.db
      .query("placements")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"placements">[];

    /**
     * ⚠️ The founder's day, not UTC. A placement at 20:00 New York is already
     * tomorrow in UTC — counting it there reports a working day as empty.
     */
    const todays = placements.filter(
      (p) => dayKeyInZone(p.publishedAt, timezone) === today
    );

    const lastPlacement = placements
      .map((p) => p.publishedAt)
      .sort((a, b) => b - a)[0];
    const daysSinceLastPlacement =
      lastPlacement === undefined
        ? null
        : Math.floor((now - lastPlacement) / 86_400_000);

    const openQuestion = (await ctx.db
      .query("messages")
      .withIndex("by_customer_and_awaiting", (q) =>
        q.eq("customerId", args.customerId).eq("awaitingAnswer", true)
      )
      .first()) as Doc<"messages"> | null;

    const liveness = livenessFrom({
      placementsToday: todays.length,
      daysSinceLastPlacement,
      hasOpenQuestion: Boolean(openQuestion),
    });

    /**
     * The ladder per channel, pre-computed with benchmarks (§16.3) — so the
     * home screen never has to run the arithmetic itself, and can never reach
     * a different answer than the weekly report.
     */
    const channels = [...new Set(placements.map((p) => p.channel))];
    const benchmarkRow = (await ctx.db
      .query("nicheCache")
      .withIndex("by_kind_and_fetchedAt", (q) => q.eq("kind", "benchmarks"))
      .order("desc")
      .first()) as Doc<"nicheCache"> | null;

    let benchmarks: ChannelBenchmark[] = [];
    try {
      benchmarks = benchmarkRow
        ? (JSON.parse(benchmarkRow.payloadJson) as ChannelBenchmark[])
        : [];
    } catch {
      benchmarks = [];
    }

    const ladder: LadderRow[] = channels.map((channel) => {
      const scoped = placements.filter((p) => p.channel === channel);
      const verdict = diagnoseFrom(scoped, now, 7);
      const bench = benchmarks.find((b) => b.channel === channel && b.usable);

      let versusNiche: string | null = null;
      if (bench && verdict.placements > 0) {
        const perPost = verdict.views / verdict.placements;
        versusNiche = compareToNiche(perPost, bench.medianViews).detail;
      }
      return { channel, rung: verdict.rung, detail: verdict.detail, versusNiche };
    });

    const assets = (await ctx.db
      .query("mediaAssets")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"mediaAssets">[];

    const needsYou = openQuestion?.body ?? undefined;

    const row = {
      customerId: args.customerId,
      statusLine: statusLineFrom({
        liveness,
        placementsToday: todays.length,
        needsYou,
        daysSinceLastPlacement,
      }),
      todayPlacementsJson: JSON.stringify(
        todays.map((p) => ({
          placementId: p._id,
          channel: p.channel,
          url: p.url ?? null,
          views: viewsOf(p),
        }))
      ),
      needsYou,
      ladderJson: JSON.stringify(ladder),
      mediaLibraryDepth: assets.length,
      /**
       * ⚠️ The oldest stamp across the placements, not the newest. A screen
       * claiming freshness from its most recent number while showing five
       * stale ones is the dishonesty §16.4 names.
       */
      metricsAsOf: oldestMetricsAsOf(todays),
      livenessState: liveness,
      updatedAt: now,
    };

    const existing = (await ctx.db
      .query("dashboardState")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .unique()
      .catch(() => null)) as Doc<"dashboardState"> | null;

    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("dashboardState", row);
    return { ok: true };
  },
});

function viewsOf(p: Doc<"placements">): number {
  if (!p.metricsJson) return 0;
  try {
    const m = JSON.parse(p.metricsJson) as Record<string, unknown>;
    return typeof m.views === "number" ? m.views : 0;
  } catch {
    return 0;
  }
}

export function oldestMetricsAsOf(
  placements: Array<{ metricsAsOf?: number }>
): number | undefined {
  const stamps = placements
    .map((p) => p.metricsAsOf)
    .filter((s): s is number => typeof s === "number");
  return stamps.length > 0 ? Math.min(...stamps) : undefined;
}

/**
 * ⭐ The one query the home screen subscribes to.
 *
 * Resolves "my" customer from the identity — no id argument, so there is no
 * ownership check to write slightly differently at each call site.
 */
/**
 * ⭐ The signed-in founder's customer row, resolved once.
 *
 * ⚠️ This three-hop walk (identity → creators.by_clerk_user →
 * customers.by_account) is hand-copied in eight modules. Factored here rather
 * than a ninth time; worth hoisting to convex/lib/ when something touches all
 * of them, but a drive-by refactor of every authed query is not this change.
 */
async function currentCustomer(ctx: {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
  db: QueryCtx["db"];
}): Promise<Doc<"customers"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const creator = (await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first()) as Doc<"creators"> | null;
  if (!creator) return null;
  return (await ctx.db
    .query("customers")
    .withIndex("by_account", (q) => q.eq("accountId", creator._id))
    .first()) as Doc<"customers"> | null;
}

/**
 * ⭐ THE IDEA BANK, VISIBLE. Every export in `ideas.ts` is an `internalQuery`,
 * so nothing on the web could show what she is planning to make — the bank was
 * unobservable from outside the agent.
 *
 * §16.75's argument for restoring the Plan screen applies here verbatim: "the
 * strategy is the most interesting thing she produces, and it's invisible."
 * Ideas are the raw form of that, and a founder who cannot see the bank cannot
 * tell a thin week from a broken sweep.
 *
 * ⚠️ Read-only, and deliberately NOT a workbench (principle 1). No edit, no
 * reorder, no delete — seeing what is queued is a receipt; rearranging it is
 * the dashboard becoming the product.
 */
export const myIdeaBank = query({
  args: { limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    ideas: Array<{
      id: string;
      angle: string;
      /** Where the idea came from — the provenance §6 requires. */
      sourceKind?: string;
      /**
       * ⭐ Whether this idea carries EVIDENCE. `ideas.evidenceJson` already
       * exists on the table, which is the field the competitor-ad ranking will
       * hang off. Surfaced as a boolean rather than the blob: a founder wants
       * "she has a reason for this", not our JSON.
       */
      hasEvidence: boolean;
      status: string;
      score?: number;
      bankedAt: number;
    }>;
    banked: number;
    error?: string;
  }> => {
    const customer = await currentCustomer(ctx);
    if (!customer) {
      return { ok: false, ideas: [], banked: 0, error: "sign in first" };
    }

    const rows = (await ctx.db
      .query("ideas")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect()) as Doc<"ideas">[];

    const banked = rows.filter((r) => r.status === "bank");
    return {
      ok: true,
      banked: banked.length,
      ideas: [...banked]
        // Newest first: a founder checking the bank wants this week's thinking.
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, args.limit ?? 25)
        .map((r) => ({
          id: r._id,
          angle: r.angle,
          sourceKind: r.sourceKind,
          hasEvidence: Boolean(r.evidenceJson),
          status: r.status,
          score: r.score,
          bankedAt: r.createdAt,
        })),
    };
  },
});

/**
 * ⭐ THE MEDIA LIBRARY, VISIBLE — and this is the half that makes §18.9.25's
 * assets ask honest. `media.forCustomer` and `media.libraryHealth` are both
 * `internalQuery`, so a founder who sent a screen recording had no way to
 * confirm it arrived, and no way to see that the library was EMPTY — which is
 * the measured cause of 14 of 16 placements going to X.
 *
 * ⚠️ Reports the LADDER RUNG, not just the row kind. "You have 6 assets" is
 * not the useful sentence; "everything here is generated, so your videos use a
 * presenter" is. That is the same reason `assetFloor` exists, surfaced.
 */
export const myMediaLibrary = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    ok: boolean;
    assets: Array<{
      id: string;
      kind: string;
      source: string;
      rung: string | null;
      url?: string;
      caption?: string;
      capturedAt: number;
    }>;
    /** Plain language for the founder, straight from the ladder. */
    note?: string;
    usesAvatar?: boolean;
    error?: string;
  }> => {
    const customer = await currentCustomer(ctx);
    if (!customer) return { ok: false, assets: [], error: "sign in first" };

    const rows = (await ctx.db
      .query("mediaAssets")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect()) as Doc<"mediaAssets">[];

    const plan = planAssets(availableFrom(rows));

    return {
      ok: true,
      note: plan.detail,
      usesAvatar: plan.usesAvatar,
      assets: [...rows]
        .sort((a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0))
        .map((a) => ({
          id: a._id,
          kind: a.kind,
          source: a.source,
          rung: ladderKindFor(a.kind, a.source),
          url: a.publicUrl,
          caption: a.caption,
          capturedAt: a.capturedAt ?? 0,
        })),
    };
  },
});

export const myDashboard = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    ok: boolean;
    statusLine?: string;
    todayPlacements?: DashboardPlacement[];
    needsYou?: string;
    ladder?: LadderRow[];
    mediaLibraryDepth?: number;
    metricsAsOf?: number;
    livenessState?: LivenessState;
    error?: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "sign in first" };

    const creator = (await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first()) as Doc<"creators"> | null;
    if (!creator) return { ok: false, error: "no account yet" };

    const customer = (await ctx.db
      .query("customers")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first()) as Doc<"customers"> | null;
    if (!customer) return { ok: false, error: "no account yet" };

    const state = (await ctx.db
      .query("dashboardState")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .unique()
      .catch(() => null)) as Doc<"dashboardState"> | null;

    if (!state) {
      /**
       * ⚠️ An honest empty rather than a fabricated one. A dashboard that
       * renders zeros before anything has been computed tells a new founder
       * their agent did nothing, when the truth is it hasn't started.
       */
      return { ok: true, statusLine: "Just getting started.", livenessState: "degraded" };
    }

    return {
      ok: true,
      statusLine: state.statusLine,
      todayPlacements: safeParse<DashboardPlacement[]>(state.todayPlacementsJson, []),
      needsYou: state.needsYou,
      ladder: safeParse<LadderRow[]>(state.ladderJson, []),
      mediaLibraryDepth: state.mediaLibraryDepth,
      metricsAsOf: state.metricsAsOf,
      livenessState: state.livenessState,
    };
  },
});

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/* -------------------------------------------------------------------------- */
/* Results — the ladder, benchmarked (§16.3)                                   */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ §16.3's centerpiece.
 *
 * > *"Most social dashboards are a vanity-metric wall: followers, likes, reach.
 * > That tells a founder nothing they can act on. **Results shows the five-rung
 * > ladder per channel, with the broken rung highlighted and her plain-language
 * > read underneath.**"*
 * >
 * > *"The benchmark column is the part no competitor can copy… is 4.1% good?
 * > Nobody knows. **Context is the product.**"*
 *
 * ⚠️ An on-demand query, NOT the subscribed one. §16.5 is explicit: the home
 * screen subscribes to `dashboardState`; the heavy tables are read when someone
 * opens Results. Subscribing here would re-run this on every placement write.
 */
export const resultsLadder = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    ok: boolean;
    channels?: Array<{
      channel: string;
      rung: string;
      detail: string;
      placements: number;
      views: number;
      /** ⚠️ Null when the niche corpus can't support a comparison yet. */
      nicheMedian: number | null;
      nichePosts: number;
      versusNiche: string | null;
      /** The post that drove the most of this — §16.3's "which post did it". */
      topPlacement: { url: string | null; views: number } | null;
    }>;
    /** ⭐ §16.4 — the OLDEST stamp on screen, not the freshest. */
    metricsAsOf?: number;
    benchmarksComputedAt?: number | null;
    benchmarksStale?: boolean;
    error?: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "sign in first" };

    const creator = (await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first()) as Doc<"creators"> | null;
    if (!creator) return { ok: false, error: "no account yet" };

    const customer = (await ctx.db
      .query("customers")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first()) as Doc<"customers"> | null;
    if (!customer) return { ok: false, error: "no account yet" };

    const placements = (await ctx.db
      .query("placements")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect()) as Doc<"placements">[];

    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      customerId: customer._id,
    });
    const benchmarkSet = await ctx.runQuery(
      internal.maya.benchmarks.benchmarksFor,
      { customerId: customer._id }
    );

    const now = Date.now();
    const byChannel = [...new Set(placements.map((p) => p.channel))];

    const channels = byChannel.map((channel) => {
      const scoped = placements.filter((p) => p.channel === channel);
      const verdict = diagnoseFrom(scoped, now, 7);
      const bench = benchmarkSet.channels.find(
        (b: ChannelBenchmark) => b.channel === channel && b.usable
      );

      let versusNiche: string | null = null;
      if (bench && verdict.placements > 0) {
        versusNiche = compareToNiche(
          verdict.views / verdict.placements,
          bench.medianViews
        ).detail;
      }

      /**
       * §16.3: "underneath, the placement that drove the most of each rung, so
       * the founder can see WHICH post did it." A rung with no example is a
       * verdict they cannot check.
       */
      const top = [...scoped].sort((a, b) => viewsOf(b) - viewsOf(a))[0];

      return {
        channel,
        rung: verdict.rung,
        detail: verdict.detail,
        placements: verdict.placements,
        views: verdict.views,
        nicheMedian: bench?.medianViews ?? null,
        nichePosts: bench?.posts ?? 0,
        versusNiche,
        topPlacement: top
          ? { url: top.url ?? null, views: viewsOf(top) }
          : null,
      };
    });

    return {
      ok: true,
      channels,
      metricsAsOf: oldestMetricsAsOf(placements),
      benchmarksComputedAt: benchmarkSet.computedAt,
      benchmarksStale: benchmarkSet.stale,
      // Unused today, but the absence of keywords is why benchmarks are empty.
      ...(targets ? {} : {}),
    };
  },
});
