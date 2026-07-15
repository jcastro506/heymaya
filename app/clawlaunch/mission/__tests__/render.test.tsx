import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// useQuery → null = "loaded, no data" → gated pages render <NeedsOnboarding/>.
// This proves every tab SSR-renders without crashing and gates correctly.
vi.mock("convex/react", () => ({
  useQuery: () => null,
  useMutation: () => async () => ({ ok: true }),
  useAction: () => async () => ({}),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => createElement("a", { href, className }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/clawlaunch/mission",
  redirect: (dest: string) => {
    throw new Error(`NEXT_REDIRECT:${dest}`);
  },
}));

// The mission.css import in layout.tsx — a no-op module under vitest.
vi.mock("../mission.css", () => ({}));

// lucide icons → explicit stubs (a catch-all Proxy breaks React element detection).
vi.mock("lucide-react", () => {
  const Stub = () => createElement("svg");
  return {
    Activity: Stub,
    Brain: Stub,
    Lightbulb: Stub,
    Map: Stub,
    MessageCircle: Stub,
    PenLine: Stub,
    Search: Stub,
    Send: Stub,
    Settings: Stub,
    Sparkles: Stub,
    Sun: Stub,
    TrendingUp: Stub,
  };
});

// api object: nested string keys for every query/mutation the tabs reference.
vi.mock("@/convex/_generated/api", () => ({
  api: {
    gtmMaya: {
      missionControl: {
        getMyAgentActivity: "getMyAgentActivity",
        getMyCompetitiveMap: "getMyCompetitiveMap",
        getMyFoundationInsights: "getMyFoundationInsights",
        getMyNicheLearnings: "getMyNicheLearnings",
        getMyConversions: "getMyConversions",
        getMyAccount: "getMyAccount",
        getMyPostAttribution: "getMyPostAttribution",
        getMyLatestWeeklyReview: "getMyLatestWeeklyReview",
        getMyMayaMessages: "getMyMayaMessages",
        deleteMyGtmAccount: "deleteMyGtmAccount",
      },
      missionActions: {
        getMyDraftQueue: "getMyDraftQueue",
        getMyConnectionHealth: "getMyConnectionHealth",
        getMyCompetitorMoves: "getMyCompetitorMoves",
        approveMyDraft: "approveMyDraft",
        passOnMyDraft: "passOnMyDraft",
        requestDraftTweak: "requestDraftTweak",
        sendMySteeringDirective: "sendMySteeringDirective",
        reportMyConversion: "reportMyConversion",
      },
      steering: { listMySteeringDirectives: "listMySteeringDirectives" },
      planDoc: {
        getMyPlanDoc: "getMyPlanDoc",
        approveMyPlan: "approveMyPlan",
      },
      mediaAssets: { getMyMediaAssets: "getMyMediaAssets" },
      researchLifecycle: { getMyGtmSnapshot: "getMyGtmSnapshot" },
      calendarWrite: { getMyCalendarEvents: "getMyCalendarEvents" },
      targetList: { getMyTargetThreads: "getMyTargetThreads" },
      postResults: { getMyRecentPostResults: "getMyRecentPostResults" },
      zernioConnect: {
        getMyConnectedAccounts: "getMyConnectedAccounts",
        getMyConnectCap: "getMyConnectCap",
        getZernioConnectUrl: "getZernioConnectUrl",
        disconnectZernioAccount: "disconnectZernioAccount",
        refreshMyZernioHealth: "refreshMyZernioHealth",
      },
      accountLifecycle: {
        cancelMyGtmSubscription: "cancelMyGtmSubscription",
        resumeMyGtmSubscription: "resumeMyGtmSubscription",
      },
    },
    billing: {
      gtmBilling: { createGtmCheckoutSession: "createGtmCheckoutSession" },
    },
  },
}));

vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({ signOut: async () => {} }),
}));

/** v3 IA — four tabs + the settings gear. */
const TABS = [
  { name: "Today", path: "../page" },
  { name: "Results", path: "../results/page" },
  { name: "Brain", path: "../brain/page" },
  { name: "Activity", path: "../activity/page" },
  { name: "Settings", path: "../settings/page" },
];

/** Old routes must redirect to their v3 homes — link rot is a product bug. */
const REDIRECTS = [
  { name: "Plan", path: "../plan/page", dest: "/clawlaunch/mission" },
  { name: "Drafts", path: "../drafts/page", dest: "/clawlaunch/mission" },
  { name: "Queue", path: "../queue/page", dest: "/clawlaunch/mission" },
  { name: "Research", path: "../research/page", dest: "/clawlaunch/mission/brain" },
  { name: "Thinking", path: "../thinking/page", dest: "/clawlaunch/mission/activity" },
  { name: "Account", path: "../account/page", dest: "/clawlaunch/mission/settings" },
  { name: "Assets", path: "../assets/page", dest: "/clawlaunch/mission/results" },
];

describe("Mission Control — SSR render smoke", () => {
  it("the layout renders the 4 tabs + the settings gear", async () => {
    const Layout = (await import("../layout")).default;
    const html = renderToString(
      createElement(Layout, null, createElement("div", null, "content"))
    );
    for (const label of ["Today", "Results", "Brain", "Activity", "Settings"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Mission Control");
    expect(html).toContain("/clawlaunch/mission/settings");
  });

  for (const tab of TABS) {
    it(`${tab.name} renders without crashing + gates to onboarding`, async () => {
      const Page = (await import(tab.path)).default;
      const html = renderToString(createElement(Page));
      // With no data + null snapshot, every gated tab shows NeedsOnboarding.
      expect(html).toContain("No agent yet");
      expect(html).toContain("Set up HeyMaya");
    });
  }

  for (const r of REDIRECTS) {
    it(`old ${r.name} route redirects to ${r.dest}`, async () => {
      const Page = (await import(r.path)).default;
      expect(() => renderToString(createElement(Page))).toThrowError(
        `NEXT_REDIRECT:${r.dest}`
      );
    });
  }
});
