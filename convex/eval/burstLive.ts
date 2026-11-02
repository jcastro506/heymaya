/**
 * Live check of one burst, one reply (core/burst), on a scenario persona (never delivered: eval personas
 * have no channel). It writes inbound rows and queues turns exactly as the inbound doors do, then reads what
 * she wrote. A few model calls; no vendor reads.
 *
 *   burst   three texts a couple of seconds apart → one reply
 *   hush    a question, then "hold on one sec" while she's writing → only "Got it, I'll wait for you."
 */
import { v } from "convex/values";
import { internalAction, internalQuery, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { HUSH_REPLY } from "../core/burst";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Out = { body: string; kind: string | null; withdrawn: boolean };

export const outSince = internalQuery({
  args: { creatorId: v.id("creators"), since: v.number() },
  handler: async (ctx, a): Promise<Out[]> => {
    const rows = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.since)).collect()) as Doc<"messages">[];
    return rows.filter((m) => m.direction === "out").map((m) => ({ body: m.body, kind: m.kind ?? null, withdrawn: Boolean(m.withdrawnAt) }));
  },
});

async function say(ctx: ActionCtx, creatorId: Id<"creators">, body: string): Promise<Id<"messages">> {
  const { messageId } = await ctx.runMutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body });
  await ctx.runMutation(internal.core.jobs.enqueue, { kind: "converse", idempotencyKey: `converse:${messageId}`, creatorId, payloadJson: JSON.stringify({ messageId, kind: "inbound" }) });
  return messageId;
}

async function settle(ctx: ActionCtx, creatorId: Id<"creators">): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await sleep(5_000);
    if (!(await ctx.runQuery(internal.core.jobs.turnInFlight, { creatorId }))) return;
  }
}

export const run = internalAction({
  args: { creatorId: v.optional(v.id("creators")) },
  handler: async (ctx, a): Promise<{ burst: { replies: number; texts: string[] }; hush: { replies: string[]; ok: boolean } }> => {
    const creatorId = a.creatorId ?? (await ctx.runQuery(internal.eval.run.scenarioCreators, {})).ids[0];
    if (!creatorId) throw new Error("no scenario creator on this deployment");
    // Burst: three texts, two seconds apart.
    const t1 = Date.now();
    await say(ctx, creatorId, "ok question");
    await sleep(2_000);
    await say(ctx, creatorId, "it's for my halloween video");
    await sleep(2_000);
    await say(ctx, creatorId, "should i post it tonight or tomorrow morning?");
    await settle(ctx, creatorId);
    const burst = ((await ctx.runQuery(internal.eval.burstLive.outSince, { creatorId, since: t1 })) as Out[]).filter((m) => !m.withdrawn);
    await sleep(3_000);
    // Hush: a question, then "hold on" while she's still writing.
    const t2 = Date.now();
    await say(ctx, creatorId, "what's a good hook for a cooking video?");
    await sleep(3_000);
    const hold = await say(ctx, creatorId, "wait hold on one sec");
    await ctx.runAction(internal.core.burst.checkHush, { creatorId, messageId: hold, text: "wait hold on one sec" });
    await settle(ctx, creatorId);
    const hushOut = ((await ctx.runQuery(internal.eval.burstLive.outSince, { creatorId, since: t2 })) as Out[]).filter((m) => !m.withdrawn).map((m) => m.body);
    return { burst: { replies: burst.length, texts: burst.map((m) => m.body) }, hush: { replies: hushOut, ok: hushOut.length === 1 && hushOut[0] === HUSH_REPLY } };
  },
});
