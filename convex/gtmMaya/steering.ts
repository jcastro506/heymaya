/**
 * Real-time operator — founder STEERING directives.
 *
 * When the founder texts Maya a directive ("focus more on LinkedIn", "stop
 * posting on X", "go harder on the pricing angle"), it must be captured as a
 * DURABLE steering row so future engine code (the heartbeat/pulse — not built
 * yet) and Maya's prompts can read it "day one". This module is that plumbing:
 *
 *   - `classifySteeringIntent(text)` — a PURE, unit-testable, cheap heuristic
 *     that decides whether an inbound founder message is a steering directive
 *     (vs a question / chit-chat) and extracts lane + intent hints. Wired into
 *     the inbound founder-text path (conversationCapture.logMessageHttp).
 *   - `saveSteeringDirective` — internal mutation that writes the row and
 *     supersedes prior CONTRADICTING directives on the same lane.
 *   - `getActiveSteeringDirectives(accountId)` — read consumed by future
 *     engine code (internal) + a fail-closed public query for the dashboard.
 *   - `saveSteeringDirectiveHttp` — `/lc_gtm/save_steering_directive` endpoint
 *     for the `save_steering_directive` typed tool (mirrors record_conversion).
 *
 * WHY NOT AN LLM IN THE HOT PATH: every inbound founder turn already runs
 * through logMessageHttp on the Convex request path. Adding an OpenRouter call
 * there would put a multi-hundred-ms (and metered) dependency on the critical
 * capture path — exactly where the data-collection sprint kept it lean. A
 * deterministic verb/lane heuristic captures the high-signal cases (imperative
 * directives naming a channel or angle) with zero latency and zero cost, and
 * is fully unit-testable. When Maya HERSELF parses a subtler directive during
 * a turn, she calls the `save_steering_directive` tool — that's the gated,
 * model-in-the-loop path, but it runs inside her turn (already paid for), not
 * on the inbound capture hot path.
 *
 * Five mandatory test categories (see steering tests):
 *   1. Cross-tenant — rows are written + read only under the resolved
 *      accountId; agent A's directives are never returned for agent B.
 *   2. Plan-tier — capture is plan-agnostic; the public read query is
 *      fail-closed on Clerk identity + accountType.
 *   3. Adversarial — empty/oversized text, non-steering chit-chat, mixed-case.
 *   4. Sibling-file — the CALLBACK_KIND "save_steering_directive" lane
 *      (inboundCallback.ts), the schema table (schema.ts), the http route
 *      (http.ts), and the maya-gtm-tools typed tool stay in lockstep.
 *   5. TODO grep: every marker carries a sprint tag or a stated reason.
 */

