/**
 * `first-read` (plan §11.2 #2): the first message, once the dossier exists. Two
 * real posts named, one true thing about how they make things, what she does
 * next. Split out because it is the moment the product is judged.
 *
 * If the catalogue read has not finished, this schedules it and says so once;
 * the ingest job enqueues `first_read` again when the dossier lands.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { buildPrefix, producedStamp } from "../agent/context";
import { deliverNow } from "../core/scheduler";
import { critique, tooLong } from "../agent/critic";

export const FIRST_READ_SKILL = `first-read
When: once, the first message after the dossier exists.
The judgment: prove you actually watched. Name two of their real posts (by what they are, not by id) with something specific you noticed in each. Say one true thing about how they make things (their opening, their pacing, their setting, their energy) with evidence. Say what you'll do next: watch the accounts they named and their lane, and text when something is worth their time. If the dossier says mode is thin or newCreator, say what you could and couldn't read, plainly.
Hard rules: no compliments without a specific. No claim without evidence in the dossier. Under 120 words. End with exactly one question that has a decision behind it, or none.`;

export const run = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const gathered = await ctx.runQuery(internal.agent.context.gather, { creatorId: args.creatorId });
    if (!gathered) return { ok: false, reason: "creator not found" };
    const { creator, directives } = gathered;

    if (!creator.dossier) {
      await ctx.runMutation(internal.core.jobs.enqueue, {
        kind: "ingest_catalogue",
        idempotencyKey: `ingest:${creator._id}:v${creator.dossierVersion}`,
        creatorId: creator._id,
        payloadJson: JSON.stringify({ reason: "first_read" }),
      });
      // Said once: `send` dedupes on the key, so a retry of this job is silent.
      await ctx.runMutation(internal.core.messages.send, {
        creatorId: creator._id,
        surface: "telegram",
        body: "reading your posts now. give me a few minutes and I'll tell you what I see.",
        dedupeKey: `first_read_pending:${creator._id}`,
        proactive: true,
        kind: "status",
      });
      await deliverNow(ctx as never);
      await ctx.runMutation(internal.scout.firstWeek.markStep, { creatorId: args.creatorId, step: "first_read" });
      return { ok: true };
    }

    const prefix = buildPrefix({ creator, directives, skill: FIRST_READ_SKILL, personal: gathered.personal });
    const spec = REGISTRY.writer;
    const result = await callModel(ctx, {
      creatorId: creator._id,
      purpose: "first_read",
      model: spec.primary,
      messages: [
        { role: "system", content: prefix },
        { role: "user", content: "Write the first message. Address them directly. This is the first thing they will ever read from you." },
      ],
      temperature: 0.6,
      maxTokens: 900,
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
    });
    if (!result.ok) return { ok: false, reason: result.reason };
    let text = result.content.trim();
    if (!text) return { ok: false, reason: "empty completion" };

    const d = creator.dossier as { voice?: unknown; persona?: unknown; works?: unknown } | undefined;
    let verdict = tooLong(text) ? { pass: false, problems: ["too_long" as const], note: "over the length cap" } : await critique(ctx, { creatorId: creator._id, kind: "first_read", text, evidence: d, voice: { voice: d?.voice, persona: d?.persona }, directives: directives.map((x) => x.verbatim) });
    let criticSkipped = Boolean(verdict.skipped);
    if (!verdict.pass) {
      const rewrite = await callModel(ctx, { creatorId: creator._id, purpose: "first_read_rewrite", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `Your previous first message was rejected by the critic for: ${verdict.problems.join(", ")} (${verdict.note}). Rewrite it, fixing exactly that. Message text only.` }], temperature: 0.5, maxTokens: 900, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      if (rewrite.ok && rewrite.content.trim()) {
        text = rewrite.content.trim();
        verdict = tooLong(text) ? { pass: false, problems: ["too_long" as const], note: "still over the length cap" } : await critique(ctx, { creatorId: creator._id, kind: "first_read", text, evidence: d, voice: { voice: d?.voice, persona: d?.persona }, directives: directives.map((x) => x.verbatim) });
        criticSkipped = criticSkipped || Boolean(verdict.skipped);
      }
      if (!verdict.pass) return { ok: false, reason: `dropped by the critic: ${verdict.problems.join(", ")} (${verdict.note})` };
    }

    await ctx.runMutation(internal.core.messages.send, {
      creatorId: creator._id,
      surface: "telegram",
      body: text,
      criticSkipped,
      dedupeKey: `first_read:${creator._id}:v${creator.dossierVersion}`,
      proactive: true,
      kind: "first_read",
      awaitingAnswer: /\?\s*$/.test(text),
      produced: producedStamp(spec.primary),
    });
    await deliverNow(ctx as never);
      await ctx.runMutation(internal.scout.firstWeek.markStep, { creatorId: args.creatorId, step: "first_read" });
    return { ok: true };
  },
});
