import { clip } from "../lib/clip";
/**
 * `first-read` (plan §11.2 #2): the first message, once the dossier exists. Two
 * real posts named, one true thing about how they make things, what she does
 * next. Split out because it is the moment the product is judged.
 *
 * If the catalogue read has not finished, this schedules it and says so once;
 * the ingest job enqueues `first_read` again when the dossier lands.
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { buildPrefix, buildSuffix, producedStamp } from "../agent/context";
import { deliverNow } from "../core/scheduler";
import { critique, tooLong } from "../agent/critic";
import { proposeLane, readLane } from "./lane";
import { citesStandout } from "./standout";
import { READ_SETTLE_MS } from "../scout/gate";

/** The rest-of-week plan follows first contact by this much: long enough to tap the lane, short enough to feel like the same conversation. */
export const FIRST_PLAN_DELAY_MS = 20 * 60_000;
/** The first scout, after the read and the plan have had their say. The gate still decides whether today gets an idea. */
export const FIRST_SCOUT_DELAY_MS = READ_SETTLE_MS;

/**
 * First contact (rewritten 2026-11-03). The read used to open with what she liked, hedge ("only seen ten
 * posts, so hold me loosely"), and end on a "which direction do you want?" survey, with no number and no idea.
 * Now: proof she watched (the standout post code picked, with its real number), one video to film this week,
 * one question that takes no thought to answer. When the hello already went out, the read has no introduction
 * section at all (live 2026-09-06: telling the model to "skip" a section it was handed does not work).
 */
export function firstReadSkill(saidHello: boolean, conversational = false): string {
  const shape = `Shape, in this order, two or three short texts with a line containing only --- between them:
1. Proof you watched: THE standout post you were given (not another one), named so they recognize it, with its numbers copied exactly as written there (never a multiple or figure of your own), and in a few words why it worked (the moment from the card or the transcript, never a detail you were not given). Real enthusiasm where you mean it.
2. One video they could film this week, built from what made that post work: what it is, in one plain line, specific to them. Not a trend, not a list, not "post more".
3. One easy question, last, on its own, that they can answer without thinking, like "got something in mind, or want me to pick one?". Never ask about their goal, their niche, what they want to be known for, or which direction to take.
If you were given no standout post (too few posts to say), skip 1 and 2: name one specific thing you liked, then ask them to send the one they're proudest of so you can tell them what to make next.`;
  const rules = `Hard rules: under 80 words. Every number copied exactly from the standout line; no other number, no decimals of your own. No compliment without a specific. Never hedge about how much you've seen ("hold me loosely", "only seen ten"), never describe what you do, no "basically". Exactly one question.`;
  if (conversational) return `first-read
The opening conversation is already underway: they've been texting you while you read. Open as the natural next text ("ok, done going through your posts"), never as a fresh start. If they told you what they want, tie the read to it. Build on anything you already told them; never repeat or contradict it.
${shape}
If they asked you something you haven't answered, or a question of yours is still open, ask nothing: end on the idea.
${rules}`;
  return `first-read
When: once, the first real thing they read from you, right after "hey, it's Maya". It decides whether they feel seen or processed.
${saidHello ? "No name, no introduction: the greeting already said it." : "Say hi and your name in a few words, then go straight in."}
${shape}
${rules}`;
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

/** How long her read waits for a reply she's writing to go first: up to a minute, checked every 5 s. */
export const READ_WAIT = { polls: 12, everyMs: 5_000 } as const;

/** Their texts and hers after `after`, oldest first (what the read didn't see while it was written). */
export const since = internalQuery({
  args: { creatorId: v.id("creators"), after: v.number() },
  handler: async (ctx, a): Promise<Doc<"messages">[]> =>
    (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gt("ts", a.after)).take(20)) as Doc<"messages">[],
});