import { v } from "convex/values";
import {
  httpAction,
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/** Hard cap on stored directive length — directives are short imperatives. */
export const MAX_DIRECTIVE_CHARS = 2000;

export type SteeringIntent = "focus" | "avoid" | "angle" | "pace" | "other";

export interface SteeringClassification {
  isSteering: boolean;
  /** Lowercased channel / angle hints, deduped. */
  laneHints: string[];
  intent?: SteeringIntent;
}

/**
 * Channel lane vocabulary — substrings we recognize as a steering "lane".
 * Keyed canonical → recognized surface forms. Kept small + explicit so the
 * heuristic is predictable; Maya's tool path handles the long tail.
 */
const CHANNEL_LANES: ReadonlyArray<{ canonical: string; forms: string[] }> = [
  { canonical: "linkedin", forms: ["linkedin", "li "] },
  { canonical: "x", forms: ["twitter", " x ", "on x", "x ("] },
  { canonical: "reddit", forms: ["reddit", "subreddit", "r/"] },
  { canonical: "tiktok", forms: ["tiktok", "tik tok"] },
  { canonical: "instagram", forms: ["instagram", "insta", " ig "] },
  { canonical: "youtube", forms: ["youtube", "yt "] },
  { canonical: "hn", forms: ["hacker news", "hackernews", "hn "] },
];

/**
 * Angle lanes — content/positioning angles a founder might steer toward.
 */
const ANGLE_LANES: ReadonlyArray<{ canonical: string; forms: string[] }> = [
  { canonical: "pricing", forms: ["pricing", "price", "cost angle"] },
  { canonical: "founder-story", forms: ["founder story", "my story", "personal story"] },
  { canonical: "technical", forms: ["technical", "engineering angle", "dev angle"] },
  { canonical: "social-proof", forms: ["testimonial", "social proof", "case study"] },
  { canonical: "comparison", forms: ["comparison", "vs ", "versus", "alternative to"] },
];

/**
 * Imperative cues that mark a message as a DIRECTIVE rather than a question.
 * Steering = the founder telling Maya to change behavior.
 */
const FOCUS_CUES = [
  "focus on",
  "focus more on",
  "go harder on",
  "lean into",
  "prioritize",
  "double down on",
  "more on",
  "push",
  "emphasize",
  "do more",
  "post more on",
];
const AVOID_CUES = [
  "stop posting",
  "stop ",
  "don't post",
  "dont post",
  "avoid",
  "no more",
  "skip",
  "pause ",
  "cut ",
  "drop ",
  "less on",
  "back off",
];
const PACE_CUES = [
  "slow down",
  "speed up",
  "post less",
  "more often",
  "less often",
  "fewer posts",
  "ramp up",
  "dial back",
  "every day",
];
const ANGLE_CUES = ["angle", "talk about", "highlight", "frame it", "position"];

/** Question/chit-chat markers that should NOT be captured as directives. */
function looksLikeQuestion(lower: string): boolean {
  const trimmed = lower.trim();
  if (trimmed.endsWith("?")) return true;
  // Leading interrogatives ("what should...", "how is...", "can you...").
  return /^(what|how|why|when|where|who|which|is |are |do |does |did |can |could |should |would |will )/.test(
    trimmed
  );
}

function extractLanes(
  lower: string,
  table: ReadonlyArray<{ canonical: string; forms: string[] }>
): string[] {
  const hits: string[] = [];
  for (const lane of table) {
    if (lane.forms.some((f) => lower.includes(f))) hits.push(lane.canonical);
  }
  return hits;
}

/**
 * PURE heuristic classifier. No I/O, no model call — safe to call on the
 * inbound capture hot path. Returns `isSteering:false` for questions,
 * chit-chat, and anything lacking an imperative directive cue.
 *
 * Conservative by design: it under-captures rather than mis-capturing
 * chit-chat as a directive (a false directive would silently bias the engine).
 * Subtler directives that the heuristic misses are caught when Maya calls the
 * `save_steering_directive` tool during her turn.
 */
export function classifySteeringIntent(text: string): SteeringClassification {
  const empty = { isSteering: false, laneHints: [] as string[] };
  if (typeof text !== "string") return empty;
  const lower = text.toLowerCase();
  if (lower.trim().length === 0) return empty;
  if (lower.length > MAX_DIRECTIVE_CHARS * 4) return empty; // absurdly long — not a directive

  // Questions are never directives, even if they name a channel.
  if (looksLikeQuestion(lower)) return empty;

  const channelLanes = extractLanes(lower, CHANNEL_LANES);
  const angleLanes = extractLanes(lower, ANGLE_LANES);

  const hasAvoid = AVOID_CUES.some((c) => lower.includes(c));
  const hasFocus = FOCUS_CUES.some((c) => lower.includes(c));
  const hasPace = PACE_CUES.some((c) => lower.includes(c));
  const hasAngle = ANGLE_CUES.some((c) => lower.includes(c)) || angleLanes.length > 0;

  // A directive needs an imperative cue. A bare channel mention with no verb
  // ("I love LinkedIn") is NOT steering.
  if (!hasAvoid && !hasFocus && !hasPace && !hasAngle) return empty;

  // Intent precedence: avoid > focus > angle > pace. "stop posting on X and
  // do more pricing" reads primarily as an avoid on the named channel.
  let intent: SteeringIntent;
  if (hasAvoid) intent = "avoid";
  else if (hasFocus) intent = "focus";
  else if (hasAngle) intent = "angle";
  else intent = "pace";

  const laneHints = Array.from(new Set([...channelLanes, ...angleLanes]));

  // Pace directives often name no lane (e.g. "post less"). Still steering.
  // Focus/avoid/angle directives with no recognized lane are still steering
  // (Maya/engine read the verbatim text), but flagged "other" intent only if
  // we truly found nothing actionable.
  return { isSteering: true, laneHints, intent };
}

/**
 * Write a steering directive row. Supersedes any prior ACTIVE directive that
 * shares a lane hint AND has an opposing intent (focus↔avoid) — so "stop
 * posting on X" cleanly overrides an earlier "focus on X". Same-intent repeats
 * are kept (they reinforce). Internal — called by the inline capture path and
 * the HTTP tool endpoint.
 */
export const saveSteeringDirective = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    directive: v.string(),
    laneHints: v.optional(v.array(v.string())),
    intent: v.optional(
      v.union(
        v.literal("focus"),
        v.literal("avoid"),
        v.literal("angle"),
        v.literal("pace"),
        v.literal("other")
      )
    ),
    source: v.union(v.literal("founder"), v.literal("maya_tool")),
    turnId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"gtmSteeringDirectives">> => {
    const directive =
      args.directive.length > MAX_DIRECTIVE_CHARS
        ? args.directive.slice(0, MAX_DIRECTIVE_CHARS)
        : args.directive;
    const laneHints = (args.laneHints ?? [])
      .map((l) => l.toLowerCase().trim())
      .filter((l) => l.length > 0);
    const now = Date.now();

    // Supersede opposing same-lane active directives (cross-tenant safe: we
    // only scan THIS account's rows via by_account_and_active).
    const opposing = (i?: SteeringIntent): SteeringIntent | null =>
      i === "focus" ? "avoid" : i === "avoid" ? "focus" : null;
    const opp = opposing(args.intent);
    if (opp && laneHints.length > 0) {
      const active = await ctx.db
        .query("gtmSteeringDirectives")
        .withIndex("by_account_and_active", (q) =>
          q.eq("accountId", args.accountId).eq("active", true)
        )
        .collect();
      for (const row of active) {
        if (
          row.intent === opp &&
          (row.laneHints ?? []).some((l) => laneHints.includes(l))
        ) {
          await ctx.db.patch(row._id, { active: false, supersededAt: now });
        }
      }
    }

    return await ctx.db.insert("gtmSteeringDirectives", {
      accountId: args.accountId,
      agentId: args.agentId,
      directive,
      laneHints: laneHints.length > 0 ? laneHints : undefined,
      intent: args.intent,
      source: args.source,
      turnId: args.turnId,
      active: true,
      createdAt: now,
    });
  },
});

