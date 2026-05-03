/**
 * HQ render-states matrix — Wave D.
 *
 * Each of the 7 HQ screens (Today, Growth, Jobs, Reviews, Posts, Customers,
 * Profile) must render three explicit states:
 *
 *   1. **Loading** — `useQuery` returns `undefined`. The screen renders a
 *      skeleton (animate-pulse `bg-ink-3` blocks) and never shows empty UI
 *      flicker.
 *   2. **Empty / no-session** — `useQuery` returns `null`. The screen renders
 *      a stage-aware `EmptyState` (`fresh` / `ready` / `blocked`) with copy
 *      that explains the next step.
 *   3. **Populated** — non-null data renders without crashing.
 *
 * The test approach: substitute `convex/react`'s `useQuery` via a vitest
 * module mock that returns a controllable value, then `renderToString` each
 * page and assert the expected markers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";

/* -------------------------------------------------------------------------- */
/* Module mocks                                                                */
/* -------------------------------------------------------------------------- */

// Each screen's `useQuery` calls are stubbed to return whatever `mockData`
// dictates. The page's behaviour under the three render states is what we
// observe.
type MockBag = Record<string, unknown>;

let mockData: MockBag | "loading" = "loading";

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, _args?: unknown) => {
    if (mockData === "loading") return undefined;
    // Resolve the query name from the function reference. Convex's anyApi
    // proxy returns objects whose toString reveals the path. In tests we
    // pass functions through as-is; we look up by either explicit key or
    // by string match on toString().
    const key = String(ref);
    for (const [k, v] of Object.entries(mockData)) {
      if (key.includes(k)) return v;
    }
    return null;
  },
}));

// Stub Next.js Link so we don't pull the entire router into the tree.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

// The Convex generated api proxy — reduces to a string path so the useQuery
// mock above can pattern-match on it.
vi.mock("@/convex/_generated/api", () => {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, key) {
        // Each key access yields a stringified path — `useQuery`'s
        // `ref.toString()` will surface the segment chain.
        const segment = String(key);
        // Return another proxy so deeply-chained access still works.
        return new Proxy(
          {},
          {
            get(_t, k2) {
              return createNamedRef(`${segment}.${String(k2)}`);
            },
          }
        );
      },
    }
  );
  return { api: proxy };
});

