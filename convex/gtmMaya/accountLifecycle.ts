/**
 * GTM account lifecycle — cancellation (reversible, end-of-period) and hard
 * deletion (irreversible). The destructive path; every public entry point is
 * Clerk-authed and fail-closed to the CALLER'S OWN account — operator B can
 * never cancel, resume, or delete operator A.
 *
 * Decisions (operator-locked):
 *   - CANCEL = end-of-period billing (Stripe `cancel_at_period_end:true`) +
 *     30-day data retention. The plan stays ACTIVE until period end; at period
 *     end the webhook lapses it to `none` AND tears down the Fly MACHINE (not
 *     the app/volume) so COGS stops while data survives for resume.
 *   - RESUME = clear `cancel_at_period_end` (or, if the sub already ended, the
 *     existing checkout re-subscribes). Clears the `gtmCanceledAt` stamp so the
 *     retention sweep never touches a resubscribed account.
 *   - HARD DELETE = cancel + delete the Stripe customer, run the authoritative
 *     table purge (accountDeletion.purgeGtmAccountByCreatorId), then destroy the
 *     Fly app(s). DB purge is authoritative; external teardown is best-effort
 *     with logging so a Stripe/Fly hiccup never leaves the DB half-purged.
 *   - 30-DAY RETENTION SWEEP (cron) hard-purges accounts whose plan is `none`
 *     AND that were canceled >30 days ago. Never touches active/trialing/
 *     past_due/resubscribed accounts.
 */

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getStripeClient } from "../billing/stripeClient";
import { assertWebhookSecret } from "../lib/webhookSecret";
import { planFeaturesGtm } from "./planGtm";

/** 30-day data-retention window after cancellation before a hard purge. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Internal resolution helpers (action ctx has no db — go through queries).    */
/* -------------------------------------------------------------------------- */

interface MyGtmContext {
  creatorId: Id<"creators">;
  agentId: Id<"gtmAgents"> | null;
  email: string;
  stripeCustomerId: string | null;
  openClawFlyAppId: string | null;
  gtmPlanJson: string | null;
}

/**
 * Resolve the signed-in user → their OWN gtm-agent account context. Fail-closed:
 * returns null on no identity, no creator row, wrong accountType, or a
 * soft-deleted account. This is the cross-tenant isolation boundary — every
 * action below resolves the caller through here and operates ONLY on the
 * returned ids, so a caller can never name another tenant's account.
 */
export const resolveMyGtmContext = internalQuery({
  args: {},
  handler: async (ctx): Promise<MyGtmContext | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return null;
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    return {
      creatorId: creator._id,
      agentId: agent?._id ?? null,
      email: creator.email,
      stripeCustomerId: creator.stripeCustomerId ?? null,
      openClawFlyAppId: agent?.openClawFlyAppId ?? null,
      gtmPlanJson: agent?.gtmPlanJson ?? null,
    };
  },
});

/** Stamp / clear the cancellation markers on the caller's OWN agent row.
 *  Re-verifies the agent belongs to the given account (defense-in-depth). */
export const stampCancellation = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    canceledAt: v.union(v.number(), v.null()),
    periodEndMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.accountId !== args.accountId) return { ok: false };
    if (args.canceledAt === null) {
      // Resume — clear the markers so the retention sweep never sweeps it.
      await ctx.db.patch(args.agentId, {
        gtmCanceledAt: undefined,
        gtmCanceledPeriodEndMs: undefined,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(args.agentId, {
        gtmCanceledAt: args.canceledAt,
        gtmCanceledPeriodEndMs: args.periodEndMs,
        updatedAt: Date.now(),
      });
    }
    return { ok: true };
  },
});

/* -------------------------------------------------------------------------- */
/* CANCEL — end-of-period, reversible.                                         */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the caller's active Stripe subscription id. GTM subs aren't stored on
 * the creator row (the plan lives in gtmPlanJson), so we list the customer's
 * subscriptions and pick the first cancelable one.
 */
async function resolveActiveSubscriptionId(
  stripeCustomerId: string
): Promise<string | null> {
  const stripe = getStripeClient();
  if (!stripe.subscriptions.list) {
    throw new Error("Stripe client missing subscriptions.list");
  }
  const subs = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: "all",
    limit: 100,
  });
  const cancelable = subs.data.find(
    (s) =>
      s.status === "active" ||
      s.status === "trialing" ||
      s.status === "past_due"
  );
  return cancelable?.id ?? null;
}

function periodEndMsOf(sub: {
  current_period_end?: number;
  items?: { data?: Array<{ current_period_end?: number }> };
}): number | undefined {
  const onSub = sub.current_period_end;
  if (typeof onSub === "number" && Number.isFinite(onSub)) return onSub * 1000;
  const onItem = sub.items?.data?.[0]?.current_period_end;
  if (typeof onItem === "number" && Number.isFinite(onItem)) return onItem * 1000;
  return undefined;
}

