/**
 * The tool surface — what Maya's runtime is actually allowed to do (§18 Sprint 3).
 *
 * The OpenClaw pack calls these over HTTP. Everything the agent can do to the
 * world passes through this file, which makes it the right place to put the
 * two guarantees that must not depend on a model behaving well.
 *
 * ## Guarantee 1 — the agent cannot name a tenant
 *
 * **No hook accepts a `customerId`.** Tenancy is resolved from the bearer
 * token and nothing else.
 *
 * The frozen GTM pack does it the other way round: the agent sends its own
 * `agentFlyAppId` in the body, and the server looks up the token for whatever
 * id it was handed. The token still has to match, so it isn't a hole — but the
 * *shape* is wrong, because it means every handler is one forgotten re-scope
 * away from acting on a tenant the caller merely claimed to be. This surface
 * removes the argument entirely: there is no field to get wrong.
 *
 * The token is stored as a SHA-256 hash and compared in constant time. A
 * database read shouldn't yield the ability to act as somebody's agent, and a
 * byte-by-byte compare that returns early leaks the prefix.
 *
 * ## Guarantee 2 — the envelope, on every response
 *
 * Principle 8: *choreography rides in tool responses, never prompts.* Every
 * reply is `{ok, data, next, why}`, including failures, including auth
 * rejections. `next` is the load-bearing field — it's what stops a model
 * retrying a hold in a loop, because the response itself says *don't retry,
 * tell them this.* Prompts drift between deploys; a tool response is generated
 * fresh by code on every single turn.
 *
 * `respond()` is the only function in this file that constructs a `Response`,
 * and a sibling-file test enforces that, so a future handler can't quietly
 * return a bare string that the model then has to guess at.
 */

import { v } from "convex/values";
import { httpAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { dayKeyInZone } from "./cadence";
import { topShapes } from "./formats";

/* -------------------------------------------------------------------------- */
/* The envelope                                                                */
/* -------------------------------------------------------------------------- */

export interface Envelope<T = unknown> {
  ok: boolean;
  data?: T;
  /** What to do now. The field that prevents retry loops. */
  next?: string;
  /** Why this happened — plain language, because it often reaches the founder. */
  why?: string;
}

/**
 * The only place a `Response` is built.
 *
 * HTTP status stays 200 for a *decided* outcome even when `ok` is false —
 * a held post is a real answer, not a transport failure, and a 4xx invites the
 * runtime's retry layer to hammer a decision that will never change. Genuine
 * transport-level rejections (bad token, bad JSON) do carry a status.
 */
function respond<T>(body: Envelope<T>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

/** SHA-256 hex. Convex's runtime exposes Web Crypto. */
export async function hashToken(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string compare.
 *
 * Both sides are fixed-length hex digests, so length is not itself a secret,
 * but the loop still visits every byte rather than returning at the first
 * mismatch.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const customerByTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args): Promise<Doc<"customers"> | null> => {
    const row = (await ctx.db
      .query("customers")
      .withIndex("by_agent_token", (q) => q.eq("agentTokenHash", args.tokenHash))
      .first()) as Doc<"customers"> | null;
    if (!row?.agentTokenHash) return null;
    // The index already matched, but comparing explicitly keeps the constant-
    // time path on the code path a reader actually sees.
    return timingSafeEqual(row.agentTokenHash, args.tokenHash) ? row : null;
  },
});

/**
 * Resolve the calling agent, or explain why not.
 *
 * Every rejection reads the same from outside — no distinction between "no
 * such token" and "token for a cancelled account" — so the surface can't be
 * used to enumerate which tokens exist.
 */
async function authenticate(
  ctx: ActionCtx,
  request: Request
): Promise<{ customer: Doc<"customers"> } | { error: Response }> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return {
      error: respond(
        {
          ok: false,
          why: "this call arrived without a bearer token",
          next: "nothing to do from the agent side — the machine's HOOK_TOKEN isn't reaching the request",
        },
        401
      ),
    };
  }
  const presented = header.slice("Bearer ".length).trim();
  if (presented.length === 0) {
    return {
      error: respond(
        { ok: false, why: "the bearer token was empty", next: "stop and report this" },
        401
      ),
    };
  }

  const customer = await ctx.runQuery(internal.maya.hooks.customerByTokenHash, {
    tokenHash: await hashToken(presented),
  });
  if (!customer) {
    return {
      error: respond(
        {
          ok: false,
          why: "that token doesn't match an account",
          next: "stop and report this — do not retry",
        },
        401
      ),
    };
  }
  return { customer };
}

async function readJson(
  request: Request
): Promise<{ body: Record<string, unknown> } | { error: Response }> {
  try {
    const parsed = (await request.json()) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        error: respond(
          { ok: false, why: "the request body wasn't a JSON object", next: "fix the call and try once" },
          400
        ),
      };
    }
    return { body: parsed as Record<string, unknown> };
  } catch {
    return {
      error: respond(
        { ok: false, why: "the request body wasn't valid JSON", next: "fix the call and try once" },
        400
      ),
    };
  }
}

/** Narrow a readJson result to its body, or an empty object on failure. */
function parsed_body(
  parsed: { body: Record<string, unknown> } | { error: Response }
): Record<string, unknown> {
  return "body" in parsed ? parsed.body : {};
}

function num(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/* -------------------------------------------------------------------------- */
/* publish                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Publish a draft. **The only publish path there is.**
 *
 * The handler does not decide anything itself — it asks `publishDecision`
 * (§9.1, the iron rule) and does what it says. That is deliberate and a test
 * enforces it: the entire point of having exactly one function that decides
 * publish-or-hold is defeated the moment a second place can hold a post, and
 * an HTTP handler with its own `if` is the most natural place for that second
 * place to appear.
 *
 * A hold comes back `ok: false` with `next` telling the model to relay the
 * reason rather than retry. That framing matters: the old system's holds were
 * silent, so the agent kept trying and the founder saw nothing happen for days.
 */
/**
 * `request_assets` — ask for the one thing only the founder can give.
 *
 * §6.4.6b measured that **half** of target-type sites publish no product
 * screenshot at all, and a headless browser doesn't fix that — the images
 * aren't hidden, they don't exist. So for roughly half of customers this ask
 * is the only route to real product imagery, and everything visual downstream
 * waits on it.
 *
 * ## One recording, not five screenshots
 *
 * §6.4.2. Lighter for them, richer for us: one 30–60s screen recording yields
 * frames, b-roll, AND showable moments that seed the idea bank. "Send me five
 * screenshots" asks for more work and returns less.
 *
 * ## Guarded three ways, because attention is the scarce thing
 *
 * It fires only when the library is **degraded** (zero real product imagery —
 * not merely thin, which is a worse video and still a real post), it spends a
 * proactive message, and it is deduped for the day. A founder pestered for
 * assets they already sent stops reading the messages that matter.
 */
export const requestAssetsHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;

  const health = await ctx.runQuery(internal.maya.media.libraryHealth, {
    customerId: auth.customer._id,
  });

  /**
   * ⚠️ `shouldAsk` is a FACT about the library; `askState` is the decision.
   *
   * The library being thin stays true for as long as it is thin, so gating on
   * it alone re-asks forever — §6.4.2 lists nagging more than once as a Never.
   */
  const askState = await ctx.runQuery(internal.maya.media.assetAskState, {
    customerId: auth.customer._id,
  });

  if (askState === "silent") {
    return respond({
      ok: false,
      data: { asked: false, library: health },
      why: health.shouldAsk
        ? `already asked — ${health.detail}`
        : `no need — ${health.detail}`,
      next: health.shouldAsk
        ? "don't ask again. Work with what's there, and use a plain background where there's nothing to show"
        : "don't ask. Use what's already there and get on with the post",
    });
  }

  const budgets = await ctx.runQuery(internal.maya.planFeatures.planFeatures, {
    customerId: auth.customer._id,
  });
  const sentToday = await ctx.runQuery(
    internal.maya.messages.proactiveSentToday,
    { customerId: auth.customer._id }
  );
  if (sentToday >= budgets.proactiveMessagesPerDay) {
    return respond({
      ok: false,
      data: { asked: false },
      why: "you've used today's unprompted messages, and this isn't urgent enough to be the exception",
      next: "ask tomorrow. Do NOT retry today",
    });
  }

  const body = str(parsed_body(await readJson(request)), "body");
  const result = await ctx.runMutation(internal.maya.messages.send, {
    customerId: auth.customer._id,
    surface: "telegram",
    body:
      body ??
      "Quick ask, and it's the only one I'll make: could you send me a 30–60 second screen recording of you using it? Just talk through what you'd show someone. I can pull stills, clips and post ideas out of one recording — it saves you sending screenshots one at a time, and right now I've got nothing real of the product to work with.",
    proactive: true,
    // One ask per customer per day, ever — see the guard above.
    // The founder's day — see the note on the update hook's key below.
    dedupeKey: `asset-ask:${dayKeyInZone(Date.now(), auth.customer.timezone ?? "UTC")}`,
  });

  return result.sent
    ? respond({
        ok: true,
        data: { asked: true, library: health },
        why: "asked — one recording, and it's on its way to them",
        next: "carry on with what you can make meanwhile. Don't ask again",
      })
    : respond({
        ok: false,
        data: { asked: false, duplicate: true },
        why: "you already asked today",
        next: "wait for the recording rather than asking twice",
      });
});

