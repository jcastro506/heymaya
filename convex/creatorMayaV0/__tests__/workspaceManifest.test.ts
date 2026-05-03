import { describe, expect, it } from "vitest";
import { CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILL_SLUGS } from "../pinnedClawhubSkills";
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
      const body = manifest.files[`skills/${slug}/SKILL.md`];
      expect(body).toBeDefined();
      expect(body).toMatch(
        new RegExp(
          `^---\\nname: ${slug}\\ndescription: "[^"\\n]+"\\n---\\n\\n# `
        )
      );
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
        "skills/creator-media-librarian/SKILL.md",
        "skills/creator-clip-composer/SKILL.md",
        "skills/creator-tiktok-draft-handoff/SKILL.md",
        "skills/creator-account-deletion-confirmation/SKILL.md",
      ])
    );
    expect(manifest.files["skills/creator-brand-fit-scorer/SKILL.md"]).toContain(
      "Score a brand candidate against the creator's audience"
    );
    expect(manifest.files["AGENTS.md"]).toContain(
      "All custom Creator Maya skills and pinned ClawHub skills"
    );
  });

  it("vendors pinned ClawHub skills into every OpenClaw workspace", () => {
    const manifest = buildCreatorMayaWorkspaceManifest(input);
    const lock = JSON.parse(manifest.files[".clawhub/lock.json"]);

    expect(Object.keys(lock.skills).sort()).toEqual(
      [...CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILL_SLUGS].sort()
    );
    expect(lock.skills["remotion-video-toolkit"].version).toBe("1.4.0");
    expect(lock.skills.tiktok.version).toBe("3.0.0");
    expect(
      manifest.files["skills/remotion-video-toolkit/SKILL.md"]
    ).toContain("name: remotion-video-toolkit");
    expect(manifest.files["skills/tiktok/SKILL.md"]).toContain("name: tiktok");
    expect(
      manifest.files["skills/remotion-video-toolkit/rules/display-captions.md"]
    ).toContain("TikTok-style");
    expect(manifest.files["skills/tiktok/references/hooks.md"]).toContain(
      "Hook"
    );
    expect(manifest.files["TOOLS.md"]).toContain(
      "remotion-video-toolkit@1.4.0"
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
    expect(all).toContain("trend candidates from the daily trend scan");
    expect(all).toContain(
      "Cross-check each content opportunity against the creator's niche"
    );
    expect(all).toContain("Do not use SMS, WhatsApp, email, or web chat in v0.");
    expect(all).toContain("brand.search_targets");
    expect(all).toContain("Brand tools are installed for every workspace");
    expect(all).toContain("media.ingest_creator_asset");
    expect(all).toContain("media.catalog_creator_asset");
    expect(all).toContain("media.search_creator_assets");
    expect(all).toContain("media.record_tiktok_draft_handoff");
    expect(all).toContain("User photos/videos must be saved");
    expect(all).toContain("Maya must not direct-post to TikTok");
    expect(all).toContain("media.compose_clip");
    expect(all).toContain("account.confirm_deletion");
    expect(all).toContain("DELETE MAYA");
  });

  it("keeps the custom creator skills specific enough for beta use cases", () => {
    const manifest = buildCreatorMayaWorkspaceManifest(input);

    expect(
      manifest.files["skills/creator-tiktok-postmortem/SKILL.md"]
    ).toContain("hook, retention path, visual pacing");
    expect(
      manifest.files["skills/creator-trend-interpreter/SKILL.md"]
    ).toContain("format, sound, edit pattern");
    expect(
      manifest.files["skills/creator-calendar-content-planner/SKILL.md"]
    ).toContain("what to film, when to film");
    expect(manifest.files["skills/creator-hook-memory/SKILL.md"]).toContain(
      "evidence strength"
    );
    expect(
      manifest.files["skills/creator-brand-fit-scorer/SKILL.md"]
    ).toContain("collaboration angle");
    expect(
      manifest.files["skills/creator-brand-contact-finder/SKILL.md"]
    ).toContain("partnership, influencer, PR");
    expect(manifest.files["skills/creator-pitch-drafter/SKILL.md"]).toContain(
      "No fabricated metrics"
    );
    expect(
      manifest.files["skills/creator-brand-followup-manager/SKILL.md"]
    ).toContain("usage rights");
    expect(
      manifest.files["skills/creator-media-librarian/SKILL.md"]
    ).toContain("creator-owned Convex media assets");
    expect(manifest.files["skills/creator-clip-composer/SKILL.md"]).toContain(
      "creatorMayaV0MediaAssets"
    );
    expect(manifest.files["skills/creator-clip-composer/SKILL.md"]).toContain(
      "Default to 9:16"
    );
    expect(
      manifest.files["skills/creator-tiktok-draft-handoff/SKILL.md"]
    ).toContain("upload-to-inbox");
    expect(
      manifest.files["skills/creator-tiktok-draft-handoff/SKILL.md"]
    ).toContain("Never use TikTok Direct Post in v0");
    expect(
      manifest.files["skills/creator-account-deletion-confirmation/SKILL.md"]
    ).toContain("same creator id, phone number");
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

    expect(jobs.jobs).toHaveLength(5);
    expect(jobs.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobId: "creator-maya-v0-morning_brief",
          entryId: "morning_brief",
          schedule: { kind: "cron", expr: "0 7 * * *", tz: "America/New_York" },
          sessionTarget: "isolated",
          payload: expect.objectContaining({ kind: "agentTurn" }),
        }),
        expect.objectContaining({
          entryId: "performance_check_2h",
          schedule: {
            kind: "cron",
            expr: "0 8-22/2 * * *",
            tz: "America/New_York",
          },
        }),
        expect.objectContaining({
          entryId: "trend_scan",
          schedule: { kind: "cron", expr: "0 11 * * *", tz: "America/New_York" },
        }),
        expect.objectContaining({
          entryId: "weekly_plan",
          schedule: { kind: "cron", expr: "0 16 * * 0", tz: "America/New_York" },
        }),
        expect.objectContaining({
          entryId: "weekly_review",
          schedule: { kind: "cron", expr: "0 21 * * 0", tz: "America/New_York" },
        }),
      ])
    );
    for (const job of jobs.jobs) {
      expect(job.delivery).toEqual(
        expect.objectContaining({
          mode: "announce",
          channel: "last",
          bestEffort: true,
        })
      );
    }
  });
});
