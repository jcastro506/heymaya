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
}));

// lucide icons → explicit stubs (a catch-all Proxy breaks React element detection).
vi.mock("lucide-react", () => {
  const Stub = () => createElement("svg");
  return {
    Activity: Stub,
    CalendarDays: Stub,
    FileText: Stub,
    TrendingUp: Stub,
    Telescope: Stub,
    Settings: Stub,
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
        getMyNicheLearnings: "getMyNicheLearnings",
        getMyConversions: "getMyConversions",
        getMyAccount: "getMyAccount",
        deleteMyGtmAccount: "deleteMyGtmAccount",
      },
      researchLifecycle: { getMyGtmSnapshot: "getMyGtmSnapshot" },
      calendarWrite: { getMyCalendarEvents: "getMyCalendarEvents" },
      calendarOAuth: { getMyCalendarConnection: "getMyCalendarConnection" },
      targetList: { getMyDraftedContent: "getMyDraftedContent" },
      postResults: { getMyRecentPostResults: "getMyRecentPostResults" },
    },
  },
}));

const TABS = [
  { name: "Today", path: "../page" },
  { name: "Plan", path: "../plan/page" },
  { name: "Research", path: "../research/page" },
  { name: "Drafts", path: "../drafts/page" },
  { name: "Results", path: "../results/page" },
  { name: "Account", path: "../account/page" },
];

describe("Mission Control — SSR render smoke", () => {
  it("the layout renders the 6 tab nav items", async () => {
    const Layout = (await import("../layout")).default;
    const html = renderToString(
      createElement(Layout, null, createElement("div", null, "content"))
    );
    for (const label of [
      "Today",
      "Plan",
      "Research",
      "Drafts",
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
      expect(html).toContain("Set up ClawLaunch");
    });
  }
});