/**
 * Cancel the caller's GTM subscription at period end. Reversible. Sets Stripe
 * `cancel_at_period_end:true`, stamps `gtmCanceledAt` + the period-end ms on the
 * agent, and returns the period-end date for the UI ("active until <date>, then
 * paused"). Auth-scoped to the caller's own account.
 */
export const cancelMyGtmSubscription = action({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    ok: boolean;
    reason?: string;
    periodEndMs?: number;
  }> => {
    const me: MyGtmContext | null = await ctx.runQuery(
      internal.gtmMaya.accountLifecycle.resolveMyGtmContext,
      {}
    );
    if (!me) return { ok: false, reason: "not-a-gtm-account" };
    if (!me.agentId) return { ok: false, reason: "no-agent" };
    if (!me.stripeCustomerId) return { ok: false, reason: "no-stripe-customer" };

    const subId = await resolveActiveSubscriptionId(me.stripeCustomerId);
    if (!subId) return { ok: false, reason: "no-active-subscription" };

    const stripe = getStripeClient();
    if (!stripe.subscriptions.update) {
      return { ok: false, reason: "stripe-update-unavailable" };
    }
    const updated = await stripe.subscriptions.update(subId, {
      cancel_at_period_end: true,
    });
    const periodEndMs = periodEndMsOf(updated);
    const now = Date.now();
    await ctx.runMutation(internal.gtmMaya.accountLifecycle.stampCancellation, {
      accountId: me.creatorId,
      agentId: me.agentId,
      canceledAt: now,
      periodEndMs,
    });
    return { ok: true, periodEndMs };
  },
});

/**
 * Resume a previously-canceled subscription (clear `cancel_at_period_end`).
 * Only works while the sub still exists (i.e. before period end). After period
 * end the sub is gone and the founder re-subscribes via checkout. Clears the
 * `gtmCanceledAt` stamp so the retention sweep won't touch the account.
 * Auth-scoped to the caller's own account.
 */
export const resumeMyGtmSubscription = action({
  args: {},
  handler: async (
    ctx
  ): Promise<{ ok: boolean; reason?: string }> => {
    const me: MyGtmContext | null = await ctx.runQuery(
      internal.gtmMaya.accountLifecycle.resolveMyGtmContext,
      {}
    );
    if (!me) return { ok: false, reason: "not-a-gtm-account" };
    if (!me.agentId) return { ok: false, reason: "no-agent" };
    if (!me.stripeCustomerId) return { ok: false, reason: "no-stripe-customer" };

    const subId = await resolveActiveSubscriptionId(me.stripeCustomerId);
    if (!subId) {
      // No live sub to un-cancel — clear the local stamp anyway (idempotent)
      // and signal the UI to send them back through checkout.
      await ctx.runMutation(
        internal.gtmMaya.accountLifecycle.stampCancellation,
        { accountId: me.creatorId, agentId: me.agentId, canceledAt: null }
      );
      return { ok: false, reason: "subscription-ended-resubscribe" };
    }

    const stripe = getStripeClient();
    if (!stripe.subscriptions.update) {
      return { ok: false, reason: "stripe-update-unavailable" };
    }
    await stripe.subscriptions.update(subId, { cancel_at_period_end: false });
    await ctx.runMutation(internal.gtmMaya.accountLifecycle.stampCancellation, {
      accountId: me.creatorId,
      agentId: me.agentId,
      canceledAt: null,
    });
    return { ok: true };
  },
});

/* -------------------------------------------------------------------------- */
/* Machine teardown at period end (called from the subscription.deleted path). */
/* -------------------------------------------------------------------------- */

/** Read the gtm agent's Fly app + machine list target for one creator. */
export const peekAgentFlyTarget = internalQuery({
  args: { stripeCustomerId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ openClawFlyAppId: string } | null> => {
    const creator = await ctx.db
      .query("creators")
      .filter((q) => q.eq(q.field("stripeCustomerId"), args.stripeCustomerId))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return null;
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent?.openClawFlyAppId) return null;
    return { openClawFlyAppId: agent.openClawFlyAppId };
  },
});

/**
 * Destroy the Fly MACHINE(S) for a canceled agent — NOT the app/volume, so the
 * data survives for resume. Stops COGS at period end. Best-effort: never throws
 * (called from the Stripe webhook, which must always 200). Resolved by Stripe
 * customer id so the webhook can call it without a creator id in hand.
 */
