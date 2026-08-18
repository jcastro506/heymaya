import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * v3.1 render smoke — two modes through one useQuery mock:
 *   "null"  → loaded-but-no-data: every gated page renders <NeedsOnboarding/>.
 *   "data"  → grounded fixtures: each tab renders its board modules
 *             (decision cards, timeline, KPI row, dossier, fit ring, wire).
 * The api mock maps every query to its string name, so the useQuery mock can
 * key fixtures by that name.
 */

const h = vi.hoisted(() => {
  const now = Date.now();
  const fixtures: Record<string, unknown> = {
    getMyGtmSnapshot: {
      creator: { _id: "c1", email: "op@x.com", accountType: "gtm-agent" },
      agent: {
        _id: "ag1",
        lifecycleState: "live",
        channelWarmthJson: JSON.stringify({
          reddit: { state: "warming", lastUpdatedMs: now },
        }),
      },
      app: { name: "Acme" },
      latestJob: null,
      evidenceCount: 0,
      channelScores: [],
      costTotalUsd: 0,
    },
    getMyDraftQueue: [
      {
        _id: "d1",
        platform: "reddit",
        kind: "reply",
        draftText:
          "This hits hard. I shipped three products before I understood.",
        approvalState: "pending_approval",
        createdAt: now - 3600_000,
        updatedAt: now - 3600_000,
        slopCriticPassed: true,
        thread: {
          title: "We can build SaaS products. But who's going to sell them?",
          url: "https://reddit.com/r/SaaS/1",
          platform: "reddit",
        },
      },
    ],
    getMyCalendarEvents: [],
    getMyConnectionHealth: [],
    getMyConnectedAccounts: [{ _id: "z1", platform: "reddit" }],
    getMyPlanDoc: { plan: { status: "approved", version: 2, moves: [] } },
    getMyAgentActivity: [
      {
        _id: "a1",
        kind: "found",
        summary: "Found a rising thread in r/SaaS",
        createdAt: now - 60_000,
      },
    ],
    getMyRecentPostResults: [],
    getMyConversions: [
      {
        _id: "cv1",
        kind: "signup",
        count: 3,
        source: "self_report",
        occurredAt: now - 120_000,
      },
    ],
    getMyPostAttribution: [
      {
        linkWrapId: "lw1",
        destinationUrl: "https://acme.dev",
        platform: "reddit",
        draftText: "Most indie AI products die from zero distribution",
        draftKind: "reply",
        clicks: 41,
        conversions: 3,
        conversionKinds: ["signup"],
        createdAt: now - 600_000,
      },
    ],
    getMyFoundationInsights: {
      hasFoundation: true,
      synthesizedAt: now,
      productPicture: null,
      buyer: {
        icpDescription: "The shipped-but-silent solo dev",
        journeyStages: [
          {
            stage: "aware",
            whereTheyHangOut: "r/SaaS",
            intentLanguage: "who's going to sell them",
            complaints: ["distribution, not code"],
          },
        ],
        intentPhrases: ["how do I get users"],
        trustedVoices: [
          { handle: "@levelsio", platform: "x", whyTrusted: "peer" },
        ],
      },
      competitors: [],
      channels: [
        {
          channel: "reddit",
          audienceFit: 0.78,
          cadenceFit: 0.6,
          uniqueUnlock: "Buyers vent here in exact problem language.",
          bet: true,
          notes: null,
        },
      ],
      angles: [
        {
          angle: "Built it, now what?",
          painQuote:
            "We can build SaaS products. But who's going to sell them?",
          painSourceUrl: "https://reddit.com/r/SaaS/1",
          hookVariants: ["h1", "h2", "h3"],
        },
      ],
      voice: {
        traits: ["direct", "no hype"],
        exemplar:
          "I shipped three products before I understood distribution is a second job.",
      },
    },
    getMyCompetitiveMap: [
      {
        _id: "cm1",
        competitorName: "Jasper AI",
        kind: "direct",
        positioning: "AI content generation",
        pricing: null,
        url: "https://jasper.ai",
        complaints: [],
        vulnerabilities: ["no attribution story"],
      },
    ],
    getMyMayaMessages: [
      {
        _id: "m1",
        role: "maya",
        body: "Foundation's done.",
        channel: "telegram",
        ts: now,
      },
      {
        _id: "m2",
        role: "user",
        body: "Why Reddit",
        channel: "telegram",
        ts: now,
      },
    ],
    listMySteeringDirectives: [
      {
        _id: "s1",
        directive: "Never mention pricing in public replies.",
        active: true,
        intent: "avoid",
        createdAt: now,
      },
    ],
  };
  return { mode: "null" as "null" | "data", fixtures };
});

