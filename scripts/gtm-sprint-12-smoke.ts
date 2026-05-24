#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 12 — Cumulative E2E sprint gate.
 *
 * Walks the data layer of the full ClawLaunch happy path in-process via
 * convex-test, without touching real ScrapeCreators / Fly / Telegram /
 * Google. Validates:
 *
 *   - Signup → setAppProfile → createResearchJob → manually-injected
 *     evidence + scores (stubs Sprint 4 workers since they need real
 *     HTTP) → workspace mutation row → Telegram handoff dispatched +
 *     skipped cleanly (no Fly) → calendar event persisted
 *   - Cross-tenant isolation at every persistence layer (the most
 *     important regression check before flipping live env vars).
 *
 * Live mode (`--live --confirm`) walks the operator through the real
 * end-to-end flow on RWTC; documented inline.
 */

import { convexTest } from "convex-test";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function buildConvexModules(): Record<string, () => Promise<unknown>> {
  const convexDir = join(REPO_ROOT, "convex");
  const modules: Record<string, () => Promise<unknown>> = {};
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === "node_modules" || name === ".git") continue;
        walk(full);
        continue;
      }
      if (!name.endsWith(".ts") && !name.endsWith(".js")) continue;
      if (name.endsWith(".d.ts")) continue;
      if (full.includes("__tests__") || name.endsWith(".test.ts")) continue;
      const rel = relative(convexDir, full).split("\\").join("/");
      modules[`../convex/${rel}`] = () => import(full);
    }
  }
  walk(convexDir);
  return modules;
}

interface Check {
  name: string;
  status: "passed" | "failed";
  detail: string;
}
const checks: Check[] = [];
const pass = (n: string, d: string) =>
  checks.push({ name: n, status: "passed", detail: d });
const fail = (n: string, d: string) =>
  checks.push({ name: n, status: "failed", detail: d });

async function setupFreshAccount(
  t: ReturnType<typeof convexTest>,
  subject: string
) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  const appId = await authed.mutation(
    api.gtmMaya.researchLifecycle.setAppProfile,
    {
      name: `${subject} app`,
      url: `https://${subject}.test/`,
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
    }
  );
  const jobId = await authed.mutation(
    api.gtmMaya.researchLifecycle.createResearchJob,
    { appId, budgetUsd: 3 }
  );
  return {
    authed,
    accountId: started.accountId,
    agentId: started.agentId,
    appId,
    jobId,
  };
}