/**
 * `history` — what she has actually done.
 *
 * ## The failure this closes
 *
 * Asked *"what have you posted to X so far? give me the links"*, she answered:
 *
 * > *"I haven't successfully posted anything to X yet, so there are no live X
 * > links to give you."*
 *
 * **She had posted twice.** Both live, both in `placements`, both openable by
 * the founder. She was confidently wrong about her own work because nothing
 * let her look — `archive.ts` has had `timeline`, `search` and `provenance`
 * since Sprint 2 with no tool exposing any of them.
 *
 * That is worse than forgetting. A founder who can see the tweets is being
 * told they don't exist, and every later claim she makes inherits that doubt.
 *
 * v1 hit this exact wall — its notes call an unread-own-work tool "the root
 * enabler of repetition." Reproduced here, one product later.
 *
 * ## Why a row read, not memory
 *
 * Placements are FACTS, and §2 is explicit: the database is the truth, the
 * model is a participant. Asking her to remember what she posted is asking a
 * context window to be a database — which is the architecture this product was
 * rebuilt to stop relying on.
 */
export const historyHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;

  /**
   * ⭐ Two modes that existed in `archive.ts` since Sprint 2 with no caller.
   *
   * `query` — "have I said this before?" She is told not to repeat herself and
   * had no way to check. A timeline of the last 14 days answers "what went
   * out"; it does not answer "did I already make this exact point in March",
   * which is the question that stops an account sounding like a loop.
   *
   * `placementId` — "why did you post that?" The provenance chain (§16.8.4)
   * links a placement back through its draft to the idea and the evidence.
   * §10.2 again: the answer comes from the chain, never from a reconstruction.
   */
  const query = str(parsed.body, "query");
  const placementId = str(parsed.body, "placementId");

  if (placementId) {
    const chain = await ctx.runQuery(internal.maya.archive.provenance, {
      customerId: auth.customer._id,
      placementId: placementId as Id<"placements">,
    });
    /**
     * ⭐ Three states, not two. A placement that exists but has no draft or
     * idea behind it is TRACEABLE TO NOTHING — and telling her to "quote the
     * evidence" there is an instruction to invent some.
     *
     * Found by a test: an orphan placement returned a non-null chain (the
     * placement itself) and got the full-provenance answer.
     */
    const traced = Boolean(chain?.draft ?? chain?.idea);
    return respond({
      ok: Boolean(chain),
      data: { provenance: chain },
      why: !chain
        ? "no record of that placement"
        : traced
          ? "here's where that post came from"
          : "that post is on record, but nothing links it back to an idea",
      next: !chain
        ? "say you can't find it rather than reconstructing a reason"
        : traced
          ? "quote the evidence it came from — the quote and the source URL are what make it an answer rather than a story"
          : "say plainly that you can see the post but not what prompted it. Do NOT reconstruct a reason — a plausible story they can't correct is worse than admitting the trail is missing",
    });
  }

  if (query) {
    const hits = await ctx.runQuery(internal.maya.archive.search, {
      customerId: auth.customer._id,
      query,
    });
    return respond({
      ok: true,
      data: {
        matches: hits.map((p) => ({
          url: p.url ?? null,
          text: p.snapshotText,
          channel: p.channel,
          publishedAt: p.publishedAt,
        })),
      },
      why:
        hits.length === 0
          ? `nothing in the archive matches "${query}"`
          : `${hits.length} past posts match "${query}"`,
      next:
        hits.length === 0
          ? "this angle is new — go ahead"
          : "you have covered this before. Either find a genuinely different angle or say plainly that you're returning to it and why",
    });
  }

  const days = Math.min(Math.max(num(parsed.body, "days") ?? 14, 1), 90);
  const since = Date.now() - days * 86_400_000;

  const placements = await ctx.runQuery(internal.maya.archive.timeline, {
    customerId: auth.customer._id,
    since,
    limit: 50,
  });

  /**
   * ⭐ THE NUMBERS RIDE ALONG.
   *
   * This returned URL, channel, kind, text and date — and no metrics at all —
   * while her Sunday cron asked *"which of the five rungs is working"* (§14.2).
   * A diagnosis with no numbers under it leaves two outcomes: she says she
   * can't, or she guesses.
   *
   * `metricsAsOf` travels WITH them, always. The schema comment says why:
   * a number with no date is how dashboards start lying.
   */
  const posted = placements.map((p) => ({
    url: p.url ?? null,
    linkStatus: p.linkStatus,
    channel: p.channel,
    kind: p.kind,
    text: p.snapshotText,
    publishedAt: p.publishedAt,
    metrics: p.metricsJson ? safeJson(p.metricsJson) : null,
    metricsAsOf: p.metricsAsOf ?? null,
  }));

  if (posted.length === 0) {
    return respond({
      ok: true,
      data: { placements: [], days },
      why: `nothing has gone live in the last ${days} days`,
      next: "say exactly that — a zero is a real answer and pretending otherwise is worse",
    });
  }

  const live = posted.filter((p) => p.linkStatus === "live").length;

  /**
   * ⭐ The streak rides along, because the daily cadence IS the job (§18
   * Sprint 3) and she cannot see it from a list of placements — counting
   * consecutive days in the founder's timezone is not something to do by
   * eye in a context window.
   *
   * It also tells her something no list does: whether TODAY is still open.
   * That is the difference between noticing at 4pm and finding out tomorrow.
   */
  const run = await ctx.runQuery(internal.maya.cadence.cadence, {
    customerId: auth.customer._id,
  });

  /**
   * ⭐ The rung is COMPUTED, not left to her.
   *
   * §2.3 — deterministic code watches, the model judges. Which rung broke is
   * arithmetic on rows; what it MEANS and what to do stays hers. Computing it
   * also stops the failure §14.2 really guards against: a confident diagnosis
   * with nothing under it.
   */
  const ladder = await ctx.runQuery(internal.maya.ladder.diagnose, {
    customerId: auth.customer._id,
    sinceDays: days,
  });

  return respond({
    ok: true,
    data: {
      placements: posted,
      days,
      cadence: {
        streak: run.streak,
        longestStreak: run.longestStreak,
        todayDone: run.todayDone,
      },
      ladder: {
        rung: ladder.rung,
        views: ladder.views,
        engagements: ladder.engagements,
        unmeasured: ladder.unmeasured,
      },
    },
    why: `${posted.length} placements in the last ${days} days, ${live} with a live link — ${run.detail}. ${ladder.detail}`,
    next: run.todayDone
      ? "quote the URLs when they ask what went out — never answer from memory, and never say you haven't posted without checking here first"
      : "nothing has gone live today yet. Quote URLs from here rather than memory, and if the day is nearly over, say so rather than letting the run break quietly",
  });
});

/**
 * `update` — tell the founder something, unprompted.
 *
 * The morning brief and the evening recap both need this and **there was no
 * tool for it.** Her only outbound path was `ask_founder`, which sends a
 * QUESTION and is capped by the one-open-question invariant — so a cron telling
 * her to brief the founder had nowhere to put the brief.
 *
 * Sixth instance this week of finished machinery with no caller:
 * `messages.send` and `proactiveSentToday` have both existed since Sprint 2.
 *
 * ## Budgeted, because unprompted messages are the churn risk
 *
 * §13.5.3 is explicit that `proactiveMessagesPerDay` is **not** a tier lever —
 * above ~4 she is interrupting rather than reporting, and a premium tier that
 * messages more is a worse product. The refusal is a real answer with a reason,
 * not an error: she should say what she'd have said tomorrow, not retry.
 */
export const updateHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;

  const body = str(parsed.body, "body");
  const kind = str(parsed.body, "kind") ?? "update";
  if (!body) {
    return respond(
      { ok: false, why: "there's nothing written to send", next: "write the update first" },
      400
    );
  }

  const budgets = await ctx.runQuery(internal.maya.planFeatures.planFeatures, {
    customerId: auth.customer._id,
  });
  const sentToday = await ctx.runQuery(
    internal.maya.messages.proactiveSentToday,
    { customerId: auth.customer._id }
  );

  if (sentToday >= budgets.proactiveMessagesPerDay) {
    return respond({
      ok: false,
      data: { sent: false, sentToday, limit: budgets.proactiveMessagesPerDay },
      why: `you've already sent them ${sentToday} unprompted messages today — that's the limit`,
      next: "hold it until tomorrow. Do NOT retry, and don't work around it by asking a question instead",
    });
  }

  /**
   * Deduped per kind per day, so a cron that fires twice sends one brief.
   *
   * ⚠️ The FOUNDER's day. This was `new Date().toISOString().slice(0, 10)` —
   * UTC — and the 20:00 recap on 2026-08-07 was filed as `recap:2026-08-08`,
   * because 20:00 in New York IS 00:00 UTC the next day.
   *
   * Two failures from one line: liveness reported `recapSentToday: false` and
   * would have raised a false `recap_missed`, and the FOLLOWING evening's
   * recap would compute that same key and be deduped away entirely — one
   * recap every two days, silently.
   *
   * Eighth instance of this class. `dailyReport` and `liveness` were fixed on
   * 08-06; this file has its own key builder and was missed.
   */
  const today = dayKeyInZone(Date.now(), auth.customer.timezone ?? "UTC");
  const result = await ctx.runMutation(internal.maya.messages.send, {
    customerId: auth.customer._id,
    surface: "telegram",
    body,
    proactive: true,
    dedupeKey: `${kind}:${today}`,
  });

  return result.sent
    ? respond({
        ok: true,
        data: { sent: true, sentToday: sentToday + 1 },
        why: "sent — it's on its way to them",
        next: "carry on; you don't need to confirm it landed",
      })
    : respond({
        ok: false,
        data: { sent: false, duplicate: true },
        why: `you already sent them a ${kind} today`,
        next: "don't send it twice — they'll read the first one",
      });
});

