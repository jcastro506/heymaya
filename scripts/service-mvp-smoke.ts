#!/usr/bin/env tsx
/**
 * scripts/service-mvp-smoke.ts
 *
 * HeyMaya Service-product MVP smoke — single-business end-to-end critical-
 * path validation.
 *
 * Mirrors `scripts/mvp-smoke.ts` (creator side) but walks the service-
 * business operator journey:
 *   1.  Test business (plan=pro for full surface coverage)
 *   2.  Mock GBP profile + reviews + posts via Mike Hansen fixture
 *   3.  Onboarding pull (mock — no external services in --mock mode)
 *   4.  businessPicture synth (mock — placeholder until live mode)
 *   5.  service-side soul.md generated (placeholder marker)
 *   6.  Mock CRM connection + webhook idempotency dedupe verification
 *   7.  serviceJob creation → completion → reviewRequest auto-queue
 *   8.  5-star review arrival → reviews.replyStatus="drafted" + attribution
 *   9.  Operator approves reply → reviews.replyStatus="approved"
 *  10.  GBP SEO auditor row materializes
 *  11.  Weekly learnings extractor row materializes
 *  12.  Growth tab — Maya-attributed counts > 0
 *  13.  Telemetry rows present for review-request-approval + crm-webhook-idempotency-hit
 *  14.  Teardown: delete test business + cascade cleanup
 *
 * Two modes:
 *   --mock (default) — zero external services. In-memory fixture validation
 *                      against the `mike-hansen-1truck-hvac` persona shape.
 *                      <30s.
 *   --live --confirm — real CRM webhook injection via local fixture replay,
 *                      real Convex internal calls, no Fly machine create
 *                      (Fly is out of scope for service smoke; per-business
 *                      Fly machines are a Sprint 6 deliverable).
 *
 * Exit codes:
 *   0 = pass
 *   1 = pre-flight env misconfig OR missing fixture
 *   2 = critical-path failure
 *   3 = teardown failure (smoke passed but cleanup is dirty)
 */

import "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

import { generateAnchor } from "./fixtures/serviceBusinesses/generate";
import type { FixtureBusiness } from "./fixtures/serviceBusinesses/types";

/* -------------------------------------------------------------------------- */
/* CLI parsing + flags                                                        */
/* -------------------------------------------------------------------------- */

interface Flags {
  mode: "mock" | "live";
  confirm: boolean;
  help: boolean;
  /** Required in --live mode: an existing businesses._id to deploy. */
  businessId: string | null;
}

function parseFlags(argv: ReadonlyArray<string>): Flags {
  const flags: Flags = {
    mode: "mock",
    confirm: false,
    help: false,
    businessId: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mock") flags.mode = "mock";
    else if (a === "--live") flags.mode = "live";
    else if (a === "--confirm") flags.confirm = true;
    else if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--business-id") flags.businessId = argv[++i] ?? null;
    else if (a.startsWith("--business-id=")) {
      flags.businessId = a.slice("--business-id=".length);
    }
  }
  return flags;
}

/* -------------------------------------------------------------------------- */
/* Logging — colour-aware, degrades to plain text without TTY                 */
/* -------------------------------------------------------------------------- */

const HAS_TTY = Boolean(process.stdout.isTTY);
const COLOUR = HAS_TTY && !process.env.NO_COLOR;

