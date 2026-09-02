/**
 * `converse` (plan §11.2 #8): any inbound not routed elsewhere. Tonight's version
 * is the minimal real turn: prefix + suffix → writer → leak guard (inside
 * messages.send) → deliver. The classifier, tool calls, the critic and the
 * skill-choice arrive with Sprint 3; the shape they plug into is this file.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { callModel } from "../core/llm";
import { REGISTRY } from "./registry";
import { buildPrefix, buildSuffix, producedStamp } from "./context";
import { deliverNow } from "../core/scheduler";

export const CONVERSE_SKILL = `converse
When: any message that is not a command, a file, a link to a post, or a button tap.
The judgment: answer the thing they actually asked, in their register, with what you know from the dossier and the conversation. If they ask about numbers you cannot see, say what you can't see and what you can. If they ask for an idea, give one, shaped to them, with why. If nothing needs a question, don't ask one.
Hard rules: never invent a metric, a post, or a trend. Never promise a post will do well. Under 120 words unless they asked for detail.`;

export const run = internalAction({
  args: { creatorId: v.id("creators"), messageId: v.id("messages") },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const gathered = await ctx.runQuery(internal.agent.context.gather, { creatorId: args.creatorId, messageId: args.messageId });
    if (!gathered) return { ok: false, reason: "creator not found" };
    const { creator, directives, recent, target } = gathered;
    if (!target) return { ok: false, reason: "message not found" };

    // Commands were handled before a job existed (§15.3); a reaction or button
    // is a signal, not a prompt, and gets no reply tonight.
    if (target.kind === "reaction") return { ok: true };

    const prefix = buildPrefix({ creator, directives, skill: CONVERSE_SKILL });
    const suffix = buildSuffix({ recent: recent.filter((m) => m._id !== target._id), target });
    const apiKey = process.env.OPENROUTER_API_KEY ?? "";
    const spec = REGISTRY.writer;

    let result = await callModel(ctx, {
      creatorId: creator._id,
      purpose: "converse",
      model: spec.primary,
      messages: [
        { role: "system", content: prefix },
        { role: "user", content: suffix },
      ],
      temperature: spec.temperature,
      maxTokens: spec.maxTokens,
      apiKey,
    });
    if (!result.ok) {
      result = await callModel(ctx, {
        creatorId: creator._id,
        purpose: "converse_fallback",
        model: spec.fallback,
        messages: [
          { role: "system", content: prefix },
          { role: "user", content: suffix },
        ],
        temperature: spec.temperature,
        maxTokens: spec.maxTokens,
        apiKey,
      });
    }
    if (!result.ok) return { ok: false, reason: result.reason };

    const text = result.content.trim();
    if (!text) return { ok: false, reason: "empty completion" };

    await ctx.runMutation(internal.core.messages.send, {
      creatorId: creator._id,
      surface: "telegram",
      body: text,
      dedupeKey: `reply:${args.messageId}`,
      proactive: false,
      kind: "reply",
      produced: producedStamp(spec.primary),
    });
    await deliverNow(ctx as never);
    return { ok: true };
  },
});
