/**
 * Sprint 6 (top-tier) — the strategic partner. Pure logic (tier cap, persistence
 * + throttled ping, survey throttle, instruments) is exact; the convex-test side
 * proves PMF/pricing are server-capped, the ping only fires after ≥2 weeks of a
 * strong non-distribution verdict, and surveys are throttled.
 */
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import {
  capTier,
  foldDiagnosis,
  canProposeSurvey,
  seanEllisSurvey,
  vanWestendorpSurvey,
  type DiagnosisState,
} from "../strategicDiagnosis";

const WEEK = 7 * 86_400_000;

describe("capTier — PMF/pricing can never be asserted strong", () => {
  it("caps pmf_suspected and pricing at lean", () => {
    expect(capTier("pmf_suspected", "strong")).toBe("lean");
    expect(capTier("pricing", "strong")).toBe("lean");
  });
  it("leaves positioning/messaging/distribution uncapped", () => {
    expect(capTier("positioning", "strong")).toBe("strong");
    expect(capTier("messaging", "strong")).toBe("strong");
    expect(capTier("distribution", "strong")).toBe("strong");
  });
});

describe("foldDiagnosis — persistence + throttled hard-truth ping", () => {
  const empty: DiagnosisState = { history: [] };

  it("does NOT ping on a single strong week (not yet persisted)", () => {
    const r = foldDiagnosis(empty, { category: "positioning", tier: "strong" }, WEEK);
    expect(r.weeksPersisted).toBe(1);
    expect(r.shouldPing).toBe(false);
  });

  it("pings on the 2nd consecutive strong positioning week", () => {
    const w1 = foldDiagnosis(empty, { category: "positioning", tier: "strong" }, WEEK);
    const w2 = foldDiagnosis(w1.state, { category: "positioning", tier: "strong" }, WEEK * 2);
    expect(w2.weeksPersisted).toBe(2);
    expect(w2.shouldPing).toBe(true);
  });

  it("never pings on distribution (it's a to-do, not a hard truth)", () => {
    const w1 = foldDiagnosis(empty, { category: "distribution", tier: "strong" }, WEEK);
    const w2 = foldDiagnosis(w1.state, { category: "distribution", tier: "strong" }, WEEK * 2);
    expect(w2.shouldPing).toBe(false);
  });

  it("never pings PMF — it's capped below strong", () => {
    const w1 = foldDiagnosis(empty, { category: "pmf_suspected", tier: "strong" }, WEEK);
    const w2 = foldDiagnosis(w1.state, { category: "pmf_suspected", tier: "strong" }, WEEK * 2);
    expect(w2.state.current?.tier).toBe("lean"); // capped
    expect(w2.shouldPing).toBe(false);
  });

  it("throttles — won't ping again the very next week", () => {
    const w1 = foldDiagnosis(empty, { category: "positioning", tier: "strong" }, WEEK);
    const w2 = foldDiagnosis(w1.state, { category: "positioning", tier: "strong" }, WEEK * 2);
    expect(w2.shouldPing).toBe(true);
    const w3 = foldDiagnosis(w2.state, { category: "positioning", tier: "strong" }, WEEK * 3);
    expect(w3.shouldPing).toBe(false); // within the 3-week throttle
  });

  it("resets persistence when the category changes", () => {
    const w1 = foldDiagnosis(empty, { category: "positioning", tier: "strong" }, WEEK);
    const w2 = foldDiagnosis(w1.state, { category: "messaging", tier: "strong" }, WEEK * 2);
    expect(w2.weeksPersisted).toBe(1);
    expect(w2.shouldPing).toBe(false);
  });
});

describe("canProposeSurvey + instruments", () => {
  it("allows when never proposed, blocks when recent, allows when stale", () => {
    expect(canProposeSurvey(undefined, WEEK * 5)).toBe(true);
    expect(canProposeSurvey(WEEK * 5, WEEK * 5 + 86_400_000)).toBe(false);
    expect(canProposeSurvey(WEEK, WEEK * 5)).toBe(true);
  });
  it("Sean-Ellis survey carries the 40% scoring + 4 questions", () => {
    const s = seanEllisSurvey("BugBrief");
    expect(s.questions.length).toBe(4);
    expect(s.questions[0]).toContain("BugBrief");
    expect(s.scoring).toMatch(/40%/);
  });
  it("van Westendorp survey has the 4 price points", () => {
    const s = vanWestendorpSurvey("BugBrief");
    expect(s.questions.length).toBe(4);
    expect(s.instrument).toBe("van-westendorp-pricing");
  });
});

// ───────────────────────── convex-test (server caps + throttle) ─────────────────────────

beforeAll(() => {
  process.env.ENCRYPTION_KEY = btoa("\0".repeat(32));
});

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  const hookToken = "fake-hook-" + subject;
  await t.run(async (ctx) => {
    await ctx.db.patch(started.agentId, { hookToken });
  });
  return { hookToken };
}

function post(
  t: ReturnType<typeof convexTest>,
  path: string,
  hookToken: string,
  body: Record<string, unknown>
) {
  return t.fetch(path, {
    method: "POST",
    headers: { authorization: `Bearer ${hookToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Sprint 6 — save_diagnosis + surveys (server-enforced)", () => {
  it("auto-caps a PMF 'strong' claim to 'lean'", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_diag_pmf");
    const res = (await post(t, "/lc_gtm/save_diagnosis", hookToken, {
      category: "pmf_suspected",
      tier: "strong",
      reason: "nobody comes back",
      nowMs: WEEK,
    }).then((r) => r.json())) as {
      ok: boolean;
      tier: string;
      cappedFrom?: string;
      shouldHardTruthPing: boolean;
    };
    expect(res.ok).toBe(true);
    expect(res.tier).toBe("lean");
    expect(res.cappedFrom).toBe("strong");
    expect(res.shouldHardTruthPing).toBe(false);
  });

  it("fires the hard-truth ping only on the 2nd persisted strong positioning week", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_diag_ping");
    const w1 = (await post(t, "/lc_gtm/save_diagnosis", hookToken, {
      category: "positioning",
      tier: "strong",
      nowMs: WEEK,
    }).then((r) => r.json())) as { shouldHardTruthPing: boolean };
    expect(w1.shouldHardTruthPing).toBe(false);

    const w2 = (await post(t, "/lc_gtm/save_diagnosis", hookToken, {
      category: "positioning",
      tier: "strong",
      nowMs: WEEK * 2,
    }).then((r) => r.json())) as { shouldHardTruthPing: boolean };
    expect(w2.shouldHardTruthPing).toBe(true);
  });

  it("proposes a PMF survey once, then throttles", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_diag_survey");
    const first = (await post(t, "/lc_gtm/propose_pmf_survey", hookToken, {
      productName: "BugBrief",
      nowMs: WEEK,
    }).then((r) => r.json())) as { ok: boolean; survey?: { questions: string[] } };
    expect(first.ok).toBe(true);
    expect(first.survey!.questions.length).toBe(4);

    const second = (await post(t, "/lc_gtm/propose_pmf_survey", hookToken, {
      productName: "BugBrief",
      nowMs: WEEK + 86_400_000,
    }).then((r) => r.json())) as { ok: boolean; reason?: string };
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("throttled");
  });
});
