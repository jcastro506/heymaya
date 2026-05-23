#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 1 smoke.
 *
 * In-process smoke for the first customer-ready foundation: account creation,
 * app profile, research job, cited evidence, channel decision, and cost ledger.
 * Live OpenClaw/Fly smoke starts in later sprints after the GTM workspace pack
 * exists; this smoke keeps Sprint 1 deterministic and cheap.
 */

import { convexTest } from "convex-test";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "../convex/_generated/api";
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

async function main() {
  const modules = buildConvexModules();
  const t = convexTest(schema, modules);
  const user = t.withIdentity({
    subject: `gtm_smoke_${Date.now()}`,
    email: "gtm-smoke@clawlaunch.test",
  });

  const start = await user.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {
      channelPreference: "whatsapp",
      timezone: "America/New_York",
    }
  );
  const appId = await user.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: "Sprint Smoke App",
    url: "https://gtm-smoke.clawlaunch.test",
    founderWhy: "Validate that Maya can ground GTM strategy in evidence.",
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  const jobId = await user.mutation(
    api.gtmMaya.researchLifecycle.createResearchJob,
    {
      appId,
      budgetUsd: 3,
    }
  );
  const evidenceCardIds = await user.mutation(
    api.gtmMaya.researchLifecycle.recordEvidenceCards,
    {
      researchJobId: jobId,
      cards: [
        {
          source: "reddit",
          url: "https://reddit.test/r/sideproject/first-users",
          title: "How do I find users?",
          snippet: "A founder is asking for practical ways to get first users.",
          observedAt: Date.now(),
          recency: "fresh",
          engagement: { likes: 25, comments: 30 },
          painMatch: 0.9,
          buyerMatch: 0.82,
          channelFit: 0.8,
          promotionRisk: "medium",
          recommendedUse: "reply",
          extractedClaims: ["founders need users", "reply-first Reddit can work"],
        },
      ],
    }
  );
  await user.mutation(api.gtmMaya.researchLifecycle.recordChannelScores, {
    researchJobId: jobId,
    scores: [
      {
        channel: "reddit",
        score: 0.74,
        decision: "primary",
        confidence: "medium",
        reasons: ["fresh first-user demand"],
        risks: ["must avoid promotion-heavy replies"],
        evidenceCardIds,
        firstWeekTest: "Reply to 10 qualified Reddit threads.",
        qualityGate: { passed: true, failures: [] },
      },
    ],
  });
  await user.mutation(api.gtmMaya.researchLifecycle.recordCost, {
    researchJobId: jobId,
    provider: "scrapecreators",
    operation: "reddit.search",
    reason: "sprint smoke fixture",
    costUsd: 0.03,
    units: 1,
    cacheStatus: "called",
  });
  await user.mutation(api.gtmMaya.researchLifecycle.updateResearchJob, {
    researchJobId: jobId,
    status: "ready_for_review",
    phase: "complete",
  });

  const snapshot = await user.query(
    api.gtmMaya.researchLifecycle.getMyGtmSnapshot,
    {}
  );
  if (!snapshot) throw new Error("Smoke snapshot missing.");
  if (snapshot.latestJob?._id !== jobId) throw new Error("Latest job mismatch.");
  if (snapshot.evidenceCount !== 1) throw new Error("Evidence count mismatch.");
  if (snapshot.channelScores[0]?.decision !== "primary") {
    throw new Error("Primary channel decision missing.");
  }
  if (snapshot.costTotalUsd !== 0.03) throw new Error("Cost ledger mismatch.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        accountId: start.accountId,
        agentId: start.agentId,
        appId,
        jobId,
        evidenceCount: snapshot.evidenceCount,
        primaryChannel: snapshot.channelScores[0].channel,
        costTotalUsd: snapshot.costTotalUsd,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
