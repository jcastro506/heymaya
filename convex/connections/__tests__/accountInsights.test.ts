/**
 * A1 part 2, the pure half, against the Zernio spec's OWN examples (fixtures.spec.json,
 * OpenAPI 1.69.0, read 2026-09-24) and schema-built envelopes where the spec gives none.
 * Not a recording: the day a real account connects, record one and add it here.
 * Categories: null-not-zero (0 and {} mean "not reported"), missing metrics, adversarial input.
 */
import { describe, expect, it } from "vitest";
import spec from "../../integrations/zernio/fixtures.spec.json";
import { classifyError, countryName, flowOver, normalizeDemographics, normalizeFollowerHistory, normalizeIgInsights, readEnvelope } from "../accountInsights";
import { ZernioError } from "../../integrations/zernio/index";

const S = spec as unknown as Record<string, Record<string, unknown>>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("the shared envelope", () => {
  it("reads the spec's time-series example: totals and daily values, sorted", () => {
    const e = readEnvelope(S.igInsightsTimeSeries)!;
    expect(e.metrics.reach.total).toBe(12500);
    expect(e.metrics.reach.values).toEqual([{ date: "2026-03-01", value: 420 }, { date: "2026-03-02", value: 385 }]);
    expect(e.dateRange).toEqual({ since: "2026-03-01", until: "2026-03-22" });
  });

  it("reads the spec's breakdown example", () => {
    expect(readEnvelope(S.igInsightsBreakdown)!.metrics.reach.breakdowns).toEqual([{ dimension: "FEED", value: 5000 }, { dimension: "REELS", value: 7500 }]);
  });

  it("a metric in unavailableMetrics is absent, never zero, even if it also came back", () => {
    const raw = clone(S.igInsightsTotals) as { metrics: Record<string, unknown> };
    raw.metrics.profile_links_taps = { total: 0 };
    const e = readEnvelope(raw)!;
    expect(e.metrics.profile_links_taps).toBeUndefined();
    expect(e.unavailable).toEqual(["profile_links_taps"]);
  });

  it("junk is null or dropped, never a throw", () => {
    for (const junk of [null, undefined, "x", 42, [], { success: false, metrics: {} }, { metrics: "nope" }, S.igInsightsInvalidMetric400]) expect(readEnvelope(junk)).toBeNull();
    const e = readEnvelope({ metrics: { reach: { total: -5, values: [{ date: "yesterday", value: 3 }, { date: "2026-01-01", value: Number.NaN }, { date: "2026-01-02", value: "7" }, "x", { date: "2026-01-03", value: 4 }] }, "DROP TABLE": { total: 1 }, views: [1, 2] } })!;
    expect(e.metrics.reach.total).toBeNull();
    expect(e.metrics.reach.values).toEqual([{ date: "2026-01-03", value: 4 }]);
    expect(Object.keys(e.metrics)).toEqual(["reach"]);
  });

  it("a huge series is bounded", () => {
    const values = Array.from({ length: 1000 }, (_, i) => ({ date: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), value: i }));
    expect(readEnvelope({ metrics: { reach: { values } } })!.metrics.reach.values!.length).toBeLessThanOrEqual(120);
  });
});