/**
 * `remember` — write down a rule the founder just gave.
 *
 * §10's premise is that founders give instructions in passing, forever — *"don't
 * post before 9"*, *"stop saying game-changer"*, *"we pivoted to agencies"* — and
 * that a model absorbs them only until the context rolls. So rules live in rows.
 *
 * The ledger has existed since Sprint 2 and **nothing could write to it**: no
 * tool, no hook. Every rule the founder gave lasted exactly as long as the
 * conversation, which is the failure §10 was written to prevent.
 *
 * `verbatim` is what they actually typed, never a paraphrase, because the payoff
 * is being able to say *"you told me on July 3: 'stop posting on linkedin its
 * dead'"* — and a paraphrase is a summary of a rule while the quote is proof you
 * were listening.
 *
 * ⭐ A `product_truth` rule also **updates the product record**, because
 * otherwise the founder corrects a fact, she agrees, and every draft keeps
 * citing the old one. That was live on 2026-08-04: her product truth came from
 * a landing page describing a product that no longer exists, and there was no
 * way for anyone to tell her.
 */
export const rememberHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;

  const verbatim = str(parsed.body, "verbatim");
  const kind = str(parsed.body, "kind");
  if (!verbatim) {
    return respond(
      {
        ok: false,
        why: "nothing to remember — I need their exact words",
        next: "pass what they actually typed, not your summary of it",
      },
      400
    );
  }
  if (!kind || !(DIRECTIVE_KINDS as readonly string[]).includes(kind)) {
    return respond(
      {
        ok: false,
        data: { allowed: DIRECTIVE_KINDS },
        why: `"${kind ?? "(none)"}" isn't a kind of rule I can file`,
        next: "pick the closest kind from data.allowed — use `other` if nothing fits",
      },
      400
    );
  }

  const result = await ctx.runMutation(internal.maya.directives.append, {
    customerId: auth.customer._id,
    kind: kind as (typeof DIRECTIVE_KINDS)[number],
    verbatim,
    interpretationJson: str(parsed.body, "meaning")
      ? JSON.stringify({ meaning: str(parsed.body, "meaning") })
      : undefined,
  });

  // A corrected fact has to reach the grounding record, or she agrees with the
  // founder and keeps citing the old version anyway.
  let productUpdated = false;
  if ((CLAIM_CHANGING_KINDS as readonly string[]).includes(kind)) {
    productUpdated = await ctx.runMutation(
      internal.maya.productTruth.applyCorrection,
      { customerId: auth.customer._id, correction: verbatim }
    );
  }

  return respond({
    ok: true,
    data: { directiveId: result.directiveId, productUpdated },
    why: "filed — I'll hold you to this one",
    next: productUpdated
      ? "the product record is updated too; say back what you now understand so they can catch it if it's wrong"
      : "carry on — say it back in your own words so they know you got it",
  });
});

/**
 * `scroll` — read what's moving in the niche.
 *
 * The 07:00 cron says "scroll", and without this she can only say she can't.
 * §13.5.2: the sweep is not enrichment, it is the input — a post written from
 * product truth alone is the same post every day.
 *
 * Returns ranked observations and nothing else. Deciding which one is worth a
 * post is hers, with product truth in hand (§5.2: no LLM in collection).
 */
export const scrollHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;

  const result = await ctx.runAction(internal.maya.scroll.scrollNiche, {
    customerId: auth.customer._id,
  });

  /**
   * ⭐ MINE THE COMMENTS. This is the moat, and it never ran.
   *
   * CLAUDE.md states the whole pitch in one line: *"she watches what's
   * actually working in the niche, MINES WHAT BUYERS ARE COMPLAINING ABOUT,
   * and then writes."*
   *
   * `mineComplaints` had **no caller**. `complaintsFor` is read by
   * `bankFromComplaints`, so complaints are consumed — they were simply never
   * produced except by hand. And a complaint is the strongest evidence in the
   * bank: `SOURCE_WEIGHT.complaint` is 1.0, the ceiling, because someone typed
   * it about a real problem.
   *
   * Folded into the morning scroll rather than given a cron, because §5.2's
   * sweep 4 IS part of "read the niche" — and a separate job is one more thing
   * that can quietly stop running.
   */
  const complaints = await ctx.runAction(internal.maya.complaints.mineComplaints, {
    customerId: auth.customer._id,
  });

  /**
   * ⭐ The competition rides along, because it is the same question.
   *
   * "What's happening out there today" covers both what the niche is posting
   * and whether anyone she watches just had a breakout. A separate tool would
   * be a second thing to remember, and the thing this codebase keeps proving
   * is that a module nobody calls does nothing at all — `watchCompetitors`
   * was zero-caller ten minutes after I wrote it.
   */
  const competition = await ctx.runAction(
    internal.maya.competitors.watchCompetitors,
    { customerId: auth.customer._id }
  );

  /**
   * ⭐ THE SCROLL FILLS THE BANK. Not a separate job she has to remember.
   *
   * `bankFromObservations` shipped with nothing calling it, which is the ninth
   * time this week a finished module has had no producer. Attaching it here
   * means the daily read and the daily restock are one action: she cannot
   * scroll without banking, and the bank cannot silently drain while the
   * scroll keeps working.
   *
   * Runs before the read below, so today's angles are available to today's
   * draft rather than tomorrow's.
   */
  await ctx.runAction(internal.maya.ideas.bankFromObservations, {
    customerId: auth.customer._id,
  });

  /**
   * ⭐⭐ AND THE COMPLAINTS — THE MOAT, WHICH HAD NEVER PRODUCED A SINGLE POST.
   *
   * CLAUDE.md states the whole pitch in one sentence: *"she watches what's
   * actually working in the niche, **mines what buyers are complaining about**,
   * and then writes."* The middle clause was not connected to anything.
   *
   * `mineComplaints` runs directly above and stores what it finds.
   * `bankFromComplaints` turns those into ideas — and had **no caller**, so
   * complaints were mined daily and left sitting in a table.
   *
   * ⚠️ Measured on the live account 2026-08-17. Idea sources across 193 rows:
   *
   *   observation   101
   *   format_card    92
   *   complaint       0
   *
   * Zero. While `SOURCE_WEIGHT.complaint` is **1.0** — the ceiling of the
   * scoring function, set there because someone typed it about a real problem
   * they actually have. The single highest-signal input in the product produced
   * nothing, and the symptom was a founder reporting that her ideas felt the
   * same every morning: she was choosing from two sources instead of three.
   *
   * Deliberately AFTER `bankFromComplaints`'s own input is mined and BEFORE
   * `nextIdea` reads below, so a complaint found this morning can be posted
   * this morning rather than tomorrow.
   */
  await ctx.runAction(internal.maya.ideas.bankFromComplaints, {
    customerId: auth.customer._id,
  });

  /**
   * ⭐ The bank rides along with the scroll.
   *
   * She needs an idea to draft a post, and a tool she has to remember to call
   * is a tool she forgets. Attaching it here puts the idea in front of her at
   * the exact moment she is deciding what to say — and costs nothing, because
   * she was already making this call.
   */
  const idea = await ctx.runQuery(internal.maya.ideas.nextIdea, {
    customerId: auth.customer._id,
  });
  const bank = await ctx.runQuery(internal.maya.ideas.bankDepth, {
    customerId: auth.customer._id,
  });

  /**
   * ⭐ THE SHAPES SHE WATCHED. The most expensive thing she does, and until now
   * nothing she wrote could see it.
   *
   * `watchTopFormats` downloads the video and sends the bytes to Gemini — it
   * works, and 7 of 12 live cards carry real beats, overlay timing and pacing.
   * But `formatCardsFor` had exactly ONE reader, `carousel.ts`, which asks for
   * `channel: "tiktok"` and needs media assets to run. With an empty asset
   * library it never ran, so **every watched card went unread**.
   *
   * ⚠️ The word "format" appeared ZERO times in her tool surface. She was
   * paying to watch videos and then writing without them — the exact shape of
   * §13.5.2's complaint about product truth alone, one level up.
   *
   * Attached to `scroll` for the reason the bank and the complaints are: a tool
   * she has to remember is a tool she forgets, and she is already making this
   * call at the moment she decides what to say.
   */
  const library = await ctx.runQuery(internal.maya.formats.formatCardsFor, {
    customerId: auth.customer._id,
  });

  /**
   * Watched cards first — a `read` card has the spoken hook, a `watch` card has
   * the visual hook, the overlay timing and the cut rhythm, and those are most
   * of what makes a short video work. Then by reach within each tier.
   *
   * ⚠️ Three, not twelve. The full card carries per-second beats; twelve of
   * them would crowd out the observations she is supposed to be reading. She
   * can pull the whole card by id when she has chosen one.
   */
  const shapes = topShapes(library.cards).map((c) => ({
      cardId: c.cardId,
      channel: c.channel,
      /** "watch" means she actually saw it; "read" means transcript only. */
      depth: c.depth,
      reusableAs: c.reusableAs,
      visualDevice: c.hook.visualDevice,
      onScreenText: c.hook.onScreenText,
      textOverlay: c.textOverlay,
      pacing: c.pacing,
      views: c.metrics.views,
    }));

  if (!result.ok) {
    return respond({
      ok: false,
      data: { observations: [] },
      why: result.error ?? "couldn't read the niche",
      next: "tell the founder you don't know what to watch yet, and ask what their buyers care about",
    });
  }

  const observations = result.observations ?? [];
  if (observations.length === 0) {
    return respond({
      ok: true,
      data: {
        observations: [],
        keywordsSwept: result.keywordsSwept ?? [],
        competition: competition.breakouts,
      },
      why: `the niche is quiet today — nothing moving worth posting about. ${competition.detail}`,
      next:
        competition.breakouts.length > 0
          ? "the niche is quiet but someone you watch just broke out — that's worth a look and worth telling them about"
          : "a quiet day is a real finding. Say so rather than posting filler",
    });
  }

  return respond({
    ok: true,
    data: {
      observations,
      keywordsSwept: result.keywordsSwept ?? [],
      todaysIdea: idea,
      bankDepth: bank.depth,
      complaintsFound: complaints.complaints?.length ?? 0,
      /**
       * ⭐ Shapes that already worked in this niche, watched rather than
       * guessed. `depth: "watch"` means she saw the video; `reusableAs` is the
       * shape written so it applies to a DIFFERENT product, which is what makes
       * it borrowable rather than copyable.
       */
      shapes,
      /**
       * Accounts she watches that just pulled far above their own usual. The
       * multiple is against THEIR baseline, so it means something for a small
       * account as much as a large one.
       */
      competition: competition.breakouts,
    },
    why: idea
      ? `${observations.length} things moving, and the strongest banked idea is "${idea.angle}". ${competition.detail}`
      : `${observations.length} things moving, but the idea bank is empty. ${competition.detail}`,
    next: idea
      ? /**
         * ⭐ Two different questions, and she needs both. The idea is WHAT to
         * say — the evidence, the quote, the person. The shape is HOW to build
         * it. Answering only the first is how a post ends up true and shapeless.
         *
         * ⚠️ Borrow the shape, never the words: `reusableAs` is deliberately
         * written to apply to a different product, and a card copied verbatim
         * is someone else's post with the nouns swapped.
         */
        shapes.length > 0
        ? `draft against data.todaysIdea.ideaId — its evidence is what you cite, and its quote is what a real person actually said. For HOW to build it, data.shapes carries ${shapes.length} shape(s) that already worked in this niche — borrow the structure in reusableAs, never the words`
        : "draft against data.todaysIdea.ideaId — its evidence is what you cite, and its quote is what a real person actually said"
      : "no banked idea means nothing has earned a post yet. Say that to the founder rather than inventing one",
  });
});

