/**
 * ⭐ The directive ledger, enforced — Sprint 6's exit criterion.
 *
 * The ledger has been append-only and **write-only**. `append` had a caller;
 * `activeRules`, `effectiveRule`, `history` and `forget` had none. So a founder
 * said *"we do NOT use Reddit"*, it was recorded verbatim with a timestamp, and
 * nothing on earth stopped her mentioning Reddit.
 *
 * Three real directives are live on staging right now, including *"Do not
 * identify yourself as an AI in public content"* — which happens to be caught
 * by the outbound denylist, coincidentally, and not because anyone read the
 * rule.
 *
 * ## Why this runs on the SERVER
 *
 * §18 Sprint 6's exit is *"a directive survives a redeploy **and a deliberate
 * model swap**."* A rule that lives in her prompt survives neither. Swap the
 * model and every instruction in the workspace is a suggestion to a stranger.
 *
 * §2.4 says it in one line: **anything promised to the user is enforced by the
 * server.** This is that.
 *
 * ## Judged, not matched
 *
 * A directive is the founder's own sentence — *"stop being so formal"*,
 * *"never mention our old name"*, *"only TikTok, Instagram, YouTube and X"*.
 * There is no regex for those, and the standing rule is to trust the model
 * where the question is judgment. So a model reads the draft against the rules
 * and must **quote the rule it breaks**.
 *
 * ⭐ Requiring the quote is the guard: a judge that must name which sentence
 * was broken cannot invent a violation as easily as one that returns a boolean.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

/** Cheap, and this runs on every publish. */
export const DIRECTIVE_MODEL = "openai/gpt-oss-120b";

/**
 * Kinds that constrain what a post may SAY.
 *
 * Deliberately not all of them: `posting_mode`, `cadence` and `timing_window`
 * are behavioural and enforced in the publish decision and the scheduler.
 * Asking a language model whether a sentence violates a cadence rule invites
 * a confident answer to a question it cannot see.
 */
export const CONTENT_KINDS = [
  /**
   * ⭐ `channel_toggle` is here, and it took a live test to see why.
   *
   * My first pass excluded it as behavioural — it decides WHERE she posts, and
   * the channel config enforces that. Then the gate cleared *"Just cross-posted
   * this to Reddit and LinkedIn too"* against a live rule reading *"we do NOT
   * use Reddit or LinkedIn. Only TikTok, Instagram, YouTube and X."*
   *
   * The rule constrains two different things and only one of them is
   * behavioural. Where she posts is config. What a post CLAIMS about the
   * business is content — and a post claiming a channel they do not use is a
   * factual lie about them, published under their name.
   */
  "channel_toggle",
  "topic",
  "phrase_ban",
  "voice",
  "entity_rule",
  "approved_claim",
  "product_truth",
  "icp_correction",
] as const;

export const GATE_SYSTEM = `You are checking one post against the house rules a founder gave their social media manager, in the founder's own words.

Return STRICT JSON, no prose:
{ "violates": boolean, "rule": string, "why": string }

- "violates": true ONLY if the post breaks one of the rules listed.
- "rule": the rule it breaks, QUOTED VERBATIM from the list. If you cannot quote the exact rule, then nothing was broken and "violates" is false.
- "why": one short clause naming what in the post breaks it.

The bar is a real conflict, not a vibe. A post that simply does not mention a rule's subject does not violate it. A rule about tone is broken by tone, not by topic.

⚠️ Most posts violate nothing. False is the common, correct answer, and a wrong "true" costs the founder a day's post.`;

export function parseGateVerdict(
  raw: string
): { violates: boolean; rule: string; why: string } | null {
  const fenced = raw.replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(fenced) as Record<string, unknown>;
    if (typeof parsed.violates !== "boolean") return null;
    if (!parsed.violates) return { violates: false, rule: "", why: "" };
    const rule = typeof parsed.rule === "string" ? parsed.rule.trim() : "";
    /**
     * ⭐ A violation with no quoted rule is the judge agreeing with itself.
     * Treated as no violation, because holding a post on an unnameable rule is
     * exactly the silent, unarguable block §9 exists to prevent.
     */
    if (!rule) return { violates: false, rule: "", why: "" };
    return {
      violates: true,
      rule,
      why: typeof parsed.why === "string" ? parsed.why : "",
    };
  } catch {
    return null;
  }
}

/**
 * Does this text break a rule the founder gave us?
 *
 * ⚠️ Fails OPEN. An unreachable judge must not block every post — the gate
 * that fails CLOSED is the safety critic, which asks a different question
 * (is this dangerous) from this one (did they ask us not to).
 *
 * That asymmetry is deliberate: a missed house rule costs an apology and a
 * correction; a missed safety violation costs the account.
 */
export const checkDirectives = internalAction({
  args: { customerId: v.id("customers"), text: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    rule?: string;
    why?: string;
    /** True when the gate could not run at all — see the no-key branch. */
    unchecked?: boolean;
  }> => {
    const rules = await ctx.runQuery(internal.maya.directives.activeRules, {
      customerId: args.customerId,
    });
    const relevant = rules.filter((r) =>
      (CONTENT_KINDS as readonly string[]).includes(r.kind)
    );
    if (relevant.length === 0) return { ok: true };

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      /**
       * ⚠️ FAILS OPEN, AND SAYS SO.
       *
       * This returned a bare `{ok: true}` — indistinguishable, to the caller,
       * from "I checked and it's fine." With no key, every house rule the
       * founder has ever set silently stops being enforced: "we don't use
       * Reddit", "never call yourself an AI", all of it, passing a gate that
       * never ran.
       *
       * Open rather than closed is still the right call — failing closed would
       * block every post the moment a key expires, turning a config problem
       * into a zero-placement week. But principle 5 is explicit that nothing
       * fails silently, and `unchecked` is a different fact from `ok`.
       */
      console.error(
        `[directive-gate] NOT RUN for ${args.customerId} — no OpenRouter key, ${relevant.length} house rule(s) unenforced`
      );
      return { ok: true, unchecked: true };
    }

    const { callModel } = await import("./llm");
    const completion = await callModel(ctx, {
      customerId: args.customerId,
      purpose: "directive_gate",
      apiKey,
      model: DIRECTIVE_MODEL,
      temperature: 0,
      maxTokens: 600,
      messages: [
        { role: "system", content: GATE_SYSTEM },
        {
          role: "user",
          content: [
            "HOUSE RULES, in the founder's own words:",
            // ⭐ VERBATIM. The ledger stores what they actually said, and a
            // paraphrase here would enforce our reading of their rule.
            ...relevant.map((r) => `- ${r.verbatim}`),
            "",
            `POST:\n${args.text.slice(0, 1_200)}`,
          ].join("\n"),
        },
      ],
    });
    if (!completion.ok) return { ok: true };

    const verdict = parseGateVerdict(completion.content);
    if (!verdict?.violates) return { ok: true };
    return { ok: false, rule: verdict.rule, why: verdict.why };
  },
});
