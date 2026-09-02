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
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { localHourMinute } from "./gate";

export const STEPS = ["first_read", "first_scout", "first_calendar_or_worth_seeing", "invite_draft", "first_review"] as const;
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
    const creators = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    const due: Id<"creators">[] = [];
    for (const c of creators) {
      if (!c.channel.paired || !c.dossier || c.plan.status === "paused" || c.plan.status === "canceled" || c.plan.status === "deleting") continue;
      const started = c.firstWeek?.startedAt ?? c.channel.pairedAt ?? c.createdAt;
      const day = Math.floor((a.now - started) / 86_400_000) + 1;
      if (day < 4 || day > 10) continue;
      if (c.firstWeek?.stepsDone.includes("invite_draft")) continue;
      const { hour } = localHourMinute(a.now, c.timezone);
      if (hour < 10 || hour >= 19) continue;
      due.push(c._id);
    }
    return due;
  },
});

export const runAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ invited: number }> => {
    const ids = await ctx.runQuery(internal.scout.firstWeek.dueForInvite, { now: Date.now() });
    let invited = 0;
    for (const creatorId of ids) {
      const { messageId } = await ctx.runMutation(internal.core.messages.send, { creatorId, surface: "telegram", body: INVITE_DRAFT, dedupeKey: `firstweek:invite:${creatorId}`, proactive: true, kind: "status" });
      if (messageId) {
        await ctx.runMutation(internal.scout.firstWeek.markStep, { creatorId, step: "invite_draft" });
        invited++;
      }
    }
    return { invited };
  },
});
