/**
 * The idea bank (§7.4) — a standing inventory, never a blank page.
 *
 * > *"Ideas come from a standing inventory, never a blank page. Generating from
 * > scratch each morning is how you get '5 productivity tips.'"*
 *
 * That failure was **measured** on 2026-08-05. Asked for ten varied posts with
 * no bank to draw on, she returned one idea ten times — `"dashboard"` appeared
 * in 10 of 10 — and the register was *fine*. A different-family judge sorted
 * them from real captions at chance. Good prose, one thought.
 *
 * Asked to scroll first, the same model produced ten genuinely different posts:
 * mean similarity **0.170 → 0.028**, topic coverage **1.00 → 0.50**. The bank is
 * that difference, made durable instead of depending on how the turn was phrased.
 *
 * ## Evidence is the entry requirement
 *
 * The schema says it: *"An idea with no evidence is a guess, and guesses don't
 * get published."* Every row carries what made it worth writing — the complaint,
 * the observation, the thing someone actually said — so a draft can always trace
 * back to a real person.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { toMillis } from "./learnBusiness";
import { diagnoseFrom } from "./ladder";
import { similarity } from "./quality";
import type { Doc, Id } from "../_generated/dataModel";

/** Where an idea came from. Kept as strings — new sources shouldn't need a migration. */
export const IDEA_SOURCES = [
  "complaint",      // sweep 4 — what people keep asking. §5.1's highest-signal input.
  "observation",    // the morning scroll — something moving right now
  "own_comment",    // a buyer telling us what to make, on our own post
  "format_card",    // a proven shape looking for content
  "founder",        // they told us directly
  "performance",    // something of ours that worked
] as const;
export type IdeaSource = (typeof IDEA_SOURCES)[number];

export interface Evidence {
  /** What was actually said or seen. Their words, not our summary. */
  quote: string;
  /** Where to check it. An idea whose evidence can't be opened is an opinion. */
  sourceUrls: string[];
  /** How many distinct people said a version of this, when we know. */
  frequency?: number;
  observedAt?: number;
}