function createNamedRef(name: string): unknown {
  // A function whose toString returns the path so the useQuery mock can
  // match it.
  const f = () => undefined;
  Object.defineProperty(f, "toString", {
    value: () => name,
  });
  Object.defineProperty(f, Symbol.toPrimitive, {
    value: () => name,
  });
  // Allow further `.foo` access — every node returns another keyed ref.
  return new Proxy(f, {
    get(target, k) {
      if (k === "toString" || k === Symbol.toPrimitive) {
        return target[k as keyof typeof target];
      }
      return createNamedRef(`${name}.${String(k)}`);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Renderer helper                                                             */
/* -------------------------------------------------------------------------- */

interface RenderHelper {
  loading(): Promise<string>;
  empty(): Promise<string>;
  populated(data: MockBag): Promise<string>;
}

function pageRenderer(importPath: string): RenderHelper {
  return {
    async loading() {
      mockData = "loading";
      const mod = await import(/* @vite-ignore */ importPath);
      return renderToString(createElement(mod.default));
    },
    async empty() {
      mockData = {};
      const mod = await import(/* @vite-ignore */ importPath);
      return renderToString(createElement(mod.default));
    },
    async populated(data) {
      mockData = data;
      const mod = await import(/* @vite-ignore */ importPath);
      return renderToString(createElement(mod.default));
    },
  };
}

beforeEach(() => {
  mockData = "loading";
});

afterEach(() => {
  vi.resetModules();
});

/* -------------------------------------------------------------------------- */
/* Today                                                                       */
/* -------------------------------------------------------------------------- */

describe("Today screen render states", () => {
  const r = pageRenderer("../today/page");

  it("loading: renders skeleton when profile is undefined", async () => {
    const html = await r.loading();
    expect(html).toContain("biz-today-boot-skeleton");
    expect(html).toContain("animate-pulse");
  });

  it("empty: renders fresh-stage EmptyState when no profile", async () => {
    const html = await r.empty();
    expect(html).toContain("Finish onboarding");
    expect(html).toContain('data-stage="fresh"');
  });

  it("populated: renders main surface when profile resolves", async () => {
    const html = await r.populated({
      "profile.getProfile": {
        account: { email: "op@test", timezone: "UTC", channelPreference: "web" },
        business: { name: "Op", planTier: "pro", serviceTypes: ["plumbing"] },
        features: { plan: "pro" },
      },
      "today.getTodaysBrief": null,
      "today.getTodaysJobs": [],
      "today.getPendingApprovals": null,
      "today.getRecentActivity": [],
      "today.getInboundLeadsCounter": null,
      "growth.getMayaContributionThisWeek": null,
    });
    expect(html).not.toContain("Finish onboarding");
  });
});

/* -------------------------------------------------------------------------- */
/* Growth                                                                      */
/* -------------------------------------------------------------------------- */

describe("Growth screen render states", () => {
  const r = pageRenderer("../growth/page");

  it("loading: renders boot skeleton when profile is undefined", async () => {
    const html = await r.loading();
    expect(html).toContain("biz-growth-boot-skeleton");
    expect(html).toContain("animate-pulse");
  });

  it("empty: renders fresh-stage EmptyState when no profile", async () => {
    const html = await r.empty();
    expect(html).toContain("Finish onboarding");
    expect(html).toContain('data-stage="fresh"');
  });

  it("populated: renders header + metrics area when profile resolves", async () => {
    const html = await r.populated({
      "profile.getProfile": {
        account: { email: "op@test", timezone: "UTC", channelPreference: "web" },
        business: { name: "Op", planTier: "pro", serviceTypes: [] },
        features: { plan: "pro" },
      },
      "growth.getGrowthSummary": null,
      "growth.getGbpHealthScoreLatest": null,
      "growth.getLatestWeeklyLearnings": null,
      "growth.getTelemetrySummary": null,
    });
    expect(html).toContain("biz-growth-header");
  });
});

/* -------------------------------------------------------------------------- */
/* Jobs                                                                        */
/* -------------------------------------------------------------------------- */

describe("Jobs screen render states", () => {
  const r = pageRenderer("../jobs/page");

  it("loading: renders skeleton", async () => {
    const html = await r.loading();
    expect(html).toContain("biz-jobs-skeleton");
  });

  it("empty: renders fresh-stage onboarding-required state", async () => {
    const html = await r.empty();
    expect(html).toContain("Finish onboarding");
    expect(html).toContain('data-stage="fresh"');
  });

  it("populated: renders pipeline section", async () => {
    const html = await r.populated({
      "profile.getProfile": {
        account: { email: "op@test", timezone: "UTC", channelPreference: "web" },
        business: { name: "Op", planTier: "pro", serviceTypes: [] },
        features: { plan: "pro" },
      },
      "jobs.getStatusCounts": null,
      "jobs.listJobs": [],
      "jobs.getJob": null,
    });
    expect(html).toContain("Pipeline");
  });
});

/* -------------------------------------------------------------------------- */
/* Reviews                                                                     */
/* -------------------------------------------------------------------------- */

describe("Reviews screen render states", () => {
  const r = pageRenderer("../reviews/page");

  it("loading: renders skeleton", async () => {
    const html = await r.loading();
    expect(html).toContain("biz-reviews-skeleton");
  });

  it("empty: renders fresh-stage EmptyState when no profile", async () => {
    const html = await r.empty();
    expect(html).toContain("Finish onboarding");
    expect(html).toContain('data-stage="fresh"');
  });

  it("populated: renders ready-stage EmptyState when no reviews in view", async () => {
    const html = await r.populated({
      "profile.getProfile": {
        account: { email: "op@test", timezone: "UTC", channelPreference: "web" },
        business: { name: "Op", planTier: "pro", serviceTypes: [] },
        features: { plan: "pro" },
      },
      "reviews.getDraftedReplies": [],
      "reviews.listReviews": [],
      "reviews.getSentimentTrend": [],
      "reviews.getUnmatchedReviews": [],
    });
    expect(html).toContain('data-stage="ready"');
  });
});

/* -------------------------------------------------------------------------- */
/* Posts                                                                       */
/* -------------------------------------------------------------------------- */

describe("Posts screen render states", () => {
  const r = pageRenderer("../posts/page");

  it("loading: renders skeleton", async () => {
    const html = await r.loading();
    expect(html).toContain("biz-posts-skeleton");
  });

  it("empty: renders fresh-stage EmptyState when no profile", async () => {
    const html = await r.empty();
    expect(html).toContain("Finish onboarding");
    expect(html).toContain('data-stage="fresh"');
  });

  it("populated: renders calendar tab when profile resolves", async () => {
    const html = await r.populated({
      "profile.getProfile": {
        account: { email: "op@test", timezone: "UTC", channelPreference: "web" },
        business: { name: "Op", planTier: "pro", serviceTypes: [] },
        features: { plan: "pro" },
      },
      "posts.listPosts": [],
      "posts.getPendingPosts": [],
      "posts.listAssets": { rows: [], canSeeRejuvenator: true },
      "posts.getRejuvenatorPicks": [],
    });
    expect(html).toContain("Posts");
  });
});

/* -------------------------------------------------------------------------- */
/* Customers                                                                   */
/* -------------------------------------------------------------------------- */

describe("Customers screen render states", () => {
  const r = pageRenderer("../customers/page");

  it("loading: renders skeleton", async () => {
    const html = await r.loading();
    expect(html).toContain("biz-customers-skeleton");
  });

  it("empty: renders fresh-stage EmptyState when no profile", async () => {
    const html = await r.empty();
    expect(html).toContain("Finish onboarding");
    expect(html).toContain('data-stage="fresh"');
  });

  it("populated (Starter): renders blocked-stage CRM-required EmptyState", async () => {
    const html = await r.populated({
      "profile.getProfile": {
        account: { email: "op@test", timezone: "UTC", channelPreference: "web" },
        business: { name: "Op", planTier: "starter", serviceTypes: [] },
        features: { plan: "starter" },
      },
      "customers.getReviewStatusCounts": null,
      "customers.listCustomers": [],
      "customers.getCustomer": null,
    });
    expect(html).toContain('data-stage="blocked"');
    expect(html).toContain("Connect a CRM");
  });
});

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

describe("Profile screen render states", () => {
  const r = pageRenderer("../profile/page");

  it("loading: renders skeleton", async () => {
    const html = await r.loading();
    expect(html).toContain("biz-profile-skeleton");
  });

  it("empty: renders fresh-stage EmptyState when no profile", async () => {
    const html = await r.empty();
    expect(html).toContain("Finish onboarding");
    expect(html).toContain('data-stage="fresh"');
  });

  it("populated: renders overview tab when profile resolves", async () => {
    const html = await r.populated({
      "profile.getProfile": {
        account: { email: "op@test", timezone: "UTC", channelPreference: "web" },
        business: {
          name: "Operator Co",
          planTier: "pro",
          serviceTypes: ["plumbing"],
          tonePreference: "friendly-neighborhood",
          responseSpeed: "within-30-min",
        },
        features: { plan: "pro" },
      },
      "profile.getConnections": null,
      "profile.getApprovalRules": null,
      "profile.getBilling": null,
    });
    expect(html).toContain("Operator Co");
  });
});