/**
 * `draft` — write a post down so it can be published.
 *
 * The missing link. `publish` takes a draftId and nothing created drafts, so
 * she could compose a perfect sentence and had nowhere to put it. Live on
 * 2026-08-04, asked to post a specific line, she answered: *"I can't post it
 * because this exact text doesn't have a draft record."* She was right.
 *
 * Preflight runs here so an over-length post is caught while writing, when the
 * fix is free — not after the founder has approved text we then have to
 * silently change or go back and re-ask about.
 */
export const draftHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;

  const text = str(parsed.body, "text");
  const channel = str(parsed.body, "channel");
  if (!text) {
    return respond(
      { ok: false, why: "no text was given", next: "write the post, then save it as a draft" },
      400
    );
  }
  if (!channel) {
    return respond(
      { ok: false, why: "no channel was given", next: "say which channel this is for" },
      400
    );
  }

  const kindRaw = str(parsed.body, "kind");
  const kind =
    kindRaw === "reply" || kindRaw === "cold_reply" ? kindRaw : ("post" as const);
  const ideaId = str(parsed.body, "ideaId");

  /**
   * ⭐ THE PRE-SPEND GATE (§7.5.7), CHECK 3 — before the founder sees anything.
   *
   * `checkPostBudget` has existed since Sprint 2 with **no caller**, so the
   * daily cap the plan tiers promise — `postsPerDayPerChannel: 2` on mvp — was
   * never enforced anywhere. She could post fifty times, which is a platform
   * ban risk and a broken promise in the same act.
   *
   * ⚠️ It belongs HERE, not at publish. `publishDecision`'s header is explicit
   * that budgets are deliberately excluded from the iron rule: *"they belong to
   * the pre-spend gate, which runs before the founder ever sees the idea,
   * precisely so an approved idea can never fail on budget. Failing after a
   * yes is the worst possible sequence."*
   *
   * Drafting is that moment. Refusing here costs her one tool call; refusing
   * after approval costs the founder's trust.
   *
   * Replies are exempt — §1, inbound outranks outbound, and a daily post cap
   * that silences answers turns a rate limit into rudeness.
   */
  if (kind === "post") {
    const budget = await ctx.runQuery(internal.maya.planFeatures.checkPostBudget, {
      customerId: auth.customer._id,
      channel,
    });
    /**
     * `hard_block` is the exhaustion verdict for this metric — §2.10's
     * budgets-not-booleans rule means the answer is a rung, not a boolean, and
     * the daily post cap is the one metric where the rung IS "stop".
     */
    if (budget.verdict === "hard_block") {
      return respond({
        ok: false,
        data: { used: budget.used, limit: budget.limit },
        why: `that's ${budget.used} of ${budget.limit} posts on ${channel} today`,
        next: "don't draft another for this channel today — say what's already gone out, and if they want more, that's a plan change rather than something to push through",
      });
    }
  }

  /**
   * ⭐ A POST MUST TRACE TO AN IDEA. A REPLY MUST NOT.
   *
   * The blank page, closed structurally. Measured 2026-08-05: asked for ten
   * varied posts with nothing banked she wrote one idea ten times, and the
   * prose was fine — good writing, one thought. Nothing stopped her, because
   * nothing asked where the idea came from.
   *
   * Replies are exempt on purpose. A reply is driven by what someone ELSE just
   * said, which is better evidence than anything in the bank — requiring a
   * banked idea there would stop her answering people, and §1 says inbound
   * outranks outbound.
   */
  if (kind === "post" && !ideaId) {
    const idea = await ctx.runQuery(internal.maya.ideas.nextIdea, {
      customerId: auth.customer._id,
    });
    return respond({
      ok: false,
      data: { saved: false, problem: "no_idea", suggested: idea },
      why: idea
        ? `every post has to come from something someone actually said — the strongest one banked is "${idea.angle}"`
        : "the idea bank is empty, so there's nothing that's earned a post today",
      next: idea
        ? "draft it again with that ideaId, and write to the person who said it"
        : "tell the founder it's a quiet day. A day with nothing worth saying is a real finding, and filler is how an account starts sounding like a bot",
    });
  }

  const result = await ctx.runMutation(internal.maya.drafts.create, {
    customerId: auth.customer._id,
    channel,
    text,
    kind,
    ideaId: ideaId ? (ideaId as Id<"ideas">) : undefined,
  });

  if (!result.ok) {
    // A preflight failure is an ANSWER, not an error — it says what to fix and
    // she can fix it immediately.
    return respond({
      ok: false,
      data: { saved: false, problem: result.failure },
      why: result.message,
      next:
        result.failure === "over_length"
          ? "tighten it and save it again"
          : "fix that, then save it again",
    });
  }

  return respond({
    ok: true,
    data: { draftId: result.draftId, length: result.weightedLength },
    why: "saved — it's ready to publish",
    next: "publish it with this draftId, or show it to the founder first if the switch says so",
  });
});

/**
 * The kinds a rule can be. Mirrors the schema union exactly — a tool sending a
 * kind the schema rejects would throw inside the mutation, where the founder
 * never sees it.
 */
/**
 * ⭐ THE KINDS THAT CHANGE WHAT SHE MAY CLAIM.
 *
 * Not just `product_truth`. Told *"we don't do Reddit anymore, HeyMaya runs
 * TikTok, Instagram, YouTube and X only"*, she filed it as `channel_toggle` —
 * which is a **better** classification than `product_truth`, and left the
 * grounding record still saying she posts on Reddit.
 *
 * The design was brittle for assuming one kind. The actual rule is about
 * consequence, not label: if a rule changes what is TRUE about the product, it
 * belongs in `APP.md` regardless of which drawer it was filed in.
 *
 * Deliberately excludes the operational kinds. *"Don't post before 9"* is a
 * real rule and says nothing about what the product is.
 */