export const teardownCanceledAgentMachine = internalAction({
  args: { stripeCustomerId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; destroyed: number; reason?: string }> => {
    let target: { openClawFlyAppId: string } | null = null;
    try {
      target = await ctx.runQuery(
        internal.gtmMaya.accountLifecycle.peekAgentFlyTarget,
        { stripeCustomerId: args.stripeCustomerId }
      );
    } catch (err) {
      console.error(
        `[accountLifecycle] peekAgentFlyTarget failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return { ok: false, destroyed: 0, reason: "peek-failed" };
    }
    if (!target) return { ok: true, destroyed: 0, reason: "no-machine" };

    let destroyed = 0;
    try {
      const { FlyClient } = await import("../lib/flyClient");
      const fly = new FlyClient();
      const machines = await fly.listMachines(target.openClawFlyAppId);
      for (const m of machines) {
        try {
          await fly.destroyMachine(target.openClawFlyAppId, m.id, {
            force: true,
          });
          destroyed += 1;
        } catch (err) {
          console.error(
            `[accountLifecycle] destroyMachine(${target.openClawFlyAppId}/${m.id}) failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    } catch (err) {
      // FLY_API_TOKEN unset, list failed, etc. — log + continue; the data is
      // retained and the retention sweep will eventually destroy the app.
      console.error(
        `[accountLifecycle] machine teardown for ${target.openClawFlyAppId} failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return { ok: false, destroyed, reason: "fly-error" };
    }
    return { ok: true, destroyed };
  },
});

/**
 * Public, bridge-secret-guarded entry point the Stripe webhook route calls when
 * a GTM subscription is deleted (period end after a cancel). Schedules the
 * machine teardown as a background action so the webhook returns 200 promptly
 * and the Fly call never blocks (or fails) the webhook. Mirrors the other
 * `*Public` webhook wrappers. Best-effort: schedules; the action itself swallows
 * Fly errors.
 */
export const scheduleMachineTeardownPublic = mutation({
  args: { secret: v.string(), stripeCustomerId: v.string() },
  handler: async (ctx, args): Promise<{ scheduled: boolean }> => {
    assertWebhookSecret(args.secret);
    await ctx.scheduler.runAfter(
      0,
      internal.gtmMaya.accountLifecycle.teardownCanceledAgentMachine,
      { stripeCustomerId: args.stripeCustomerId }
    );
    return { scheduled: true };
  },
});

/* -------------------------------------------------------------------------- */
/* HARD DELETE — irreversible. Sequences Stripe → purge → Fly.                 */
/* -------------------------------------------------------------------------- */

/**
 * Hard-delete the caller's OWN GTM account. Sequencing + failure contract:
 *
 *   1. Best-effort cancel + delete the Stripe customer (cancels all subs as a
 *      side effect). Logged on failure, never throws.
 *   2. AUTHORITATIVE table purge (accountDeletion.purgeGtmAccountByCreatorId) —
 *      this is the source of truth; if it succeeds the account is gone from the
 *      DB regardless of step 1/3 outcomes. Returns the Fly app id(s).
 *   3. Best-effort destroy the returned Fly app(s) (the whole app — this is a
 *      permanent delete, not a pause, so the volume goes too). Logged.
 *
 * Idempotent: a second call finds no creator (resolveMyGtmContext returns null
 * post-purge) and returns ok:false/already-deleted. Auth-scoped — operates only
 * on the resolved caller's account, never a named id.
 */
export const hardDeleteMyGtmAccount = action({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    ok: boolean;
    deleted: boolean;
    reason?: string;
    stripeDeleted: boolean;
    flyDestroyed: number;
    flyErrors: number;
  }> => {
    const me: MyGtmContext | null = await ctx.runQuery(
      internal.gtmMaya.accountLifecycle.resolveMyGtmContext,
      {}
    );
    if (!me) {
      return {
        ok: false,
        deleted: false,
        reason: "not-a-gtm-account",
        stripeDeleted: false,
        flyDestroyed: 0,
        flyErrors: 0,
      };
    }

    // ── 1. Stripe: delete the customer (cancels all subscriptions). ────────
    let stripeDeleted = false;
    if (me.stripeCustomerId) {
      try {
        const stripe = getStripeClient();
        if (stripe.customers.del) {
          await stripe.customers.del(me.stripeCustomerId);
          stripeDeleted = true;
        }
      } catch (err) {
        console.error(
          `[accountLifecycle] Stripe customer delete failed for ${me.stripeCustomerId}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    // ── 2. AUTHORITATIVE table purge. ──────────────────────────────────────
    const purge = await ctx.runMutation(
      internal.accountDeletion.purgeGtmAccountByCreatorId,
      { creatorId: me.creatorId, source: "web" }
    );
    if (!purge.deleted) {
      return {
        ok: purge.ok,
        deleted: false,
        reason: purge.reason,
        stripeDeleted,
        flyDestroyed: 0,
        flyErrors: 0,
      };
    }

    // ── 3. Best-effort Fly app teardown (permanent — app + volume). ────────
    let flyDestroyed = 0;
    let flyErrors = 0;
    const appIds = (purge.flyAppIds ?? []).filter(
      (id): id is string => typeof id === "string" && id.length > 0
    );
    if (appIds.length > 0) {
      try {
        const { FlyClient, FlyError } = await import("../lib/flyClient");
        const fly = new FlyClient();
        for (const appId of [...new Set(appIds)]) {
          try {
            await fly.destroyApp(appId);
            flyDestroyed += 1;
          } catch (err) {
            if (err instanceof FlyError && err.status === 404) continue;
            flyErrors += 1;
            console.error(
              `[accountLifecycle] destroyApp(${appId}) failed: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
      } catch (err) {
        // FlyClient ctor threw (no FLY_API_TOKEN) — log; data already purged.
        flyErrors += appIds.length;
        console.error(
          `[accountLifecycle] Fly teardown unavailable: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    return {
      ok: true,
      deleted: true,
      stripeDeleted,
      flyDestroyed,
      flyErrors,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* 30-DAY RETENTION SWEEP — hard-purge long-canceled accounts.                 */
/* -------------------------------------------------------------------------- */

/**
 * Find gtm agents eligible for the retention purge: `gtmCanceledAt` set AND
 * >30 days ago AND the plan has actually lapsed to `none` (so an active /
 * trialing / past_due / resubscribed account is NEVER purged, even if a stale
 * `gtmCanceledAt` lingers). Returns one entry per eligible account.
 */
export const listRetentionPurgeTargets = internalQuery({
  args: { nowMs: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<
    Array<{ creatorId: Id<"creators">; agentId: Id<"gtmAgents">; canceledAt: number }>
  > => {
    const now = args.nowMs ?? Date.now();
    const cutoff = now - RETENTION_MS;
    const agents = await ctx.db.query("gtmAgents").collect();
    const targets: Array<{
      creatorId: Id<"creators">;
      agentId: Id<"gtmAgents">;
      canceledAt: number;
    }> = [];
    for (const agent of agents) {
      const canceledAt = agent.gtmCanceledAt;
      if (typeof canceledAt !== "number") continue; // not canceled
      if (canceledAt > cutoff) continue; // within retention window
      // Plan must have lapsed to none. An active/trialing/past_due plan means
      // the founder is paying again — never purge.
      const features = planFeaturesGtm({ gtmPlanJson: agent.gtmPlanJson });
      if (features.status !== "none") continue;
      targets.push({
        creatorId: agent.accountId,
        agentId: agent._id,
        canceledAt,
      });
    }
    return targets;
  },
});

/**
 * Convex cron — every 6h. Hard-purge GTM accounts canceled >30 days ago whose
 * plan has lapsed to `none`. Logs each purge. Never purges an active/trialing/
 * resubscribed account (the eligibility query enforces status==="none"). Each
 * target goes through the same purge + Fly-teardown path as the explicit
 * hard-delete; failures on one target never block the rest.
 */
export const sweepCanceledRetention = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{ scanned: number; purged: number }> => {
    const targets = await ctx.runQuery(
      internal.gtmMaya.accountLifecycle.listRetentionPurgeTargets,
      {}
    );
    let purged = 0;
    for (const target of targets) {
      try {
        const purge = await ctx.runMutation(
          internal.accountDeletion.purgeGtmAccountByCreatorId,
          { creatorId: target.creatorId, source: "web" }
        );
        if (!purge.deleted) continue;
        purged += 1;
        console.log(
          `[accountLifecycle] retention-purged account ${target.creatorId} (canceled ${new Date(
            target.canceledAt
          ).toISOString()}); rows=${JSON.stringify(purge.deletedRows)}`
        );
        const appIds = (purge.flyAppIds ?? []).filter(
          (id): id is string => typeof id === "string" && id.length > 0
        );
        if (appIds.length > 0) {
          try {
            const { FlyClient, FlyError } = await import("../lib/flyClient");
            const fly = new FlyClient();
            for (const appId of [...new Set(appIds)]) {
              try {
                await fly.destroyApp(appId);
              } catch (err) {
                if (err instanceof FlyError && err.status === 404) continue;
                console.error(
                  `[accountLifecycle] retention destroyApp(${appId}) failed: ${
                    err instanceof Error ? err.message : String(err)
                  }`
                );
              }
            }
          } catch (err) {
            console.error(
              `[accountLifecycle] retention Fly teardown unavailable: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
      } catch (err) {
        console.error(
          `[accountLifecycle] retention purge for ${target.creatorId} failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
    return { scanned: targets.length, purged };
  },
});
