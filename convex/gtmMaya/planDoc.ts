import { v } from "convex/values";
import {
  httpAction,
  internalAction,
  internalMutation,
  mutation,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { authenticate } from "./openclaw/inboundCallback";
import { resolveMyGtmCreator } from "./targetList";
import { runAgentTurn, type HookEndpoint } from "./openclaw/hookClient";

/**
 * PLAN_APPROVAL_LOOP_V1 §2 — the plan as a first-class object.
 *
 * Maya writes a STRUCTURED plan (save_plan_doc tool → savePlanDoc) alongside
 * the prose she sends in chat. The founder reads it on the web approval
 * screen, argues with it in Telegram (each steering exchange = a new version
 * with an amendments entry), and approves it here or by telling her "go"
 * (her set_strategy_approval tool). Once approved it is her constitution:
 * every action justifiable against it.
 *
 * Shape is validated loosely on purpose (trust-LLM-judgment rule): the only
 * structural requirements are the fields the UI renders. Everything else
 * passes through.
 */

export interface PlanDoc {
  version: number;
  status: "proposed" | "approved";
  approvedAtMs?: number;
  read?: string;
  goal?: { metric?: string; target?: number; byMs?: number };
  moves?: Array<{
    id?: string;
    name: string;
    channel?: string;
    intent?: string;
    budget?: Record<string, unknown>;
    expect?: string;
    horizon?: string;
  }>;
  notDoing?: Array<{ channel?: string; why: string }>;
  week?: Record<string, unknown>;
  asks?: string[];
  amendments?: Array<{ v: number; directive: string; diff: string; atMs: number }>;
}

export function parsePlanDoc(json: string | null | undefined): PlanDoc | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as PlanDoc;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Maya saves (or amends) the plan. Versioning is server-owned: first save is
 * v1 status "proposed"; subsequent saves bump the version and append an
 * amendment entry when a `directive`/`diff` is supplied. Approval state is
 * NOT writable here — that's the founder's (approveMyPlan / set_strategy_approval).
 */
export const savePlanDoc = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    plan: v.string(), // JSON — read/goal/moves/notDoing/week/asks
    /** When this save is an amendment: the founder ask + what changed. */
    directive: v.optional(v.string()),
    diff: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ version: number }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("savePlanDoc: agent not found");
    const incoming = parsePlanDoc(args.plan);
    if (!incoming) throw new Error("savePlanDoc: plan must be valid JSON");
    const existing = parsePlanDoc(agent.planDocJson);
    const version = (existing?.version ?? 0) + 1;
    const amendments = [...(existing?.amendments ?? [])];
    if (args.directive && args.diff && existing) {
      amendments.push({
        v: version,
        directive: args.directive.slice(0, 500),
        diff: args.diff.slice(0, 500),
        atMs: Date.now(),
      });
    }
    const doc: PlanDoc = {
      ...incoming,
      version,
      // A re-save after approval returns to proposed — the founder re-approves
      // material changes. (Post-approval steering tweaks that don't need a
      // re-approve go through steering directives, not a plan rewrite.)
      status: "proposed",
      amendments,
    };
    await ctx.db.patch(args.agentId, {
      planDocJson: JSON.stringify(doc),
      updatedAt: Date.now(),
    });
    if (agent.accountId) {
      await ctx.db.insert("gtmAgentActivity", {
        accountId: agent.accountId,
        agentId: agent._id,
        kind: "plan_changed",
        summary:
          version === 1
            ? "My plan for you is ready — review and approve it."
            : `Plan updated to v${version}${args.diff ? ` — ${args.diff.slice(0, 120)}` : ""}.`,
        createdAt: Date.now(),
      });
    }
    return { version };
  },
});

/** Maya's HTTP tool endpoint: POST /lc_gtm/save_plan_doc */
export const savePlanDocHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const plan =
    typeof body.plan === "string"
      ? body.plan
      : body.plan && typeof body.plan === "object"
        ? JSON.stringify(body.plan)
        : null;
  if (!plan) {
    return new Response("missing required field (plan — object or JSON string)", {
      status: 400,
    });
  }
  try {
    const result = await ctx.runMutation(internal.gtmMaya.planDoc.savePlanDoc, {
      agentId: auth.agentId,
      plan,
      directive: typeof body.directive === "string" ? body.directive : undefined,
      diff: typeof body.diff === "string" ? body.diff : undefined,
    });
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, reason: err instanceof Error ? err.message : String(err) }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
});

/** Founder-side read: the plan + approval state, fail-closed. */
export const getMyPlanDoc = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    plan: PlanDoc | null;
    approvalState: "proposed" | "approved" | "iterating" | null;
  } | null> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return null;
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) return null;
    let approvalState: "proposed" | "approved" | "iterating" | null = null;
    if (agent.appId) {
      const jobs = await ctx.db
        .query("gtmResearchJobs")
        .withIndex("by_app", (q) => q.eq("appId", agent.appId!))
        .collect();
      const latest = jobs.sort((a, b) => b.createdAt - a.createdAt)[0];
      if (latest && latest.accountId === creator._id) {
        approvalState = latest.strategyApprovalState ?? null;
      }
    }
    return { plan: parsePlanDoc(agent.planDocJson), approvalState };
  },
});

/**
 * Founder approves from the web. Marks the plan doc approved, flips the
 * research job's strategyApprovalState via the shared internal mutation
 * (which also fires tryActivateAgent), and relays the decision to Maya's
 * machine so she reacts in her own voice.
 */
export const approveMyPlan = mutation({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; reason?: string }> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) throw new Error("Sign in to approve the plan.");
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) throw new Error("No agent yet — finish onboarding first.");
    const doc = parsePlanDoc(agent.planDocJson);
    if (!doc) return { ok: false, reason: "no_plan_yet" };
    const now = Date.now();
    await ctx.db.patch(agent._id, {
      planDocJson: JSON.stringify({ ...doc, status: "approved", approvedAtMs: now }),
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.gtmMaya.managerStore.setStrategyApproval, {
      accountId: creator._id,
      agentId: agent._id,
      state: "approved" as const,
    });
    await ctx.db.insert("gtmAgentActivity", {
      accountId: creator._id,
      agentId: agent._id,
      kind: "status",
      summary: "You approved the plan. Maya is moving.",
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.gtmMaya.planDoc.notifyAgentOfPlanApproval, {
      agentId: agent._id,
    });
    return { ok: true };
  },
});

/** Best-effort relay so Maya reacts to the approval in her own voice. The
 *  approval itself is already durable in rows; a sleeping machine catches up
 *  on its next heartbeat. */
export const notifyAgentOfPlanApproval = internalAction({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.runQuery(
      internal.gtmMaya.telegramHandoff.getHandoffContext,
      { agentId: args.agentId }
    );
    if (!row?.hookBaseUrl || !row.hookToken) return;
    const endpoint: HookEndpoint = { baseUrl: row.hookBaseUrl, token: row.hookToken };
    try {
      await runAgentTurn(endpoint, {
        message:
          "The founder just APPROVED your plan from Mission Control. React in your voice via send_update (short, real) and start executing per the approved plan. Account-connect gates still apply.",
        deliver: false,
        thinking: "medium",
        timeoutSeconds: 90,
      });
    } catch {
      // Heartbeat picks the approved state up.
    }
  },
});