vi.mock("convex/react", () => ({
  useQuery: (name: unknown) =>
    h.mode === "null" ? null : (h.fixtures[String(name)] ?? null),
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
    CalendarDays: Stub,
    Lightbulb: Stub,
    Map: Stub,
    MessageCircle: Stub,
    PenLine: Stub,
    ScrollText: Stub,
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
    // The new module. Mission Control still reads mostly `gtmMaya`, but the
    // restored Plan screen (§16.75) reads the live product's strategy.
    maya: {
      strategy: { planScreen: "planScreen" },
      dashboard: { resultsLadder: "resultsLadder", myDashboard: "myDashboard" },
      archive: { myActivity: "myActivity" },
      attribution: { myResults: "myResults" },
      // §18 Sprint 10's "account deletion + data export". Settings offers the
      // export above the danger zone, so the founder passes "get your data out"
      // on the way to "delete everything".
      dataExport: { requestMyDataExport: "requestMyDataExport" },
    },
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

/** v3.1 IA — four tabs + the settings gear. */
const TABS = [
  { name: "Today", path: "../page" },
  { name: "Results", path: "../results/page" },
  { name: "Brain", path: "../brain/page" },
  { name: "Activity", path: "../activity/page" },
  { name: "Settings", path: "../settings/page" },
];

/**
 * Old routes must redirect to their v3 homes — link rot is a product bug.
 *
 * ⚠️ `Plan` was here and is deliberately no longer. §16.75: *"I trimmed this
 * out when cutting to six screens. **That was wrong** — the strategy is the
 * most interesting thing she produces, and it's invisible."* The route now
 * renders the restored screen, asserted separately below.
 */
const REDIRECTS = [
  { name: "Drafts", path: "../drafts/page", dest: "/clawlaunch/mission" },
  { name: "Queue", path: "../queue/page", dest: "/clawlaunch/mission" },
  {
    name: "Research",
    path: "../research/page",
    dest: "/clawlaunch/mission/brain",
  },
  {
    name: "Thinking",
    path: "../thinking/page",
    dest: "/clawlaunch/mission/activity",
  },
  {
    name: "Account",
    path: "../account/page",
    dest: "/clawlaunch/mission/settings",
  },
  {
    name: "Assets",
    path: "../assets/page",
    dest: "/clawlaunch/mission/results",
  },
];

beforeEach(() => {
  h.mode = "null";
});

describe("the Plan screen is back (§16.75)", () => {
  it("renders rather than redirecting", async () => {
    // The changelog is "the single strongest trust artifact in the product"
    // (§16.75.1) and had no surface at all until this route stopped
    // redirecting.
    const Page = (await import("../plan/page")).default;
    expect(() => renderToString(createElement(Page))).not.toThrow();
  });
});

describe("Mission Control — SSR render smoke", () => {
  it("the layout renders the 6 tabs + the settings gear", async () => {
    const Layout = (await import("../layout")).default;
    const html = renderToString(
      createElement(Layout, null, createElement("div", null, "content")),
    );
    for (const label of [
      "Today",
      "Results",
      "Brain",
      "Activity",
      // §16.2 gives House Rules a top-level slot — the proof she remembers.
      "Rules",
      /**
       * ⚠️ Plan was BUILT AND UNREACHABLE. §16.75 restored the screen because
       * "the strategy is the most interesting thing she produces, and it's
       * invisible" — then it was left out of NAV, so it stayed invisible. This
       * test passed the whole time, because it only asserted the tabs that
       * existed rather than the screens that do.
       */
      "Plan",
      "Settings",
    ]) {
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
        `NEXT_REDIRECT:${r.dest}`,
      );
    });
  }
});

describe("Mission Control v3.1 — board modules render with grounded data", () => {
  beforeEach(() => {
    h.mode = "data";
  });

  it("Today: decision cards + timeline + pulse", async () => {
    const Page = (await import("../page")).default;
    const html = renderToString(createElement(Page));
    expect(html).toContain("Needs you");
    expect(html).toContain("Post it"); // draft decision card actions
    expect(html).toContain("Tweak");
    expect(html).toContain("Pass");
    expect(html).toContain("who&#x27;s going to sell them?"); // thread context
    expect(html).toContain("The day she&#x27;s running");
    expect(html).toContain("Morning brief"); // cron block on the timeline
    expect(html).toContain("Evening recap");
    expect(html).toContain("Pulse");
    expect(html).toContain("posts out today");
    expect(html).toContain("next work block");
  });

  it("Results: KPI row + funnel + channel scorecards + receipts", async () => {
    const Page = (await import("../results/page")).default;
    const html = renderToString(createElement(Page));
    expect(html).toContain("Signups · attributed"); // hero KPI
    expect(html).toContain("+ Log a win");
    expect(html).toContain("Clicks");
    expect(html).toContain("Posts shipped");
    expect(html).not.toContain("Reply rate"); // not derivable → hidden
    expect(html).toContain("as a funnel");
    expect(html).toContain("By channel");
    expect(html).toContain("Every post, with receipts");
    expect(html).toContain("Most indie AI products die from zero distribution");
    expect(html).toContain("This week"); // segmented control
  });

  it("Brain: dossier + fit ring + warmth + watch", async () => {
    const Page = (await import("../brain/page")).default;
    const html = renderToString(createElement(Page));
    expect(html).toContain("Who she believes is buying");
    expect(html).toContain("The shipped-but-silent solo dev");
    expect(html).toContain("betting"); // bets panel
    expect(html).toContain("78%"); // fit ring from audienceFit 0.78
    expect(html).toContain("WARMING"); // warmth stepper from channelWarmthJson
    expect(html).toContain("Built it, now what?"); // angle board
    /**
     * ⚠️ "Standing instructions" was removed 2026-08-12 — it rendered the
     * FROZEN product's `gtmSteeringDirectives`, so it could never show a rule
     * the live Maya was given. Asserted absent rather than deleted, so a
     * revert reintroducing the stale panel fails here.
     */
    expect(html).not.toContain("Standing instructions");
    expect(html).toContain("Competitor watch");
    expect(html).toContain("Jasper AI");
    expect(html).toContain("no attribution story");
  });

  it("Activity: live wire + chat mirror", async () => {
    const Page = (await import("../activity/page")).default;
    const html = renderToString(createElement(Page));
    expect(html).toContain("Live wire");
    expect(html).toContain("Found a rising thread in r/SaaS");
    expect(html).toContain("read-only");
    expect(html).toContain("Foundation&#x27;s done."); // maya bubble
    expect(html).toContain("Why Reddit"); // operator bubble
  });
});