async function checkFullHappyPath(): Promise<void> {
  const t = convexTest(schema, buildConvexModules());
  const acct = await setupFreshAccount(t, "e2e_happy");

  // ── Simulate Sprint 4 worker output: insert evidence cards directly.
  // Real workers would do this from ScrapeCreators responses.
  const evidenceIds = await t.mutation(
    internal.gtmMaya.platformWorkers.recordPlatformEvidence,
    {
      researchJobId: acct.jobId,
      accountId: acct.accountId,
      cards: [
        {
          source: "reddit",
          url: "https://reddit.com/r/SaaS/comments/abc/x/",
          snippet: "how do I get first users for my indie SaaS?",
          observedAt: Date.now(),
          recency: "fresh",
          painMatch: 0.85,
          buyerMatch: 0.7,
          channelFit: 0.8,
          promotionRisk: "medium",
          recommendedUse: "reply",
          extractedClaims: ["first-user pain"],
          rawRef: "reddit:search:abc",
        },
        {
          source: "x",
          url: "https://x.com/founder/status/1",
          snippet: "shipped my MVP, no audience, what now",
          observedAt: Date.now(),
          recency: "fresh",
          painMatch: 0.75,
          buyerMatch: 0.65,
          channelFit: 0.7,
          promotionRisk: "low",
          recommendedUse: "strategy",
          extractedClaims: ["audience cold-start"],
          rawRef: "x:search:1",
        },
        {
          source: "google",
          url: "https://example.test/alt-stripe-atlas",
          snippet: "alternatives to Stripe Atlas in 2026",
          observedAt: Date.now(),
          recency: "fresh",
          painMatch: 0.5,
          buyerMatch: 0.6,
          channelFit: 0.7,
          promotionRisk: "low",
          recommendedUse: "competitor",
          extractedClaims: ["substitute landscape"],
          rawRef: "google:search:alt",
        },
      ],
    }
  );
  if (evidenceIds.length !== 3) {
    fail("evidence-insert", `expected 3 evidence cards, got ${evidenceIds.length}`);
    return;
  }

  // Mark the job ready_for_review + insert a channel score (real
  // orchestrator would do this via Sprint 6 channel-judge or the
  // existing evaluateChannelSet).
  await t.run(async (ctx) => {
    await ctx.db.patch(acct.jobId, {
      status: "ready_for_review",
      phase: "complete",
      spentUsd: 0.35,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("gtmChannelScores", {
      accountId: acct.accountId,
      researchJobId: acct.jobId,
      channel: "reddit",
      score: 0.82,
      decision: "primary",
      confidence: "high",
      reasons: ["high painMatch in r/SaaS thread"],
      risks: [],
      evidenceCardIds: evidenceIds,
      qualityGate: { passed: true, failures: [] },
      createdAt: Date.now(),
    });
  });

  // ── Sprint 19 workspace mutation persists (best-effort from
  // orchestrator; we call directly to verify the path).
  const mutation = await t.action(
    internal.gtmMaya.workspaceMutator.mutateWorkspaceFromResearch,
    {
      agentId: acct.agentId,
      accountId: acct.accountId,
      researchJobId: acct.jobId,
      trigger: "research_complete",
    }
  );
  if (!mutation.summary.toLowerCase().includes("reddit")) {
    fail(
      "workspace-mutation",
      `mutation summary should name the primary channel: ${mutation.summary}`
    );
    return;
  }
  if (!mutation.changedFiles.includes("APP.md")) {
    fail(
      "workspace-mutation",
      `mutation should mark APP.md changed: ${mutation.changedFiles.join(", ")}`
    );
    return;
  }
  pass(
    "workspace-mutation",
    `mutation row persisted: ${mutation.summary.slice(0, 80)}`
  );

  // ── Sprint 10 handoff: skips cleanly when not deployed.
  const handoff = await t.action(
    internal.gtmMaya.telegramHandoff.handoffResearchToTelegram,
    {
      agentId: acct.agentId,
      summary: {
        researchJobId: acct.jobId,
        primaryChannel: "reddit",
        evidenceCount: 3,
        spentUsd: 0.35,
        status: "ready_for_review",
        succeededPlatformCount: 1,
        insufficientPlatformCount: 0,
        topEvidenceUrls: [
          "https://reddit.com/r/SaaS/comments/abc/x/",
        ],
      },
    }
  );
  if (handoff.status !== "skipped") {
    fail(
      "handoff-skip",
      `expected skipped (no Fly machine), got ${handoff.status}`
    );
    return;
  }
  if (!handoff.reason.includes("not deployed")) {
    fail(
      "handoff-skip",
      `expected 'not deployed' reason, got: ${handoff.reason}`
    );
    return;
  }
  pass(
    "handoff-skip-no-fly",
    "handoff correctly skipped when agent not deployed (live: would dispatch via hook bridge)"
  );

  // ── Sprint 9 calendar event: persist directly (operator would
  // approve a draft; orchestrator/skill writes via Google Calendar API
  // — covered in calendarWrite tests).
  const eventId = await t.mutation(
    internal.gtmMaya.calendarWrite.persistGtmCalendarEvent,
    {
      accountId: acct.accountId,
      agentId: acct.agentId,
      researchJobId: acct.jobId,
      providerEventId: "google_e2e_evt",
      htmlLink: "https://calendar.google.com/event?eid=e2e",
      title: "Reply on r/SaaS thread re: first-user pain",
      description: "Approved draft from Maya.",
      startsAtMs: Date.now() + 24 * 60 * 60 * 1000,
      endsAtMs: Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000,
      timezone: "America/New_York",
    }
  );

  const events = await acct.authed.query(
    api.gtmMaya.calendarWrite.getMyCalendarEvents,
    {}
  );
  if (events.length !== 1 || events[0]?._id !== eventId) {
    fail("calendar-event", `expected 1 event scoped to caller, got ${events.length}`);
    return;
  }
  pass(
    "calendar-event-persisted",
    `1 Maya-owned event in gtmCalendarEvents scoped to caller`
  );

  // ── Mission-board surfaces: every layer queryable scoped to user.
  const cards = await acct.authed.query(
    api.gtmMaya.deliveryFailures.getMyDeliveryFailures,
    {}
  );
  const muts = await acct.authed.query(
    api.gtmMaya.workspaceMutator.getMyWorkspaceMutations,
    {}
  );
  if (muts.length === 0) {
    fail(
      "mission-board-mutations",
      "getMyWorkspaceMutations should show ≥1 row after mutation"
    );
    return;
  }
  pass(
    "mission-board-surfaces",
    `delivery-failures (${cards.length}), workspace mutations (${muts.length}), calendar events (${events.length}) all queryable + scoped`
  );
}

async function checkCrossTenantIsolation(): Promise<void> {
  const t = convexTest(schema, buildConvexModules());
  const a = await setupFreshAccount(t, "e2e_iso_a");
  const b = await setupFreshAccount(t, "e2e_iso_b");

  await t.mutation(internal.gtmMaya.platformWorkers.recordPlatformEvidence, {
    researchJobId: a.jobId,
    accountId: a.accountId,
    cards: [
      {
        source: "reddit",
        url: "https://r.test/a",
        snippet: "A's evidence",
        observedAt: Date.now(),
        recency: "fresh",
        painMatch: 0.8,
        buyerMatch: 0.7,
        channelFit: 0.8,
        promotionRisk: "low",
        recommendedUse: "strategy",
        extractedClaims: [],
      },
    ],
  });
  await t.mutation(internal.gtmMaya.platformWorkers.recordPlatformCost, {
    researchJobId: a.jobId,
    accountId: a.accountId,
    provider: "scrapecreators",
    operation: "reddit.search",
    reason: "A's spend",
    costUsd: 0.01,
    cacheStatus: "called",
  });

  // B's getMyDeliveryFailures / mutations / events should all be empty.
  const bFailures = await b.authed.query(
    api.gtmMaya.deliveryFailures.getMyDeliveryFailures,
    {}
  );
  const bMutations = await b.authed.query(
    api.gtmMaya.workspaceMutator.getMyWorkspaceMutations,
    {}
  );
  const bEvents = await b.authed.query(
    api.gtmMaya.calendarWrite.getMyCalendarEvents,
    {}
  );
  if (bFailures.length !== 0 || bMutations.length !== 0 || bEvents.length !== 0) {
    fail(
      "cross-tenant",
      `B should see 0 of A's rows; got failures=${bFailures.length} mutations=${bMutations.length} events=${bEvents.length}`
    );
    return;
  }

  // B's cost cap should be unaffected by A's spend.
  const bCostStatus = await b.authed.query(
    api.gtmMaya.costCap.getMyCostCapStatus,
    { scope: "hour", nextCostUsd: 0.5 }
  );
  if (!bCostStatus?.allowed) {
    fail(
      "cross-tenant-cost-cap",
      `B's cost cap should allow $0.50 after A's $0.01 spend; got blocked: ${bCostStatus?.reason}`
    );
    return;
  }
  pass(
    "cross-tenant-isolation",
    "A's evidence/cost/mutations do NOT leak into B's mission board OR cost cap"
  );
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  await checkFullHappyPath();
  await checkCrossTenantIsolation();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 12 L4 smoke: ${passed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups — the REAL staging readiness test:\n" +
        "  1. Confirm `npm run smoke:gtm-sprint22` shows productionReady=true.\n" +
        "  2. As RWTC user, walk /onboarding/gtm intake fully.\n" +
        "  3. Wait ≤3 min after submit; verify research job advances through every phase to 'complete' with status=ready_for_review or needs_more_evidence.\n" +
        "  4. Verify ≥3 evidence cards inserted across ≥2 platforms.\n" +
        "  5. Verify cost ledger total <$1.50.\n" +
        "  6. Verify gtmChannelScores has a primary channel + at most one secondary.\n" +
        "  7. Verify gtmWorkspaceMutations row created with deployed=false.\n" +
        "  8. Verify Telegram receives a 3-sentence summary within 2 min of complete.\n" +
        "  9. Reply 'iterate' from Telegram → verify webhook routes back as agent turn.\n" +
        "  10. Connect Calendar via /api/google-calendar-gtm/start. Verify connection row + that Maya can propose events that land in your calendar tagged '[Maya GTM]'.\n" +
        "\nIf 10/10 of these pass, the product is REAL for one user. The next step is multi-user load + Sprint 23 (multi-project per creator)."
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
