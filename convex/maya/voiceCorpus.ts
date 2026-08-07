/**
 * The voice corpus — source 2, which is free and nobody uses (§6).
 *
 * > *"Every message the founder types to Maya is an authentic, unedited voice
 * > sample from exactly the person she's imitating. After a week there's a real
 * > corpus; after a month it's better than anything an onboarding form could
 * > capture. **It costs nothing to collect because the messages are already
 * > stored.**"*
 *
 * §7.5.2 ranks this the **highest-leverage** anti-slop layer — above the
 * critic, above the denylist, above everything: *"ten real examples beat any
 * amount of 'be casual and authentic.'"*
 *
 * `SOUL.md` has rendered `voiceExcerpts` since Sprint 2 and **nothing has ever
 * populated it.** Every deploy shipped the fallback: *"No writing samples yet."*
 * That's the fourth instance of the same shape this week — a finished consumer
 * with no producer.
 *
 * ## What counts as a sample
 *
 * Not everything they type. *"post it"*, *"yes"*, *"do it"* are instructions,
 * and a corpus of instructions teaches her to write like a remote control.
 * What's wanted is the messages where they *explain*, *object*, or *describe* —
 * because that's the register they'd use writing to their own audience.
 *
 * ## Why a model, after all
 *
 * This originally said selection was *"length, shape and punctuation — cheap,
 * deterministic"*. **Live data disproved it.** The first real corpus on the
 * dogfood account was five excerpts, and four were instructions to her:
 *
 * > *"do the daily placement now, for real. take the strongest thing from this
 * > morning's scroll, write it, and publish it to X."*
 * > *"did your 11am daily placement job run today?"*
 *
 * Each is long, well punctuated, and not in the acknowledgement wordlist, so
 * every heuristic passed it. Only one of the five was actually the founder
 * writing:
 *
 * > *"honestly the thing that bugs me is when tools promise automation and then
 * > you spend an hour a day babysitting them anyway"*
 *
 * The difference is not shape. It is whether the message is addressed **to her
 * about her work** or is the founder **saying something about the world** — a
 * semantic distinction that no length rule will ever catch, and precisely the
 * kind of thing to give the model rather than another wordlist.
 *
 * ⚠️ And this is the layer §7.5.2 calls the highest-leverage of all. A corpus
 * of commands doesn't produce a weak voice, it produces the wrong one: she
 * learns to write like someone barking orders at a bot.
 *
 * The cheap filter stays as a pre-pass — it removes "ok" and "post it" for
 * free — and the model only judges what survives. Fails OPEN: if it can't run,
 * the heuristic result is kept, because a worse corpus beats no corpus.
 *
 * ## Where the logic lives
 *
 * `voice.ts` — it already owned voice reasoning, including a `corpusFromMessages`
 * this initially duplicated before superseding it. This file is only the Convex
 * wiring: read the table, call the pure function, write the row.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  applyVoiceJudge,
  buildFewShot,
  buildVoiceJudgePrompt,
  selectExcerpts,
  VOICE_JUDGE_SYSTEM,
  type FewShotExample,
} from "./voice";
import type { Doc } from "../_generated/dataModel";

/* -------------------------------------------------------------------------- */

/**
 * Rebuild the corpus from what they've already typed.
 *
 * Idempotent and cheap enough to run on every deploy — there is no state to
 * accumulate, just a re-read of the message log.
 */
/** The model that judges instruction-vs-voice. Cheap: one call per deploy. */
/**
 * ⚠️ Not `gemini-2.5-flash` — that is $2.50/M output, **14.7× this model**, for
 * deciding whether a sentence is an instruction. Cheapest tier that can do the
 * job, per the house rule.
 */
export const VOICE_JUDGE_MODEL = "openai/gpt-oss-120b";

/**
 * ⭐ Rebuild the corpus, with the model deciding what is actually their voice.
 *
 * An action because it calls a model. The heuristic pre-pass runs first (free,
 * removes "ok" and "post it"), the judge sees only what survives, and the
 * mutation below does the write — so a model outage degrades to the old
 * behaviour instead of to an empty corpus.
 */
export const refreshVoiceCorpusJudged = internalAction({
  args: { customerId: v.id("customers"), limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ excerpts: number; scanned: number; judged: boolean }> => {
    const candidates = await ctx.runQuery(
      internal.maya.voiceCorpus.excerptCandidates,
      { customerId: args.customerId, limit: args.limit }
    );
    if (candidates.excerpts.length === 0) {
      await ctx.runMutation(internal.maya.voiceCorpus.storeExcerpts, {
        customerId: args.customerId,
        excerpts: [],
      });
      return { excerpts: 0, scanned: candidates.scanned, judged: false };
    }

    let kept = candidates.excerpts;
    let judged = false;
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (apiKey) {
      const { callModel } = await import("./llm");
      const completion = await callModel(ctx, {
        customerId: args.customerId,
        purpose: "voice_judge",
        apiKey,
        model: VOICE_JUDGE_MODEL,
        temperature: 0,
        maxTokens: 500,
        messages: [
          { role: "system", content: VOICE_JUDGE_SYSTEM },
          { role: "user", content: buildVoiceJudgePrompt(candidates.excerpts) },
        ],
      });
      if (completion.ok) {
        kept = applyVoiceJudge(candidates.excerpts, completion.content);
        judged = true;
      } else {
        // Fails OPEN and says so — the heuristic corpus is worse, not absent.
        console.warn(`[voice] judge unavailable: ${completion.reason}`);
      }
    }

    await ctx.runMutation(internal.maya.voiceCorpus.storeExcerpts, {
      customerId: args.customerId,
      excerpts: kept,
    });
    return { excerpts: kept.length, scanned: candidates.scanned, judged };
  },
});