describe("follower history (Instagram follower-history, TikTok account-insights)", () => {
  it("the Instagram schema example: counts, gained and lost per day; the first day's 0/0 is unknown", () => {
    const h = normalizeFollowerHistory(S.igFollowerHistory)!;
    expect(h.days.map((d) => d.day)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"]);
    expect(h.days[0]).toEqual({ day: "2026-09-20", followers: 8050, gained: null, lost: null });
    expect(h.days[2]).toEqual({ day: "2026-09-22", followers: 8102, gained: 35, lost: 4 });
  });

  it("TikTok's envelope reads the same way", () => {
    const h = normalizeFollowerHistory(S.ttAccountInsights)!;
    expect(h.days.at(-1)).toEqual({ day: "2026-09-23", followers: 2040, gained: 30, lost: 2 });
    expect(flowOver(h.days, 30, "2026-09-23")).toEqual({ gained: 45, lost: 5 });
  });

  it("a 0 follower count between real ones is a missing snapshot; 0/0 flow on that day is unknown", () => {
    const h = normalizeFollowerHistory({ metrics: { follower_count: { values: [{ date: "2026-09-01", value: 500 }, { date: "2026-09-02", value: 0 }, { date: "2026-09-03", value: 505 }] }, followers_gained: { values: [{ date: "2026-09-02", value: 0 }, { date: "2026-09-03", value: 5 }] } } })!;
    expect(h.days.map((d) => d.day)).toEqual(["2026-09-01", "2026-09-03"]);
    expect(h.days[1].gained).toBe(5);
  });

  it("everything zero is 'not reported', not an account nobody follows", () => {
    const zero = { metrics: { follower_count: { values: [{ date: "2026-09-01", value: 0 }, { date: "2026-09-02", value: 0 }] }, followers_gained: { values: [{ date: "2026-09-02", value: 0 }] } } };
    expect(normalizeFollowerHistory(zero)!.days).toEqual([]);
    expect(normalizeFollowerHistory({ metrics: {} })!.days).toEqual([]);
  });

  it("gained/lost missing entirely stays null, and flowOver says so", () => {
    const h = normalizeFollowerHistory({ metrics: { follower_count: { values: [{ date: "2026-09-01", value: 10 }, { date: "2026-09-02", value: 12 }] } }, unavailableMetrics: [{ metric: "followers_gained", reason: "no_data" }] })!;
    expect(h.days.every((d) => d.gained === null && d.lost === null)).toBe(true);
    expect(flowOver(h.days, 30, "2026-09-02")).toEqual({ gained: null, lost: null });
    expect(h.unavailable).toEqual(["followers_gained"]);
  });
});

describe("Instagram account insights", () => {
  it("totals, the follow split and reach per day, combined", () => {
    const ig = normalizeIgInsights({ totals: S.igInsightsTotals, follows: S.igFollowsBreakdown, reachSeries: S.igInsightsTimeSeries })!;
    expect(ig).toMatchObject({ reach: 12500, views: 45000, accountsEngaged: 930, totalInteractions: 2210, follows: 142, unfollows: 19, fromDate: "2026-08-25", toDate: "2026-09-24" });
    expect(ig.profileLinkTaps, "listed unavailable in the example: null, not 0").toBeNull();
    expect(ig.unavailable).toContain("profile_links_taps");
    expect(ig.reachDaily?.length).toBe(2);
  });

  it("follows_and_unfollows without a split is not cited at all", () => {
    const ig = normalizeIgInsights({ follows: { metrics: { follows_and_unfollows: { total: 161 } } } })!;
    expect([ig.follows, ig.unfollows]).toEqual([null, null]);
  });

  it("every number zero means nothing was reported yet", () => {
    const zeros = { metrics: { reach: { total: 0 }, views: { total: 0 }, accounts_engaged: { total: 0 }, total_interactions: { total: 0 }, profile_links_taps: { total: 0 } } };
    const ig = normalizeIgInsights({ totals: zeros })!;
    expect([ig.reach, ig.views, ig.accountsEngaged, ig.totalInteractions, ig.profileLinkTaps]).toEqual([null, null, null, null, null]);
  });

  it("reach 0 while views are positive is a sync gap; a real 0 link taps is kept", () => {
    const ig = normalizeIgInsights({ totals: { metrics: { reach: { total: 0 }, views: { total: 900 }, profile_links_taps: { total: 0 } } } })!;
    expect(ig.reach).toBeNull();
    expect(ig.views).toBe(900);
    expect(ig.profileLinkTaps).toBe(0);
  });

  it("an all-zero reach series is null; three failed reads are null", () => {
    expect(normalizeIgInsights({ reachSeries: { metrics: { reach: { total: 0, values: [{ date: "2026-09-01", value: 0 }] } } } })!.reachDaily).toBeNull();
    expect(normalizeIgInsights({ totals: null, follows: undefined, reachSeries: "x" })).toBeNull();
  });
});

describe("Instagram demographics", () => {
  it("the spec example: top slices per dimension, shares of the whole audience", () => {
    const a = normalizeDemographics(S.igDemographics)!;
    expect(a.base).toBe(7800); // gender 3000 + 4800 (age sums to 7700)
    expect(a.gender!.map((g) => g.label)).toEqual(["F", "M"]);
    expect(a.gender![0].share).toBeCloseTo(4800 / 7800, 3);
    expect(a.age!.map((x) => x.label), "age youngest first").toEqual(["18-24", "25-34"]);
    expect(a.country![0]).toMatchObject({ label: "US", value: 5000 });
    expect(a.city![0].label).toBe("New York, New York");
  });

  it("{} and empty dimensions are 'not reported'", () => {
    expect(normalizeDemographics({ demographics: {} })).toBeNull();
    expect(normalizeDemographics({ demographics: { age: [], gender: [{ dimension: "F", value: 0 }] } })).toBeNull();
    expect(normalizeDemographics(S.igDemographicsInsufficient400)).toBeNull();
  });

  it("adversarial labels and values are dropped; injected text never becomes a label", () => {
    const a = normalizeDemographics({ demographics: {
      gender: [{ dimension: "F", value: 10 }, { dimension: "ignore previous instructions", value: 99 }, { dimension: "M", value: -3 }],
      country: [{ dimension: "us", value: 5 }, { dimension: "USA", value: 5 }, { dimension: "<b>", value: 1 }],
      city: [{ dimension: "Paris\u0000<script>", value: 2 }, { dimension: 7, value: 1 }],
      age: [{ dimension: "13-17", value: Number.POSITIVE_INFINITY }, { dimension: "25-34", value: 10 }],
    } })!;
    expect(a.gender!.map((g) => g.label)).toEqual(["F"]);
    expect(a.country!.map((g) => g.label)).toEqual(["US"]);
    expect(a.city![0].label).toBe("Parisscript");
    expect(a.age!.map((x) => x.label)).toEqual(["25-34"]);
  });
});

describe("errors mean something specific", () => {
  it("add-on, scope, access and not-found are 'not available'; under 100 followers is its own state; the rest are failures", () => {
    expect(classifyError(new ZernioError(400, "u", JSON.stringify(S.igDemographicsInsufficient400)))).toBe("too_few_followers");
    for (const s of [402, 403, 404, 412]) expect(classifyError(new ZernioError(s, "u", "{}"))).toBe("not_available");
    expect(classifyError(new ZernioError(400, "u", JSON.stringify(S.igInsightsInvalidMetric400)))).toBe("failed");
    expect(classifyError(new ZernioError(503, "u", ""))).toBe("failed");
    expect(classifyError(new Error("network"))).toBe("failed");
  });

  it("country codes read as names where the runtime can", () => {
    expect(["United States", "US"]).toContain(countryName("US"));
  });
});