export const CLAIM_CHANGING_KINDS = [
  "product_truth",
  "icp_correction",
  "approved_claim",
  "channel_toggle",
] as const;

export const DIRECTIVE_KINDS = [
  "posting_mode", "channel_toggle", "cadence", "timing_window", "topic",
  "phrase_ban", "voice", "entity_rule", "approved_claim", "product_truth",
  "icp_correction", "notification_pref", "pause", "escalation",
  "standing_task", "campaign", "other",
] as const;

export const publishHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;

  const draftId = str(parsed.body, "draftId");
  if (!draftId) {
    return respond(
      { ok: false, why: "no draftId was given", next: "write the draft first, then publish it" },
      400
    );
  }

  /**
   * ⭐ CAPTURE THE EDIT — the strongest voice signal we get, and it was never
   * recorded.
   *
   * SOUL.md says it outright: *"A writing sample shows me their register; an
   * edit shows me what I got WRONG. When these disagree with anything above,
   * these win."*
   *
   * `drafts.decide` has existed since Sprint 4 to store exactly that, with
   * **no caller**. So the chain died at step one: she drafted, the founder
   * rewrote it, nothing recorded the diff, `foldEdits` and `diffSignals` had
   * no input, and the `editPairs` block in her workspace has rendered empty
   * since the day it was written.
   *
   * ⚠️ Captured HERE rather than in a tool of its own, because the approval
   * and the edit arrive in the same breath — *"post it but say 'ship' not
   * 'deploy'"*. A separate tool is one she has to remember to call after the
   * founder has already moved on, and that is precisely the shape of thing
   * this codebase keeps not calling.
   *
   * The edited text also BECOMES the draft, so publishing posts what they
   * approved rather than the version they rejected.
   */
  const editedText = str(parsed.body, "editedText");
  if (editedText && editedText.trim().length > 0) {
    await ctx.runMutation(internal.maya.drafts.decide, {
      draftId: draftId as Id<"drafts">,
      outcome: "edited",
      editedText,
    });
  }

  // Double-publish prevention (invariant 4) BEFORE the decision, so a retry of
  // an already-published draft is idempotent rather than a second post.
  const already = await ctx.runQuery(internal.maya.publishDecision.alreadyPublished, {
    draftId: draftId as Id<"drafts">,
  });
  if (already) {
    return respond({
      ok: true,
      data: { published: true, duplicate: true },
      why: "that draft is already live",
      next: "don't post it again — it's done",
    });
  }

  const decision = await ctx.runQuery(internal.maya.publishDecision.decidePublish, {
    customerId: auth.customer._id,
    draftId: draftId as Id<"drafts">,
    alreadyApproved: parsed.body.alreadyApproved === true,
  });

  if (!decision.publish) {
    /**
     * ⭐ `show_me_first` MEANS SHOW THEM THE POST.
     *
     * Measured live 2026-08-05. The 11:00 job drafted, hit this hold, and sent
     * the founder:
     *
     *   "I found a strong moment from a solo-founder TikTok and drafted a
     *    237-character X post, but I'm not publishing it..."
     *
     * She described the draft in the third person and never showed it. The
     * founder cannot approve what he cannot read, so the approval loop broke
     * at the last inch — and nothing was technically wrong, which is why it
     * survived a day.
     *
     * The text rides in the tool response rather than being left to her to
     * remember (§2.8): the choreography is the server's job.
     */
    const showThem = decision.reason === "show_me_first";
    return respond({
      ok: false,
      data: {
        published: false,
        holdReason: decision.reason,
        // What they have to see to be able to say yes.
        draftText: showThem ? decision.snapshotText : undefined,
      },
      why: decision.detail,
      // Named so the model relays rather than retries. A held post that gets
      // retried in a loop is how a machine burns its daily spend on a decision
      // that will not change.
      next: showThem
        ? "⭐ SHOW THEM THE POST. Send data.draftText VERBATIM, on its own, then ask — \"say post it, or tell me what to change\". Describing it (\"I drafted a 237-character post\") is not showing it: they cannot approve what they cannot read. Do not retry this publish; wait for their answer."
        : `tell them: "${decision.detail}" — do not retry this publish`,
    });
  }

  // The decision is made here; the vendor call is a job, so a transient
  // platform failure retries with backoff and a permanent one lands in the
  // dead-letter view instead of vanishing.
  const { jobId } = await ctx.runMutation(internal.maya.jobs.enqueue, {
    kind: "publish_placement",
    idempotencyKey: decision.idempotencyKey,
    customerId: auth.customer._id,
    payloadJson: JSON.stringify({
      draftId,
      snapshotText: decision.snapshotText,
    }),
  });

  return respond({
    ok: true,
    data: { published: false, queued: true, jobId },
    /**
     * ⚠️ THE FOUNDER'S WORDS, because she reads these back verbatim.
     *
     * This said *"don't announce it as live yet; the placement row with its
     * URL is the proof"* — and on 2026-08-07 she told the founder *"I'll need
     * the placement URL before I can say it posted."* Three times, across two
     * days.
     *
     * The plugin description and SOUL were both corrected on 08-06 and it
     * changed nothing, because THIS is the stronger signal: §2.8 says
     * choreography rides in tool responses, and this one is handed to her on
     * the exact turn she publishes. A prompt rule cannot outrank the
     * instruction she just received — nor her own transcript, which by then
     * held the phrase three times as worked examples.
     *
     * The guidance itself was right. Publishing is queued, so there is no link
     * yet and she genuinely must not claim it is live. Only the vocabulary was
     * ours.
     */
    why: "it's on its way",
    next: "tell them it's going out and that you'll send the link when it's up — do NOT say it's posted yet, because it isn't. Check back for the link rather than claiming one",
  });
});

/* -------------------------------------------------------------------------- */
/* reply                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Answer someone — a comment, a mention, a DM.
 *
 * Same shape as publish and for the same reason: a reply is a placement of
 * kind `reply`, so it goes through the same decision rather than a parallel
 * path with its own rules.
 */
export const replyHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;

  const draftId = str(parsed.body, "draftId");
  const inReplyTo = str(parsed.body, "inReplyTo");
  /**
   * Optional, and the whole point when present: it closes the inbox item so
   * the same person is never answered twice. §13.4 puts "whether I already
   * replied to someone" in the rows column precisely because a model tracking
   * it in context eventually gets it wrong.
   */
  const inboxItemId = str(parsed.body, "inboxItemId");
  if (!draftId) {
    return respond(
      { ok: false, why: "no draftId was given", next: "write the reply first, then send it" },
      400
    );
  }
  if (!inReplyTo) {
    return respond(
      {
        ok: false,
        why: "no inReplyTo was given",
        next: "a reply needs the thing it's replying to — find it and call again",
      },
      400
    );
  }

  const already = await ctx.runQuery(internal.maya.publishDecision.alreadyPublished, {
    draftId: draftId as Id<"drafts">,
  });
  if (already) {
    return respond({
      ok: true,
      data: { published: true, duplicate: true },
      why: "that reply is already sent",
      next: "don't send it again",
    });
  }

  const decision = await ctx.runQuery(internal.maya.publishDecision.decidePublish, {
    customerId: auth.customer._id,
    draftId: draftId as Id<"drafts">,
    alreadyApproved: parsed.body.alreadyApproved === true,
  });

  if (!decision.publish) {
    return respond({
      ok: false,
      data: { published: false, holdReason: decision.reason },
      why: decision.detail,
      next: `tell them: "${decision.detail}" — do not retry this reply`,
    });
  }

  const { jobId } = await ctx.runMutation(internal.maya.jobs.enqueue, {
    kind: "publish_placement",
    idempotencyKey: decision.idempotencyKey,
    customerId: auth.customer._id,
    payloadJson: JSON.stringify({
      draftId,
      snapshotText: decision.snapshotText,
      inReplyTo,
      inboxItemId,
    }),
  });

  return respond({
    ok: true,
    data: { published: false, queued: true, jobId },
    why: "it's on its way",
    next: "move on to the next one; don't wait on this",
  });
});

/* -------------------------------------------------------------------------- */
/* rules                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ `rules` — the three commands §18 Sprint 6 asks for, in one tool.
 *
 *   list          "what rules do I have?"       → their sentences, with dates
 *   forget        "forget that"                  → retire one, never delete it
 *   why           "why did/didn't you do that?"  → the stored record
 *
 * All three read a ledger that was WRITE-ONLY: `append` had a caller and
 * `activeRules`, `forget`, `effectiveRule` and `history` had none. Nineteenth
 * time this week.
 *
 * ⚠️ **`why` is answered from rows, never regenerated.** §10.2 is explicit: a
 * model asked to explain its own past behaviour produces a plausible story,
 * which is worse than "I don't know" because it cannot be corrected. So this
 * returns what was recorded and she reads it out; if the ledger is silent, the
 * honest answer is that she doesn't have a record.
 *
 * ⚠️ **Forget RETIRES, it never deletes.** §16 — the ledger is append-only, so
 * "forget that" marks a rule inactive and leaves the history intact. A founder
 * asking *"what did I used to tell you?"* deserves an answer.
 */
