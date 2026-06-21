/**
 * Founder God-view dashboard — read-only operator surface.
 *
 * Purpose (operator ask, 2026-05-31): a single place to SEE, from a phone,
 * what every Maya is actually doing — the real user↔Maya transcript, per-turn
 * cost/latency/model, channel-recommendation distribution (so we can prove
 * Maya isn't just always recommending Reddit), and which agents look stuck.
 *
 * Gating: these are PUBLIC queries (so the page can be a thin client without a
 * Clerk admin role), but every handler fails CLOSED against `ADMIN_DASH_TOKEN`.
 * No token / wrong token → `{ ok: false }`, never data. The token travels in
 * the URL query string (operator bookmarks the link); it is a bearer secret,
 * so rotate it if it leaks. Set it with:
 *   npx convex env set ADMIN_DASH_TOKEN <hex>
 *
 * Scale note: `overview` collects `mayaMessages` once and groups in memory.
 * That is fine at current volume (tens of agents, hundreds of messages). When
 * this grows past a few thousand messages, switch to per-agent indexed reads
 * (by_agent) — left as a deliberate, logged simplification for now.
 */

import { query } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

const TEST_CLERK_USER_ID_PREFIX = "test_gtm_synth_";

/** Fail-closed token check. Returns true only on an exact env match. */
function authorized(token: string): boolean {
  const expected = process.env.ADMIN_DASH_TOKEN;
  // No env configured → nobody gets in (fail closed).
  if (!expected || expected.length === 0) return false;
  return token === expected;
}

/** Mask a Clerk user id for display (never surface the full subject). */
function maskClerkId(clerkUserId: string): string {
  if (clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX)) return "test-fixture";
  if (clerkUserId.length <= 10) return clerkUserId;
  return `${clerkUserId.slice(0, 8)}…${clerkUserId.slice(-4)}`;
}

type AccountRow = {
  accountId: Id<"creators">;
  agentId: Id<"gtmAgents">;
  productName: string;
  productUrl: string | null;
  stage: string | null;
  weekGoal: string | null;
  onboardingStep: string;
  deployed: boolean;
  flyAppId: string | null;
  isTest: boolean;
  plan: string;
  who: string;
  createdAt: number;
  userMsgCount: number;
  mayaMsgCount: number;
  lastMsgAt: number | null;
  costUsd: number;
  /**
   * Windowed COGS-per-tenant — so a runaway bill is visible per agent, not just
   * in the aggregate. `today` = trailing 24h, `last7d` = trailing 7d. Each
   * splits discovery (continuous hunt-loop read+score spend) from everything
   * else (operational LLM turns, research jobs, OpenRouter poll, etc.).
   */
  spend: {
    today: { totalUsd: number; discoveryUsd: number; otherUsd: number };
    last7d: { totalUsd: number; discoveryUsd: number; otherUsd: number };
  };
  models: string[];
  betChannels: string[];
  /** A short, human-readable health flag, or null when nothing's wrong. */
  errorState: string | null;
};

type SpendWindow = { totalUsd: number; discoveryUsd: number; otherUsd: number };

