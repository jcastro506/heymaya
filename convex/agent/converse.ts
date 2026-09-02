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
import { internalMutation, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const SHOTLIST_SKILL = `adapt-format (shot list)
When: they tapped "shot list" on an idea you sent.
The judgment: turn the idea into something they can shoot this afternoon. Five to six shots at most, each one line: what's on screen, what they say or the text that appears, roughly how long. Their setting and their opening pattern from the dossier. No production jargon.
Hard rules: under 120 words. No question at the end unless a real decision needs it.`;

export const markIdea = internalMutation({
  args: { ideaId: v.id("ideas"), status: v.union(v.literal("sent"), v.literal("hearted"), v.literal("posted"), v.literal("passed"), v.literal("expired")) },
  handler: async (ctx, a): Promise<null> => {
    await ctx.db.patch(a.ideaId, { status: a.status });
    return null;
  },
});

export const ideaById = internalQuery({
  args: { ideaId: v.id("ideas") },
  handler: async (ctx, a) => await ctx.db.get(a.ideaId),
});

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

    // One-tap options on an idea (§7 S3). Handled here without a model call where the answer is code.
    if (target.kind === "button") {
      const m = target.body.match(/^idea:([a-z0-9]+):(shotlist|notme|save)$/);
      if (m) {
        const ideaId = m[1] as Id<"ideas">;
        const op = m[2];
        if (op === "notme") {
          await ctx.runMutation(internal.agent.converse.markIdea, { ideaId, status: "passed" });
          await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body: "noted. fewer like that.", dedupeKey: `btn:${target._id}`, proactive: false, kind: "reply" });
          await deliverNow(ctx as never);
          return { ok: true };
        }
        if (op === "save") {
          await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body: "saved. it's in your swipe file.", dedupeKey: `btn:${target._id}`, proactive: false, kind: "reply" });
          await deliverNow(ctx as never);
          return { ok: true };
        }
        // shotlist: a short writer call with the idea in context
        const idea = await ctx.runQuery(internal.agent.converse.ideaById, { ideaId });
        const prefix = buildPrefix({ creator, directives, skill: SHOTLIST_SKILL });
        const spec = REGISTRY.writer;
        const r = await callModel(ctx, { creatorId: creator._id, purpose: "shot_list", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `The idea you sent them:\n${JSON.stringify(idea)}\n\nWrite the shot list.` }], temperature: 0.5, maxTokens: 500, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
        const text = r.ok ? r.content.trim() : "";
        await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body: text || "couldn't put the shot list together just now. ask me again in a minute.", dedupeKey: `btn:${target._id}`, proactive: false, kind: "reply", produced: producedStamp(spec.primary) });
        await deliverNow(ctx as never);
        return { ok: true };
      }
    }

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
