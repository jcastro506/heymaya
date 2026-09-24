/**
 * The first week (plan §1 "The first week"): each capability shown once, in order,
 * before the cadence settles, enforced as a schedule row (`creators.firstWeek`), not
 * left to the gate. Day 1 the first read (onboarding) · day 2 the first scout message
 * (the scout, with the gate) · day 3 the first calendar idea or "worth seeing" (the
 * scout) · day 4 an invitation to send a draft (here) · day 7 the first review (the
 * weekly review, which also runs on the first Sunday). This module owns the steps
 * that are hers to initiate and the ledger every step writes to.
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { localHourMinute } from "./gate";
import { pairedRows } from "../core/schedule";

export const STEPS = ["first_read", "first_plan", "first_scout", "first_calendar_or_worth_seeing", "invite_draft", "first_review"] as const;
export type Step = (typeof STEPS)[number];

export const INVITE_DRAFT = "one thing i haven't said yet: send me a draft before you post it, or a link after, and i'll tell you what i actually think. three fixes, a confidence in words, and i keep score on myself. no pressure, whenever you have one.";

export const markStep = internalMutation({
  args: { creatorId: v.id("creators"), step: v.union(...STEPS.map((s) => v.literal(s))) },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const fw = c.firstWeek ?? { startedAt: Date.now(), stepsDone: [] };
    if (fw.stepsDone.includes(a.step)) return null;
    await ctx.db.patch(c._id, { firstWeek: { ...fw, stepsDone: [...fw.stepsDone, a.step] }, updatedAt: Date.now() });
    return null;
  },
});

/** Who is on day 4 or later of their first week, paired, with no invitation yet, at a civil local hour. */
export const dueForInvite = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, a): Promise<Id<"creators">[]> => {
    const due: Id<"creators">[] = [];
    for (const c of await pairedRows(ctx, { activeOnly: true })) {
      if (!c.hasDossier) continue;
      const started = c.firstWeekStartedAt ?? c.pairedAt ?? c.createdAt;
      const day = Math.floor((a.now - started) / 86_400_000) + 1;
      // Day two, not four (2026-09-06): the pilot asked for opinions unprompted by day two anyway.
      if (day < 2 || day > 10) continue;
      if (c.inviteDrafted) continue;
      const { hour } = localHourMinute(a.now, c.timezone);
      if (hour < 10 || hour >= 19) continue;
      due.push(c.creatorId);
    }
    return due;
  },
});

export const runAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ invited: number }> => {
    const ids = await ctx.runQuery(internal.scout.firstWeek.dueForInvite, { now: Date.now() });
    let invited = 0;
    for (const creatorId of ids) if ((await ctx.runMutation(internal.scout.firstWeek.inviteOne, { creatorId })).invited) invited++;
    return { invited };
  },
});

/** One creator's day-two invitation: the fleet job above and the first-week simulation both send it through here. */
export const inviteOne = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ invited: boolean }> => {
    const { messageId } = await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: INVITE_DRAFT, dedupeKey: `firstweek:invite:${a.creatorId}`, proactive: true, kind: "status" });
    if (!messageId) return { invited: false };
    await ctx.runMutation(internal.scout.firstWeek.markStep, { creatorId: a.creatorId, step: "invite_draft" });
    return { invited: true };
  },
});
