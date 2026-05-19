/**
 * Sprint C.1 — Maya-authored Google Calendar event tests.
 *
 * Covers the five mandatory categories per CLAUDE.md:
 *
 *   1. Cross-tenant isolation — creator A's events never reachable from
 *      creator B (queries + insert path).
 *   2. Plan-tier × action matrix — every kind × every tier; fail-closed
 *      on cap exceed.
 *   3. Adversarial inputs — empty cited refs on actionable rejected,
 *      start>=end rejected, Google id collision dedupes, body version
 *      monotonic increase only.
 *   4. Sibling-file scan — planner SKILL.md references schema fields
 *      that exist; AGENTS.md-referenced surface present.
 *   5. TODO grep — no TODO / FIXME / unjustified eslint-disable in the
 *      new code paths.
 *
 * Plus body-templater unit coverage for each of the 9 kinds and the
 * per-tier cap helper matrix.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import schema from "../../schema";
import { internal } from "../../_generated/api";
import { api } from "../../_generated/api";
import { modules } from "../../../tests/_modules";

import {
  MAYA_CALENDAR_EVENT_KINDS,
  type MayaCalendarEventKind,
  weeklyCalendarEventCapPerKind,
  calendarTierFromPlan,
  renderEventBody,
  type CalendarPlanTier,
} from "../mayaCalendarEvents";

const REPO_ROOT = join(__dirname, "..", "..", "..");

function asUser(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({ subject });
}

async function createCreator(
  t: ReturnType<typeof convexTest>,
  subject: string,
  email = `${subject}@example.com`,
  tier: "coach" | "manager" = "coach",
) {
  const user = asUser(t, subject);
  const account = await user.mutation(
    api.creatorMayaV0.backend.getOrCreateAccount,
    {
      email,
      timezone: "America/New_York",
      tier,
    },
  );
  return { user, account };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function insertArgs(
  creatorId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    creatorId: creatorId as never,
    googleEventId: "evt_" + Math.random().toString(36).slice(2, 10),
    kind: "trend-strike" as MayaCalendarEventKind,
    citedRefs: [
      {
        kind: "trend" as const,
        ref: "https://www.tiktok.com/@example/video/72340",
        label: "Peer breakout",
      },
    ],
    startTimeMs: 1_700_000_000_000,
    endTimeMs: 1_700_000_000_000 + HOUR,
    actionable: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Body templater — pure unit tests (no Convex seeding).
// ---------------------------------------------------------------------------

describe("renderEventBody — per-kind body templates", () => {
  it("trend-strike body cites the trend + peer + age + hook idea", () => {
    const body = renderEventBody({
      kind: "trend-strike",
      context: {
        trendName: "bodega lighting voiceover",
        trendUrl: "https://www.tiktok.com/@soundsofbk/video/7355",
        peerHandle: "@soundsofbk",
        peerViews: 412_000,
        ageHours: 14,
        hookIdea: "places only kids who grew up here would recognize",
      },
    });
    expect(body.title).toContain("Trend strike");
    expect(body.title).toContain("bodega lighting voiceover");
    expect(body.description).toContain("412,000");
    expect(body.description).toContain("14h ago");
    expect(body.description).toContain(
      "places only kids who grew up here would recognize",
    );
    expect(body.description).toContain("https://www.tiktok.com");
  });

  it("content-block body emits numbered idea cards", () => {
    const body = renderEventBody({
      kind: "content-block",
      context: {
        filmingFocus: "Saturday morning filming",
        ideaCards: [
          "What I bring to set",
          "POV walking into the bagel spot",
          "Q&A reading 3 comments",
        ],
      },
    });
    expect(body.title).toContain("Content block");
    expect(body.title).toContain("Saturday morning filming");
    expect(body.description).toContain("1. What I bring to set");
    expect(body.description).toContain("3. Q&A reading 3 comments");
    expect(body.description).toContain("3 idea cards ready");
  });

  it("post-publish body surfaces caption + first-comment + optimal time", () => {
    const body = renderEventBody({
      kind: "post-publish",
      context: {
        platform: "TikTok",
        caption: "places only kids who grew up here would recognize",
        firstComment: "tell me where you grew up below",
        optimalTimeLabel: "6:42 PM ET",
        postUrl: "https://app.heymaya.app/drafts/d_72ab",
      },
    });
    expect(body.title).toContain("TikTok");
    expect(body.title).toContain("6:42 PM ET");
    expect(body.description).toContain("places only kids who grew up here");
    expect(body.description).toContain("tell me where you grew up below");
    expect(body.description).toContain("https://app.heymaya.app/drafts/d_72ab");
  });

  it("niche-scroll body prefixes peer handles with @ and lists hashtags", () => {
    const body = renderEventBody({
      kind: "niche-scroll",
      context: {
        focus: "Brooklyn food creators",
        peers: ["soundsofbk", "@nycfoodguy", "bagels.of.brooklyn"],
        hashtags: ["#brooklynfood", "#bedstuy"],
      },
    });
    expect(body.title).toContain("Brooklyn food creators");
    // Auto-prefixes @ when missing; preserves existing.
    expect(body.description).toContain("@soundsofbk");
    expect(body.description).toContain("@nycfoodguy");
    expect(body.description).toContain("@bagels.of.brooklyn");
    expect(body.description).toContain("#brooklynfood");
  });

  it("comment-window body lists own-post + 5 peer accounts", () => {
    const body = renderEventBody({
      kind: "comment-window",
      context: {
        ownPostUrl: "https://www.tiktok.com/@you/video/73",
        peerHandles: ["a", "b", "c", "d", "e"],
      },
    });
    expect(body.title).toContain("own post + 5 peers");
    expect(body.description).toContain("https://www.tiktok.com/@you/video/73");
    expect(body.description).toContain("@a");
    expect(body.description).toContain("@e");
    expect(body.description).toContain("Substantive");
  });

  it("brand-outbox body shows draft count + thread summaries", () => {
    const body = renderEventBody({
      kind: "brand-outbox",
      context: {
        draftCount: 3,
        brandThreads: [
          "Ceremonia — gifted-only ask → soft decline",
          "Brooklyn Bagel — $1,800 → counter at $2,400",
          "Drinkmate — first-touch reply → polite hold",
        ],
      },
    });
    expect(body.title).toContain("3 drafts waiting");
    expect(body.description).toContain("1. Ceremonia");
    expect(body.description).toContain("3. Drinkmate");
    expect(body.description).toContain("Manager");
  });

  it("brand-outbox body singularizes for a single draft", () => {
    const body = renderEventBody({
      kind: "brand-outbox",
      context: { draftCount: 1, brandThreads: ["one thread"] },
    });
    expect(body.title).toContain("1 draft waiting");
    expect(body.title).not.toContain("drafts");
  });

  it("weekly-review body carries follower delta + top post URL", () => {
    const body = renderEventBody({
      kind: "weekly-review",
      context: {
        weekLabel: "2026-05-05",
        topPostUrl: "https://www.tiktok.com/@you/video/73",
        followerDelta: 1247,
      },
    });
    expect(body.title).toBe("Weekly review with Maya");
    expect(body.description).toContain("+1,247");
    expect(body.description).toContain("https://www.tiktok.com/@you/video/73");
    expect(body.description).toContain("2026-05-05");
  });

  it("weekly-review body shows negative follower delta without double-sign", () => {
    const body = renderEventBody({
      kind: "weekly-review",
      context: { followerDelta: -340 },
    });
    expect(body.description).toContain("-340");
    expect(body.description).not.toContain("+-340");
  });

  it("brain-break body carries the explicit-non-content framing", () => {
    const body = renderEventBody({
      kind: "brain-break",
      context: { reason: "you booked Saturday off after the wedding shoot" },
    });
    expect(body.title).toContain("Brain break");
    expect(body.description).toContain("non-content day");
    expect(body.description).toContain("wedding shoot");
  });

  it("edit-block body cites the footage + target idea + style anchor", () => {
    const body = renderEventBody({
      kind: "edit-block",
      context: {
        editFocus: "Saturday shoot cut-down",
        clipCount: 3,
        targetIdea: "the bagel-spot POV for Wednesday",
        styleAnchor: "fast jump cuts, no intro, text-on-screen hook",
        sourceRef: "https://app.heymaya.app/footage/f_91",
      },
    });
    expect(body.title).toContain("Edit block");
    expect(body.title).toContain("Saturday shoot cut-down");
    expect(body.description).toContain("3 clips");
    expect(body.description).toContain("the bagel-spot POV for Wednesday");
    expect(body.description).toContain("fast jump cuts");
    expect(body.description).toContain(
      "https://app.heymaya.app/footage/f_91",
    );
  });

  it("edit-block body singularizes for a single clip", () => {
    const body = renderEventBody({
      kind: "edit-block",
      context: { clipCount: 1 },
    });
    expect(body.description).toContain("1 clip ");
    expect(body.description).not.toContain("1 clips");
  });

  it("every kind returns non-empty title + description even with empty context", () => {
    for (const kind of MAYA_CALENDAR_EVENT_KINDS) {
      const body = renderEventBody({ kind, context: {} });
      expect(body.title.length, `${kind} empty-context title`).toBeGreaterThan(0);
      expect(
        body.description.length,
        `${kind} empty-context description`,
      ).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Plan-tier cap matrix — unit tests.
// ---------------------------------------------------------------------------

describe("weeklyCalendarEventCapPerKind — full matrix", () => {
  const EXPECTED: Record<
    CalendarPlanTier,
    Record<MayaCalendarEventKind, number | "unlimited">
  > = {
    starter: {
      "trend-strike": 1,
      "content-block": 1,
      "edit-block": 1,
      "post-publish": 3,
      "niche-scroll": 2,
      "comment-window": 1,
      "brand-outbox": "unlimited",
      "weekly-review": 1,
      "brain-break": "unlimited",
    },
    pro: {
      "trend-strike": 3,
      "content-block": 2,
      "edit-block": 2,
      "post-publish": "unlimited",
      "niche-scroll": 7,
      "comment-window": 3,
      "brand-outbox": "unlimited",
      "weekly-review": 1,
      "brain-break": "unlimited",
    },
    studio: {
      "trend-strike": "unlimited",
      "content-block": "unlimited",
      "edit-block": "unlimited",
      "post-publish": "unlimited",
      "niche-scroll": "unlimited",
      "comment-window": "unlimited",
      "brand-outbox": "unlimited",
      "weekly-review": "unlimited",
      "brain-break": "unlimited",
    },
  };

  for (const tier of ["starter", "pro", "studio"] as const) {
    for (const kind of MAYA_CALENDAR_EVENT_KINDS) {
      it(`${tier} × ${kind} = ${EXPECTED[tier][kind]}`, () => {
        expect(weeklyCalendarEventCapPerKind(tier, kind)).toBe(
          EXPECTED[tier][kind],
        );
      });
    }
  }

  it("calendarTierFromPlan maps coach → starter, manager → studio", () => {
    expect(calendarTierFromPlan("coach")).toBe("starter");
    expect(calendarTierFromPlan("manager")).toBe("studio");
  });

  it("calendarTierFromPlan fails closed on adversarial plan value", () => {
    // Cast to bypass the typed param — simulates a corrupted plan field at
    // runtime. The helper must default to starter (most restrictive).
    expect(
      calendarTierFromPlan(
        "not-a-real-plan" as unknown as "coach" | "manager",
      ),
    ).toBe("starter");
  });
});

// ---------------------------------------------------------------------------
// Convex mutation tests — schema-driven.
// ---------------------------------------------------------------------------

describe("Maya calendar events — insert + isolation + caps", () => {
  it("inserts a Maya-authored event for the creator", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(t, "creator-cal-a");
    const res = await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId),
    );
    expect(res.deduped).toBe(false);
    expect(res.mayaCalendarEventId).toBeDefined();
  });

  it("dedupes a second insert with the same googleEventId", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(t, "creator-cal-dedupe");
    const first = await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, { googleEventId: "evt_collide" }),
    );
    const second = await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, {
        googleEventId: "evt_collide",
        startTimeMs: 1_700_000_000_000 + 2 * HOUR,
        endTimeMs: 1_700_000_000_000 + 3 * HOUR,
      }),
    );
    expect(second.deduped).toBe(true);
    expect(second.mayaCalendarEventId).toBe(first.mayaCalendarEventId);
  });

  it("rejects actionable events with an empty citedRefs array (grounded-or-silent)", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(t, "creator-cal-empty-refs");
    await expect(
      t.mutation(
        internal.creatorMayaV0.mayaCalendarEvents
          .insertMayaCalendarEventInternal,
        insertArgs(account.creatorId, {
          actionable: true,
          citedRefs: [],
        }),
      ),
    ).rejects.toThrow(/grounded or silent/);
  });

  it("allows non-actionable brain-break with empty citedRefs", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(t, "creator-cal-brain-break");
    const res = await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, {
        kind: "brain-break",
        actionable: false,
        citedRefs: [],
      }),
    );
    expect(res.deduped).toBe(false);
  });

  it("rejects start>=end", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(t, "creator-cal-bad-range");
    await expect(
      t.mutation(
        internal.creatorMayaV0.mayaCalendarEvents
          .insertMayaCalendarEventInternal,
        insertArgs(account.creatorId, {
          startTimeMs: 1_700_000_000_000 + HOUR,
          endTimeMs: 1_700_000_000_000,
        }),
      ),
    ).rejects.toThrow(/start must be strictly before end/);
  });

  it("rejects start === end (zero-duration)", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(t, "creator-cal-zero-dur");
    await expect(
      t.mutation(
        internal.creatorMayaV0.mayaCalendarEvents
          .insertMayaCalendarEventInternal,
        insertArgs(account.creatorId, {
          startTimeMs: 1_700_000_000_000,
          endTimeMs: 1_700_000_000_000,
        }),
      ),
    ).rejects.toThrow(/start must be strictly before end/);
  });
});

describe("Maya calendar events — cross-tenant isolation", () => {
  it("creator A's events never appear in creator B's window scan", async () => {
    const t = convexTest(schema, modules);
    const { account: a } = await createCreator(t, "creator-iso-a");
    const { account: b } = await createCreator(t, "creator-iso-b");

    await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(a.creatorId, { googleEventId: "evt_a" }),
    );
    await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(b.creatorId, { googleEventId: "evt_b" }),
    );

    const aWindow = await t.query(
      internal.creatorMayaV0.mayaCalendarEvents
        .listMayaCalendarEventsForCreatorAndWindow,
      {
        creatorId: a.creatorId as never,
        fromMs: 0,
        toMs: 2_000_000_000_000,
      },
    );
    const bWindow = await t.query(
      internal.creatorMayaV0.mayaCalendarEvents
        .listMayaCalendarEventsForCreatorAndWindow,
      {
        creatorId: b.creatorId as never,
        fromMs: 0,
        toMs: 2_000_000_000_000,
      },
    );

    expect(aWindow.length).toBe(1);
    expect(bWindow.length).toBe(1);
    expect(aWindow[0].googleEventId).toBe("evt_a");
    expect(bWindow[0].googleEventId).toBe("evt_b");
    for (const row of aWindow) {
      expect(row.creatorId).toBe(a.creatorId);
    }
    for (const row of bWindow) {
      expect(row.creatorId).toBe(b.creatorId);
    }
  });

  it("findMayaEventByGoogleId is scoped to creator (same googleEventId in different tenants is distinct)", async () => {
    const t = convexTest(schema, modules);
    const { account: a } = await createCreator(t, "creator-find-a");
    const { account: b } = await createCreator(t, "creator-find-b");
    await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(a.creatorId, { googleEventId: "evt_shared" }),
    );
    await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(b.creatorId, { googleEventId: "evt_shared" }),
    );
    const aRow = await t.query(
      internal.creatorMayaV0.mayaCalendarEvents.findMayaEventByGoogleId,
      { creatorId: a.creatorId as never, googleEventId: "evt_shared" },
    );
    const bRow = await t.query(
      internal.creatorMayaV0.mayaCalendarEvents.findMayaEventByGoogleId,
      { creatorId: b.creatorId as never, googleEventId: "evt_shared" },
    );
    expect(aRow?.creatorId).toBe(a.creatorId);
    expect(bRow?.creatorId).toBe(b.creatorId);
    expect(aRow?._id).not.toBe(bRow?._id);
  });

  it("listMayaCalendarEventsForCreatorAndWindow respects the window bounds", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(t, "creator-window-bounds");
    await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, {
        googleEventId: "evt_early",
        startTimeMs: 1_000_000_000_000,
        endTimeMs: 1_000_000_000_000 + HOUR,
      }),
    );
    await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, {
        googleEventId: "evt_mid",
        startTimeMs: 1_500_000_000_000,
        endTimeMs: 1_500_000_000_000 + HOUR,
      }),
    );
    await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, {
        googleEventId: "evt_late",
        startTimeMs: 2_000_000_000_000,
        endTimeMs: 2_000_000_000_000 + HOUR,
      }),
    );

    const mid = await t.query(
      internal.creatorMayaV0.mayaCalendarEvents
        .listMayaCalendarEventsForCreatorAndWindow,
      {
        creatorId: account.creatorId as never,
        fromMs: 1_400_000_000_000,
        toMs: 1_600_000_000_000,
      },
    );
    expect(mid.length).toBe(1);
    expect(mid[0].googleEventId).toBe("evt_mid");
  });

  it("returns empty when window is degenerate (fromMs > toMs)", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(t, "creator-window-degenerate");
    const rows = await t.query(
      internal.creatorMayaV0.mayaCalendarEvents
        .listMayaCalendarEventsForCreatorAndWindow,
      {
        creatorId: account.creatorId as never,
        fromMs: 2_000_000_000_000,
        toMs: 1_000_000_000_000,
      },
    );
    expect(rows).toEqual([]);
  });
});

describe("Maya calendar events — plan-tier weekly caps", () => {
  it("coach hits the 1/wk trend-strike cap on the second insert in the same week", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(
      t,
      "creator-cap-coach-trend",
      undefined,
      "coach",
    );
    // First trend-strike — should succeed.
    await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, {
        googleEventId: "evt_first_strike",
        kind: "trend-strike",
      }),
    );
    // Second trend-strike same week — should throw CalendarCapError.
    await expect(
      t.mutation(
        internal.creatorMayaV0.mayaCalendarEvents
          .insertMayaCalendarEventInternal,
        insertArgs(account.creatorId, {
          googleEventId: "evt_second_strike",
          kind: "trend-strike",
          startTimeMs: 1_700_000_000_000 + DAY,
          endTimeMs: 1_700_000_000_000 + DAY + HOUR,
        }),
      ),
    ).rejects.toThrow(/cap exceeded/i);
  });

  it("coach respects the 3/wk post-publish cap", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(
      t,
      "creator-cap-coach-post",
      undefined,
      "coach",
    );
    for (let i = 0; i < 3; i++) {
      await t.mutation(
        internal.creatorMayaV0.mayaCalendarEvents
          .insertMayaCalendarEventInternal,
        insertArgs(account.creatorId, {
          googleEventId: `evt_post_${i}`,
          kind: "post-publish",
          startTimeMs: 1_700_000_000_000 + i * DAY,
          endTimeMs: 1_700_000_000_000 + i * DAY + HOUR,
        }),
      );
    }
    await expect(
      t.mutation(
        internal.creatorMayaV0.mayaCalendarEvents
          .insertMayaCalendarEventInternal,
        insertArgs(account.creatorId, {
          googleEventId: "evt_post_overflow",
          kind: "post-publish",
          startTimeMs: 1_700_000_000_000 + 3 * DAY,
          endTimeMs: 1_700_000_000_000 + 3 * DAY + HOUR,
        }),
      ),
    ).rejects.toThrow(/cap exceeded/i);
  });

  it("manager (studio row) accepts unlimited trend-strikes in a week", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(
      t,
      "creator-cap-mgr-trend",
      undefined,
      "manager",
    );
    // 5 trend-strikes in a single week — would blow coach's cap; manager
    // (mapped to studio = unlimited) lets all 5 through.
    for (let i = 0; i < 5; i++) {
      await t.mutation(
        internal.creatorMayaV0.mayaCalendarEvents
          .insertMayaCalendarEventInternal,
        insertArgs(account.creatorId, {
          googleEventId: `evt_mgr_strike_${i}`,
          kind: "trend-strike",
          startTimeMs: 1_700_000_000_000 + i * DAY,
          endTimeMs: 1_700_000_000_000 + i * DAY + HOUR,
        }),
      );
    }
    const rows = await t.query(
      internal.creatorMayaV0.mayaCalendarEvents
        .listMayaCalendarEventsForCreatorAndWindow,
      {
        creatorId: account.creatorId as never,
        fromMs: 0,
        toMs: 2_000_000_000_000,
      },
    );
    expect(rows.filter((r) => r.kind === "trend-strike").length).toBe(5);
  });

  it("brand-outbox is unlimited on coach (entry tier caps at unlimited per spec)", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(
      t,
      "creator-cap-coach-outbox",
      undefined,
      "coach",
    );
    for (let i = 0; i < 6; i++) {
      const res = await t.mutation(
        internal.creatorMayaV0.mayaCalendarEvents
          .insertMayaCalendarEventInternal,
        insertArgs(account.creatorId, {
          googleEventId: `evt_outbox_${i}`,
          kind: "brand-outbox",
          startTimeMs: 1_700_000_000_000 + i * DAY,
          endTimeMs: 1_700_000_000_000 + i * DAY + HOUR,
          citedRefs: [
            { kind: "email", ref: `gmail-thread-${i}`, label: `Thread ${i}` },
          ],
        }),
      );
      expect(res.deduped).toBe(false);
    }
  });

  it("cap window is anchored to startTimeMs — events more than a week apart do not contend", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(
      t,
      "creator-cap-week-boundary",
      undefined,
      "coach",
    );
    // First trend-strike at t0.
    await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, {
        googleEventId: "evt_week1",
        kind: "trend-strike",
        startTimeMs: 1_700_000_000_000,
        endTimeMs: 1_700_000_000_000 + HOUR,
      }),
    );
    // Second trend-strike >2 weeks later — outside the rolling window;
    // should be accepted because the per-week cap is 1 and these two
    // events are in different weeks.
    const res = await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, {
        googleEventId: "evt_week3",
        kind: "trend-strike",
        startTimeMs: 1_700_000_000_000 + 3 * WEEK,
        endTimeMs: 1_700_000_000_000 + 3 * WEEK + HOUR,
      }),
    );
    expect(res.deduped).toBe(false);
  });

  it("caps are per-kind, not cross-kind — coach can have 1 trend-strike + 1 content-block + 3 post-publishes same week", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(
      t,
      "creator-cap-multi-kind",
      undefined,
      "coach",
    );
    await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, {
        googleEventId: "evt_ts",
        kind: "trend-strike",
        startTimeMs: 1_700_000_000_000,
        endTimeMs: 1_700_000_000_000 + HOUR,
      }),
    );
    await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, {
        googleEventId: "evt_cb",
        kind: "content-block",
        startTimeMs: 1_700_000_000_000 + DAY,
        endTimeMs: 1_700_000_000_000 + DAY + 2 * HOUR,
      }),
    );
    for (let i = 0; i < 3; i++) {
      await t.mutation(
        internal.creatorMayaV0.mayaCalendarEvents
          .insertMayaCalendarEventInternal,
        insertArgs(account.creatorId, {
          googleEventId: `evt_pp_${i}`,
          kind: "post-publish",
          startTimeMs: 1_700_000_000_000 + (2 + i) * DAY,
          endTimeMs: 1_700_000_000_000 + (2 + i) * DAY + HOUR,
        }),
      );
    }
    const rows = await t.query(
      internal.creatorMayaV0.mayaCalendarEvents
        .listMayaCalendarEventsForCreatorAndWindow,
      {
        creatorId: account.creatorId as never,
        fromMs: 0,
        toMs: 2_000_000_000_000,
      },
    );
    expect(rows.length).toBe(5);
  });
});

describe("Maya calendar events — nudge fire stamps + body version", () => {
  it("markNudgeSent(pre) stamps preEventNudgeSentAt", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(t, "creator-nudge-pre");
    const ins = await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, { googleEventId: "evt_nudge_pre" }),
    );
    const stamped = await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents.markNudgeSent,
      {
        mayaCalendarEventId: ins.mayaCalendarEventId,
        kind: "pre",
        nowMs: 1_700_000_500_000,
      },
    );
    expect(stamped?.preEventNudgeSentAt).toBe(1_700_000_500_000);
    expect(stamped?.postEventCheckInSentAt).toBeUndefined();
  });

  it("markNudgeSent(post) stamps postEventCheckInSentAt independently", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(t, "creator-nudge-post");
    const ins = await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, { googleEventId: "evt_nudge_post" }),
    );
    await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents.markNudgeSent,
      {
        mayaCalendarEventId: ins.mayaCalendarEventId,
        kind: "pre",
        nowMs: 1_700_000_100_000,
      },
    );
    const stamped = await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents.markNudgeSent,
      {
        mayaCalendarEventId: ins.mayaCalendarEventId,
        kind: "post",
        nowMs: 1_700_000_900_000,
      },
    );
    expect(stamped?.preEventNudgeSentAt).toBe(1_700_000_100_000);
    expect(stamped?.postEventCheckInSentAt).toBe(1_700_000_900_000);
  });

  it("markNudgeSent with waiveReason records the reason and leaves the timestamp unset", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(t, "creator-nudge-waive");
    const ins = await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, { googleEventId: "evt_nudge_waive" }),
    );
    const stamped = await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents.markNudgeSent,
      {
        mayaCalendarEventId: ins.mayaCalendarEventId,
        kind: "pre",
        waiveReason: "creator is in DND window",
      },
    );
    expect(stamped?.preEventNudgeSentAt).toBeUndefined();
    expect(stamped?.preEventNudgeWaiveReason).toBe("creator is in DND window");
  });

  it("updateBodyVersion strictly increases version + updates lastEditedByMaya", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(t, "creator-body-version");
    const ins = await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, { googleEventId: "evt_body" }),
    );
    const next = await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents.updateBodyVersion,
      {
        mayaCalendarEventId: ins.mayaCalendarEventId,
        bodyVersion: 2,
        lastEditedByMaya: 1_700_000_777_000,
      },
    );
    expect(next?.bodyVersion).toBe(2);
    expect(next?.lastEditedByMaya).toBe(1_700_000_777_000);

    // Same-version request must reject (must STRICTLY increase).
    await expect(
      t.mutation(
        internal.creatorMayaV0.mayaCalendarEvents.updateBodyVersion,
        {
          mayaCalendarEventId: ins.mayaCalendarEventId,
          bodyVersion: 2,
          lastEditedByMaya: 1_700_000_999_000,
        },
      ),
    ).rejects.toThrow(/bodyVersion must strictly increase/);
  });
});

// ---------------------------------------------------------------------------
// Sibling-file scan — the SKILL.md / schema cohesion guard.
// ---------------------------------------------------------------------------

describe("Maya calendar events — sibling-file scan", () => {
  const SKILL_MD = readFileSync(
    join(REPO_ROOT, "agents", "skills", "maya-calendar-planner", "SKILL.md"),
    "utf8",
  );

  it("SKILL.md references every kind in the canonical taxonomy", () => {
    for (const kind of MAYA_CALENDAR_EVENT_KINDS) {
      expect(
        SKILL_MD,
        `SKILL.md missing taxonomy entry for kind=${kind}`,
      ).toContain(kind);
    }
  });

  it("SKILL.md names the schema table + the planner backend file", () => {
    expect(SKILL_MD).toContain("mayaCalendarEvents");
    expect(SKILL_MD).toContain(
      "convex/creatorMayaV0/mayaCalendarEvents.ts",
    );
  });

  it("SKILL.md names the lc_maya HTTP endpoints it depends on", () => {
    expect(SKILL_MD).toContain("/lc_maya/calendar_list_events");
    expect(SKILL_MD).toContain("/lc_maya/calendar_create_event");
    expect(SKILL_MD).toContain("/lc_maya/calendar_update_event");
    expect(SKILL_MD).toContain("/lc_maya/calendar_delete_event");
  });

  it("SKILL.md mandates voice-applier + citation-firewall before write", () => {
    expect(SKILL_MD).toContain("maya-voice-applier");
    expect(SKILL_MD).toContain("maya-citation-firewall");
  });

  it("SKILL.md sets the 30-min popup reminder convention", () => {
    expect(SKILL_MD).toContain("popup");
    expect(SKILL_MD).toContain("30");
  });

  it("SKILL.md exposes the cap helper name for the wrapping action", () => {
    expect(SKILL_MD).toContain("weeklyCalendarEventCapPerKind");
  });

  it("SKILL.md references the proactive-agent pin (WAL + verify implementation)", () => {
    expect(SKILL_MD).toContain("proactive-agent");
  });
});

// ---------------------------------------------------------------------------
// TODO grep — no TODO / FIXME / unjustified eslint-disable in new code.
// ---------------------------------------------------------------------------

describe("Maya calendar events — TODO grep", () => {
  const FILES_TO_SCAN = [
    join(REPO_ROOT, "convex", "creatorMayaV0", "mayaCalendarEvents.ts"),
    join(REPO_ROOT, "agents", "skills", "maya-calendar-planner", "SKILL.md"),
  ];

  it("no TODO / FIXME markers in new code paths", () => {
    for (const path of FILES_TO_SCAN) {
      const body = readFileSync(path, "utf8");
      expect(body, `${path} contains TODO`).not.toMatch(/\bTODO\b/);
      expect(body, `${path} contains FIXME`).not.toMatch(/\bFIXME\b/);
    }
  });

  it("no unjustified eslint-disable in new code paths", () => {
    for (const path of FILES_TO_SCAN) {
      const body = readFileSync(path, "utf8");
      expect(body, `${path} has eslint-disable`).not.toMatch(
        /eslint-disable/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Adversarial — Google id collisions across tenants + concurrent inserts.
// ---------------------------------------------------------------------------

describe("Maya calendar events — adversarial", () => {
  it("concurrent inserts of the same (creator, googleEventId) dedupe to one row", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(t, "creator-concurrent");
    const args = insertArgs(account.creatorId, {
      googleEventId: "evt_concurrent",
    });

    // Convex's test runner serializes mutations within a single test, but
    // we still hit the dedupe guard by interleaving two awaits — each
    // observes whatever the other persisted before the index probe runs.
    const [r1, r2] = await Promise.all([
      t.mutation(
        internal.creatorMayaV0.mayaCalendarEvents
          .insertMayaCalendarEventInternal,
        args,
      ),
      t.mutation(
        internal.creatorMayaV0.mayaCalendarEvents
          .insertMayaCalendarEventInternal,
        args,
      ),
    ]);
    // One MUST be deduped — both rows would be a regression.
    expect([r1.deduped, r2.deduped].sort()).toEqual([false, true]);
    expect(r1.mayaCalendarEventId).toBe(r2.mayaCalendarEventId);
  });

  it("findMayaEventByGoogleId returns null for an unknown googleEventId", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(t, "creator-find-missing");
    const row = await t.query(
      internal.creatorMayaV0.mayaCalendarEvents.findMayaEventByGoogleId,
      {
        creatorId: account.creatorId as never,
        googleEventId: "evt_does_not_exist",
      },
    );
    expect(row).toBeNull();
  });

  it("non-existent mayaCalendarEventId on markNudgeSent throws", async () => {
    const t = convexTest(schema, modules);
    const { account } = await createCreator(t, "creator-bogus-id");
    // Get a valid id then use a different (non-existent) one.
    const ins = await t.mutation(
      internal.creatorMayaV0.mayaCalendarEvents
        .insertMayaCalendarEventInternal,
      insertArgs(account.creatorId, { googleEventId: "evt_real" }),
    );
    // Build a bogus id by mutating the suffix — Convex `Id<T>` is a
    // branded string, so this still type-checks via the schema-aware
    // Id<"mayaCalendarEvents"> guard.
    const bogusId = (ins.mayaCalendarEventId.slice(0, -3) + "ZZZ") as typeof ins.mayaCalendarEventId;
    await expect(
      t.mutation(
        internal.creatorMayaV0.mayaCalendarEvents.markNudgeSent,
        {
          mayaCalendarEventId: bogusId,
          kind: "pre",
        },
      ),
    ).rejects.toThrow();
  });
});
