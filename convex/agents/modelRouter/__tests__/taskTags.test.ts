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
  // medium
  morning_brief: "medium",
  post_publish_reaction: "medium",
  weekly_content_plan: "medium",
  hook_library_build: "medium",
  rate_suggestion: "medium",
  // high
  brand_email_draft: "high",
  weekly_review_synth: "high",
  manager_readiness_packet: "high",
  contract_redflag_scan: "high",
  creator_picture_synthesis: "high",
  soul_generation: "high",
};

describe("taskTags / defaultThinkingBudget", () => {
  it("covers every defined task tag with the expected default budget", () => {
    for (const tag of TASK_TAGS) {
      expect(defaultThinkingBudget(tag)).toBe(EXPECTED[tag]);
    }
  });

  it("declares 16 task tags (5 low + 5 medium + 6 high)", () => {
    expect(TASK_TAGS).toHaveLength(16);
    const lows = TASK_TAGS.filter((t) => EXPECTED[t] === "low").length;
    const meds = TASK_TAGS.filter((t) => EXPECTED[t] === "medium").length;
    const highs = TASK_TAGS.filter((t) => EXPECTED[t] === "high").length;
    expect(lows).toBe(5);
    expect(meds).toBe(5);
    expect(highs).toBe(6);
  });

  it("throws on unknown task tag (strict — typos must surface)", () => {
    expect(() => defaultThinkingBudget("morning_breif")).toThrow(/Unknown Maya task tag/);
    expect(() => defaultThinkingBudget("")).toThrow();
    expect(() => defaultThinkingBudget("send_dm")).toThrow();
  });

  it("isTaskTag narrows correctly", () => {
    expect(isTaskTag("morning_brief")).toBe(true);
    expect(isTaskTag("not_a_tag")).toBe(false);
  });
});
