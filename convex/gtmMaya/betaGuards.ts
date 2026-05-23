import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

const DEFAULT_DAILY_COST_LIMIT_USD = 2;
const DEFAULT_MONTHLY_COST_LIMIT_USD = 35;
const DEFAULT_DAILY_API_CALL_LIMIT = 120;

const ACTOR = v.union(
  v.literal("maya"),
  v.literal("system"),
  v.literal("admin"),
  v.literal("user")
);

const SEVERITY = v.union(v.literal("info"), v.literal("warn"), v.literal("error"));

const PROVIDER = v.union(
  v.literal("whatsapp"),
  v.literal("imessage"),
  v.literal("google_calendar"),
  v.literal("reddit"),
  v.literal("x"),
  v.literal("linkedin"),
  v.literal("composio"),
  v.literal("openclaw")
);

const CONNECTION_STATUS = v.union(
  v.literal("connected"),
  v.literal("disconnected"),
  v.literal("reconnect_required"),
  v.literal("error")
);

const MACHINE_STATUS = v.union(
  v.literal("healthy"),
  v.literal("unhealthy"),
  v.literal("restarting"),
  v.literal("unknown")
);

export interface GtmGuardState {
  adminDisabled: boolean;
  disabledReason?: string;
  dailyCostLimitUsd: number;
  monthlyCostLimitUsd: number;
  dailyApiCallLimit: number;
}

export interface GtmGuardUsage {
  dailyCostUsd: number;
  monthlyCostUsd: number;
  dailyApiCalls: number;
}

type DbReadCtx = Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">;

export function evaluateGtmBetaGuard(input: {
  state: GtmGuardState;
  usage: GtmGuardUsage;
  nextCostUsd: number;
}): { allowed: true } | { allowed: false; reason: string } {
  if (input.state.adminDisabled) {
    return {
      allowed: false,
      reason: input.state.disabledReason ?? "GTM account disabled by admin",
    };
  }
  if (input.nextCostUsd < 0) {
    return { allowed: false, reason: "cost cannot be negative" };
  }
  if (
    input.usage.dailyCostUsd + input.nextCostUsd >
    input.state.dailyCostLimitUsd
  ) {
    return { allowed: false, reason: "daily GTM cost cap exceeded" };
  }
  if (
    input.usage.monthlyCostUsd + input.nextCostUsd >
    input.state.monthlyCostLimitUsd
  ) {
    return { allowed: false, reason: "monthly GTM cost cap exceeded" };
  }
  if (input.usage.dailyApiCalls + 1 > input.state.dailyApiCallLimit) {
    return { allowed: false, reason: "daily GTM API call cap exceeded" };
  }
  return { allowed: true };
}

export async function assertGtmSpendAllowed(
  ctx: MutationCtx,
  accountId: Id<"creators">,
  nextCostUsd: number,
  now = Date.now()
): Promise<void> {
  const [state, usage] = await Promise.all([
    getSafetyState(ctx, accountId),
    getUsage(ctx, accountId, now),
  ]);
  const gate = evaluateGtmBetaGuard({ state, usage, nextCostUsd });
  if (!gate.allowed) {
    throw new Error(gate.reason);
  }
}

export const adminSetSafetyState = mutation({
  args: {
    token: v.string(),
    accountId: v.id("creators"),
    adminDisabled: v.optional(v.boolean()),
    disabledReason: v.optional(v.string()),
    dailyCostLimitUsd: v.optional(v.number()),
    monthlyCostLimitUsd: v.optional(v.number()),
    dailyApiCallLimit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    assertAdminToken(args.token);
    const creator = await ctx.db.get(args.accountId);
    if (!creator || creator.accountType !== "gtm-agent") {
      throw new Error("GTM account not found");
    }
    const current = await getSafetyStateDoc(ctx, args.accountId);
    const now = Date.now();
    const patch = {
      adminDisabled: args.adminDisabled ?? current?.adminDisabled ?? false,
      disabledReason: args.disabledReason ?? current?.disabledReason,
      dailyCostLimitUsd:
        args.dailyCostLimitUsd ??
        current?.dailyCostLimitUsd ??
        DEFAULT_DAILY_COST_LIMIT_USD,
      monthlyCostLimitUsd:
        args.monthlyCostLimitUsd ??
        current?.monthlyCostLimitUsd ??
        DEFAULT_MONTHLY_COST_LIMIT_USD,
      dailyApiCallLimit:
        args.dailyApiCallLimit ??
        current?.dailyApiCallLimit ??
        DEFAULT_DAILY_API_CALL_LIMIT,
      updatedAt: now,
    };
    if (current) {
      await ctx.db.patch(current._id, patch);
    } else {
      await ctx.db.insert("gtmSafetyStates", {
        accountId: args.accountId,
        ...patch,
      });
    }
    await recordAuditEventForAccount(ctx, {
      accountId: args.accountId,
      actor: "admin",
      eventType: "gtm.safety.updated",
      severity: patch.adminDisabled ? "warn" : "info",
      message: patch.adminDisabled
        ? "Admin disabled GTM account"
        : "Admin updated GTM safety limits",
      metadata: patch,
      now,
    });
  },
});