/**
 * ⭐ What she has written and the founder has not answered yet.
 *
 * The gap that broke the 2026-08-06 approval: `publish` needs a `draftId`, and
 * nothing in the tool surface returned one for a draft written on an earlier
 * turn. `draft` returns an id only for what it just created; `history` returns
 * placements, which are things already posted. So a draft offered yesterday
 * was unpublishable today — not because she'd forgotten it, but because the
 * id existed nowhere she could reach.
 *
 * Expired drafts are excluded rather than listed as stale: offering a
 * 25-hour-old post is worse than not offering it, because saying yes commits
 * the founder to something written for a moment that has passed.
 */
export const pendingHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;

  /**
   * ⭐ Recording a NO, on the tool that lists what's awaiting one.
   *
   * `outcome: "rejected"` was a value nothing in `convex/maya` ever wrote —
   * only the frozen v1 did. So a founder saying no left no trace: the draft
   * sat `pending` until it expired, and the reason was lost entirely.
   *
   * ⚠️ The reason is the point, not the rejection. An edit says what she got
   * wrong about the WORDS; a no says what she got wrong about the IDEA, and
   * that lesson exists nowhere else — a post nobody lets out earns no views to
   * learn from. It goes into the workspace as a standing "don't make this
   * argument again".
   *
   * Lives here rather than in its own tool because this is the surface she
   * already calls when handling drafts, and a separate tool is one more thing
   * to remember at the moment the founder has already moved on — the same
   * reasoning that put edit capture inside `publish`.
   */
  const parsedBody = await readJson(request);
  if ("error" in parsedBody) return parsedBody.error;
  const rejectId = str(parsedBody.body, "rejectDraftId");
  if (rejectId) {
    const reason = str(parsedBody.body, "reason");
    if (!reason || reason.trim().length < 3) {
      return respond(
        {
          ok: false,
          why: "a no without a reason teaches me nothing",
          next: "ask them what was wrong with it, in their words, then record that — don't guess or paraphrase it into something tidier",
        },
        400
      );
    }
    await ctx.runMutation(internal.maya.drafts.decide, {
      draftId: rejectId as Id<"drafts">,
      outcome: "rejected",
      reason,
    });
    await ctx.runMutation(internal.maya.messages.closeQuestionFor, {
      customerId: auth.customer._id,
      dedupeKey: `draft:${rejectId}`,
    });
    return respond({
      ok: true,
      data: { rejected: true },
      why: "noted, and it will shape what I write next",
      next: "say it back so they know it stuck — quote their reason. Do NOT rewrite the same idea more carefully; the idea was the problem",
    });
  }

  const drafts = await ctx.runQuery(internal.maya.drafts.pending, {
    customerId: auth.customer._id,
  });

  const now = Date.now();
  const data = drafts.map((d) => ({
    draftId: d._id,
    channel: d.channel,
    kind: d.kind,
    text: d.snapshotText,
    offeredMinutesAgo: Math.round((now - d.proposedAt) / 60_000),
    expiresInMinutes: Math.round((d.expiresAt - now) / 60_000),
  }));

  return respond({
    ok: true,
    data: { drafts: data, count: data.length },
    why:
      data.length === 0
        ? "nothing is waiting on them right now"
        : `${data.length} draft${data.length === 1 ? "" : "s"} waiting on their answer`,
    next:
      data.length === 0
        ? "an empty list is a real answer — say the zero plainly rather than implying something is in flight"
        : "if they have said yes to one, call publish with its draftId and alreadyApproved:true. Their words in chat count exactly as much as a tap",
  });
});

export const rulesHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;

  const action = str(parsed.body, "action") ?? "list";

  if (action === "forget") {
    const directiveId = str(parsed.body, "directiveId");
    if (!directiveId) {
      return respond(
        {
          ok: false,
          why: "no rule was named",
          next: "call with action:list first, then pass the directiveId of the one they mean — never guess which rule they want dropped",
        },
        400
      );
    }
    const result = await ctx.runMutation(internal.maya.directives.forget, {
      directiveId: directiveId as Id<"directives">,
      customerId: auth.customer._id,
    });
    return respond({
      ok: result.forgotten,
      data: { forgotten: result.forgotten },
      why: result.forgotten
        ? "that rule is retired — it stays in the history, it just stops applying"
        : "that rule wasn't active",
      next: result.forgotten
        ? "say it back in their words so they know exactly which one stopped: quote the sentence"
        : "don't claim to have forgotten something that wasn't there",
    });
  }

  if (action === "why") {
    const kind = str(parsed.body, "kind");
    const history = await ctx.runQuery(internal.maya.directives.history, {
      customerId: auth.customer._id,
      kind: kind as never,
    });
    return respond({
      ok: true,
      data: {
        history: history.map((d) => ({
          directiveId: d._id,
          verbatim: d.verbatim,
          kind: d.kind,
          active: d.active,
          createdAt: d.createdAt,
        })),
      },
      why:
        history.length === 0
          ? "there's no rule on record about that"
          : `${history.length} on record, newest first`,
      /**
       * The instruction that matters most in this file. §10.2.
       */
      next:
        history.length === 0
          ? "say you don't have a record of being told that. Do NOT reconstruct a reason — a plausible story you invented is worse than admitting you don't know, because they can't correct it"
          : "quote the rule and its date. The answer is what's written here, not what you'd have decided",
    });
  }

  const rules = await ctx.runQuery(internal.maya.directives.activeRules, {
    customerId: auth.customer._id,
  });
  return respond({
    ok: true,
    data: {
      rules: rules.map((d) => ({
        directiveId: d._id,
        verbatim: d.verbatim,
        kind: d.kind,
        createdAt: d.createdAt,
      })),
    },
    why: rules.length === 0 ? "no rules yet" : `${rules.length} active`,
    next:
      rules.length === 0
        ? "say there aren't any yet — anything they tell you becomes one"
        : "read them back in THEIR words, with dates. Seeing their own sentences listed is the proof you remembered",
  });
});

/* -------------------------------------------------------------------------- */
/* weekly_read                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ `weekly_read` — the two sweeps that are worth money once a week.
 *
 * The daily `scroll` answers "what is moving in this niche today". This
 * answers the slower questions, and both halves cost real requests:
 *
 *   trends       what SHAPES are working right now, including outside our
 *                niche — where the topic is useless but the structure travels
 *   wider world  what actually happened to these people this week, grounded
 *                in sources it can cite
 *
 * Weekly, not daily, because neither changes hourly and the trend sweep's
 * measured hit rate for a narrow niche is low (§5.2.3a: 0 in-niche of 56 on
 * the first run). A cheap wide net is worth casting once.
 *
 * ⚠️ Both modules were written tonight and had NO CALLER ten minutes later —
 * the same defect this codebase has produced eighteen times. A sweep nobody
 * invokes is indistinguishable from a sweep that finds nothing.
 */
export const weeklyReadHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;

  const shapes = await ctx.runAction(internal.maya.trends.sweepTrends, {
    customerId: auth.customer._id,
  });
  const world = await ctx.runAction(internal.maya.widerWorld.sweepWiderWorld, {
    customerId: auth.customer._id,
  });

  const nothing = shapes.kept === 0 && shapes.shapes === 0 && world.findings.length === 0;
  return respond({
    ok: true,
    data: {
      trendingInNiche: shapes.observations,
      borrowableShapes: shapes.shapes,
      world: world.findings,
      /** ⚠️ Questions we asked and could not source. Never hidden. */
      unciteable: world.ungrounded,
    },
    why: `${shapes.detail}. ${world.detail}`,
    next: nothing
      ? "a quiet week is a real finding — say so plainly rather than reaching for something to report"
      : "use the world findings for WHAT to talk about and the shapes for HOW. Cite the sources when you mention what people are saying — an uncited claim is a guess",
  });
});

/* -------------------------------------------------------------------------- */
/* inbox                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ `inbox` — who is talking to her, and hasn't been answered.
 *
 * The missing half. `reply` has refused without an `inReplyTo` since Sprint 3,
 * telling her to *"find it and call again"* — and nothing could find it. This
 * is the finder.
 *
 * It syncs first, then returns what's open, so one call is the whole job. A
 * separate "refresh" step would eventually be skipped and she'd answer from a
 * stale list.
 */
