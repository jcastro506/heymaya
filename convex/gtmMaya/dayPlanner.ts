import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Maya v2 §5.1 — the morning-plan "day-plan".
 *
 * The morning-plan cron compiles a lightweight posture + funnel budget for the
 * day (NOT a rigid schedule) and stores it on gtmAgents.dayPlanJson. The
 * heartbeat reads it for direction: hunt buying-intent first (tier1 budget),
 * then spend the rest building credibility (tier2/tier3). Reuses the JSON-on-row
 * pattern (schema is at the table ceiling).
 */
export interface DayPlan {
  /** The agent-local date this plan is for (YYYY-MM-DD). */
  planDate: string;
  /** Free-text posture for the day ("helpful + a little funny; r/X is hot on Y"). */
  posture: string;
  /** Funnel allocation, NOT a quota: how many of each tier to aim for today. */
  funnelBudget: { tier1: number; tier2: number; tier3: number };
  /** ~1 in N actions may surface the product (maps to the 9:1 rule). */
  productMentionRatio: number;
  /** Intent phrases / competitor mentions / events to watch for today. */
  watchFor: string[];
  /** The one deliberate post for the day, if any. */
  originalPost?: { channel: string; angle: string; needsCreative: boolean };
  generatedAt: number;
}

export function parseDayPlan(json: string | null | undefined): DayPlan | null {
  if (!json) return null;
  try {
    const p: unknown = JSON.parse(json);
    if (
      !p ||
      typeof p !== "object" ||
      typeof (p as DayPlan).planDate !== "string"
    ) {
      return null;
    }
    return p as DayPlan;
  } catch {
    return null;
  }
}

/** Whether the stored plan is for the agent's local `todayDate` (YYYY-MM-DD). */
export function isPlanForToday(
  plan: DayPlan | null,
  todayDate: string
): boolean {
  return plan !== null && plan.planDate === todayDate;
}

const dayPlanValidator = v.object({
  planDate: v.string(),
  posture: v.string(),
  funnelBudget: v.object({
    tier1: v.number(),
    tier2: v.number(),
    tier3: v.number(),
  }),
  productMentionRatio: v.number(),
  watchFor: v.array(v.string()),
  originalPost: v.optional(
    v.object({
      channel: v.string(),
      angle: v.string(),
      needsCreative: v.boolean(),
    })
  ),
  generatedAt: v.number(),
});

/** Morning-plan cron → write today's day-plan. Overwrites the prior day. */
export const writeDayPlan = internalMutation({
  args: { agentId: v.id("gtmAgents"), plan: dayPlanValidator },
  handler: async (ctx, args): Promise<void> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return;
    await ctx.db.patch(args.agentId, {
      dayPlanJson: JSON.stringify(args.plan),
      updatedAt: Date.now(),
    });
  },
});

/** Heartbeat → read today's day-plan for direction. */
export const readDayPlan = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<DayPlan | null> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    return parseDayPlan(agent.dayPlanJson);
  },
});
