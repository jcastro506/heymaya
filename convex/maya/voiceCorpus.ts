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
 * ## Why no model
 *
 * Selection is length, shape and punctuation — cheap, deterministic, and
 * re-runnable. A model would cost money to reproduce a rule that fits in twenty
 * lines, and §5.2's "no LLM in collection" applies to voice as much as to posts.
 *
 * ## Where the logic lives
 *
 * `voice.ts` — it already owned voice reasoning, including a `corpusFromMessages`
 * this initially duplicated before superseding it. This file is only the Convex
 * wiring: read the table, call the pure function, write the row.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { selectExcerpts, buildFewShot, type FewShotExample } from "./voice";
import type { Doc } from "../_generated/dataModel";

/* -------------------------------------------------------------------------- */

/**
 * Rebuild the corpus from what they've already typed.
 *
 * Idempotent and cheap enough to run on every deploy — there is no state to
 * accumulate, just a re-read of the message log.
 */
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
