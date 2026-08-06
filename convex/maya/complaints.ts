/**
 * The ranked complaint list (§5.0.0) — the content plan, in the buyer's words.
 *
 * > **The ranked complaint list *is* the content plan.** If 11 people in this
 * > niche asked about pricing confusion this month, that's not an insight to
 * > file — it's next week's post, with the receipts attached.
 *
 * §5.1 calls comment mining *"the most valuable and the cheapest"* sweep, and
 * *"nobody mines it."* Comment sections under popular niche posts are where
 * people say what they actually want, what confuses them, and what they hate
 * about the incumbent — unprompted, in their own words, at scale.
 *
 * ## Frequency is the whole point
 *
 * One person complaining is an anecdote. Eleven people complaining about the
 * same thing in different words is a post that writes itself. So the work isn't
 * extraction, it's **clustering** — "how much is this?" and "what does it cost?"
 * and "is there a free tier?" are one complaint, not three.
 *
 * That's a judgment call over text, which is the model's job. Collection stays
 * deterministic: fetch comments, hand them over, store what comes back with the
 * URLs still attached so every claim can be checked.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { toMillis } from "./learnBusiness";
import { BUYER_MAP_MAX_AGE_MS } from "./buyerMap";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Clustering in someone else's words is judgment, not extraction — and getting
 * it wrong produces a content plan about the wrong thing. Main brain.
 */
export const COMPLAINT_MODEL = "openai/gpt-5.6-luna-pro";

/** How many posts' comment sections to mine per run. Each costs one credit. */
export const POSTS_PER_RUN = 8;
/** Comments below this are usually "first" and emoji. */
export const MIN_COMMENT_CHARS = 12;

export interface Complaint {
  /** Their words, not ours — kept close to how it was actually said. */
  text: string;
  /** How many distinct people said a version of this. */
  frequency: number;
  /** ⭐ The receipts. A complaint without them is an opinion. */
  sourceUrls: string[];
  lastSeen: number;
}

/* -------------------------------------------------------------------------- */
/* Preparing what the model reads                                              */
/* -------------------------------------------------------------------------- */

/**
 * Drop the comments that carry no signal before paying to read them.
 *
 * Comment sections are mostly "🔥🔥🔥" and "first". Filtering deterministically
 * is free; filtering with a model costs money to learn the same thing.
 */
export function worthReading(text: string): boolean {
  const t = text.trim();
  if (t.length < MIN_COMMENT_CHARS) return false;
  // Emoji-only, once punctuation and spaces are gone.
  const letters = t.replace(/[^\p{L}\p{N}]/gu, "");
  if (letters.length < 6) return false;
  // Pure @-mentions — someone tagging a friend, which says nothing.
  if (/^(@\w+[\s,]*)+$/.test(t)) return false;
  return true;
}

export interface MinedComment {
  text: string;
  sourceUrl: string;
  postedAt: number | null;
}

/** Cap what goes into one prompt: enough to cluster, not enough to bankrupt. */
export const MAX_COMMENTS_PER_CALL = 300;