function emptySpendWindow(): SpendWindow {
  return { totalUsd: 0, discoveryUsd: 0, otherUsd: 0 };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Top-level overview: one row per GTM agent, plus portfolio totals and the
 * channel-recommendation distribution.
 */
export const overview = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!authorized(token)) return { ok: false as const };

    const agents = await ctx.db.query("gtmAgents").collect();
    const allMessages = await ctx.db.query("mayaMessages").collect();
    const allScorecards = await ctx.db.query("gtmChannelScorecard").collect();
    const allCost = await ctx.db.query("gtmCostLedger").collect();

    // Group messages + cost + bets by agent/account for O(1) lookups below.
    const msgsByAgent = new Map<string, Doc<"mayaMessages">[]>();
    for (const m of allMessages) {
      const k = m.agentId as string;
      const arr = msgsByAgent.get(k);
      if (arr) arr.push(m);
      else msgsByAgent.set(k, [m]);
    }
    const now = Date.now();
    const DAY_MS = 1000 * 60 * 60 * 24;
    const dayCutoff = now - DAY_MS;
    const weekCutoff = now - 7 * DAY_MS;

    const costByAccount = new Map<string, number>();
    // Windowed per-account spend (today / last-7d, discovery-split). Built from
    // the same single ledger collect — no extra reads, isolated per account.
    const spendByAccount = new Map<
      string,
      { today: SpendWindow; last7d: SpendWindow }
    >();
    for (const c of allCost) {
      const k = c.accountId as string;
      const usd = c.costUsd ?? 0;
      costByAccount.set(k, (costByAccount.get(k) ?? 0) + usd);

      const createdAt = c.createdAt ?? c._creationTime;
      if (createdAt < weekCutoff) continue;
      let win = spendByAccount.get(k);
      if (!win) {
        win = { today: emptySpendWindow(), last7d: emptySpendWindow() };
        spendByAccount.set(k, win);
      }
      const isDiscovery = c.discovery === true;
      // 7d bucket (all rows past weekCutoff land here).
      win.last7d.totalUsd += usd;
      if (isDiscovery) win.last7d.discoveryUsd += usd;
      else win.last7d.otherUsd += usd;
      // 24h bucket (subset).
      if (createdAt >= dayCutoff) {
        win.today.totalUsd += usd;
        if (isDiscovery) win.today.discoveryUsd += usd;
        else win.today.otherUsd += usd;
      }
    }
    const betsByAgent = new Map<string, string[]>();
    for (const s of allScorecards) {
      if (!s.bet) continue;
      const k = s.agentId as string;
      const arr = betsByAgent.get(k);
      if (arr) arr.push(s.channel);
      else betsByAgent.set(k, [s.channel]);
    }

    const STALE_MS = 1000 * 60 * 60 * 24; // 24h with no activity = "quiet"

    const rows: AccountRow[] = [];
    for (const agent of agents) {
      const account = await ctx.db.get(agent.accountId);
      if (!account) continue;
      const app = agent.appId ? await ctx.db.get(agent.appId) : null;

      const msgs = msgsByAgent.get(agent._id as string) ?? [];
      let userMsgCount = 0;
      let mayaMsgCount = 0;
      let lastMsgAt: number | null = null;
      const models = new Set<string>();
      let msgCostUsd = 0;
      for (const m of msgs) {
        if (m.role === "user") userMsgCount += 1;
        else mayaMsgCount += 1;
        if (lastMsgAt === null || m.ts > lastMsgAt) lastMsgAt = m.ts;
        if (m.model) models.add(m.model);
        if (typeof m.costUsd === "number") msgCostUsd += m.costUsd;
      }

      const ledgerCost = costByAccount.get(account._id as string) ?? 0;
      // Ledger already mirrors per-turn completion cost, so prefer it; fall
      // back to message-summed cost if the ledger is empty for this account.
      const costUsd = ledgerCost > 0 ? ledgerCost : msgCostUsd;

      const deployed = Boolean(agent.openClawFlyAppId);
      const betChannels = (betsByAgent.get(agent._id as string) ?? []).sort();

      const rawSpend = spendByAccount.get(account._id as string);
      const spend = {
        today: {
          totalUsd: round4(rawSpend?.today.totalUsd ?? 0),
          discoveryUsd: round4(rawSpend?.today.discoveryUsd ?? 0),
          otherUsd: round4(rawSpend?.today.otherUsd ?? 0),
        },
        last7d: {
          totalUsd: round4(rawSpend?.last7d.totalUsd ?? 0),
          discoveryUsd: round4(rawSpend?.last7d.discoveryUsd ?? 0),
          otherUsd: round4(rawSpend?.last7d.otherUsd ?? 0),
        },
      };

      // Health heuristic — purely descriptive, no scoring.
      let errorState: string | null = null;
      if (deployed && msgs.length === 0) {
        errorState = "deployed · no messages captured";
      } else if (
        agent.onboardingStep !== "active" &&
        now - agent.createdAt > STALE_MS
      ) {
        errorState = `stuck in onboarding: ${agent.onboardingStep}`;
      } else if (lastMsgAt !== null && now - lastMsgAt > STALE_MS) {
        errorState = "quiet >24h";
      }

      rows.push({
        accountId: account._id,
        agentId: agent._id,
        productName:
          (app as Doc<"gtmApps"> | null)?.name ??
          account.displayName ??
          "(unnamed)",
        productUrl: (app as Doc<"gtmApps"> | null)?.url ?? null,
        stage: (app as Doc<"gtmApps"> | null)?.stage ?? null,
        weekGoal: (app as Doc<"gtmApps"> | null)?.weekGoal ?? null,
        onboardingStep: agent.onboardingStep,
        deployed,
        flyAppId: agent.openClawFlyAppId ?? null,
        isTest: account.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX),
        plan: account.plan,
        who: maskClerkId(account.clerkUserId),
        createdAt: agent.createdAt,
        userMsgCount,
        mayaMsgCount,
        lastMsgAt,
        costUsd,
        spend,
        models: [...models],
        betChannels,
        errorState,
      });
    }

    rows.sort((a, b) => (b.lastMsgAt ?? 0) - (a.lastMsgAt ?? 0));

    // Portfolio totals.
    const totals = {
      accounts: rows.length,
      deployed: rows.filter((r) => r.deployed).length,
      withMessages: rows.filter((r) => r.userMsgCount + r.mayaMsgCount > 0)
        .length,
      inError: rows.filter((r) => r.errorState !== null).length,
      totalCostUsd: rows.reduce((s, r) => s + r.costUsd, 0),
      // Windowed portfolio COGS — the "are we about to be surprised by a bill?"
      // top-line. Sum of the per-agent windows.
      spendTodayUsd: round4(
        rows.reduce((s, r) => s + r.spend.today.totalUsd, 0)
      ),
      spendLast7dUsd: round4(
        rows.reduce((s, r) => s + r.spend.last7d.totalUsd, 0)
      ),
      totalUserMsgs: rows.reduce((s, r) => s + r.userMsgCount, 0),
      totalMayaMsgs: rows.reduce((s, r) => s + r.mayaMsgCount, 0),
    };

    // Channel-recommendation distribution — answers "is Maya just always
    // recommending Reddit?". Counts across every agent that produced bets.
    const betChannelHistogram = new Map<string, number>();
    let agentsWithBets = 0;
    let redditBetCount = 0;
    for (const r of rows) {
      if (r.betChannels.length === 0) continue;
      agentsWithBets += 1;
      if (r.betChannels.includes("reddit")) redditBetCount += 1;
      for (const ch of r.betChannels) {
        betChannelHistogram.set(ch, (betChannelHistogram.get(ch) ?? 0) + 1);
      }
    }
    const channelInsight = {
      agentsWithBets,
      redditBetCount,
      redditBetPct:
        agentsWithBets > 0
          ? Math.round((redditBetCount / agentsWithBets) * 100)
          : 0,
      histogram: [...betChannelHistogram.entries()]
        .map(([channel, count]) => ({ channel, count }))
        .sort((a, b) => b.count - a.count),
    };

    return {
      ok: true as const,
      generatedAt: now,
      totals,
      channelInsight,
      accounts: rows,
    };
  },
});