export const inboxHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;

  const sync = await ctx.runAction(internal.maya.inbox.sync, {
    customerId: auth.customer._id,
  });

  const items = await ctx.runQuery(internal.maya.inbox.open, {
    customerId: auth.customer._id,
    limit: 20,
  });

  const waiting = items.map((item) => ({
    inboxItemId: item._id,
    // The id `reply` needs. Named to match so the chain is obvious.
    inReplyTo: item.externalId,
    channel: item.channel,
    text: item.text,
    permalink: item.permalink ?? null,
    postedAt: item.postedAt,
    waitingHours: Math.round((Date.now() - item.postedAt) / 3_600_000),
  }));

  /**
   * ⚠️ Partial failure is reported, never swallowed. Zernio returns
   * `meta.failedAccounts`, and a live call once returned
   * `accountsQueried: 2, accountsFailed: 1` — reading half the inbox and
   * saying "all clear" is exactly what this product exists not to do.
   */
  const caveats: string[] = [];
  if (sync.unreadableAccounts.length > 0) {
    caveats.push(
      `couldn't read ${sync.unreadableAccounts.join(", ")} — say so rather than implying you've seen everything`
    );
  }
  if (sync.truncated) {
    caveats.push("there are more than this page — answer these, then call again");
  }

  if (waiting.length === 0) {
    return respond({
      ok: true,
      data: { waiting: [], synced: sync.ok },
      why: sync.ok
        ? "nobody is waiting on a reply"
        : sync.detail,
      next: caveats.length
        ? caveats.join(" · ")
        : "nothing to answer — don't invent something to respond to",
    });
  }

  return respond({
    ok: true,
    data: { waiting, synced: sync.ok },
    why: `${waiting.length} waiting${sync.added > 0 ? `, ${sync.added} new` : ""}`,
    next: [
      "answer the oldest first — they have waited longest. Write the reply with `draft`, then `reply` with BOTH inReplyTo and inboxItemId so it gets marked answered",
      ...caveats,
    ].join(" · "),
  });
});

/* -------------------------------------------------------------------------- */
/* checkpoint                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Daily: mirror her curated memory somewhere durable, and report whether her
 * own context is being truncated.
 *
 * Both are things Convex genuinely cannot see — they live inside the machine.
 * This is the agent reporting *observations* (a file's contents, a boolean from
 * `openclaw doctor`); Convex does the judging. A machine that stops checking in
 * is a breach detected by a sweep running somewhere else, so the watchdog is
 * still not marking its own homework.
 */
export const checkpointHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;

  const markdown = parsed.body.memoryMarkdown;
  if (typeof markdown !== "string") {
    return respond(
      {
        ok: false,
        why: "no memoryMarkdown was given",
        next: "read MEMORY.md and send its contents",
      },
      400
    );
  }

  const result = await ctx.runMutation(internal.maya.checkpoint.record, {
    customerId: auth.customer._id,
    markdown,
    contextTruncated: parsed.body.contextTruncated === true,
  });

  if (!result.stored) {
    return respond(
      { ok: false, why: "that account no longer exists", next: "stop and report this" },
      404
    );
  }

  // A sharp drop is reported back to her, not just logged. If she just
  // overwrote her own memory, the next thing she does should be about that.
  if (result.shrankBy !== undefined) {
    return respond({
      ok: true,
      data: { bytes: result.bytes, shrankBy: result.shrankBy },
      why: `checkpoint saved — but MEMORY.md shrank by ${result.shrankBy} bytes since the last one`,
      next: "tell the operator; something may have overwritten your memory rather than tidying it",
    });
  }

  return respond({
    ok: true,
    data: { bytes: result.bytes, pruned: result.pruned },
    why: "checkpoint saved",
    next: "carry on — nothing to do with this",
  });
});

/* -------------------------------------------------------------------------- */
/* ask_founder                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Ask the founder something.
 *
 * Invariant 5 caps this at one open question at a time, and the refusal is the
 * interesting case: it comes back `ok: false` naming the question already
 * outstanding. Without that, an agent that asks twice looks to the founder like
 * an employee who doesn't listen — which is the single fastest way to lose
 * trust in something that texts you.
 */
export const askFounderHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;

  const question = str(parsed.body, "question");
  if (!question) {
    return respond(
      { ok: false, why: "no question was given", next: "decide what you actually need to know first" },
      400
    );
  }

  const open = await ctx.runQuery(internal.maya.messages.openQuestion, {
    customerId: auth.customer._id,
  });
  if (open) {
    return respond({
      ok: false,
      data: { asked: false, openQuestion: open.body },
      why: `you're already waiting on an answer to: "${open.body}"`,
      next: "wait for that answer — don't stack a second question on them",
    });
  }

  const result = await ctx.runMutation(internal.maya.messages.askFounder, {
    customerId: auth.customer._id,
    surface: "telegram",
    body: question,
    // Deduped on the text so a retried tool call can't send the same question
    // twice. The date bounds it so a genuinely recurring question can be asked
    // again tomorrow.
    dedupeKey: `ask:${dayKeyInZone(Date.now(), auth.customer.timezone ?? "UTC")}:${question}`,
  });

  return result.asked
    ? respond({
        ok: true,
        data: { asked: true },
        why: "asked — it's on its way to them",
        next: "carry on with something else; you'll get the answer as a message",
      })
    : respond({
        ok: false,
        data: { asked: false },
        why: "you already asked that today",
        next: "don't repeat it — wait, or do something else",
      });
});


/** Parse stored JSON without letting one bad row break a whole report. */
function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * ⭐ `make_carousel` — turn a banked idea into a stored, postable slide set.
 *
 * ⚠️ `makeCarousel` had **zero callers**. It was built, tested, and verified by
 * hand against a live deploy, and the agent could not reach it — which is this
 * codebase's dominant defect class and the exact shape it takes: the code is
 * right, the suite is green, and in production nothing happens.
 *
 * §3435's hard rules are enforced inside the action, not here. This is the
 * door, not a second gate — a tool that re-checked them would be a second place
 * they could disagree.
 */
export const carouselHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;

  const ideaId = str(parsed.body, "ideaId");
  if (!ideaId) {
    /**
     * ⚠️ No free-text path, deliberately. §6: every post traces back to
     * something a real person said, and `drafts.ts` already refuses a post with
     * no idea. It would be strange for the picture to have a weaker standard
     * than the caption.
     */
    return respond(
      {
        ok: false,
        why: "a carousel has to come from a banked idea, not a prompt",
        next: "pick an idea from the bank — `scroll` returns today's, and the bank has the rest",
      },
      400
    );
  }

  const result = await ctx.runAction(internal.maya.carousel.makeCarousel, {
    customerId: auth.customer._id,
    ideaId: ideaId as Id<"ideas">,
    steer: str(parsed.body, "steer") || undefined,
  });

  if (!result.ok) {
    /**
     * ⭐ `next` differs by failure, because the right move genuinely differs.
     *
     * Principle 8 — choreography rides in the tool response, never the prompt.
     * A single "it failed, try again" would make her retry the two cases where
     * retrying is exactly wrong: a house rule she'd break again, and a critic
     * that already judged the argument.
     */
    const next =
      result.failure === "house_rule"
        ? "do not retry this angle. Tell the founder which of their rules it kept breaking and ask whether the rule or the angle should change"
        : result.failure === "critic_rejected"
          ? "do not re-render the same set. Either take a different angle on this idea or pick another idea"
          : result.failure === "no_idea"
            ? "that idea doesn't exist on this account — pick one from the bank"
            : "stop and tell the founder you couldn't make the images. Do not retry more than once";

    return respond({
      ok: false,
      data: { failure: result.failure ?? "unknown" },
      why: result.detail,
      next,
    });
  }

  return respond({
    ok: true,
    data: {
      slides: result.slides,
      /** Provenance — which proven shape this borrowed, if any. */
      formatCardId: result.formatCardId,
    },
    why: result.detail,
    /**
     * ⚠️ The consent step is named here rather than left to her judgment.
     * TikTok requires the founder to confirm the rendered preview, `publish`
     * fails closed without it, and the hold would otherwise arrive as a
     * surprise after the work was done.
     */
    next:
      "these are stored and postable. For TikTok the founder must see them and okay them first — that's TikTok's requirement, not ours — so send the images and ask before publishing",
  });
});

/**
 * ⭐ `confirm_preview` — the founder okayed exactly this, and now it can post.
 *
 * ⚠️ Shipped because the gate arrived without it. The consent check in
 * `publish` fails closed, and nothing could record a confirmation — so every
 * TikTok post held forever. A lock with no key, and the kind of thing that
 * looks like a working safety feature right up until someone tries to use it.
 *
 * ## The property that makes the record mean anything
 *
 * The fingerprint is computed HERE, from the draft's own text and the stored
 * assets' own URLs. It is never accepted from the caller.
 *
 * That distinction is the whole design. A tool taking `{fingerprint}` — or
 * worse `{confirmed: true}` — lets the agent describe an approval of something
 * nobody was shown, and the compliance record would then attest to a human
 * action that never happened. Here the only thing she can influence is WHICH
 * draft and WHICH assets, both of which are server-side rows.
 *
 * ⛔ What this does NOT prove: that she asked at all. Questions key on
 * `dedupeKey` rather than a draft, so "a question about this draft was
 * outstanding and got answered" isn't a cheap lookup yet. The founder's actual
 * reply is in the message log and auditable, but the precondition is not
 * enforced — worth closing, and stated rather than papered over.
 */
