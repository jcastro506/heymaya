import { describe, expect, it } from "vitest";
import {
  bannedPhrases,
  draftPlatformPost,
  evaluateDraftQuality,
} from "../contentQuality";

const evidence = [
  "Indie builders repeatedly ask for practical ways to get their first users without hiring a marketer.",
];

describe("GTM content quality", () => {
  it("drafts platform-native posts grounded in evidence", () => {
    const reddit = draftPlatformPost({
      platform: "reddit",
      productName: "ClawLaunch",
      channelThesis: "reply-first Reddit",
      evidenceSnippets: evidence,
      targetAction: "three user interviews",
    });

    expect(reddit).toContain("Not dropping a pitch");
    expect(reddit).toContain("first users");
    expect(evaluateDraftQuality({ draft: reddit, evidenceSnippets: evidence }).passed)
      .toBe(true);
  });

  it("drafts Instagram reuse briefs as manual carousel or Reel handoffs", () => {
    const instagram = draftPlatformPost({
      platform: "instagram",
      productName: "ClawLaunch",
      channelThesis: "reuse screenshot-led demos",
      evidenceSnippets: evidence,
      targetAction: "three beta signups",
    });

    expect(instagram).toContain("Carousel/Reel brief");
    expect(instagram).toContain("product screenshot or reused demo clip");
    expect(evaluateDraftQuality({ draft: instagram, evidenceSnippets: evidence }).passed)
      .toBe(true);
  });

  it("rejects banned AI-slop phrases", () => {
    const result = evaluateDraftQuality({
      draft:
        "ClawLaunch is a revolutionary game changer that will supercharge your launch.",
      evidenceSnippets: evidence,
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "banned phrase: game changer",
        "banned phrase: supercharge",
        "banned phrase: revolutionary",
      ])
    );
    expect(bannedPhrases()).toContain("leverage social media");
  });

  it("rejects unsupported claims even when the prose sounds polished", () => {
    const result = evaluateDraftQuality({
      draft:
        "I built ClawLaunch because finance teams need SOC2-ready compliance reporting in 5 minutes. Reply if you run procurement.",
      evidenceSnippets: evidence,
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toContain("draft is not grounded in provided evidence");
  });

  it("rejects thin generic drafts", () => {
    const result = evaluateDraftQuality({
      draft: "Post consistently and engage with your audience.",
      evidenceSnippets: evidence,
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "banned phrase: post consistently",
        "banned phrase: engage with your audience",
        "draft is too thin",
      ])
    );
  });
});
