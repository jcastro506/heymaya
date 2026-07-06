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

// lucide icons → explicit stubs (a catch-all Proxy breaks React element detection).
vi.mock("lucide-react", () => {
  const Stub = () => createElement("svg");
  return {
    Activity: Stub,
    Brain: Stub,
    Inbox: Stub,
    TrendingUp: Stub,
    Settings: Stub,
    Sparkles: Stub,
  };
});

// api object: nested string keys for every query/mutation the tabs reference.
vi.mock("@/convex/_generated/api", () => ({
  api: {
    gtmMaya: {
      missionControl: {
        getMyAgentActivity: "getMyAgentActivity",
        getMyBuyerMap: "getMyBuyerMap",
        getMyCompetitiveMap: "getMyCompetitiveMap",
        getMyFoundationInsights: "getMyFoundationInsights",
        getMyNicheLearnings: "getMyNicheLearnings",
        getMyConversions: "getMyConversions",
        getMyAccount: "getMyAccount",
        getMyPostAttribution: "getMyPostAttribution",
        getMyLatestWeeklyReview: "getMyLatestWeeklyReview",
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
      mediaAssets: { getMyMediaAssets: "getMyMediaAssets" },
      researchLifecycle: { getMyGtmSnapshot: "getMyGtmSnapshot" },
      calendarWrite: { getMyCalendarEvents: "getMyCalendarEvents" },
      calendarOAuth: { getMyCalendarConnection: "getMyCalendarConnection" },
      targetList: {
        getMyDraftedContent: "getMyDraftedContent",
        getMyTargetThreads: "getMyTargetThreads",
      },
      postResults: { getMyRecentPostResults: "getMyRecentPostResults" },
    },
    billing: {
      gtmBilling: { createGtmCheckoutSession: "createGtmCheckoutSession" },
    },
  },
}));

/** v2 IA — six live tabs. */
const TABS = [
  { name: "Today", path: "../page" },
  { name: "Thinking", path: "../thinking/page" },
  { name: "Queue", path: "../queue/page" },
  { name: "Brain", path: "../brain/page" },
  { name: "Results", path: "../results/page" },
  { name: "Account", path: "../account/page" },
];

/** Old routes must 308 to their v2 homes — link rot is a product bug. */
const REDIRECTS = [
  { name: "Plan", path: "../plan/page", dest: "/clawlaunch/mission" },
  { name: "Research", path: "../research/page", dest: "/clawlaunch/mission/brain" },
  { name: "Drafts", path: "../drafts/page", dest: "/clawlaunch/mission/queue" },
  { name: "Assets", path: "../assets/page", dest: "/clawlaunch/mission/queue?view=media" },
];

describe("Mission Control — SSR render smoke", () => {
  it("the layout renders the 6 tab nav items", async () => {
    const Layout = (await import("../layout")).default;
    const html = renderToString(
      createElement(Layout, null, createElement("div", null, "content"))
    );
    for (const label of [
      "Today",
      "Thinking",
      "Queue",
      "Brain",
      "Results",
      "Account",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Mission Control");
  });

  for (const tab of TABS) {
    it(`${tab.name} tab renders without crashing + gates to onboarding`, async () => {
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