export interface ScoredIdea {
  angle: string;
  source: IdeaSource;
  evidence: Evidence;
  score: number;
  /** Which term made it score — so a low score can be argued with. */
  why: string;
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * §7.4: `today's relevance × format fit × recency decay × past performance`.
 *
 * **Multiplicative, and that is the design.** Any term at zero kills the idea:
 * a perfect angle nobody can act on this week is not a post, and neither is a
 * timely one with no evidence. Summing would let a strong term paper over a
 * fatal one.
 */
export const RECENCY_HALF_LIFE_MS = 10 * 24 * 60 * 60 * 1000;

export function recencyDecay(observedAt: number | undefined, now: number): number {
  const ms = toMillis(observedAt ?? null);
  if (ms === null) return 0.5; // undated: neither fresh nor stale
  const age = Math.max(0, now - ms);
  return Math.pow(0.5, age / RECENCY_HALF_LIFE_MS);
}

/**
 * How much a complaint's frequency is worth.
 *
 * §5.0.0: *"if 11 people in this niche asked about pricing confusion this month,
 * that's next week's post."* One person is an anecdote; the curve flattens fast
 * because the difference between 11 and 30 is not what decides a post.
 */
export function frequencyWeight(frequency: number | undefined): number {
  if (!frequency || frequency < 1) return 0.4;
  return Math.min(1, 0.4 + 0.2 * Math.log2(frequency + 1));
}

/** Sources are not equal. Comment mining is the spec's highest-signal input. */
const SOURCE_WEIGHT: Record<IdeaSource, number> = {
  complaint: 1.0,
  own_comment: 1.0,   // a buyer telling US what to make — as good as it gets
  observation: 0.75,
  format_card: 0.7,
  founder: 0.9,
  performance: 0.8,
};

/**
 * ⭐ What the diagnostic rung changes about which idea to pick.
 *
 * §14.2.2: she diagnosed on Sunday and Monday was unchanged. This is the wire
 * between them — and it is deliberately NOT "the posts that did well used this
 * hook, so use that hook".
 *
 * §14.3 rules that out explicitly: at 30–90 posts a month, own data cannot
 * answer format-level questions, and *"any system claiming to optimize hooks
 * off 40 data points is fitting noise and will produce confident nonsense."*
 *
 * So own data is used ONLY for the coarse thing it can actually answer —
 * **which kind of problem we have** — and that selects which EVIDENCE to trust
 * more, straight out of §14.2's own table:
 *
 * | rung | what it means | so prefer |
 * |---|---|---|
 * | **L1** | nobody saw it — a FORMAT problem | `observation` / `format_card`: things that demonstrably travelled in this niche |
 * | **L2** | they saw it and scrolled — a TOPIC problem | `complaint` / `own_comment`: a real person saying what they actually care about |
 *
 * The nudge is small on purpose (±25%). Evidence quality still dominates: a
 * one-off observation must never outrank a thing thirteen people complained
 * about because a weekly verdict tilted the table.
 */
const RUNG_PREFERENCE: Record<string, Partial<Record<IdeaSource, number>>> = {
  // Format problem — favour what already travelled here.
  L1: { observation: 1.25, format_card: 1.25, complaint: 0.9 },
  // Topic problem — favour what someone actually said.
  L2: { complaint: 1.25, own_comment: 1.25, observation: 0.9 },
};

export function scoreIdea(
  idea: { source: IdeaSource; evidence: Evidence },
  now: number,
  /**
   * The current rung, when we have one. Absent — or `unknown`/`L0` — changes
   * nothing: `L0` is our own failure to post and says nothing about which
   * idea to choose next.
   */
  rung?: string
): { score: number; why: string } {
  // No evidence is not a low score, it is not an idea.
  if (!idea.evidence.quote?.trim() || idea.evidence.sourceUrls.length === 0) {
    return { score: 0, why: "no evidence — a guess, not an idea" };
  }

  const source = SOURCE_WEIGHT[idea.source] ?? 0.5;
  const freq = frequencyWeight(idea.evidence.frequency);
  const recency = recencyDecay(idea.evidence.observedAt, now);
  const tilt: number =
    (rung ? RUNG_PREFERENCE[rung]?.[idea.source] : undefined) ?? 1;
  const score = source * freq * recency * tilt;

  const weakest = Math.min(source, freq, recency);
  const base =
    weakest === recency
      ? "losing value with age"
      : weakest === freq
        ? "only one person said it"
        : `${idea.source} is weaker signal than a complaint`;

  /**
   * The tilt is NAMED when it moves anything. A ranking that quietly changed
   * because of last week's numbers is the kind of thing nobody can argue with
   * later — and she has to be able to say why she picked this one.
   */
  const why =
    tilt > 1
      ? `${base} — but last week said ${rung === "L1" ? "nobody saw us, so what travels here matters more" : "they scrolled past, so what people actually say matters more"}`
      : tilt < 1
        ? `${base}, and last week pointed at ${rung === "L1" ? "reach" : "relevance"} instead`
        : base;

  return { score, why };
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                     */
/* -------------------------------------------------------------------------- */

/** Two ideas are the same idea if they say the same thing. */
export const SAME_ANGLE_AT = 0.6;

export const bankIdeas = internalMutation({
  args: {
    customerId: v.id("customers"),
    ideasJson: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ banked: number; duplicates: number; rejected: number }> => {
    const incoming = JSON.parse(args.ideasJson) as ScoredIdea[];
    const now = args.now ?? Date.now();

    const existing = (await ctx.db
      .query("ideas")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"ideas">[];
    // Compare against USED ones too — re-banking something we already posted is
    // how an account starts repeating itself a month later.
    const known = existing.map((e) => e.angle);

    let banked = 0;
    let duplicates = 0;
    let rejected = 0;

    for (const idea of incoming) {
      if (idea.score <= 0 || !idea.angle.trim()) {
        rejected += 1;
        continue;
      }
      if (known.some((a) => similarity(a, idea.angle) >= SAME_ANGLE_AT)) {
        duplicates += 1;
        continue;
      }
      await ctx.db.insert("ideas", {
        customerId: args.customerId,
        angle: idea.angle.trim(),
        evidenceJson: JSON.stringify(idea.evidence),
        score: idea.score,
        status: "bank",
        sourceKind: idea.source,
        createdAt: now,
        updatedAt: now,
      });
      known.push(idea.angle);
      banked += 1;
    }

    return { banked, duplicates, rejected };
  },
});

/**
 * ⭐ Bank depth — a health metric, not a stat.
 *
 * §7.4: *"shallow means perception stalled, **visible before the content
 * degrades**."* This is the only early warning in the system that fires while
 * the posts are still good.
 */
export const HEALTHY_BANK_DEPTH = 10;

export const bankDepth = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (
    ctx,
    args
  ): Promise<{ depth: number; healthy: boolean; detail: string }> => {
    const rows = (await ctx.db
      .query("ideas")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"ideas">[];
    const depth = rows.filter((r) => r.status === "bank").length;
    return {
      depth,
      healthy: depth >= HEALTHY_BANK_DEPTH,
      detail:
        depth >= HEALTHY_BANK_DEPTH
          ? `${depth} ideas banked`
          : depth === 0
            ? "the bank is empty — perception has stalled, and the posts will show it before long"
            : `only ${depth} ideas banked — perception is thinning`,
    };
  },
});

/**
 * The best idea to write today.
 *
 * Recency decays continuously, so the ranking is recomputed at read time rather
 * than trusting a score frozen at insert. An idea banked ten days ago should not
 * still be winning on a number it earned when it was new.
 */
export const nextIdea = internalQuery({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ ideaId: Id<"ideas">; angle: string; evidence: Evidence; score: number } | null> => {
    const now = args.now ?? Date.now();
    const rows = (await ctx.db
      .query("ideas")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"ideas">[];

    /**
     * ⭐ §14.2.2 — this is where last week reaches this week.
     *
     * The rung says what KIND of problem we have, and that selects which
     * evidence to trust more. It does NOT say which hook to use: §14.3 is
     * explicit that own data cannot answer format questions at this volume.
     *
     * Read from the same pure function the weekly verdict uses, so the report
     * and the decision can never disagree.
     */
    const placements = (await ctx.db
      .query("placements")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"placements">[];
    const { rung } = diagnoseFrom(placements, now, 7);

    /**
     * ⭐ AN IDEA ALREADY WAITING ON THE FOUNDER IS NOT A NEW IDEA.
     *
     * ⚠️ The measured bug behind *"every morning her ideas for a post seem the
     * same"* — and it is arithmetic, not model drift.
     *
     * An idea leaves `status: "bank"` only when a post PUBLISHES (`markUsed`,
     * called from the draft's publish path). So a draft that is written and
     * never approved leaves its idea banked at its original score — and this
     * query returns the single highest-scored banked idea. The same one.
     * Tomorrow, and the day after.
     *
     * Live when found: 26 of 34 drafts undecided, 182 ideas banked against 11
     * used, and she had no way to chase an approval because the tool she was
     * reaching for could not reach the founder at all.
     *
     * ⚠️ Deliberately NOT `status: "drafted"`. An unapproved draft expires
     * (`expiresAt`), and when it does the idea genuinely is available again —
     * a third status would need a sweep to clear it, which is one more thing
     * that can quietly stop running. Reading the drafts is the fact itself.
     */
    const held = new Set<string>(
      ((await ctx.db
        .query("drafts")
        .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
        .collect()) as Doc<"drafts">[])
        .filter((d) => d.outcome === "pending" && d.expiresAt > now && d.ideaId)
        .map((d) => String(d.ideaId)),
    );

    const live = rows
      .filter((r) => r.status === "bank" && !held.has(String(r._id)))
      .map((r) => {
        let evidence: Evidence = { quote: "", sourceUrls: [] };
        try {
          evidence = r.evidenceJson
            ? (JSON.parse(r.evidenceJson) as Evidence)
            : evidence;
        } catch {
          /* a corrupt row scores 0 below rather than throwing */
        }
        const { score } = scoreIdea(
          { source: (r.sourceKind as IdeaSource) ?? "observation", evidence },
          now,
          rung
        );
        return { r, evidence, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = live[0];
    return best
      ? {
          ideaId: best.r._id,
          angle: best.r.angle,
          evidence: best.evidence,
          score: best.score,
        }
      : null;
  },
});

/**
 * ⭐ Retire the shape-ideas — a one-way cleanup for a category error.
 *
 * ⚠️ `sweepTrends` used to bank each borrowable shape as an idea, putting a
 * camera direction in the field that means "what to post about". That is fixed
 * at the source, but the rows it already wrote do not go away, and they are the
 * ones that keep winning: measured live 2026-08-17, **155 of 322 banked ideas**
 * were shapes, and the top of the bank was *"A parent and child take on a
 * challenge together"* — queued to become that day's post for a product that
 * turns spreadsheets into dashboards.
 *
 * `discarded` rather than deleted. The evidence and the source URL stay
 * readable, and §16.8's archive rule is that we do not destroy what we acted
 * on — we record that we stopped acting on it.
 *
 * ⚠️ Bounded per call. A mutation that scans an unbounded table is the one that
 * breaks at the size where it matters; the caller repeats until `remaining` is
 * zero.
 */
export const retireShapeIdeas = internalMutation({
  args: {
    customerId: v.id("customers"),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ retired: number; remaining: number }> => {
    const rows = (await ctx.db
      .query("ideas")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"ideas">[];

    const stale = rows.filter(
      (r) => r.sourceKind === "format_card" && r.status === "bank"
    );
    const batch = stale.slice(0, args.limit ?? 200);
    for (const row of batch) {
      await ctx.db.patch(row._id, {
        status: "discarded",
        updatedAt: Date.now(),
      });
    }
    return { retired: batch.length, remaining: stale.length - batch.length };
  },
});

export const markUsed = internalMutation({
  args: {
    ideaId: v.id("ideas"),
    status: v.union(v.literal("used"), v.literal("discarded")),
  },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.ideaId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/* -------------------------------------------------------------------------- */
/* Filling the bank                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Turn mined complaints into banked ideas.
 *
 * **No model call, deliberately.** A complaint has already been clustered from
 * real comments and carries its receipts — *"nobody explains what it actually
 * costs"* is already the angle. Asking a model to rewrite it into an angle
 * would spend money to move further from what people actually said, which is
 * the one thing making it worth posting.
 *
 * §5.1 calls comment mining the most valuable and cheapest sweep. This is the
 * step that turns it into content rather than a report.
 */
export const bankFromComplaints = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ banked: number; duplicates: number; rejected: number }> => {
    const complaints = await ctx.runQuery(
      internal.maya.complaints.complaintsFor,
      { customerId: args.customerId }
    );
    const now = args.now ?? Date.now();

    const scored: ScoredIdea[] = complaints.map((c) => {
      const evidence: Evidence = {
        quote: c.text,
        sourceUrls: c.sourceUrls,
        frequency: c.frequency,
        observedAt: c.lastSeen,
      };
      const { score, why } = scoreIdea({ source: "complaint", evidence }, now);
      return { angle: c.text, source: "complaint", evidence, score, why };
    });

    return await ctx.runMutation(internal.maya.ideas.bankIdeas, {
      customerId: args.customerId,
      ideasJson: JSON.stringify(scored),
      now,
    });
  },
});

/**
 * Turn the morning's observations into ideas.
 *
 * ## Why this needs judgment, when complaints didn't
 *
 * A complaint is already an angle — *"nobody explains what it actually costs"*
 * is the thing to say. An observation is somebody else's post, and most of them
 * are not worth answering. *"Day one, 16 years old, 31 followers"* is a moment
 * this founder can speak to; a competitor's feature announcement is not.
 *
 * So one batched call over the top observations, asking the only question that
 * matters: **is there something this founder could say here that would be worth
 * reading?** Not "summarise this" — the observation is already the summary.
 *
 * ## Why it's the daily filler
 *
 * Complaint mining runs against comment sections and yields a handful at a
 * time. Observations arrive every morning. Without this the bank drains to
 * empty between mining runs and the 11:00 placement reports a quiet day
 * forever — which is honest, and wrong.
 */
export const IDEA_MODEL = "openai/gpt-5.6-luna-pro";

const ANGLE_SYSTEM = `You read posts from one niche and decide which ones a specific founder could add something to.

Return STRICT JSON, no prose:
{ "angles": [ { "sourceUrl": string, "angle": string, "why": string } ] }

- "angle": ⭐ NAME THE SPECIFIC THING. Point at the person, the number, the moment in THIS post. Not a lesson drawn from it.

  BAD:  "You don't need a full marketing team to start, but you do need a repeatable system."
  GOOD: "Someone posted day one at 16 years old with 31 followers. That's where everything starts."

  BAD:  "Organic social works best as a consistent feedback channel."
  GOOD: "A dev said their vacation moved to fall because the game ate the summer."

  The bad ones are advice about a topic. The good ones point at a human being.
  If the angle would still make sense with a different source post, it is too
  abstract and you have thrown away the only thing that made it worth saying.

- "why": one clause on why it's worth their breath.
- "sourceUrl": copy it exactly from the input, so the angle keeps its receipt.

Only return posts worth answering. Most aren't, and returning fewer is the correct answer — an empty array is fine.

Skip: competitor announcements (nothing to add), pure self-promotion, anything where the honest response is "congrats", and anything this founder has no standing to comment on.

Keep: a real problem someone is having · a question nobody answered well · a moment this founder has lived through · a widely-held belief they'd disagree with.

Every kept angle must survive one check: **could a reader tell which post this came from?** If not, you generalised, and generalising is how a feed turns into "5 productivity tips".`;

export function buildAnglePrompt(
  product: { whatItIs?: string; whoItsFor?: string },
  observations: Array<{ text: string; sourceUrl: string }>
): string {
  return [
    `THE FOUNDER'S PRODUCT: ${product.whatItIs ?? "unknown"}`,
    `THEIR BUYERS: ${product.whoItsFor ?? "unknown"}`,
    "",
    "POSTS FROM THE NICHE:",
    ...observations.map((o) => `- [${o.sourceUrl}] ${o.text.replace(/\s+/g, " ").slice(0, 200)}`),
    "",
    "Which of these could this founder add something to? Strict JSON only.",
  ].join("\n");
}

export function parseAngles(
  content: string
): Array<{ sourceUrl: string; angle: string; why: string }> {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return [];
  try {
    const parsed = JSON.parse(text.slice(first, last + 1)) as {
      angles?: Array<{ sourceUrl?: unknown; angle?: unknown; why?: unknown }>;
    };
    return (parsed.angles ?? [])
      .filter(
        (a): a is { sourceUrl: string; angle: string; why: string } =>
          typeof a.sourceUrl === "string" && typeof a.angle === "string"
      )
      .map((a) => ({
        sourceUrl: a.sourceUrl,
        angle: a.angle,
        why: typeof a.why === "string" ? a.why : "",
      }));
  } catch {
    return [];
  }
}

/** How many observations to consider per run. Enough to choose from, not a firehose. */
export const OBSERVATIONS_CONSIDERED = 20;

export const bankFromObservations = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ banked: number; duplicates: number; rejected: number; considered: number }> => {
    const now = args.now ?? Date.now();
    const observations = await ctx.runQuery(
      internal.maya.scroll.recentObservations,
      { customerId: args.customerId, limit: OBSERVATIONS_CONSIDERED }
    );
    if (observations.length === 0) {
      return { banked: 0, duplicates: 0, rejected: 0, considered: 0 };
    }

    const truth = await ctx.runQuery(internal.maya.productTruth.forCustomer, {
      customerId: args.customerId,
    });

    const { callModel } = await import("./llm");
    const completion = await callModel(ctx, {
      customerId: args.customerId,
      purpose: "idea_scoring",
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
      model: IDEA_MODEL,
      temperature: 0.3,
      maxTokens: 3_000,
      messages: [
        { role: "system", content: ANGLE_SYSTEM },
        {
          role: "user",
          content: buildAnglePrompt(truth ?? {}, observations.map((o) => ({
            text: o.text,
            sourceUrl: o.sourceUrl,
          }))),
        },
      ],
    });
    if (!completion.ok) {
      return { banked: 0, duplicates: 0, rejected: 0, considered: observations.length };
    }

    const byUrl = new Map(observations.map((o) => [o.sourceUrl, o]));
    const scored: ScoredIdea[] = [];
    for (const a of parseAngles(completion.content)) {
      const observed = byUrl.get(a.sourceUrl);
      // An angle whose URL matches nothing we collected is the model inventing
      // a source. Dropped — an unverifiable idea looks identical to a real one
      // everywhere downstream.
      if (!observed) continue;
      const evidence: Evidence = {
        quote: observed.text,
        sourceUrls: [observed.sourceUrl],
        observedAt: observed.postedAt ?? observed.capturedAt,
      };
      const { score, why } = scoreIdea({ source: "observation", evidence }, now);
      scored.push({ angle: a.angle, source: "observation", evidence, score, why });
    }

    /**
     * ⭐ Drop the angles that are about nothing.
     *
     * `assessInsight` has had an anti-generic gate since Sprint 5 and NO
     * PRODUCTION CALLER — the seventeenth thing this week that was built,
     * tested, and never invoked. This is the moment it was for: an angle like
     * *"drive engagement with authentic content"* survives every other check
     * here, because it has a real source URL attached and scores fine.
     *
     * Judged, not matched. The wordlist this replaced counted "engagement" as
     * padding in both *"drive engagement"* and *"3 engagements on that post"*.
     *
     * Fails OPEN — an unreachable judge banks everything rather than nothing.
     * A quality nudge that silently empties the bank is worse than one that
     * occasionally lets a dull idea through.
     */
    const kept: ScoredIdea[] = [];
    let filler = 0;
    for (const idea of scored) {
      const verdict = await ctx.runAction(internal.maya.quality.judgeFiller, {
        customerId: args.customerId,
        text: idea.angle,
      });
      if (verdict.filler) {
        filler += 1;
        continue;
      }
      kept.push(idea);
    }

    const result = await ctx.runMutation(internal.maya.ideas.bankIdeas, {
      customerId: args.customerId,
      ideasJson: JSON.stringify(kept),
      now,
    });
    return { ...result, considered: observations.length,
      // Named, so a bank that rejected everything is visible rather than empty.
      rejected: result.rejected + filler };
  },
});

/**
 * One idea by id, tenant-checked by the caller.
 *
 * Exists because `nextIdea` picks and `bankDepth` counts, but nothing could
 * simply *read* one — so anything working from an id the founder or a tool
 * already chose had no way to resolve it.
 */
export const byId = internalQuery({
  args: { ideaId: v.id("ideas") },
  handler: async (ctx, args): Promise<Doc<"ideas"> | null> =>
    (await ctx.db.get(args.ideaId)) as Doc<"ideas"> | null,
});