/**
 * Internal read consumed by future engine code (heartbeat/pulse) — the latest
 * active directives for an account, newest first. Scoped to the account only.
 */
export const getActiveSteeringDirectives = internalQuery({
  args: { accountId: v.id("creators"), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"gtmSteeringDirectives">[]> => {
    const limit =
      typeof args.limit === "number" && args.limit > 0
        ? Math.min(args.limit, 100)
        : 25;
    return await ctx.db
      .query("gtmSteeringDirectives")
      .withIndex("by_account_and_active", (q) =>
        q.eq("accountId", args.accountId).eq("active", true)
      )
      .order("desc")
      .take(limit);
  },
});

/**
 * Fail-closed public query for the operator dashboard. Returns [] for any
 * unauthenticated / non-GTM caller and only ever reads the caller's own rows.
 */
export const listMySteeringDirectives = query({
  args: {},
  handler: async (ctx): Promise<Doc<"gtmSteeringDirectives">[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return [];
    return await ctx.db
      .query("gtmSteeringDirectives")
      .withIndex("by_account_and_active", (q) =>
        q.eq("accountId", creator._id).eq("active", true)
      )
      .order("desc")
      .take(50);
  },
});

interface SaveSteeringDirectivePayload {
  idempotencyKey?: string;
  directive?: string;
  laneHints?: string[];
  intent?: string;
  turnId?: string;
}

const VALID_INTENTS: ReadonlyArray<SteeringIntent> = [
  "focus",
  "avoid",
  "angle",
  "pace",
  "other",
];

/**
 * POST /lc_gtm/save_steering_directive — `save_steering_directive` typed tool.
 *
 * Maya calls this when she parses a steering directive from the founder during
 * a turn (the model-in-the-loop path; runs inside her already-paid turn, never
 * on the inbound hot path). Mirrors record_conversion: bearer auth, idempotency
 * claim, internal mutation. `source` is always "maya_tool" here.
 */
export const saveSteeringDirectiveHttp = httpAction(async (ctx, request) => {
  const { authenticate } = await import("./openclaw/inboundCallback");
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: SaveSteeringDirectivePayload;
  try {
    body = (await request.json()) as SaveSteeringDirectivePayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.idempotencyKey) {
    return new Response("missing required fields", { status: 400 });
  }
  if (typeof body.directive !== "string" || body.directive.trim().length === 0) {
    return new Response("directive required", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "save_steering_directive",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  // Trust Maya's lane hints if provided; otherwise derive them from the text
  // with the same pure heuristic (cheap, deterministic).
  const heuristic = classifySteeringIntent(body.directive);
  const laneHints = Array.isArray(body.laneHints)
    ? body.laneHints.map((l) => String(l).toLowerCase().trim()).filter(Boolean)
    : heuristic.laneHints;
  const intent: SteeringIntent =
    typeof body.intent === "string" &&
    VALID_INTENTS.includes(body.intent as SteeringIntent)
      ? (body.intent as SteeringIntent)
      : (heuristic.intent ?? "other");

  await ctx.runMutation(internal.gtmMaya.steering.saveSteeringDirective, {
    accountId: auth.accountId,
    agentId: auth.agentId,
    directive: body.directive,
    laneHints,
    intent,
    source: "maya_tool",
    turnId: typeof body.turnId === "string" ? body.turnId : undefined,
  });
  return new Response("ok", { status: 200 });
});