/**
 * Pure windowing helper — folds a set of ledger rows into today/last-7d totals
 * with a discovery split. Unit-testable without a Convex ctx. Callers pass only
 * rows for ONE account (isolation is the caller's responsibility — see the
 * indexed read in `agentSpend`).
 */
export function windowLedgerSpend(
  rows: Array<{ costUsd: number; createdAt: number; discovery?: boolean }>,
  now: number
): { today: SpendWindow; last7d: SpendWindow } {
  const DAY_MS = 1000 * 60 * 60 * 24;
  const dayCutoff = now - DAY_MS;
  const weekCutoff = now - 7 * DAY_MS;
  const out = { today: emptySpendWindow(), last7d: emptySpendWindow() };
  for (const r of rows) {
    const usd = r.costUsd ?? 0;
    if (r.createdAt < weekCutoff) continue;
    const isDiscovery = r.discovery === true;
    out.last7d.totalUsd += usd;
    if (isDiscovery) out.last7d.discoveryUsd += usd;
    else out.last7d.otherUsd += usd;
    if (r.createdAt >= dayCutoff) {
      out.today.totalUsd += usd;
      if (isDiscovery) out.today.discoveryUsd += usd;
      else out.today.otherUsd += usd;
    }
  }
  for (const win of [out.today, out.last7d]) {
    win.totalUsd = round4(win.totalUsd);
    win.discoveryUsd = round4(win.discoveryUsd);
    win.otherUsd = round4(win.otherUsd);
  }
  return out;
}