export const confirmPreviewHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;

  const draftId = str(parsed.body, "draftId");
  const rawAssets = (parsed.body as Record<string, unknown>).assetIds;
  const assetIds = Array.isArray(rawAssets)
    ? rawAssets.filter((a): a is string => typeof a === "string")
    : [];

  if (!draftId) {
    return respond(
      {
        ok: false,
        why: "no draft was named",
        next: "say which draft the founder just okayed — `pending` lists the ones waiting",
      },
      400
    );
  }
  if (assetIds.length === 0) {
    return respond(
      {
        ok: false,
        why: "no images were named",
        next: "list the slide assetIds you showed them, in the order you showed them",
      },
      400
    );
  }

  const result = await ctx.runMutation(
    internal.maya.tiktokConsent.confirmFromDraft,
    {
      customerId: auth.customer._id,
      draftId: draftId as Id<"drafts">,
      assetIds: assetIds as Array<Id<"mediaAssets">>,
    }
  );

  if (!result.ok) {
    return respond({
      ok: false,
      why: result.reason ?? "couldn't record that",
      next: "check the draftId and the assetIds are the ones you actually showed them, then try once more",
    });
  }

  return respond({
    ok: true,
    data: { confirmed: true },
    why: "recorded — the founder okayed this exact version",
    /**
     * ⚠️ Names the binding, because it is the thing most likely to surprise
     * her later: editing the caption after this point silently invalidates the
     * approval, and `publish` will hold with a message about a version they
     * didn't see.
     */
    next: "publish it as-is. If the words or the images change at all, this approval no longer covers it and you'll need to ask again",
  });
});

/**
 * ⭐ `adapt_crosspost` — one post, three channels, never the same words twice.
 *
 * ⚠️ The last of the four actions built on 2026-08-09 with zero callers. The
 * three hard rules (§3433) are enforced inside the action; this is the door.
 *
 * Takes a `draftId` rather than free text, deliberately. The draft is where
 * traceability lives — `drafts.ts` already refuses a post with no idea — and
 * adapting loose text would create per-channel variants of something that never
 * had evidence behind it.
 */
export const crosspostHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;

  const draftId = str(parsed.body, "draftId");
  if (!draftId) {
    return respond(
      {
        ok: false,
        why: "no draft was named",
        next: "write the post first with `draft`, then adapt that draftId for the other channels",
      },
      400
    );
  }

  const rawChannels = (parsed.body as Record<string, unknown>).channels;
  const channels = Array.isArray(rawChannels)
    ? rawChannels.filter((c): c is string => typeof c === "string")
    : [];
  if (channels.length === 0) {
    return respond(
      {
        ok: false,
        why: "no channels were given",
        next: "say which channels this should go to — only the ones the founder has connected",
      },
      400
    );
  }

  const draft = await ctx.runQuery(internal.maya.drafts.byId, {
    draftId: draftId as Id<"drafts">,
  });
  if (!draft || draft.customerId !== auth.customer._id) {
    return respond({
      ok: false,
      why: "that draft isn't on this account",
      next: "check the draftId — `pending` lists the ones waiting",
    });
  }

  const result = await ctx.runAction(internal.maya.crosspost.adaptCrosspost, {
    customerId: auth.customer._id,
    // Server-side, so the variants adapt the text the founder will actually see.
    text: draft.snapshotText,
    channels,
    assetSummary: str(parsed.body, "assetSummary") || undefined,
  });

  if (!result.ok) {
    /**
     * ⚠️ A carbon copy is NOT retryable by repeating the call.
     *
     * The action already retried once with the collision named. A second
     * identical request gets a second identical failure, and §3433's rule is
     * that identical captions across channels are a recognisable tell — so the
     * honest move is fewer channels, not another roll.
     */
    return respond({
      ok: false,
      data: { failure: result.failure ?? "unknown" },
      why: result.detail,
      next:
        result.failure === "carbon_copy"
          ? "do not retry this. Post it to one channel only, or rewrite the draft so the other channel has something genuinely different to say"
          : "tell the founder you couldn't adapt it, and post it to the one channel it was written for",
    });
  }

  return respond({
    ok: true,
    data: {
      variants: result.variants,
      /** Tags the model reached for that weren't in the mined set. Dropped. */
      droppedTags: result.droppedTags,
    },
    why: result.detail,
    /**
     * Each variant still has to become its own draft — `publish` takes a
     * draftId, so a variant that was never drafted cannot be posted no matter
     * how good it is.
     */
    next: "save each variant as its own draft for that channel, then publish them separately",
  });
});

/**
 * ⭐ `forget_asset` — take something back out of the media library.
 *
 * ⚠️ The library had no delete at all. A founder who sent a wrong or stale
 * screenshot was stuck with it forever, and §7.5.3's authenticity floor ranks a
 * real screenshot ABOVE a generated one — so a wrong screenshot doesn't merely
 * sit there, it outranks the alternatives and gets chosen.
 */
export const forgetAssetHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;

  const assetId = str(parsed.body, "assetId");
  if (!assetId) {
    return respond(
      {
        ok: false,
        why: "no image was named",
        next: "say which assetId to remove — `request_assets` lists what's on file",
      },
      400
    );
  }

  const result = await ctx.runMutation(internal.maya.media.forget, {
    customerId: auth.customer._id,
    assetId: assetId as Id<"mediaAssets">,
  });

  if (!result.forgotten) {
    return respond({
      ok: false,
      why: result.reason ?? "that isn't in the library",
      next: "check the assetId, and do not retry more than once",
    });
  }

  return respond({
    ok: true,
    data: { forgotten: true },
    why: "removed it from the library",
    /**
     * ⚠️ Named because it is irreversible and the founder may not realise.
     * Re-sending is the only way back for anything they supplied.
     */
    next: "it's gone for good — if that was a mistake, ask them to send it again",
  });
});

/**
 * `make_video` — propose a video and STOP at the storyboard (§7.5.36, Sprint 9).
 *
 * ⚠️ The stopping is the feature. Everything this does is free: the eight-check
 * gate, the script, the brief, the storyboard. The credits are spent only after
 * the founder answers, by `approveRender`. A tool that proposed and rendered in
 * one call would be a more expensive way of not asking.
 *
 * ⭐ And the storyboard shows the EXACT frames, because §7.6.2 makes us always
 * ground the link with our own media-library images rather than letting the
 * vendor scrape. The approval step and the grounding rule are one mechanism.
 */
export const makeVideoHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;

  const ideaId = str(parsed.body, "ideaId");
  if (!ideaId) {
    // Same standard as the carousel and the draft: §6, every post traces back
    // to something a real person actually said.
    return respond(
      {
        ok: false,
        why: "a video has to come from a banked idea, not a prompt",
        next: "pick an idea from the bank — `scroll` returns today's, and the bank has the rest",
      },
      400
    );
  }

  const result = await ctx.runAction(internal.maya.video.proposeVideo, {
    customerId: auth.customer._id,
    ideaId: ideaId as Id<"ideas">,
    rung: str(parsed.body, "rung") || undefined,
    referenceVideoUrl: str(parsed.body, "referenceVideoUrl") || undefined,
  });

  if (!result.ok) {
    /**
     * ⭐ `next` differs by failure, because the right move genuinely differs —
     * and two of these must NOT be retried.
     */
    const next =
      result.failure === "no_brief"
        ? "do not retry. This needs something from the founder — ask for what the message says is missing, in your own words, and wait"
        : result.failure === "anti_slop"
          ? "do not re-render the same cut. Change what's wrong with it or take a different angle"
          : result.failure === "vendor_unconfigured"
            ? "video isn't available yet. Say so plainly and offer them a photo set instead — do not retry, and do not promise a video later"
            : result.failure === "pre_spend_gate"
              ? "the gate already decided. Relay its reason and take the cheaper option it named rather than retrying"
              : "stop and tell the founder you couldn't start the video. Do not retry more than once";

    return respond({
      ok: false,
      data: { failure: result.failure ?? "unknown" },
      why: result.detail,
      next,
    });
  }

  return respond({
    ok: true,
    data: {
      jobId: result.jobId,
      /** ⭐ The storyboard, verbatim. Send it AS IS — it is already their words. */
      storyboard: result.message,
      estimatedCredits: result.estimatedCredits,
    },
    why: `${result.detail} — nothing has been made yet`,
    /**
     * ⚠️ The whole point, stated as choreography. She must send the storyboard
     * and wait; approving on her own behalf is the one thing that turns a free
     * check into a wasted render.
     */
    next: "send data.storyboard to the founder EXACTLY as it is, then WAIT. Do not render, do not approve it yourself, and do not summarise it — they are being asked to check the actual frames. When they say go, call `approve_video` with data.jobId",
  });
});

/**
 * `approve_video` — the founder said go. The only thing that releases a render.
 *
 * Separate from `make_video` on purpose: one call proposes and one releases, so
 * "did anyone actually approve this?" is answered by finding this call rather
 * than by reasoning about a flag.
 */
export const approveVideoHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if ("error" in auth) return auth.error;
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;

  const jobId = str(parsed.body, "jobId");
  if (!jobId) {
    return respond(
      {
        ok: false,
        why: "I need to know which video they said yes to",
        next: "use the jobId `make_video` gave you",
      },
      400
    );
  }

  const out = await ctx.runMutation(internal.maya.video.approveRender, {
    jobId: jobId as Id<"jobs">,
  });

  return respond({
    ok: out.ok,
    data: {},
    why: out.detail,
    next: out.ok
      ? "tell them it's being made and roughly how long, then leave it — it will publish when it's ready"
      : "tell the founder it couldn't be started and why, in your own words",
  });
});
