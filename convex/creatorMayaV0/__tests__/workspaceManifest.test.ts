import { describe, expect, it } from "vitest";
import {
  CREATOR_MAYA_V0_SKILL_SLUGS,
  buildCreatorMayaWorkspaceManifest,
} from "../workspaceManifest";

const input = {
  creatorId: "creator_1",
  timezone: "America/New_York",
  tiktokHandle: "maya_test",
  calendarConnected: true,
  imessagePaired: true,
  creatorPicture: {
    niche: "solo founder TikTok education",
    stage: "growing consistently",
    goal: "grow authority and get sponsor-ready",
    voiceFingerprint: "direct, useful, result-first",
    contentPillars: ["founder lessons", "building in public"],
    workingHooks: ["show the finished result first"],
    weakHooks: ["context before payoff"],
    scheduleConstraints: ["No filming before 10am"],
  },
};

describe("Creator Maya v0 OpenClaw workspace manifest", () => {
  it("emits the required OpenClaw workspace files", () => {
    const manifest = buildCreatorMayaWorkspaceManifest(input);

    expect(Object.keys(manifest.files)).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        "DREAMING.md",
        "HEARTBEAT.md",
        "jobs.json",
        "MEMORY.md",
        "SOUL.md",
        "TOOLS.md",
        "USER.md",
      ])
    );
  });

  it("installs the same Creator Maya skill pack for every workspace", () => {
    const manifest = buildCreatorMayaWorkspaceManifest(input);

    for (const slug of CREATOR_MAYA_V0_SKILL_SLUGS) {
      expect(manifest.files[`skills/${slug}/SKILL.md`]).toBeDefined();
    }
    expect(Object.keys(manifest.files)).toEqual(
      expect.arrayContaining([
        "skills/creator-tiktok-postmortem/SKILL.md",
        "skills/creator-trend-interpreter/SKILL.md",
        "skills/creator-calendar-content-planner/SKILL.md",
        "skills/creator-hook-memory/SKILL.md",
        "skills/creator-brand-category-finder/SKILL.md",
        "skills/creator-brand-fit-scorer/SKILL.md",
        "skills/creator-brand-contact-finder/SKILL.md",
        "skills/creator-pitch-drafter/SKILL.md",
        "skills/creator-brand-followup-manager/SKILL.md",
        "skills/creator-clip-composer/SKILL.md",
        "skills/creator-account-deletion-confirmation/SKILL.md",
      ])
    );
    expect(manifest.files["skills/creator-brand-fit-scorer/SKILL.md"]).toContain(
      "Score a brand candidate against the creator's audience"
    );
    expect(manifest.files["AGENTS.md"]).toContain(
      "All custom Creator Maya skills"
    );
  });

  it("locks v0 to iMessage and calendar-aware tools", () => {
    const manifest = buildCreatorMayaWorkspaceManifest(input);
    const all = Object.values(manifest.files).join("\n");

    expect(all).toContain("Primary channel: iMessage");
    expect(all).toContain("Stage: growing consistently");
    expect(all).toContain("Goal: grow authority and get sponsor-ready");
    expect(all).toContain("maya.send_imessage");
    expect(all).toContain("calendar.get_availability");
    expect(all).toContain("calendar.create_hold");
    expect(all).toContain("Do not use SMS, WhatsApp, email, or web chat in v0.");
    expect(all).toContain("brand.search_targets");
    expect(all).toContain("Brand tools are installed for every workspace");
    expect(all).toContain("media.compose_clip");
    expect(all).toContain("account.confirm_deletion");
    expect(all).toContain("DELETE MAYA");
  });

  it("refuses to deploy before calendar is connected", () => {
    expect(() =>
      buildCreatorMayaWorkspaceManifest({ ...input, calendarConnected: false })
    ).toThrow("connected calendar");
  });

  it("can emit the workspace before native iMessage pairing completes", () => {
    const manifest = buildCreatorMayaWorkspaceManifest({
      ...input,
      imessagePaired: false,
    });

    expect(manifest.files["USER.md"]).toContain("iMessage pairing: pending");
    expect(() =>
      buildCreatorMayaWorkspaceManifest({ ...input, imessagePaired: false })
    ).not.toThrow();
  });

  it("writes creator-local cron jobs for the daily and weekly loops", () => {
    const manifest = buildCreatorMayaWorkspaceManifest(input);
    const jobs = JSON.parse(manifest.files["jobs.json"]);

    expect(jobs.timezone).toBe("America/New_York");
    expect(jobs.jobs).toEqual(
      expect.arrayContaining([
        { name: "morning_brief", cron: "0 7 * * *" },
        { name: "performance_check_2h", cron: "0 8-22/2 * * *" },
        { name: "trend_scan", cron: "0 11 * * *" },
        { name: "weekly_plan", cron: "0 16 * * 0" },
        { name: "weekly_review", cron: "0 21 * * 0" },
      ])
    );
  });
});