/** The cheap pre-pass, as a query so the action can read the table. */
export const excerptCandidates = internalQuery({
  args: { customerId: v.id("customers"), limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ excerpts: string[]; scanned: number }> => {
    const inbound = (await ctx.db
      .query("messages")
      .withIndex("by_customer_and_ts", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .take(args.limit ?? 300)) as Doc<"messages">[];
    return {
      excerpts: selectExcerpts(
        inbound.map((m) => ({ body: m.body, ts: m.ts, direction: m.direction }))
      ),
      scanned: inbound.filter((m) => m.direction === "in").length,
    };
  },
});

/** The write, kept separate so the judge can fail without losing the corpus. */
export const storeExcerpts = internalMutation({
  args: { customerId: v.id("customers"), excerpts: v.array(v.string()) },
  handler: async (ctx, args): Promise<null> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return null;
    let profile: Record<string, unknown> = {};
    try {
      profile = customer.voiceProfileJson
        ? (JSON.parse(customer.voiceProfileJson) as Record<string, unknown>)
        : {};
    } catch {
      profile = {};
    }
    await ctx.db.patch(args.customerId, {
      voiceProfileJson: JSON.stringify({
        ...profile,
        excerpts: args.excerpts,
        excerptSource: "founder_messages",
        excerptsRefreshedAt: Date.now(),
      }),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** @deprecated Superseded by `refreshVoiceCorpusJudged` — heuristic only. */
export const refreshVoiceCorpus = internalMutation({
  args: { customerId: v.id("customers"), limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ excerpts: number; scanned: number }> => {
    const inbound = (await ctx.db
      .query("messages")
      .withIndex("by_customer_and_ts", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .take(args.limit ?? 300)) as Doc<"messages">[];

    // `selectExcerpts` filters direction itself — deliberately, so no call
    // site can forget and feed her own writing back as theirs.
    const excerpts = selectExcerpts(
      inbound.map((m) => ({ body: m.body, ts: m.ts, direction: m.direction }))
    );
    const fromFounder = inbound.filter((m) => m.direction === "in");

    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { excerpts: 0, scanned: fromFounder.length };

    let profile: Record<string, unknown> = {};
    try {
      profile = customer.voiceProfileJson
        ? (JSON.parse(customer.voiceProfileJson) as Record<string, unknown>)
        : {};
    } catch {
      profile = {};
    }

    await ctx.db.patch(args.customerId, {
      voiceProfileJson: JSON.stringify({
        ...profile,
        excerpts,
        // Where they came from, because "learned from your messages" and
        // "learned from your posts" are different claims and she may be asked.
        excerptSource: "founder_messages",
        excerptsRefreshedAt: Date.now(),
      }),
      updatedAt: Date.now(),
    });

    return { excerpts: excerpts.length, scanned: fromFounder.length };
  },
});

export const voiceExcerptsFor = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<string[]> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer?.voiceProfileJson) return [];
    try {
      const parsed = JSON.parse(customer.voiceProfileJson) as {
        excerpts?: unknown;
      };
      return Array.isArray(parsed.excerpts)
        ? parsed.excerpts.filter((e): e is string => typeof e === "string")
        : [];
    } catch {
      return [];
    }
  },
});


/* -------------------------------------------------------------------------- */
/* Layer 2 — what they changed                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The last N `{what I wrote → what they changed it to}` pairs.
 *
 * §7.5.2 layer 2, and it calls this **the highest-signal training data in the
 * system** — because unlike a writing sample, an edit says what was *wrong*.
 * "Too long" and "not that word" and "we don't claim that" are all in the diff.
 *
 * It also costs nothing: the edits already happened, and `drafts.decide` has
 * been storing them since yesterday. `SOUL.md` has said *"when they edit
 * something I wrote, that diff is the strongest signal I get"* the entire time,
 * with no diffs behind it.
 */
export const editPairsFor = internalQuery({
  args: { customerId: v.id("customers"), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<FewShotExample[]> => {
    const drafts = (await ctx.db
      .query("drafts")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"drafts">[];

    const edits: Array<{ before: string; after: string; decidedAt: number }> = [];
    for (const draft of drafts) {
      if (draft.outcome !== "edited" || !draft.editDiff) continue;
      try {
        const diff = JSON.parse(draft.editDiff) as {
          before?: unknown;
          after?: unknown;
        };
        if (typeof diff.before !== "string" || typeof diff.after !== "string") {
          continue;
        }
        edits.push({
          before: diff.before,
          after: diff.after,
          decidedAt: draft.decidedAt ?? draft.proposedAt,
        });
      } catch {
        continue;
      }
    }

    return buildFewShot(edits, args.limit ?? 10);
  },
});
