import { describe, expect, it } from "vitest";
import { planTikTokWarmup } from "../tiktokWarmup";

describe("TikTok account warm-up planning", () => {
  it("requires warm-up for new or unchecked TikTok accounts", () => {
    const plan = planTikTokWarmup({
      canPostTikTokManually: true,
      existingTikTokUrl: "https://www.tiktok.com/@newapp",
      tiktokWarmupState: "new_needs_warmup",
      tiktokAccountAgeDays: 2,
      tiktokAccountStatusChecked: false,
      maxWeeklyVisualPosts: 5,
    });

    expect(plan.status).toBe("warmup_required");
    expect(plan.postingCapPerWeek).toBe(2);
    expect(plan.checklist.join(" ")).toContain("Account Check");
    expect(plan.checklist.join(" ")).toContain("Avoid bulk");
  });

  it("blocks TikTok when account restrictions are reported", () => {
    const plan = planTikTokWarmup({
      canPostTikTokManually: true,
      tiktokWarmupState: "restricted",
      tiktokAccountAgeDays: 30,
      tiktokAccountStatusChecked: true,
    });

    expect(plan.status).toBe("blocked");
    expect(plan.postingCapPerWeek).toBe(0);
    expect(plan.firstWeekCalendarTasks[0]).toContain("Account Check");
  });

  it("allows normal cadence when the account is explicitly ready", () => {
    const plan = planTikTokWarmup({
      canPostTikTokManually: true,
      existingTikTokUrl: "https://www.tiktok.com/@readyapp",
      tiktokWarmupState: "ready",
      tiktokAccountAgeDays: 60,
      tiktokAccountStatusChecked: true,
      maxWeeklyVisualPosts: 4,
    });

    expect(plan.status).toBe("ready");
    expect(plan.shouldWarmUp).toBe(false);
    expect(plan.postingCapPerWeek).toBe(4);
  });
});