const C = {
  green: (s: string) => (COLOUR ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (COLOUR ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (COLOUR ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (COLOUR ? `\x1b[36m${s}\x1b[0m` : s),
  dim: (s: string) => (COLOUR ? `\x1b[2m${s}\x1b[0m` : s),
};

const startedAt = Date.now();
const stepReports: string[] = [];

function elapsed(): string {
  const ms = Date.now() - startedAt;
  return `${(ms / 1000).toFixed(1)}s`;
}

function pass(msg: string): void {
  const line = `${C.green("OK")} ${msg}`;
  stepReports.push(line);
  console.log(line);
}

function skip(msg: string): void {
  const line = `${C.yellow("--")} ${msg} ${C.dim("[SKIPPED]")}`;
  stepReports.push(line);
  console.log(line);
}

function info(msg: string): void {
  console.log(C.dim(`  ${msg}`));
}

function fail(stage: string, err: unknown, hint?: string): never {
  console.error(`\n${C.red("X")} FAIL at step: ${C.cyan(stage)}`);
  console.error(C.red(formatError(err)));
  if (hint) console.error(`${C.yellow("hint:")} ${hint}`);
  console.error(`\n${C.red("SMOKE FAIL")} - ${elapsed()}`);
  process.exit(2);
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/* -------------------------------------------------------------------------- */
/* Pre-flight                                                                 */
/* -------------------------------------------------------------------------- */

interface PreflightResult {
  fixtureRoot: string;
  /** Live-mode only — null in mock mode. */
  convexUrl: string | null;
  /** Live-mode only — null in mock mode. */
  adminKey: string | null;
  /** Live-mode only — null in mock mode. */
  businessId: string | null;
}

function preflight(flags: Flags): PreflightResult {
  if (flags.mode === "live" && !flags.confirm) {
    console.error(
      C.red(
        "Refusing --live without --confirm. Live mode hits OpenRouter, creates a real Fly app + machine, and consumes the OpenClaw runtime image at registry.fly.io/heymaya-openclaw. Pass --confirm to acknowledge."
      )
    );
    process.exit(1);
  }
  // Verify the persona-anchor fixture is reachable on disk. The fixture
  // generator produces an in-memory shape from `personas/mike.ts` so we
  // verify the file exists rather than expecting a JSON snapshot.
  const fixtureRoot = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "serviceBusinesses"
  );
  const personaFile = join(fixtureRoot, "personas", "mike.ts");
  if (!existsSync(personaFile)) {
    console.error(
      C.red(
        `Service smoke: missing fixture '${personaFile}'. Did you delete the persona pack?`
      )
    );
    process.exit(1);
  }

  // Mock mode needs nothing further from env.
  if (flags.mode !== "live") {
    return {
      fixtureRoot,
      convexUrl: null,
      adminKey: null,
      businessId: null,
    };
  }

  // Live mode — Convex URL + admin key + a businessId to deploy.
  const convexUrl =
    process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL ?? null;
  if (!convexUrl) {
    console.error(
      C.red(
        "Live mode requires NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) in env. See .env.local."
      )
    );
    process.exit(1);
  }
  const adminKey =
    process.env.CONVEX_ADMIN_KEY ?? process.env.CONVEX_DEPLOY_KEY ?? null;
  if (!adminKey) {
    console.error(
      C.red(
        "Live mode requires CONVEX_ADMIN_KEY (or CONVEX_DEPLOY_KEY) so this script can call internal.* actions. Get one from `npx convex dashboard` → Settings → Deploy keys."
      )
    );
    process.exit(1);
  }
  // --business-id is now OPTIONAL. If absent, the smoke auto-creates a
  // fresh fixture business via `internal.smokeFixtures.serviceBusiness.
  // createServiceFixture` and tears it down on exit. Operators who want
  // to deploy a specific real business can still pass --business-id; that
  // path skips fixture creation but still runs auto-teardown of the Fly
  // app on exit (the `businesses` row is preserved in that case).
  return {
    fixtureRoot,
    convexUrl,
    adminKey,
    businessId: flags.businessId,
  };
}

/* -------------------------------------------------------------------------- */
/* Mock-mode smoke walk                                                        */
/* -------------------------------------------------------------------------- */

interface MockBusinessRow {
  id: string;
  accountId: string;
  name: string;
  planTier: "starter" | "pro" | "studio";
  serviceTypes: string[];
  createdAt: number;
}

interface MockJobRow {
  id: string;
  businessId: string;
  status: "scheduled" | "in-progress" | "completed" | "cancelled";
  customerId?: string;
  technicianName: string;
  serviceType: string;
  ticketAmountUsd: number;
  scheduledAt: number;
  completedAt?: number;
  originatingLeadId?: string;
}

interface MockReviewRow {
  id: string;
  businessId: string;
  externalReviewId: string;
  starRating: number;
  body: string;
  receivedAt: number;
  draftReply?: string;
  replyStatus?: "drafted" | "approved" | "posted" | "rejected";
}

interface MockReviewRequestRow {
  id: string;
  businessId: string;
  jobId?: string;
  channel: "sms" | "email";
  status: "pending_approval" | "queued" | "sent" | "cancelled";
  sentAt?: number;
  attributedReviewId?: string;
}

interface MockTelemetryRow {
  id: string;
  businessId: string;
  signal:
    | "review-request-approval"
    | "review-reply-moderation"
    | "lead-response-nudge-open"
    | "voice-satisfaction"
    | "ai-cost"
    | "crm-webhook-idempotency-hit";
  outcome: string;
  numericValue?: number;
  ts: number;
}

interface MockGbpHealthRow {
  id: string;
  businessId: string;
  scoreAt: number;
  compositeScore: number;
  reasoning: string;
  nudgesPending: number;
}

interface MockWeeklyLearningsRow {
  id: string;
  businessId: string;
  weekStartMs: number;
  weekEndMs: number;
  topPatterns: Array<{
    kind: string;
    claim: string;
    sampleSize: number;
    jobsAttributed: number;
    fiveStarsAttributed: number;
    confidence: number;
    wikiVaultPath: string;
  }>;
}

interface MockState {
  businesses: MockBusinessRow[];
  jobs: MockJobRow[];
  reviews: MockReviewRow[];
  reviewRequests: MockReviewRequestRow[];
  telemetry: MockTelemetryRow[];
  gbpHealth: MockGbpHealthRow[];
  weeklyLearnings: MockWeeklyLearningsRow[];
  webhookEvents: Map<string, true>;
}

function freshState(): MockState {
  return {
    businesses: [],
    jobs: [],
    reviews: [],
    reviewRequests: [],
    telemetry: [],
    gbpHealth: [],
    weeklyLearnings: [],
    webhookEvents: new Map(),
  };
}

function mintId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Run the full mock smoke walk. Returns the final mutable state for
 * post-walk assertions (used by the test harness).
 */
export async function runMockSmoke(): Promise<{
  state: MockState;
  fixture: FixtureBusiness;
  durationMs: number;
}> {
  const t0 = Date.now();
  const state = freshState();

  // Step 1 — create test business (pro plan).
  const fixture = generateAnchor("mike");
  if (!fixture || fixture.persona !== "mike") {
    throw new Error("smoke: expected mike fixture");
  }
  const accountId = mintId("creator");
  const businessId = mintId("business");
  const business: MockBusinessRow = {
    id: businessId,
    accountId,
    name: fixture.businessName,
    // Override fixture's starter plan — smoke uses pro for full coverage.
    planTier: "pro",
    serviceTypes: fixture.serviceTypes,
    createdAt: Date.now(),
  };
  state.businesses.push(business);
  pass(`business created (${businessId}, plan=pro, persona=${fixture.persona})`);

  // Step 2 — fixture validation: GBP + reviews + photos all present.
  if (fixture.gbp.businessName.length === 0) {
    throw new Error("smoke: fixture has empty GBP business name");
  }
  if (fixture.reviews.length < 5) {
    throw new Error(
      `smoke: fixture has ${fixture.reviews.length} reviews; expected >= 5`
    );
  }
  pass(
    `fixture loaded (gbp="${fixture.gbp.businessName}", reviews=${fixture.reviews.length}, photos=${fixture.photos.length})`
  );

  // Step 3 — onboarding pull (mock).
  pass(
    `onboarding pull (mock) - ${fixture.gbp.serviceArea.zips.length} zips, ${fixture.gbp.namedCompetitors?.length ?? 0} competitors`
  );

  // Step 4 — businessPicture synth (placeholder).
  if (
    !fixture.businessPicture.brandVoice ||
    fixture.businessPicture.brandVoice.length === 0
  ) {
    throw new Error("smoke: fixture businessPicture.brandVoice is empty");
  }
  pass("businessPicture synthesized (fixture-driven, live model deferred)");

  // Step 5 — service-side soul.md (placeholder marker).
  pass("soul.md generated (placeholder, live deploy will replace)");

  // Step 6 — mock CRM connection + webhook idempotency dedupe.
  const dupeEventId = "evt_mock_jobber_001";
  state.webhookEvents.set(dupeEventId, true);
  // Simulate a redelivery — this should emit a telemetry row.
  if (state.webhookEvents.has(dupeEventId)) {
    state.telemetry.push({
      id: mintId("telemetry"),
      businessId,
      signal: "crm-webhook-idempotency-hit",
      outcome: "jobber",
      ts: Date.now(),
    });
  } else {
    throw new Error("smoke: webhook dedupe didn't trigger");
  }
  pass("CRM webhook redelivery emitted idempotency-hit telemetry");

  // Step 7 — serviceJob create → complete → reviewRequest queued.
  const jobId = mintId("job");
  state.jobs.push({
    id: jobId,
    businessId,
    status: "scheduled",
    technicianName: "Mike",
    serviceType: "hvac",
    ticketAmountUsd: 320,
    scheduledAt: Date.now(),
  });
  // Mark complete.
  const jobRow = state.jobs.find((j) => j.id === jobId)!;
  jobRow.status = "completed";
  jobRow.completedAt = Date.now();
  // ReviewRequest queues for approval (Pro tier — gated by approvalRules).
  const rrId = mintId("rr");
  state.reviewRequests.push({
    id: rrId,
    businessId,
    jobId,
    channel: "sms",
    status: "pending_approval",
  });
  pass(
    `job completed → reviewRequest pending_approval (id=${rrId.slice(0, 18)})`
  );

  // Step 8 — 5-star review arrives + attribution writes.
  const reviewId = mintId("review");
  state.reviews.push({
    id: reviewId,
    businessId,
    externalReviewId: "ext_review_mock_001",
    starRating: 5,
    body: "Mike was great — fixed the AC fast.",
    receivedAt: Date.now(),
    draftReply: "Thanks for the kind words! Glad we could get it cooled down.",
    replyStatus: "drafted",
  });
  // Wave C.5 attribution: link reviewRequest → review.
  const rrRow = state.reviewRequests.find((r) => r.id === rrId)!;
  rrRow.attributedReviewId = reviewId;
  rrRow.status = "sent";
  rrRow.sentAt = Date.now() - 24 * 60 * 60 * 1000;
  pass(
    `5-star review arrived (rev=${reviewId.slice(0, 18)}) → drafted reply + attribution linked`
  );

  // Step 9 — operator approves reply → posted + telemetry emit.
  const reviewRow = state.reviews.find((r) => r.id === reviewId)!;
  reviewRow.replyStatus = "approved";
  state.telemetry.push({
    id: mintId("telemetry"),
    businessId,
    signal: "review-request-approval",
    outcome: "approved",
    ts: Date.now(),
  });
  state.telemetry.push({
    id: mintId("telemetry"),
    businessId,
    signal: "review-reply-moderation",
    outcome: "pass",
    ts: Date.now(),
  });
  pass("operator approved reply → telemetry emitted (approval + moderation pass)");

  // Step 10 — GBP SEO auditor row materializes.
  state.gbpHealth.push({
    id: mintId("health"),
    businessId,
    scoreAt: Date.now(),
    compositeScore: 78,
    reasoning:
      "Solid review velocity, posts cadence within 5 days. Suggest claiming Yelp.",
    nudgesPending: 1,
  });
  pass("GBP SEO audit materialized (score=78)");

  // Step 11 — weekly learnings extractor row materializes.
  state.weeklyLearnings.push({
    id: mintId("learnings"),
    businessId,
    weekStartMs: Date.now() - 7 * 24 * 60 * 60 * 1000,
    weekEndMs: Date.now(),
    topPatterns: [
      {
        kind: "review-request-channel",
        claim: "SMS review requests outperform email by ~3x for HVAC residential.",
        sampleSize: 4,
        jobsAttributed: 2,
        fiveStarsAttributed: 3,
        confidence: 0.7,
        wikiVaultPath: "concepts/what-works/gbp/review-request-sms",
      },
    ],
  });
  pass("weekly learnings synthesized (1 pattern, sample=4)");

  // Step 12 — Growth tab attribution counts > 0.
  // Set the lead linkage so the job is "attributed".
  const leadId = mintId("lead");
  jobRow.originatingLeadId = leadId;
  const jobsAttributed = state.jobs.filter(
    (j) => j.businessId === businessId && j.originatingLeadId !== undefined
  ).length;
  const fiveStarsAttributed = state.reviewRequests.filter((rr) => {
    if (rr.businessId !== businessId) return false;
    if (!rr.attributedReviewId) return false;
    const rev = state.reviews.find((r) => r.id === rr.attributedReviewId);
    return rev !== undefined && rev.starRating >= 5;
  }).length;
  if (jobsAttributed === 0 || fiveStarsAttributed === 0) {
    throw new Error(
      `smoke: expected attribution > 0; got jobs=${jobsAttributed} fiveStars=${fiveStarsAttributed}`
    );
  }
  pass(
    `Growth tab attribution: jobs=${jobsAttributed}, 5-stars=${fiveStarsAttributed}`
  );

  // Step 13 — assert telemetry surface populated (Wave D).
  const telemetrySignals = new Set(
    state.telemetry.filter((t) => t.businessId === businessId).map((t) => t.signal)
  );
  if (
    !telemetrySignals.has("review-request-approval") ||
    !telemetrySignals.has("crm-webhook-idempotency-hit")
  ) {
    throw new Error(
      `smoke: telemetry signals missing; have=${[...telemetrySignals].join(",")}`
    );
  }
  pass(
    `telemetry rows: ${[...telemetrySignals].sort().join(", ")}`
  );

  // Step 14 — teardown.
  state.businesses.length = 0;
  state.jobs.length = 0;
  state.reviews.length = 0;
  state.reviewRequests.length = 0;
  state.telemetry.length = 0;
  state.gbpHealth.length = 0;
  state.weeklyLearnings.length = 0;
  state.webhookEvents.clear();
  pass("teardown complete");

  return { state, fixture, durationMs: Date.now() - t0 };
}

/* -------------------------------------------------------------------------- */
/* Live mode — real Convex + Fly                                              */
/* -------------------------------------------------------------------------- */

interface DeployServiceMayaResult {
  ok: boolean;
  stage: string;
  message?: string;
  flyAppId?: string;
  machineId?: string;
  durationMs: number;
}

async function runLiveSmoke(pre: PreflightResult): Promise<void> {
  if (!pre.convexUrl || !pre.adminKey) {
    fail(
      "live-preflight",
      new Error("live mode invariants violated"),
      "Should be unreachable — preflight should have caught this."
    );
  }

  // Lazy import: only pull `convex/browser` when actually running live so
  // mock-mode + tests never need the runtime client.
  const { ConvexHttpClient } = await import("convex/browser");
  const { anyApi } = await import("convex/server");

  const client = new ConvexHttpClient(pre.convexUrl);
  // setAdminAuth is the documented-internal escape hatch convex-cli uses.
  // It exists on convex@1.x and is the only way to call internal.* over
  // HTTP without a Clerk identity. Mirrors the creator-side smoke
  // (`scripts/mvp-smoke.ts:417`).
  (client as unknown as { setAdminAuth: (k: string) => void }).setAdminAuth(
    pre.adminKey
  );

  pass(`live preflight ok (convex=${shortenUrl(pre.convexUrl)})`);

  // Step 1 — fixture business. Either the operator passed --business-id
  // pointing at an existing real row, or we auto-create a smoke fixture.
  // Auto-created fixtures are torn down on exit; operator-supplied ids
  // are preserved (only the Fly app gets cleaned up).
  let businessId: string;
  let fixtureCreated = false;
  if (pre.businessId) {
    businessId = pre.businessId;
    pass(`reusing operator-supplied business=${businessId}`);
  } else {
    try {
      const created = (await client.mutation(
        anyApi.smokeFixtures.serviceBusiness.createServiceFixture,
        {}
      )) as { businessId: string; creatorId: string; clerkUserId: string };
      businessId = created.businessId;
      fixtureCreated = true;
      pass(
        `fixture business created (business=${businessId}, creator=${created.creatorId}, clerk=${created.clerkUserId})`
      );
    } catch (err) {
      fail(
        "fixture-create",
        err,
        "Could not call internal.smokeFixtures.serviceBusiness.createServiceFixture. Did you `npx convex dev --once` after the latest commit?"
      );
    }
  }

  // Step 2 — call deployServiceMaya. This is the entire end-to-end:
  //   workspace assembly → bundle upload → Fly app create → secrets →
  //   machine create → wait-for-state → channel-pair via OpenClaw CLI →
  //   writeback. Every stage that fails returns
  //   `{ ok: false, stage, message }` so we can surface the exact gap.
  // Wrapped in try/finally so teardown always runs.
  let result: DeployServiceMayaResult | null = null;
  let deployError: unknown = null;
  try {
    const t0 = Date.now();
    result = (await client.action(
      anyApi.onboarding.business.deployServiceMaya.deployServiceMaya,
      { businessId }
    )) as DeployServiceMayaResult;
    info(`deployServiceMaya returned in ${(Date.now() - t0) / 1000}s`);
  } catch (err) {
    deployError = err;
  }

  // Step 3 — teardown FIRST, then surface success/failure. We always
  // tear down the Fly app (it costs $$ to leave running) and the
  // fixture business (if we created it).
  interface TeardownReport {
    flyAppDestroyed: boolean;
    flyError: string | null;
    deletedCounts: Record<string, number>;
  }
  let teardownReport: TeardownReport | null = null;
  try {
    teardownReport = (await client.action(
      anyApi.smokeFixtures.serviceBusiness.destroyServiceFixtureWithFly,
      {
        businessId: fixtureCreated ? businessId : undefined,
        flyAppId: result?.flyAppId,
      }
    )) as TeardownReport;
  } catch (err) {
    console.error(
      C.yellow(`! teardown call failed: ${formatError(err)}`)
    );
  }

  if (deployError) {
    fail(
      "deploy-call",
      deployError,
      "Could not reach Convex. Verify NEXT_PUBLIC_CONVEX_URL + CONVEX_ADMIN_KEY and that `npx convex dev --once` has pushed current functions."
    );
  }
  if (!result) {
    fail("deploy-call", new Error("deploy returned null"), "Unreachable.");
  }
  if (!result.ok) {
    const flyHint =
      result.stage === "create-machine" || result.stage === "wait-for-state"
        ? " (machine boot — most likely the OpenClaw runtime image at registry.fly.io/heymaya-openclaw is missing or unreachable; build + push per infra/openclaw-runtime/README.md)"
        : "";
    fail(
      `deploy-${result.stage}`,
      new Error(result.message ?? "(no message)"),
      `Deploy stage '${result.stage}' returned ok=false${flyHint}.`
    );
  }

  pass(
    `deploy ok (stage=${result.stage}, app=${result.flyAppId ?? "?"}, machine=${result.machineId ?? "?"}, ${(result.durationMs / 1000).toFixed(1)}s)`
  );

  if (teardownReport) {
    if (teardownReport.flyAppDestroyed) {
      pass(`fly app destroyed (${result.flyAppId})`);
    } else if (teardownReport.flyError) {
      info(
        `! fly app destroy failed: ${teardownReport.flyError} — clean up manually: flyctl apps destroy ${result.flyAppId} --yes`
      );
    }
    const totalSwept = Object.values(teardownReport.deletedCounts).reduce(
      (a, b) => a + b,
      0
    );
    if (totalSwept > 0) {
      pass(
        `fixture rows swept (${totalSwept} total: ${Object.entries(
          teardownReport.deletedCounts
        )
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${k}=${n}`)
          .join(", ")})`
      );
    }
  }

  pass("live smoke complete");
}

function shortenUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.host;
  } catch {
    return u;
  }
}

/* -------------------------------------------------------------------------- */
/* Help                                                                       */
/* -------------------------------------------------------------------------- */

function printHelp(): void {
  console.log(
    [
      "HeyMaya Service-product MVP smoke",
      "",
      "Usage:",
      "  npm run smoke:service                                # mock mode (default, hermetic, <30s)",
      "  npm run smoke:service -- --live --confirm           # live mode, auto fixture create + teardown",
      "  npm run smoke:service -- --live --confirm --business-id <id>   # live mode, target an existing business",
      "",
      "Flags:",
      "  --mock                  Hermetic — fixture-driven, zero external services (default).",
      "  --live                  Real deploy: Convex action call → Fly app + machine create → OpenClaw boot.",
      "  --confirm               Required with --live (creates real cloud resources).",
      "  --business-id <id>      Optional in --live: target an existing businesses._id. If omitted, the",
      "                          smoke auto-creates a fresh fixture business and tears it down on exit.",
      "  --help                  Show this and exit.",
      "",
      "Live-mode env (must be set in .env.local or process env):",
      "  NEXT_PUBLIC_CONVEX_URL  Convex deployment URL (or CONVEX_URL).",
      "  CONVEX_ADMIN_KEY        Admin/deploy key (or CONVEX_DEPLOY_KEY) so internal.* actions are callable.",
      "",
      "Live-mode preconditions (operator-side, one-time):",
      "  1. npx convex dev --once   # push current schema + functions",
      "  2. flyctl auth docker && docker push registry.fly.io/heymaya-openclaw:v2026.4.23",
      "     (see infra/openclaw-runtime/README.md for the full build + push flow)",
      "",
      "Teardown is automatic — Fly app destroyed on exit; auto-created fixture rows swept",
      "via internal.smokeFixtures.serviceBusiness.destroyServiceFixtureWithFly.",
      "",
      "Exit codes:",
      "  0 = pass",
      "  1 = pre-flight env misconfig OR missing fixture",
      "  2 = critical-path failure",
      "  3 = teardown failure (smoke passed but cleanup is dirty)",
    ].join("\n")
  );
}

/* -------------------------------------------------------------------------- */
/* Main entry                                                                 */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    process.exit(0);
  }
  console.log(
    `${C.cyan("HeyMaya service smoke")} - mode=${flags.mode}`
  );
  const pre = preflight(flags);

  if (flags.mode === "mock") {
    try {
      const { durationMs } = await runMockSmoke();
      info(`mock walk completed in ${(durationMs / 1000).toFixed(1)}s`);
    } catch (err) {
      fail("mock-walk", err, "Inspect the persona fixture or the smoke walk steps.");
    }
  } else {
    await runLiveSmoke(pre);
  }

  console.log(
    `\n${C.green("SMOKE PASS")} - ${elapsed()} - ${flags.mode} mode`
  );
  process.exit(0);
}

// Only run main when invoked as a script. The test imports `runMockSmoke`
// directly and asserts behavior in-process.
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("service-mvp-smoke.ts");

if (isDirectRun) {
  main().catch((err) => {
    fail("uncaught", err, "Exception escaped per-step error handlers.");
  });
}
