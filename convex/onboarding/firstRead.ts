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
import { READ_SETTLE_MS } from "../scout/gate";

/** The rest-of-week plan follows first contact by this much: long enough to tap the lane, short enough to feel like the same conversation. */
export const FIRST_PLAN_DELAY_MS = 20 * 60_000;
/** The first scout, after the read and the plan have had their say. The gate still decides whether today gets an idea. */
export const FIRST_SCOUT_DELAY_MS = READ_SETTLE_MS;

/**
 * First contact, in two shapes. When the hello already went out at pairing, the read has no
 * introduction section at all: telling the model to "skip" a section it was handed does not
 * work (live 2026-09-06, she introduced herself twice again); not handing it the section does.
 */
export function firstReadSkill(saidHello: boolean): string {
  const arrangement = saidHello
    ? `2. Nothing about what you do: the hello at pairing already said it. No name, no re-introduction.`
    : `2. Then what this is, in your own voice, the way you'd text a friend who just agreed to let you help, two or three lines, no list, never a manual's opener ("here is how this works"): you scroll for them every day (their lane, what's blowing up in general, who's worth stealing from), you keep their content calendar, you bring ideas, and they can throw anything at you for a straight opinion. Say your name once, lightly.`;
  return `first-read
When: once, the message they have been waiting ten minutes for. It decides whether they feel seen or processed. Warm, specific, glad to be here. Under 150 words, under 900 characters, two or three short texts with a line containing only --- between them.
Shape, in this order:
1. "ok, went through everything." Then show you watched: the one or two things of theirs you genuinely liked, named, with the moment that got you (from the card or the transcript, never a detail you were not given). This is a friend telling them their good thing is good, with real enthusiasm where you feel it.
${arrangement}
3. The clarifying question, the way a friend asks it, as the last text on its own. The lane line you were given tells you what you saw. If their posts pull in several directions, say what you see in plain words ("i see a lot of different stuff: travel, the app you're building, the dog") and ask whether there's one thing they'd want to be known for or they like posting whatever's happening that week; name the one you'd pick and why, in a few words. If one lane is obvious, say it and ask if that's right. Lane labels in plain words ("the travel stuff", "the running clips"), never a category name. Buttons will carry your candidates; free text is welcome too.
If the data is thin, one clause, kind: "i've only seen ten so far, so hold me loosely."
Hard rules: no compliments without a specific. No claim without evidence in the dossier or the lane line you were given; no share or percentage that is not in that line. Exactly one question. Your personality is allowed: an exclamation mark or one emoji where you mean it, never a row.`;
}

/** The first-contact shape, for callers that only need the text. */
export const FIRST_READ_SKILL = firstReadSkill(false);

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

    // Live 2026-09-06: she introduced herself twice, once at pairing and again in the read.
    const saidHello = await ctx.runQuery(internal.core.messages.exists, { creatorId: creator._id, dedupeKey: `hello:${creator._id}` });

    const prefix = buildPrefix({ creator, directives, skill: firstReadSkill(saidHello), personal: gathered.personal, voice: gathered.voice, history: gathered.history });
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
        { role: "user", content: `${saidHello ? "You already said hello when they paired (\"hey, i'm maya. i'm going through your posts…\"), so do NOT introduce yourself again: open straight with the read, and fold what you do for them into one short line at most." : "Write the first message. Address them directly. This is the first thing they will ever read from you."}${laneLine ? ` This is the lane read from their rows; say it in your own words, keep every number and name in it, and let its question be the ONLY question in the message: "${laneLine}"` : ""}` },
      ],
      temperature: 0.6,
      maxTokens: 900,
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
    });
    if (!result.ok) return { ok: false, reason: result.reason };
    let text: string = result.content.trim();
    if (!text) return { ok: false, reason: "empty completion" };

    const d = creator.dossier as { voice?: unknown; persona?: unknown; works?: unknown } | undefined;
    let verdict = tooLong(text, true) ? { pass: false, problems: ["too_long" as const], note: "over the length cap" } : await critique(ctx, { creatorId: creator._id, kind: "first_read", text, evidence: d, voice: { voice: d?.voice, persona: d?.persona }, directives: directives.map((x) => x.verbatim) });
    let criticSkipped = Boolean(verdict.skipped);
    if (!verdict.pass) {
      const rewrite = await callModel(ctx, { creatorId: creator._id, purpose: "first_read_rewrite", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `Your previous first message was rejected by the critic for: ${verdict.problems.join(", ")} (${verdict.note}). Rewrite it, fixing exactly that. Message text only.` }], temperature: 0.5, maxTokens: 900, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      if (rewrite.ok && rewrite.content.trim()) {
        text = rewrite.content.trim();
        verdict = tooLong(text, true) ? { pass: false, problems: ["too_long" as const], note: "still over the length cap" } : await critique(ctx, { creatorId: creator._id, kind: "first_read", text, evidence: d, voice: { voice: d?.voice, persona: d?.persona }, directives: directives.map((x) => x.verbatim) });
        criticSkipped = criticSkipped || Boolean(verdict.skipped);
      }
      // First contact carries an introduction AND the read, so it gets the character cap only
    // (tooLong with detailRequested), not the 140-word reply cap; the skill says 150 words.
    // Live 2026-09-06: first contact was dropped twice for "slop: remove the compliment", and
      // the person who had just been told "first thoughts in about ten minutes" got silence.
      // For first contact, as for replies, the critic advises and never blocks: one rewrite,
      // then it goes, with the critic's note on the record.
      if (!verdict.pass) {
        console.error(`[first-read] sending over the critic's objection for ${creator._id}: ${verdict.problems.join(", ")} (${verdict.note})`);
        criticSkipped = true;
      }
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
      // Day one is a working day (plan 4f addendum): the rest of this week follows the read,
      // and the scout judges the roster it sampled during onboarding, after the read, not before.
      await ctx.scheduler.runAt(Date.now() + FIRST_PLAN_DELAY_MS, internal.calendar.weekPlan.draft, { creatorId: creator._id, horizon: "first" });
      await ctx.scheduler.runAt(Date.now() + FIRST_SCOUT_DELAY_MS, internal.scout.scout.run, { creatorId: creator._id });
    return { ok: true };
  },
});