export const run = internalAction({
  // dryRun (evals, 2026-11-03): write the read and return it; nothing is sent, stashed or scheduled.
  args: { creatorId: v.id("creators"), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string; text?: string }> => {
    const gathered = await ctx.runQuery(internal.agent.context.gather, { creatorId: args.creatorId });
    if (!gathered) return { ok: false, reason: "creator not found" };
    const { creator, directives } = gathered;

    if (!creator.dossier) {
      if (args.dryRun) return { ok: false, reason: "no dossier" };
      await ctx.runMutation(internal.core.jobs.enqueue, {
        kind: "ingest_catalogue",
        idempotencyKey: `ingest:${creator._id}:v${creator.dossierVersion}`,
        creatorId: creator._id,
        payloadJson: JSON.stringify({ reason: "first_read" }),
      });
      // Said once: `send` dedupes on the key, so a retry of this job is silent. Not at all when her hello
      // already said it (2026-10-01): live in the sim it landed between her question and their answer,
      // so "honestly all of it lol" read as an answer to "reading your posts now" and she asked if life was a lot.
      const helloSaid = await ctx.runQuery(internal.core.messages.exists, { creatorId: creator._id, dedupeKey: `hello:${creator._id}` });
      if (!helloSaid) await ctx.runMutation(internal.core.messages.send, {
        creatorId: creator._id,
        surface: creator.channel.kind ?? "imessage",
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
    // Written before they've texted START, it can only go out at pairing, where the greeting leads it
    // (core/pairing openWithRead): it never introduces her either (2026-11-03: twice in eleven seconds).
    const saidHello = args.dryRun || !creator.channel.paired || (await ctx.runQuery(internal.core.messages.exists, { creatorId: creator._id, dedupeKey: `hello:${creator._id}` }));

    // A dry run writes the read as it goes to someone who finished onboarding before texting START (the usual path).
    const conversational = !args.dryRun && Boolean(creator.conversationalOnboardingAt);
    // A question of hers they haven't answered yet (dev sim, 2026-10-01: the read asked "what gets in the
    // way?" on top of the unanswered goal question, twice). Code knows; it tells her plainly.
    const waiting = conversational ? await ctx.runQuery(internal.core.messages.openQuestion, { creatorId: creator._id }) : null;
    const waitingLine = waiting ? ` You asked them "${clip(waiting.body.split("\n---\n").pop() ?? waiting.body, 200)}" and they haven't answered yet: ask NOTHING in this text, not even a light question; end on the observation.` : "";
    const prefix = buildPrefix({ creator, directives, skill: firstReadSkill(saidHello, conversational), personal: gathered.personal, voice: gathered.voice, history: gathered.history });
    const spec = REGISTRY.writer;
    /**
     * The standout post and its number are code (onboarding/standout): grounded or silent. The lane she reads
     * from their posts is context for the idea, no longer a question with buttons (2026-11-03: the "which
     * direction?" survey was the least useful thing in her first text).
     */
    const best = await ctx.runQuery(internal.onboarding.standout.forCreator, { creatorId: creator._id });
    let laneContext = "";
    if (!creator.laneConfirmedAt) {
      const li = await ctx.runQuery(internal.onboarding.lane.inputsFor, { creatorId: creator._id });
      const read = li ? readLane(li.posts) : null;
      const prop = li ? proposeLane({ lanes: li.lanes, laneKeywords: read?.keywords ?? [], admiredKeywords: li.admiredKeywords, stated: li.niche, laneConfidence: read?.confidence ?? "none" }) : null;
      laneContext = prop?.read ?? (read && read.confidence !== "none" ? `their posts are mostly ${read.keywords.slice(0, 3).join(", ")}` : "");
    }
    const facts = `${best ? ` Their standout post: ${best.line}.` : " You were given no standout post: they have too few posts to say."}${laneContext ? ` What their posts are mostly about (context for the idea, not something to ask about): ${laneContext}.` : ""}`;

    const result = await callModel(ctx, {
      creatorId: creator._id,
      purpose: "first_read",
      model: spec.primary,
      messages: [
        { role: "system", content: prefix },
        ...(conversational ? [{ role: "user" as const, content: buildSuffix({ recent: gathered.recent, target: null }) }] : []),
        { role: "user", content: `${waitingLine}${saidHello ? "You already said hello, so do NOT introduce yourself or say what you do: open straight with the read." : "Write the first message. Address them directly. This is the first thing they will ever read from you."}${facts}` },
      ],
      temperature: 0.6,
      maxTokens: 900,
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
    });
    if (!result.ok) return { ok: false, reason: result.reason };
    let text: string = result.content.trim();
    if (!text) return { ok: false, reason: "empty completion" };

    const d = creator.dossier as { voice?: unknown; persona?: unknown; works?: unknown } | undefined;
    // The standout fact is code's, from their post rows: evidence, so the critic doesn't strip it as invented.
    const critEvidence = best ? { ...(d ?? {}), standoutPost: best.line } : d;
    let verdict = tooLong(text, true) ? { pass: false, problems: ["too_long" as const], note: "over the length cap" } : await critique(ctx, { creatorId: creator._id, kind: "first_read", text, evidence: critEvidence, voice: { voice: d?.voice, persona: d?.persona }, directives: directives.map((x) => x.verbatim) });
    let criticSkipped = Boolean(verdict.skipped);
    if (!verdict.pass) {
      const rewrite = await callModel(ctx, { creatorId: creator._id, purpose: "first_read_rewrite", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `Your previous first message was rejected by the critic for: ${verdict.problems.join(", ")} (${verdict.note}). Rewrite it, fixing exactly that. Message text only.` }], temperature: 0.5, maxTokens: 900, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      if (rewrite.ok && rewrite.content.trim()) {
        text = rewrite.content.trim();
        verdict = tooLong(text, true) ? { pass: false, problems: ["too_long" as const], note: "still over the length cap" } : await critique(ctx, { creatorId: creator._id, kind: "first_read", text, evidence: critEvidence, voice: { voice: d?.voice, persona: d?.persona }, directives: directives.map((x) => x.verbatim) });
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

    // Proof she watched is the point (2026-11-03, dev runs: she opened on another post, or a critic rewrite
    // dropped the number). Code checks the standout's figure is cited; one rewrite if not, then it goes.
    if (best && !citesStandout(text, best)) {
      const fix = await callModel(ctx, { creatorId: creator._id, purpose: "first_read_rewrite", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `Your read:\n"""\n${text}\n"""\nIts first text must be about this post and cite its numbers exactly as written: ${best.line}. Keep the moment that got you first, then the numbers, then your idea and your one question as they are. Message text only.` }], temperature: 0.4, maxTokens: 900, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      if (fix.ok && fix.content.trim() && citesStandout(fix.content, best) && !tooLong(fix.content.trim(), true)) text = fix.content.trim();
    }

    // The conversation is live while she reads (2026-10-01): never land over one of her replies, and if
    // they talked while she wrote this, write it once more so it follows the conversation as it now is.
    if (conversational) {
      for (let i = 0; i < READ_WAIT.polls && (await ctx.runQuery(internal.core.jobs.turnInFlight, { creatorId: creator._id })); i++) await new Promise((r) => setTimeout(r, READ_WAIT.everyMs));
      const lastSeen = gathered.recent.reduce((t, m) => Math.max(t, m.ts), 0);
      const fresh = await ctx.runQuery(internal.onboarding.firstRead.since, { creatorId: creator._id, after: lastSeen });
      if (fresh.length) {
        const again = await callModel(ctx, { creatorId: creator._id, purpose: "first_read_rewrite", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: buildSuffix({ recent: [...gathered.recent, ...fresh], target: null }) }, { role: "user", content: `The conversation moved on while you were reading. Your read so far:\n"""\n${text}\n"""\nRewrite it to follow the LAST message above: keep its findings, numbers and examples, drop anything you've since said, answer nothing twice, and ask nothing. Message text only.` }], temperature: 0.4, maxTokens: 900, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
        if (again.ok && again.content.trim() && !tooLong(again.content.trim(), true)) text = again.content.trim();
      }
    }

    if (args.dryRun) return { ok: true, text };
    await ctx.runMutation(internal.core.messages.send, {
      creatorId: creator._id,
      surface: creator.channel.kind ?? "imessage",
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
      // No buttons: her question is open (a menu under it read as a survey).
      awaitingAnswer: /\?\s*$/.test(text),
      produced: producedStamp(spec.primary),
    });
    // No goal question after the read any more (operator, 2026-10-09): her intro says what she does; what they want comes out in conversation.
    await deliverNow(ctx as never);
      await ctx.runMutation(internal.scout.firstWeek.markStep, { creatorId: args.creatorId, step: "first_read" });
      // Day one is a working day (plan 4f addendum): the rest of this week follows the read,
      // and the scout judges the roster it sampled during onboarding, after the read, not before.
      // The month first, then its first week, as one text (agent/monthPlan).
      await ctx.scheduler.runAt(Date.now() + FIRST_PLAN_DELAY_MS, internal.agent.monthPlan.proposeThenWeek, { creatorId: creator._id });
      await ctx.scheduler.runAt(Date.now() + FIRST_SCOUT_DELAY_MS, internal.scout.scout.run, { creatorId: creator._id });
    return { ok: true };
  },
});
