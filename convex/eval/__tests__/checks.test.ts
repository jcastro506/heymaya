/**
 * Sprint 3c named tests: an invented number is caught · every tell is caught · a leak is
 * caught · two questions are caught · a clean scout message passes every check.
 */
import { describe, expect, it } from "vitest";
import { numberGrounded, numbersIn, passed, runChecks } from "../checks";

const evidence = { ownPost: { views: 559925, multiple: 2.1 }, candidate: { url: "https://www.tiktok.com/@x/video/1", ratio: 6, ageHours: 9, lengthSec: 28 } };

describe("numbers", () => {
  it("finds the numbers a creator would read as metrics and skips counting words and years", () => {
    expect(numbersIn("your wnba post did 559,925 views, this is at 6× after 9h, keep it under 30s. three fixes. in 2026. 12k is a stretch")).toEqual(["559925", "6×", "12k"]);
  });
  it("grounds a number in any honest spelling", () => {
    const ev = JSON.stringify(evidence);
    expect(numberGrounded("559925", ev)).toBe(true);
    expect(numberGrounded("560k", ev)).toBe(true);
    expect(numberGrounded("6×", ev)).toBe(true);
    expect(numberGrounded("2.1x", ev)).toBe(true);
    expect(numberGrounded("12400", ev)).toBe(false);
    expect(numberGrounded("12k", ev)).toBe(false);
  });
});

describe("runChecks", () => {
  it("catches an invented number", () => {
    const c = runChecks({ text: "your last one did 12,400 views so this is a stretch", evidence, kind: "reply" });
    expect(c.find((x) => x.name === "numbers_grounded")?.pass).toBe(false);
    expect(passed(c)).toBe(false);
  });
  it("catches every tell", () => {
    const samples = ["great question!", "i'd be happy to help", "as an AI i can't", "i hope this helps", "your content strategy", "leverage the trend", "optimize the hook", "boost engagement", "real synergy here", "unlock growth", "a game-changer", "let's go 🚀"];
    for (const text of samples) expect(runChecks({ text, evidence, kind: "reply" }).find((x) => x.name === "no_tells")?.pass, text).toBe(false);
    expect(runChecks({ text: "the hook lands at 2 seconds, move the cut", evidence, kind: "reply" }).find((x) => x.name === "no_tells")?.pass).toBe(true);
  });
  it("catches two questions, bullets, and her name twice", () => {
    const c = runChecks({ text: "which one? or the other?\n- a\n- b\nmaya here, maya out", evidence, kind: "reply" });
    expect(c.find((x) => x.name === "one_question")?.pass).toBe(false);
    expect(c.find((x) => x.name === "no_bullets")?.pass).toBe(false);
    expect(c.find((x) => x.name === "name_once")?.pass).toBe(false);
  });
  it("catches a message that trails off, and a leaked draft label", () => {
    expect(runChecks({ text: "hey leah. looking through your setup now. the data on my end is still thin—only one clip came through the wire so far, the", evidence, kind: "reply" }).find((x) => x.name === "complete")?.pass).toBe(false);
    expect(runChecks({ text: "Refining word count & voice:**\n\nhey leah, maya here", evidence, kind: "reply" }).find((x) => x.name === "no_markdown")?.pass).toBe(false);
  });
  it("catches a reply that claims an action no tool took, and allows it on a routed management turn", () => {
    const text = "added @runwithcarly. tracking her now.";
    expect(runChecks({ text, evidence, kind: "reply", actionTaken: false }).find((x) => x.name === "no_claimed_action")?.pass).toBe(false);
    expect(runChecks({ text, evidence, kind: "reply", actionTaken: true }).find((x) => x.name === "no_claimed_action")).toBeUndefined();
  });
  it("a clean scout message passes every check", () => {
    const text = "@x just posted a list that's at 6× their normal after 9h. your wnba post did 559,925 views on the same directness, so this is yours to take. your version: open on the shoe rack, keep it under 30s. want the shot list? https://www.tiktok.com/@x/video/1";
    const c = runChecks({ text, evidence, kind: "scout" });
    expect(c.filter((x) => !x.pass)).toEqual([]);
  });
});
