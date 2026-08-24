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
    /**
     * ⭐ The homework, which IS the work before anything is live. Audited on a
     * live account four days in: 51 ideas, 72 observations, 12 competitor ads
     * and a verified niche vocabulary — with this screen showing an empty room,
     * because every panel asked a question that only has an answer once
     * something has been published.
     */
    /**
     * ⭐ What she actually did, from the spend ledger — the one source that
     * cannot report an intention or be padded. 111 cost events were read by
     * nothing while the founder was asking "so are you still doing stuff or".
     */
    myWork: {
      ok: true,
      days: [
        {
          day: "2026-08-22",
          total: 26,
          items: [
            { what: "worked out which shapes are landing", times: 22 },
            { what: "read what buyers are complaining about", times: 4 },
          ],
        },
      ],
    },
    myResearch: {
      ok: true,
      counts: { ideas: 51, observations: 72, posts: 60, ads: 12 },
      watching: 30,
      niche: ["ads not converting", "creative fatigue facebook ads"],
      complaints: ["I can't make fresh creative ads because management wants safe"],
      ads: [
        {
          advertiser: "madgicx.com",
          daysRunning: 60,
          variants: 2,
          isVideo: true,
          url: "https://www.facebook.com/ads/library?id=1",
          hook: "THIS IS YOUR BRAIN ON MANUAL ADS",
          device: "talking head",
          borrowable: "open on the mess, then show one simpler workflow",
          requires: "screen_recording",
        },
      ],
    },
    /**
     * ⭐ v2 shape. `myDraftQueue` returns {ok, drafts[]} with `id`/`channel`/
     * `text`/`proposedAt`, already filtered to pending-and-unexpired and sorted
     * oldest-first — so the page does no filtering of its own.
     *
     * ⚠️ The v1 fixture below posted to REDDIT, a channel this product has
     * never supported (`connectedChannelsMatchSpec.test.ts` explicitly forbids
     * offering it). It rendered green the whole time because nothing checked
     * that a fixture's channel was one we actually sell.
     */
    myVideos: { ok: true, videos: [] },
    myState: {
      signedIn: true,
      customerId: "c1",
      productName: "Widgetly",
      telegramPaired: true,
      deployed: true,
    },
    myFormats: {
      ok: true,
      shapes: [
        {
          id: "f1",
          channel: "tiktok",
          depth: "watch",
          hook: "Stop selling products. Start building a brand",
          views: 47800,
          watched: true,
        },
      ],
    },
    myIdeaBank: {
      ok: true,
      banked: 1,
      ideas: [
        {
          id: "i1",
          angle: "The CSV that became a dashboard project",
          sourceKind: "complaint",
          hasEvidence: true,
          /**
           * ⭐ The evidence itself. This used to be `hasEvidence` alone, so the
           * answer to "why does she want to post this?" was one boolean wide —
           * while every one of 59 ideas on a live account carried a verbatim
           * quote and its source URL.
           */
          quote: "I paste a CSV and spend an hour formatting it every Monday.",
          sourceUrls: ["https://www.tiktok.com/@someone/video/123"],
          status: "bank",
          bankedAt: now - 7200_000,
        },
      ],
    },
    myMediaLibrary: {
      ok: true,
      note: "building from a screen recording",
      usesAvatar: false,
      assets: [
        {
          id: "a1",
          kind: "screen_recording",
          source: "telegram",
          rung: "screen_recording",
          capturedAt: now - 86_400_000,
        },
      ],
    },
    myChannels: {
      ok: true,
      channels: [
        { channel: "instagram", state: "connected", handle: "@founder", notices: [] },
        { channel: "tiktok", state: "not_connected", notices: [] },
        { channel: "youtube", state: "connected", handle: "@founder", notices: [] },
      ],
    },
    myActivity: {
      ok: true,
      entries: [
        {
          placementId: "p1",
          channel: "instagram",
          text: "Most indie AI products die from zero distribution",
          publishedAt: now - 1800_000,
          tappable: true,
          url: "https://instagram.com/p/1",
          views: 412,
        },
      ],
    },
    myDraftQueue: {
      ok: true,
      drafts: [
        {
          id: "d1",
          channel: "instagram",
          kind: "post",
          text: "This hits hard. I shipped three products before I understood.",
          proposedAt: now - 3600_000,
          expiresAt: now + 20 * 3600_000,
        },
      ],
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
    Swords: Stub,
    CalendarDays: Stub,
    Clapperboard: Stub,
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
      dashboard: {
        resultsLadder: "resultsLadder",
        myDashboard: "myDashboard",
        myVideos: "myVideos",
        myIdeaBank: "myIdeaBank",
        myMediaLibrary: "myMediaLibrary",
        myResearch: "myResearch",
      },
      activityFeed: {
        /** The spend ledger, read in the founder's language. */
        myWork: "myWork",
      },
      archive: { myActivity: "myActivity" },
      attribution: { myResults: "myResults" },
      // §18 Sprint 10's "account deletion + data export". Settings offers the
      // export above the danger zone, so the founder passes "get your data out"
      // on the way to "delete everything".
      dataExport: { requestMyDataExport: "requestMyDataExport" },
      /**
       * ⭐ The drafts tray, migrated off `gtmMaya` 2026-08-19. The table had NO
       * public reader, so Today's "Needs you" band read the frozen product
       * while a v2 Maya wrote here.
       */
      drafts: {
        myDraftQueue: "myDraftQueue",
        decideMyDraft: "decideMyDraft",
      },
      /**
       * ⭐ `myChannels` replaces BOTH `getMyConnectionHealth` and
       * `getMyConnectedAccounts` — one read answering the two questions those
       * asked separately. `myActivity` replaces `getMyAgentActivity`, and is
       * narrower on purpose: v2 activity is the PLACEMENT ledger, so an entry
       * is something a stranger could have seen.
       */
      channels: { myChannels: "myChannels" },
      formats: { myFormats: "myFormats" },
      setup: { myState: "myState" },
      // The Videos screen — the artifact the founder is paying for.
      // `myVideos` is on dashboard alongside the other read-only panels.
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
  { name: "Videos", path: "../videos/page" },
  { name: "Results", path: "../results/page" },
  { name: "Brain", path: "../brain/page" },
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
    dest: "/clawlaunch/mission",
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
  it("the layout renders the 7 tabs + the settings gear", async () => {
    const Layout = (await import("../layout")).default;
    const html = renderToString(
      createElement(Layout, null, createElement("div", null, "content")),
    );
    for (const label of [
      "Today",
      /**
       * ⭐ Videos, added 2026-08-19 and placed SECOND — above Results. It is
       * the artifact the founder pays for, and on a UGC product it is what they
       * open this to see. Mission Control had every other screen and not this
       * one (docs/MISSION_CONTROL_UGC.md).
       */
      "Videos",
      "Results",
      /**
       * ⭐ Competition, added 2026-08-24. The only screen that reports on
       * somebody ELSE's money — an ad a rival has kept paying to run for sixty
       * days is the strongest evidence in the product, and it was reachable
       * from nowhere.
       */
      "Competition",
      "Brain",
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
    /**
     * ⚠️ The thread-context assertion went with the field. `thread` (the source
     * post a reply answered) was an X/Reddit-era concept; `convex/maya/drafts`
     * has nothing to populate it with, and both channels are gone.
     */
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

  it("Brain: shapes + ideas + what she has to work with", async () => {
    /**
     * ⚠️ REWRITTEN 2026-08-19, and the old assertions went with the screen.
     * They pinned "Who she believes is buying", the fit ring, the warmth
     * stepper and the angle board — all from the SUPERSEDED intent-hunting
     * design (docs/AGENT_REDESIGN_V2.md). Brain now answers the three questions
     * a UGC agent's dashboard has to: what is she watching, what does she plan
     * to make, and what does she have to make it with.
     */
    const Page = (await import("../brain/page")).default;
    const html = renderToString(createElement(Page));

    // What she's watching — the hook line, never the whole card (§7.5.3).
    expect(html).toContain("Shapes that are working");
    expect(html).toContain("Stop selling products");
    expect(html).toContain("watched");

    // What she plans to make.
    expect(html).toContain("Ideas she&#x27;s banked");
    expect(html).toContain("The CSV that became a dashboard project");
    // ⭐ It opens now, rather than asserting she has a reason and stopping.
    expect(html).toContain("why she picked this");

    // What she has to make it with — the LADDER VERDICT, not a count.
    expect(html).toContain("What she has to work with");
    expect(html).toContain("building from a screen recording");

    /**
     * ⚠️ The superseded frame must not come back. Asserted absent rather than
     * merely deleted: "Intent signal" belongs to a product that no longer
     * exists, and a copy-paste from the old screen would restore it silently.
     */
    expect(html).not.toContain("Intent signal");
    expect(html).not.toContain("Who she believes is buying");
  });

});

describe("⭐ THE HOMEWORK IS THE WORK, AND IT WAS INVISIBLE", () => {
  // The grounded mode — the default is the everything-null state, which is the
  // OTHER thing this panel has to survive and is covered by the smoke block.
  beforeEach(() => {
    h.mode = "data";
  });

  it("shows what she found when nothing is live yet", async () => {
    const Page = (await import("../page")).default;
    const html = renderToString(createElement(Page));

    // Counts a founder can weigh — proof she has been working at all.
    expect(html).toContain("ideas banked");
    expect(html).toContain("51");
    expect(html).toContain("accounts watched");

    /**
     * ⭐ The days-running number IS the argument: an ad alive for weeks is one
     * somebody pays every morning to keep alive.
     *
     * ⚠️ Asserted in parts. React SSR inserts a `<!-- -->` separator between an
     * expression and the text beside it, so the rendered markup is
     * `60<!-- -->d live` — matching the visible string would fail on a panel
     * that is rendering perfectly.
     */
    expect(html).toContain("mc-ad-days");
    expect(html).toContain("60");
    expect(html).toContain("d live");
    expect(html).toContain("madgicx.com");

    // The link, so they can judge the ad themselves rather than take her word.
    expect(html).toContain("https://www.facebook.com/ads/library?id=1");

    // Their buyers' own words — the whole point of the niche work.
    expect(html).toContain("ads not converting");
  });

  it("⭐ and shows what she DID, in the founder's language", async () => {
    /**
     * From the spend ledger, which records work that actually happened and
     * cannot be padded. The founder's question, verbatim, was "so are you still
     * doing stuff or" — while 111 cost events sat unread.
     */
    const Page = (await import("../page")).default;
    const html = renderToString(createElement(Page));
    expect(html).toContain("What she&#x27;s been doing");
    expect(html).toContain("worked out which shapes are landing");
    // ⚠️ Never our vocabulary — no purpose slugs leak through.
    expect(html).not.toContain("trend_shape");
    expect(html).not.toContain("complaint_mining");
  });
});
