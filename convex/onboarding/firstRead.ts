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
import { laneQuestion, proposeLane, readLane } from "./lane";

export const FIRST_READ_SKILL = `first-read
When: once. This is first contact: the first real thing they read from you, so it has to do two jobs in one text, introduce you and prove you watched.
Shape, in this order:
1. Hello, and what you are for them, in one or two lines in your own voice: you're Maya, their assistant for TikTok and Instagram. You watch their posts, the accounts they picked and their lane every day; you text only when something is actually worth their time; they can send you anything (a draft, a link, a question) for a straight opinion; on Sundays you lay out their week. No feature list, no bullets, no "I'm an AI".
2. The read: name two of their real posts (by what they are, not by id) with something specific you noticed in each, and one true thing about how they make things (opening, pacing, setting, energy) with evidence. If the dossier says mode is thin or newCreator, say what you could and couldn't read, plainly.
3. The one question you were given, if any; otherwise none.
Hard rules: no compliments without a specific. No claim without evidence in the dossier or the lane line you were given; no share or percentage that is not in that line. Under 160 words. Exactly one question at most.`;

/** Pure: does the text name every button it will carry? Case-insensitive, whole label. */
export function candidatesNamed(text: string, labels: string[]): boolean {
  const t = text.toLowerCase();
  return labels.every((l) => t.includes(l.toLowerCase()));
}

/** Pure: when a label is still missing, the proposal line (which names them all) is appended and the stray question is not trusted to stand alone. */
export function ensureCandidatesNamed(text: string, labels: string[], laneLine: string): string {
  return candidatesNamed(text, labels) ? text : `${text}\n\n${laneLine}`;
}

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

    const prefix = buildPrefix({ creator, directives, skill: FIRST_READ_SKILL, personal: gathered.personal, voice: gathered.voice, history: gathered.history });
    const spec = REGISTRY.writer;
    /**
     * Sprint 4d: she states the lane she read from their posts, for one tap, rather than
     * asking them to name a niche. A creator who cannot write that sentence otherwise gets a
     * weak lane, and the sweep, the roster and the fit test all inherit it. Read before the
     * model writes, so the lane check is the message's one question.
     */
    let laneAsk: { token: string; keywords: string[]; candidates: Array<{ label: string; keywords: string[] }> } | null = null;
    let laneLine = "";
    if (!creator.laneConfirmedAt) {
      const li = await ctx.runQuery(internal.onboarding.lane.inputsFor, { creatorId: creator._id });
      const read = li ? readLane(li.posts) : null;
      // Sprint 4f: the scattered account. She leads with the truth and a recommendation, and asks one thing.
      const prop = li ? proposeLane({ lanes: li.lanes, laneKeywords: read?.keywords ?? [], admiredKeywords: li.admiredKeywords, stated: li.niche, laneConfidence: read?.confidence ?? "none" }) : null;
      if (li && prop && prop.state === "scattered" && prop.recommendation && prop.question && li.laneQuestionsThisWeek < 2) {
        const candidates = prop.candidates.map((c) => ({ label: c.label, keywords: c.keywords }));
        laneAsk = { token: `pick-${candidates.map((c) => c.keywords[0] ?? c.label).join("-").replace(/[^a-z0-9-]/g, "").slice(0, 50)}`, keywords: prop.recommendation.keywords, candidates };
        await ctx.runMutation(internal.onboarding.lane.stashRead, { creatorId: creator._id, token: laneAsk.token, keywords: prop.recommendation.keywords, candidates });
        laneLine = `${prop.read}. ${prop.candidates.map((c) => `${c.label}: ${c.evidence}`).join("; ")}. ${prop.question}`;
      } else if (read && read.confidence !== "none") {
        laneAsk = { token: read.keywords.slice(0, 5).join("-").replace(/[^a-z0-9-]/g, "").slice(0, 60), keywords: read.keywords, candidates: [] };
        await ctx.runMutation(internal.onboarding.lane.stashRead, { creatorId: creator._id, token: laneAsk.token, keywords: read.keywords });
        laneLine = laneQuestion(read.keywords, li?.hooks ?? []);
      }
    }

    const result = await callModel(ctx, {
      creatorId: creator._id,
      purpose: "first_read",
      model: spec.primary,
      messages: [
        { role: "system", content: prefix },
        { role: "user", content: `Write the first message. Address them directly. This is the first thing they will ever read from you.${laneLine ? ` This is the lane read from their rows; say it in your own words, keep every number and name in it, and let its question be the ONLY question in the message: "${laneLine}"` : ""}` },
      ],
      temperature: 0.6,
      maxTokens: 900,
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
    });
    if (!result.ok) return { ok: false, reason: result.reason };
    let text: string = result.content.trim();
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

    // Live 2026-09-05: appending the lane line after the model had already asked its own
    // question gave them two questions in one message. The lane check is now the model's
    // one question (told above); the line is appended only when the message carries none.
    if (laneLine && !text.includes("?")) text = `${text}\n\n${laneLine}`;
    // Live 2026-09-06: she kept the two candidate buttons and rewrote the question into one of
    // her own, so a tap answered a question she never asked. Buttons and question must agree:
    // one rewrite naming every candidate, then the proposal line itself.
    if (laneAsk && laneAsk.candidates.length && !candidatesNamed(text, laneAsk.candidates.map((c) => c.label))) {
      const labels = laneAsk.candidates.map((c) => `"${c.label}"`).join(" and ");
      const rewrite = await callModel(ctx, { creatorId: creator._id, purpose: "first_read_rewrite", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `Your message will carry buttons labelled ${labels}. Rewrite it so its ONLY question is the one you were given, naming ${labels} exactly as written, and cite no share or percentage that is not in that line. Message text only.` }], temperature: 0.4, maxTokens: 900, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      if (rewrite.ok && rewrite.content.trim() && candidatesNamed(rewrite.content, laneAsk.candidates.map((c) => c.label))) text = rewrite.content.trim();
      text = ensureCandidatesNamed(text, laneAsk.candidates.map((c) => c.label), laneLine);
    }

    await ctx.runMutation(internal.core.messages.send, {
      creatorId: creator._id,
      surface: "telegram",
      body: text,
      criticSkipped,
      /**
       * ⚠️ Once per creator, FOREVER — not once per dossier version. The version was in
       * this key until the first live creator got TWO introductions (2026-09-02), one per
       * dossier write. Worse in production: the dossier is rewritten every week, so every
       * Sunday would have opened with "took a look through your posts" as though they had
       * just signed up.
       */
      dedupeKey: `first_read:${creator._id}`,
      proactive: true,
      kind: "first_read",
      awaitingAnswer: Boolean(laneAsk) || /\?\s*$/.test(text),
      ...(laneAsk
        ? laneAsk.candidates.length
          ? { buttons: laneAsk.candidates.slice(0, 3).map((c, i) => ({ id: `lanepick:${laneAsk!.token}:${i}`, label: c.label.slice(0, 30) })) }
          : { buttons: [{ id: `lane:${laneAsk.token}:yes`, label: "that's it" }, { id: `lane:${laneAsk.token}:no`, label: "not quite" }] }
        : {}),
      produced: producedStamp(spec.primary),
    });
    await deliverNow(ctx as never);
      await ctx.runMutation(internal.scout.firstWeek.markStep, { creatorId: args.creatorId, step: "first_read" });
    return { ok: true };
  },
});