export function prepareComments(comments: MinedComment[]): MinedComment[] {
  const seen = new Set<string>();
  return comments
    .filter((c) => worthReading(c.text))
    .filter((c) => {
      const key = c.text.trim().toLowerCase().slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_COMMENTS_PER_CALL);
}

export const COMPLAINT_SYSTEM = `You read comment sections from one niche and report what people keep saying they want, hate, or don't understand.

Return STRICT JSON, no prose:
{ "complaints": [ { "text": string, "quotes": string[], "frequency": number } ] }

- "text": the complaint in THEIR words, one short sentence. Not a category label. "nobody explains what it actually costs" — not "pricing concerns".
- "quotes": the actual comment texts that belong to this complaint, copied exactly. This is what makes it checkable.
- "frequency": how many DISTINCT people said a version of it.

The job is CLUSTERING, not listing. "how much is it", "what's the price", and "is there a free tier" are ONE complaint said three ways. Merge them. A list where every complaint has frequency 1 means you listed comments instead of clustering them.

Only report things said more than once. A single comment is an anecdote and this list is meant to be acted on.

You may be given ALREADY KNOWN complaints from previous weeks. When you are, MERGE rather than start over:
- if new comments say a version of something already known, keep the known wording, ADD the new frequency to it, and include the new quotes
- if the new comments say it better — closer to how a buyer actually talks — use the better wording and say so by using it
- carry forward anything still true even when nothing new was said about it this week, with its existing frequency unchanged
- only drop something if the niche has clearly moved on

A complaint people have raised for three weeks is stronger evidence than one raised loudly once. Starting from scratch each week throws that away.

Ignore: praise, tagging friends, spam, off-topic chatter, and anything about the creator rather than the subject.

If there is no repeated complaint in here, return an empty array. That is a real answer.`;

export function buildComplaintPrompt(
  niche: string,
  comments: MinedComment[],
  /**
   * ⭐ What we already knew, so the map ACCUMULATES.
   *
   * `storeComplaints` overwrote the whole list every run, so the buyer map was
   * a snapshot of one sweep's eight posts rather than a map. A complaint that
   * was loud in week one vanished in week two if that week's eight posts
   * happened not to mention it, and frequency never counted past a single run
   * — which is the opposite of what makes this evidence worth anything.
   *
   * Merging is done by the MODEL rather than by a similarity threshold here.
   * Word overlap scores "pricing is confusing" against "I can't work out what
   * this would cost me" at 0.07 — the same complaint, counted twice, therefore
   * never surfaced. The model reads them as the same sentence because they
   * are.
   */
  known: ReadonlyArray<Complaint> = []
): string {
  const lines = [`NICHE: ${niche}`, ""];

  if (known.length > 0) {
    lines.push(
      "ALREADY KNOWN (from previous weeks — merge into these, don't start over):"
    );
    for (const k of known) {
      lines.push(`- [${k.frequency}x] ${k.text}`);
    }
    lines.push("");
  }

  lines.push(
    "NEW COMMENTS:",
    ...comments.map((c) => `- ${c.text.replace(/\s+/g, " ").slice(0, 240)}`),
    "",
    "What do these people keep saying? Strict JSON only."
  );
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Turning verdicts back into rows with receipts                               */
/* -------------------------------------------------------------------------- */

/**
 * Attach the source URL of every comment a complaint quoted.
 *
 * The model returns quotes; we already know which post each comment came from.
 * Matching them back is what turns "people complain about pricing" into
 * "people complain about pricing, **here**, **here** and **here**" — and §5.0.0
 * is explicit that the receipts are the point.
 */
export function attachReceipts(
  clusters: Array<{ text: string; quotes: string[]; frequency: number }>,
  comments: MinedComment[],
  now: number
): Complaint[] {
  const byText = new Map<string, MinedComment>();
  for (const c of comments) {
    byText.set(c.text.trim().toLowerCase(), c);
  }

  const out: Complaint[] = [];
  for (const cluster of clusters) {
    if (!cluster.text?.trim()) continue;

    const urls = new Set<string>();
    let latest = 0;
    for (const quote of cluster.quotes ?? []) {
      const match = byText.get(quote.trim().toLowerCase());
      if (!match) continue;
      urls.add(match.sourceUrl);
      const ms = toMillis(match.postedAt);
      if (ms && ms > latest) latest = ms;
    }

    // A cluster whose quotes match nothing we collected is the model writing
    // rather than reading. Dropped — an unverifiable complaint is worse than a
    // missing one, because it looks identical to a real one downstream.
    if (urls.size === 0) continue;

    out.push({
      text: cluster.text.trim().slice(0, 300),
      // Trust the receipts over the model's own count.
      frequency: Math.max(
        1,
        Math.min(cluster.frequency ?? 1, (cluster.quotes ?? []).length)
      ),
      sourceUrls: [...urls].slice(0, 10),
      lastSeen: latest || now,
    });
  }

  return out.sort((a, b) => b.frequency - a.frequency);
}

export function parseClusters(
  content: string
): Array<{ text: string; quotes: string[]; frequency: number }> {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return [];
  try {
    const parsed = JSON.parse(text.slice(first, last + 1)) as {
      complaints?: Array<{ text?: unknown; quotes?: unknown; frequency?: unknown }>;
    };
    return (parsed.complaints ?? [])
      .filter((c): c is { text: string; quotes: string[]; frequency: number } =>
        typeof c.text === "string"
      )
      .map((c) => ({
        text: c.text,
        quotes: Array.isArray(c.quotes)
          ? c.quotes.filter((q): q is string => typeof q === "string")
          : [],
        frequency: typeof c.frequency === "number" ? c.frequency : 1,
      }));
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                     */
/* -------------------------------------------------------------------------- */

export const storeComplaints = internalMutation({
  args: { customerId: v.id("customers"), complaintsJson: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return null;
    let existing: Record<string, unknown> = {};
    try {
      existing = customer.buyerJson ? JSON.parse(customer.buyerJson) : {};
    } catch {
      existing = {};
    }
    await ctx.db.patch(args.customerId, {
      buyerJson: JSON.stringify({
        ...existing,
        complaints: JSON.parse(args.complaintsJson),
        complaintsRefreshedAt: Date.now(),
      }),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const complaintsFor = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<Complaint[]> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer?.buyerJson) return [];
    try {
      const parsed = JSON.parse(customer.buyerJson) as { complaints?: Complaint[] };
      return parsed.complaints ?? [];
    } catch {
      return [];
    }
  },
});

/* -------------------------------------------------------------------------- */
/* The sweep                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Mine the comment sections under the niche's best posts.
 *
 * Ordered deliberately: the highest-**velocity** posts, not the biggest. A post
 * that's climbing right now has a live comment section; a post that peaked six
 * months ago has a dead one, and its complaints are already stale.
 *
 * ## Cost
 *
 * `POSTS_PER_RUN` keyword searches are already paid for by `learn-business`;
 * this adds one comments call per post — 8 credits — plus a single model call
 * over ~300 comments. Cents, weekly. §5.1: *"the most valuable and the
 * cheapest."*
 */
export const mineComplaints = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    error?: string;
    complaints?: Complaint[];
    commentsRead?: number;
  }> => {
    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      customerId: args.customerId,
    });
    if (!targets || targets.keywords.length === 0) {
      // §5.0's ordering, enforced: mining without validated keywords means
      // mining strangers' comment sections.
      return { ok: false, error: "no validated keywords yet — run learn-business first" };
    }

    const now = args.now ?? Date.now();
    const { tiktok } = await import(
      "../integrations/scrapeCreators/platforms/tiktok"
    );

    // Gather candidate posts across the validated keywords, best-first.
    const candidates: Array<{
      handle: string;
      postId: string;
      url: string;
      velocity: number;
    }> = [];
    const { velocity } = await import("./learnBusiness");

    for (const keyword of targets.keywords.slice(0, 4)) {
      try {
        const result = await tiktok.searchKeyword(keyword, {
          datePosted: "last_3_months",
          sortBy: "relevance",
        });
        for (const post of result.posts) {
          if (!post.authorHandle || !post.postId) continue;
          candidates.push({
            handle: post.authorHandle,
            postId: post.postId,
            url: post.url ?? "",
            velocity: velocity(post.metrics, post.postedAt, now),
          });
        }
      } catch {
        // One dead search must not lose the rest.
        continue;
      }
    }

    const best = candidates
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, POSTS_PER_RUN);
    if (best.length === 0) {
      return { ok: false, error: "no posts found to mine" };
    }

    const mined: MinedComment[] = [];
    for (const post of best) {
      try {
        const comments = await tiktok.comments(post.handle, post.postId);
        for (const c of comments) {
          mined.push({
            text: c.text,
            sourceUrl:
              post.url || `https://www.tiktok.com/@${post.handle}/video/${post.postId}`,
            postedAt: c.postedAt,
          });
        }
      } catch {
        continue;
      }
    }

    const prepared = prepareComments(mined);
    if (prepared.length < 10) {
      // Honest rather than empty: too little to cluster is a different answer
      // from "these people have no complaints".
      return {
        ok: false,
        error: `only ${prepared.length} usable comments — not enough to find a pattern`,
        commentsRead: prepared.length,
      };
    }

    // What we already knew. Stale entries are dropped BEFORE the model sees
    // them, so a complaint the niche moved on from isn't carried forward
    // forever by its own history.
    const known = (
      await ctx.runQuery(internal.maya.complaints.complaintsFor, {
        customerId: args.customerId,
      })
    ).filter((c) => now - c.lastSeen <= BUYER_MAP_MAX_AGE_MS);

    const { callModel } = await import("./llm");
    const completion = await callModel(ctx, {
      customerId: args.customerId,
      purpose: "complaint_mining",
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
      model: COMPLAINT_MODEL,
      temperature: 0.1,
      maxTokens: 4_000,
      messages: [
        { role: "system", content: COMPLAINT_SYSTEM },
        {
          role: "user",
          content: buildComplaintPrompt(
            targets.keywords.join(", "),
            prepared,
            known
          ),
        },
      ],
    });
    if (!completion.ok) {
      return { ok: false, error: completion.reason, commentsRead: prepared.length };
    }

    const complaints = attachReceipts(
      parseClusters(completion.content),
      prepared,
      now
    );

    await ctx.runMutation(internal.maya.complaints.storeComplaints, {
      customerId: args.customerId,
      complaintsJson: JSON.stringify(complaints),
    });

    return { ok: true, complaints, commentsRead: prepared.length };
  },
});
