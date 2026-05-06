import { describe, it, expect } from "vitest";
import {
  TASK_TAGS,
  defaultThinkingBudget,
  isTaskTag,
  type TaskTag,
} from "../taskTags";
import type { ThinkingBudget } from "../../../lib/planFeatures";

const EXPECTED: Record<TaskTag, ThinkingBudget> = {
  // none / low
  chat_reply: "low",
  comment_triage: "low",
  accountability_nudge: "low",
  niche_scan: "low",
  evening_recap: "low",
  heartbeat_tick: "low",
  revenue_snapshot: "low",
  // medium
  morning_brief: "medium",
  post_publish_reaction: "medium",
  hook_library_build: "medium",
  rate_suggestion: "medium",
  picture_verification: "medium",
  // high
  brand_email_draft: "high",
  weekly_review_synth: "high",
  weekly_content_plan: "high",
  manager_readiness_packet: "high",
  contract_redflag_scan: "high",
  creator_picture_synthesis: "high",
  soul_generation: "high",
  pre_post_scorer: "high",
  underperformance_diagnoser: "high",
};

describe("taskTags / defaultThinkingBudget", () => {
  it("covers every defined task tag with the expected default budget", () => {
    for (const tag of TASK_TAGS) {
      expect(defaultThinkingBudget(tag)).toBe(EXPECTED[tag]);
    }
  });

  it("declares 21 task tags (7 low + 5 medium + 9 high) — Sprint 3 Slice 2 additions", () => {
    expect(TASK_TAGS).toHaveLength(21);
    const lows = TASK_TAGS.filter((t) => EXPECTED[t] === "low").length;
    const meds = TASK_TAGS.filter((t) => EXPECTED[t] === "medium").length;
    const highs = TASK_TAGS.filter((t) => EXPECTED[t] === "high").length;
    expect(lows).toBe(7);
    expect(meds).toBe(5);
    expect(highs).toBe(9);
  });

  it("Sprint 3 Slice 2 additions: heartbeat_tick=low, pre_post_scorer=high, underperformance_diagnoser=high, picture_verification=medium, revenue_snapshot=low", () => {
    expect(defaultThinkingBudget("heartbeat_tick")).toBe("low");
    expect(defaultThinkingBudget("pre_post_scorer")).toBe("high");
    expect(defaultThinkingBudget("underperformance_diagnoser")).toBe("high");
    expect(defaultThinkingBudget("picture_verification")).toBe("medium");
    expect(defaultThinkingBudget("revenue_snapshot")).toBe("low");
  });

  it("weekly_content_plan promoted to high (Sprint 3 Slice 2 — Sunday plan drives the whole week)", () => {
    expect(defaultThinkingBudget("weekly_content_plan")).toBe("high");
  });

  it("throws on unknown task tag (strict — typos must surface)", () => {
    expect(() => defaultThinkingBudget("morning_breif")).toThrow(/Unknown Maya task tag/);
    expect(() => defaultThinkingBudget("")).toThrow();
    expect(() => defaultThinkingBudget("send_dm")).toThrow();
  });

  it("isTaskTag narrows correctly", () => {
    expect(isTaskTag("morning_brief")).toBe(true);
    expect(isTaskTag("not_a_tag")).toBe(false);
    expect(isTaskTag("heartbeat_tick")).toBe(true);
  });
});
