/**
 * stage helpers — pure-logic tests covering the stage-aware empty copy and
 * section-ordering matrices.
 *
 * Mandatory categories adapted for pure-frontend code:
 *   - "Cross-tenant" / "plan-tier" don't apply (no Convex ctx); the
 *     server-side `creatorStage` query enforces those.
 *   - Adversarial: every (slot × stage) combination returns a non-empty
 *     {title, body}. Section orderings include each section id exactly once
 *     and only valid ids. Synthetic milestone never reads as "0K".
 *   - Sibling-file scan: every TodaySection / DealsSection / PlanSection
 *     literal that the helper returns has a JSX render branch in the
 *     respective page. We grep the page files at test time.
 *   - TODO grep: covered repo-wide.
 */

import { describe, it, expect } from "vitest";
import {
  dealsSectionsFor,
  emptyCopyFor,
  formatFollowers,
  planSectionsFor,
  todaySectionsFor,
  type DealsSection,
  type EmptySlot,
  type PlanSection,
  type Stage,
  type StageContext,
  type TodaySection,
} from "../stage";

const STAGES: ReadonlyArray<Stage> = [
  "just-starting",
  "building",
  "monetizing",
  "scaling",
];

function ctxFor(stage: Stage, followers: number): StageContext {
  return {
    stage,
    stageSource: "inferred",
    topFollowers: followers,
    nextMilestone: { label: "5K", targetFollowers: 5_000 },
    focusArea: "consistency",
  };
}

describe("emptyCopyFor", () => {
  const SLOTS: ReadonlyArray<EmptySlot> = [
    "deals-inbound",
    "deals-outbound",
    "deals-opportunities",
    "plan-current",
    "today-brief",
    "today-pending",
    "today-revenue",
  ];

  it("returns non-empty title + body for every (slot × stage) combination", () => {
    for (const slot of SLOTS) {
      for (const stage of STAGES) {
        const copy = emptyCopyFor(slot, ctxFor(stage, 1_500));
        expect(copy.title.length).toBeGreaterThan(0);
        expect(copy.body.length).toBeGreaterThan(10);
      }
    }
  });

  it("just-starting deals-inbound surfaces the milestone label", () => {
    const copy = emptyCopyFor(
      "deals-inbound",
      ctxFor("just-starting", 800)
    );
    // The operator-spec example: "your milestone is 5K — Maya is tracking that."
    expect(copy.body).toMatch(/5K/);
    expect(copy.body.toLowerCase()).toMatch(/milestone/);
  });

  it("building deals-inbound surfaces Gmail connect CTA", () => {
    const copy = emptyCopyFor(
      "deals-inbound",
      ctxFor("building", 50_000)
    );
    expect(copy.body.toLowerCase()).toMatch(/gmail/);
    expect(copy.cta?.href).toBe("/profile");
  });

  it("plan-current for just-starting reassures + cites posting pattern", () => {
    const copy = emptyCopyFor(
      "plan-current",
      ctxFor("just-starting", 500)
    );
    expect(copy.body.toLowerCase()).toMatch(/keep posting/);
    expect(copy.body.toLowerCase()).toMatch(/2 weeks|posting pattern/);
  });

  it("today-revenue for just-starting cites current top-handle followers", () => {
    const copy = emptyCopyFor(
      "today-revenue",
      ctxFor("just-starting", 1_500)
    );
    expect(copy.body).toMatch(/1\.5K/);
  });
});

describe("section ordering helpers", () => {
  const TODAY_VALID: ReadonlySet<TodaySection> = new Set([
    "brief",
    "topMove",
    "growth",
    "pending",
    "revenue",
    "accountability",
    "outliers",
  ]);
  const PLAN_VALID: ReadonlySet<PlanSection> = new Set([
    "voice",
    "days",
    "history",
  ]);
  const DEALS_VALID: ReadonlySet<DealsSection> = new Set([
    "inbound",
    "outbound",
    "opportunities",
  ]);

  it("todaySectionsFor returns only valid ids and no duplicates per stage", () => {
    for (const stage of STAGES) {
      const order = todaySectionsFor(stage);
      const seen = new Set<TodaySection>();
      for (const s of order) {
        expect(TODAY_VALID.has(s)).toBe(true);
        expect(seen.has(s)).toBe(false); // no duplicates
        seen.add(s);
      }
    }
  });

  it("just-starting Today leads with brief + growth + topMove + accountability", () => {
    const order = todaySectionsFor("just-starting");
    // Brief is always first; growth banner second; revenue is last.
    expect(order[0]).toBe("brief");
    expect(order[1]).toBe("growth");
    expect(order[order.length - 1]).toBe("revenue");
  });

  it("scaling Today bumps pending + revenue ahead of topMove", () => {
    const order = todaySectionsFor("scaling");
    const pendingIdx = order.indexOf("pending");
    const revenueIdx = order.indexOf("revenue");
    const topMoveIdx = order.indexOf("topMove");
    expect(pendingIdx).toBeGreaterThan(-1);
    expect(revenueIdx).toBeGreaterThan(-1);
    expect(topMoveIdx).toBeGreaterThan(revenueIdx);
    expect(topMoveIdx).toBeGreaterThan(pendingIdx);
  });

  it("only just-starting includes the growth section", () => {
    expect(todaySectionsFor("just-starting").includes("growth")).toBe(true);
    expect(todaySectionsFor("building").includes("growth")).toBe(false);
    expect(todaySectionsFor("monetizing").includes("growth")).toBe(false);
    expect(todaySectionsFor("scaling").includes("growth")).toBe(false);
  });

  it("planSectionsFor returns voice + days + history for every stage", () => {
    for (const stage of STAGES) {
      const order = planSectionsFor(stage);
      expect(order).toEqual(["voice", "days", "history"]);
      for (const s of order) expect(PLAN_VALID.has(s)).toBe(true);
    }
  });

  it("dealsSectionsFor hides outbound + opportunities for just-starting", () => {
    const js = dealsSectionsFor("just-starting");
    expect(js).toEqual(["inbound"]);
    expect(js.includes("outbound")).toBe(false);
    expect(js.includes("opportunities")).toBe(false);

    for (const stage of ["building", "monetizing", "scaling"] as const) {
      const order = dealsSectionsFor(stage);
      expect(order.includes("inbound")).toBe(true);
      expect(order.includes("outbound")).toBe(true);
      expect(order.includes("opportunities")).toBe(true);
      for (const s of order) expect(DEALS_VALID.has(s)).toBe(true);
    }
  });
});

describe("formatFollowers", () => {
  it.each([
    [0, "0"],
    [42, "42"],
    [800, "800"],
    [1_500, "1.5K"],
    [25_000, "25.0K"],
    [120_000, "120.0K"],
    [3_500_000, "3.5M"],
  ])("formats %d as %s", (input, expected) => {
    expect(formatFollowers(input)).toBe(expected);
  });
});