/**
 * Per-agent windowed spend (today / last-7d, discovery-split) for ONE account.
 * Admin-scoped (ADMIN_DASH_TOKEN, fail-closed) like the rest of this module.
 * Reads ONLY the requested account's ledger rows via the `by_account` index —
 * never sums across tenants. Use this for a per-agent COGS drill-down without
 * loading the whole portfolio.
 */
export const agentSpend = query({
  args: { token: v.string(), accountId: v.id("creators") },
  handler: async (ctx, { token, accountId }) => {
    if (!authorized(token)) return { ok: false as const };

    const now = Date.now();
    const weekCutoff = now - 7 * 1000 * 60 * 60 * 24;
    // Account-scoped, time-windowed read — only this tenant's recent rows.
    const rows = await ctx.db
      .query("gtmCostLedger")
      .withIndex("by_account_and_created", (q) =>
        q.eq("accountId", accountId).gte("createdAt", weekCutoff)
      )
      .collect();

    const spend = windowLedgerSpend(
      rows.map((r) => ({
        costUsd: r.costUsd,
        createdAt: r.createdAt ?? r._creationTime,
        discovery: r.discovery,
      })),
      now
    );

    return { ok: true as const, accountId, generatedAt: now, spend };
  },
});

/**
 * Full transcript for one account — the user↔Maya conversation rendered in
 * order, each Maya turn carrying its telemetry.
 */
export const transcript = query({
  args: { token: v.string(), accountId: v.id("creators") },
  handler: async (ctx, { token, accountId }) => {
    if (!authorized(token)) return { ok: false as const };

    const account = await ctx.db.get(accountId);
    if (!account) return { ok: true as const, found: false as const };

    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .first();
    const app = agent?.appId ? await ctx.db.get(agent.appId) : null;

    // by_account_and_ts gives chronological order directly.
    const messages = await ctx.db
      .query("mayaMessages")
      .withIndex("by_account_and_ts", (q) => q.eq("accountId", accountId))
      .order("asc")
      .take(500);

    return {
      ok: true as const,
      found: true as const,
      productName:
        (app as Doc<"gtmApps"> | null)?.name ??
        account.displayName ??
        "(unnamed)",
      productUrl: (app as Doc<"gtmApps"> | null)?.url ?? null,
      messages: messages.map((m) => ({
        id: m._id as string,
        role: m.role,
        body: m.body,
        ts: m.ts,
        channel: m.channel,
        turnId: m.turnId,
        messageClass: m.messageClass ?? null,
        criticPassed: m.criticPassed ?? null,
        model: m.model ?? null,
        tokensIn: m.tokensIn ?? null,
        tokensOut: m.tokensOut ?? null,
        latencyMs: m.latencyMs ?? null,
        costUsd: m.costUsd ?? null,
        thinkingBudget: m.thinkingBudget ?? null,
      })),
    };
  },
});
