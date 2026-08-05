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
 * Selection here is length, shape and punctuation — cheap, deterministic, and
 * re-runnable. A model would cost money to reproduce a rule that fits in
 * twenty lines, and §5.2's "no LLM in collection" applies to voice as much as
 * to posts.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/** Below this it's an instruction or an acknowledgement, not writing. */
export const MIN_SAMPLE_CHARS = 40;
/** Above this they're pasting something, usually not their own prose. */
export const MAX_SAMPLE_CHARS = 600;
/** What SOUL.md carries. Ten real sentences is the spec's own number. */
export const MAX_EXCERPTS = 12;

/**
 * Short commands, in full. Matched exactly rather than by substring, so
 * *"yes — and make it shorter than the last one"* still counts as writing.
 */
const PURE_INSTRUCTIONS = new Set([
  "post it", "post", "yes", "no", "yep", "nope", "go", "go ahead", "do it",
  "skip", "skip it", "ok", "okay", "sure", "sounds good", "approved",
  "approve", "reject", "stop", "pause", "resume", "thanks", "thank you",
  "perfect", "nice", "great", "cool", "hold off", "not yet", "later",
]);

export function isVoiceSample(text: string): boolean {
  const t = text.trim();
  if (t.length < MIN_SAMPLE_CHARS || t.length > MAX_SAMPLE_CHARS) return false;

  const normalized = t.toLowerCase().replace(/[.!?,]+$/, "");
  if (PURE_INSTRUCTIONS.has(normalized)) return false;

  // A pasted URL or a bare handle is a reference, not a sentence.
  const withoutLinks = t.replace(/https?:\/\/\S+/g, "").trim();
  if (withoutLinks.length < MIN_SAMPLE_CHARS) return false;

  // Needs at least a few words — a long single token is an id or a paste.
  if (withoutLinks.split(/\s+/).length < 8) return false;

  return true;
}

/**
 * Prefer variety over recency.
 *
 * Twelve samples from one afternoon capture one mood. §7.5.2's point is that
 * **variance is where humanity hides**, so a corpus that's all one register
 * teaches exactly the flatness it exists to prevent — spreading across days
 * costs nothing and captures how they actually vary.
 */
export function selectExcerpts(
  messages: Array<{ body: string; ts: number }>,
  limit = MAX_EXCERPTS
): string[] {
  const samples = messages.filter((m) => isVoiceSample(m.body));
  if (samples.length <= limit) return samples.map((m) => m.body.trim());

  const byDay = new Map<string, Array<{ body: string; ts: number }>>();
  for (const m of samples) {
    const day = new Date(m.ts).toISOString().slice(0, 10);
    const bucket = byDay.get(day) ?? [];
    bucket.push(m);
    byDay.set(day, bucket);
  }

  // Round-robin across days, newest day first, until we have enough.
  const days = [...byDay.keys()].sort().reverse();
  const picked: string[] = [];
  let depth = 0;
  while (picked.length < limit) {
    let addedThisPass = false;
    for (const day of days) {
      const bucket = byDay.get(day)!;
      if (depth >= bucket.length) continue;
      picked.push(bucket[depth].body.trim());
      addedThisPass = true;
      if (picked.length >= limit) break;
    }
    if (!addedThisPass) break;
    depth += 1;
  }
  return picked;
}

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

    const fromFounder = inbound.filter((m) => m.direction === "in");
    const excerpts = selectExcerpts(
      fromFounder.map((m) => ({ body: m.body, ts: m.ts }))
    );

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
