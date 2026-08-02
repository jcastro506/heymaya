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
    return respond({
      ok: false,
      data: { published: false, holdReason: decision.reason },
      why: decision.detail,
      // Named so the model relays rather than retries. A held post that gets
      // retried in a loop is how a machine burns its daily spend on a decision
      // that will not change.
      next: `tell them: "${decision.detail}" — do not retry this publish`,
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
    why: "cleared to post — it's queued",
    next: "don't announce it as live yet; the placement row with its URL is the proof",
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
    }),
  });

  return respond({
    ok: true,
    data: { published: false, queued: true, jobId },
    why: "cleared to reply — it's queued",
    next: "move on to the next one; don't wait on this",
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
    dedupeKey: `ask:${new Date().toISOString().slice(0, 10)}:${question}`,
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