export const recordAuditEvent = mutation({
  args: {
    actor: ACTOR,
    eventType: v.string(),
    severity: SEVERITY,
    message: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<Id<"gtmAuditEvents">> => {
    const creator = await requireMyGtmCreator(ctx);
    return await recordAuditEventForAccount(ctx, {
      accountId: creator._id,
      ...args,
      now: Date.now(),
    });
  },
});

export const recordConnectionHealth = mutation({
  args: {
    provider: PROVIDER,
    status: CONNECTION_STATUS,
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"gtmConnectionHealth">> => {
    const creator = await requireMyGtmCreator(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("gtmConnectionHealth")
      .withIndex("by_account_and_provider", (q) =>
        q.eq("accountId", creator._id).eq("provider", args.provider)
      )
      .first();
    const row = {
      accountId: creator._id,
      provider: args.provider,
      status: args.status,
      failureReason: args.failureReason,
      lastCheckedAt: now,
      updatedAt: now,
    };
    const id = existing
      ? (await ctx.db.patch(existing._id, row), existing._id)
      : await ctx.db.insert("gtmConnectionHealth", row);
    if (args.status === "reconnect_required" || args.status === "error") {
      await recordAuditEventForAccount(ctx, {
        accountId: creator._id,
        actor: "system",
        eventType: "gtm.connection.unhealthy",
        severity: "warn",
        message: `${args.provider} requires attention`,
        metadata: args,
        now,
      });
    }
    return id;
  },
});

export const recordMachineHealth = mutation({
  args: {
    flyAppId: v.string(),
    status: MACHINE_STATUS,
    lastPingAt: v.optional(v.number()),
    restartCount: v.optional(v.number()),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"gtmMachineHealth">> => {
    const creator = await requireMyGtmCreator(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("gtmMachineHealth")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    const row = {
      accountId: creator._id,
      flyAppId: args.flyAppId,
      status: args.status,
      lastPingAt: args.lastPingAt,
      restartCount: args.restartCount ?? existing?.restartCount ?? 0,
      lastError: args.lastError,
      updatedAt: now,
    };
    const id = existing
      ? (await ctx.db.patch(existing._id, row), existing._id)
      : await ctx.db.insert("gtmMachineHealth", row);
    if (args.status === "unhealthy" || args.status === "restarting") {
      await recordAuditEventForAccount(ctx, {
        accountId: creator._id,
        actor: "system",
        eventType: "gtm.machine.unhealthy",
        severity: args.status === "unhealthy" ? "error" : "warn",
        message: `OpenClaw machine is ${args.status}`,
        metadata: args,
        now,
      });
    }
    return id;
  },
});

export const getMyBetaHardeningStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return null;
    const [state, connections, machine, audits, usage] = await Promise.all([
      getSafetyState(ctx, creator._id),
      ctx.db
        .query("gtmConnectionHealth")
        .withIndex("by_account", (q) => q.eq("accountId", creator._id))
        .collect(),
      ctx.db
        .query("gtmMachineHealth")
        .withIndex("by_account", (q) => q.eq("accountId", creator._id))
        .first(),
      ctx.db
        .query("gtmAuditEvents")
        .withIndex("by_account", (q) => q.eq("accountId", creator._id))
        .order("desc")
        .take(20),
      getUsage(ctx, creator._id, Date.now()),
    ]);
    return { state, usage, connections, machine, audits };
  },
});

async function getSafetyState(
  ctx: DbReadCtx,
  accountId: Id<"creators">
): Promise<GtmGuardState> {
  const doc = await getSafetyStateDoc(ctx, accountId);
  return {
    adminDisabled: doc?.adminDisabled ?? false,
    disabledReason: doc?.disabledReason,
    dailyCostLimitUsd: doc?.dailyCostLimitUsd ?? DEFAULT_DAILY_COST_LIMIT_USD,
    monthlyCostLimitUsd:
      doc?.monthlyCostLimitUsd ?? DEFAULT_MONTHLY_COST_LIMIT_USD,
    dailyApiCallLimit: doc?.dailyApiCallLimit ?? DEFAULT_DAILY_API_CALL_LIMIT,
  };
}

async function getSafetyStateDoc(
  ctx: DbReadCtx,
  accountId: Id<"creators">
): Promise<Doc<"gtmSafetyStates"> | null> {
  return await ctx.db
    .query("gtmSafetyStates")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .first();
}

async function getUsage(
  ctx: DbReadCtx,
  accountId: Id<"creators">,
  now: number
): Promise<GtmGuardUsage> {
  const dayStart = now - 24 * 60 * 60 * 1000;
  const monthStart = now - 30 * 24 * 60 * 60 * 1000;
  const costs = await ctx.db
    .query("gtmCostLedger")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  return costs.reduce<GtmGuardUsage>(
    (usage, row) => {
      const isApiCall =
        row.cacheStatus === "called" || row.cacheStatus === "failed";
      if (row.createdAt >= dayStart) {
        usage.dailyCostUsd += row.costUsd;
        if (isApiCall) usage.dailyApiCalls += 1;
      }
      if (row.createdAt >= monthStart) usage.monthlyCostUsd += row.costUsd;
      return usage;
    },
    { dailyCostUsd: 0, monthlyCostUsd: 0, dailyApiCalls: 0 }
  );
}

async function requireMyGtmCreator(ctx: MutationCtx): Promise<Doc<"creators">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("signed-in user required");
  const creator = await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
  if (!creator || creator.accountType !== "gtm-agent") {
    throw new Error("GTM account not found");
  }
  return creator;
}

async function recordAuditEventForAccount(
  ctx: Pick<MutationCtx, "db">,
  args: {
    accountId: Id<"creators">;
    actor: "maya" | "system" | "admin" | "user";
    eventType: string;
    severity: "info" | "warn" | "error";
    message: string;
    metadata?: unknown;
    now: number;
  }
): Promise<Id<"gtmAuditEvents">> {
  return await ctx.db.insert("gtmAuditEvents", {
    accountId: args.accountId,
    actor: args.actor,
    eventType: args.eventType,
    severity: args.severity,
    message: args.message,
    metadata: args.metadata,
    createdAt: args.now,
  });
}

function assertAdminToken(provided: string): void {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !constantTimeEqual(expected, provided)) {
    throw new Error("admin: unauthorized");
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
