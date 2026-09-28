/**
 * The 2026-09-28 sims' text findings, pure: template holes in a draft, the actions that failed and
 * stayed failed (the critic's failedActions), and a post id in a plan line. Adversarial inputs included:
 * a link must survive whole, an email in angle brackets is not a hole, a view count is not an id.
 */
import { describe, expect, it } from "vitest";
import { placeholders } from "../../partnerships/pitch";
import { failedActions } from "../../agent/critic";
import { checkPlainLanguage, scrubPostIds } from "../plainLanguage";
import { clipWords } from "../../lib/clip";

describe("placeholders", () => {
  it("finds the holes the deals sim queued for approval", () => {
    expect(placeholders("my rate is [rate] for [usage window, e.g. 30 days organic usage].")).toEqual(["[rate]", "[usage window, e.g. 30 days organic usage]"]);
    expect(placeholders("hi {{first_name}}, TBD on dates")).toEqual(["{{first_name}}", "TBD"]);
  });
  it("leaves links, emails and plain prices alone", () => {
    expect(placeholders("kit: <https://hey-maya.ai/k/abc> · mail <team@brand.com> · $900 for 30 days")).toEqual([]);
  });
});

describe("failedActions", () => {
  it("a save that failed and never succeeded later is listed with its reason, not its stack", () => {
    const trace = [
      { tool: "partnership_research", ok: true, result: "{...}" },
      { tool: "partnership_update", ok: false, result: "failed: Uncaught Error: Evidence must come from recent research results\n    at handler (store.ts:178)" },
      { tool: "partnership_update", ok: false, result: "failed: Uncaught Error: Evidence must come from recent research results" },
    ];
    expect(failedActions(trace)).toEqual([
      { tool: "partnership_update", error: "failed: Uncaught Error: Evidence must come from recent research results" },
      { tool: "partnership_update", error: "failed: Uncaught Error: Evidence must come from recent research results" },
    ]);
  });
  it("a failure fixed later in the turn, or a failed read, is not listed", () => {
    expect(failedActions([{ tool: "partnership_draft", ok: false, result: "Keep the existing thread subject" }, { tool: "partnership_draft", ok: true }])).toEqual([]);
    expect(failedActions([{ tool: "web_read", ok: false, result: "404" }])).toEqual([]);
  });
});

describe("post ids", () => {
  it("never reach a plan line; links keep theirs", () => {
    expect(scrubPostIds("hits the effort vs pace debate, echoing 3469416464831006725_3077920201")).toBe("hits the effort vs pace debate, echoing one of your posts");
    expect(scrubPostIds("borrows the prep from your build in 3991900386226507399_3077920201 into a hook")).toBe("borrows the prep from your build in one of your posts into a hook");
    const link = "watch https://www.tiktok.com/@cam/video/7687918779531152643 first";
    expect(scrubPostIds(link)).toBe(link);
    expect(checkPlainLanguage(link).clean).toBe(link);
    expect(checkPlainLanguage("your post got 51200 views").ok).toBe(true);
    expect(checkPlainLanguage("like 7687918779531152643 did").redacted).toContain("post id");
  });
  it("titles are cut at a word, never mid-word", () => {
    expect(clipWords("Today I'm running the most miles of my entire life and I have to pretend", 60)).toBe("Today I'm running the most miles of my entire life and I…");
  });
});
