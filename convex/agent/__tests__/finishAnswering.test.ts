/**
 * Answer what was asked (2026-11-02). Adina asked "which sound should i use" and got a reaction, three
 * captions and a sound, four times; one review named a sound she was never shown ("Cafe Mariposa isn't
 * cleared…"); another ran two sentences together ("incredible The pacing").
 */
import { describe, expect, it } from "vitest";
import { answeringOf, finishText, joinLines, noteFor } from "../finish";

const caps = [{ text: "dress reveal at msg", shape: "their-usual", why: "" }, { text: "would you wear this", shape: "question", why: "" }, { text: "diy halloween costume", shape: "search", why: "" }];
const sound = (name: string, clipId = "") => ({ name, clipId, platform: "tiktok", source: "trending", why: "it's spooky", howToUse: "start it on the reveal" });

describe("the shape follows the question", () => {
  it("a sound question gets only the sound", () => {
    const t = finishText({ answering: "sound", reaction: "the dress is incredible", captions: caps, sounds: [sound("Thriller by Michael Jackson", "1")] });
    expect(t).toContain("Thriller");
    expect(t).not.toMatch(/caption/i);
    expect(t).not.toContain("incredible");
  });
  it("a caption question gets the three captions and no sound", () => {
    const t = finishText({ answering: "caption", reaction: "x", captions: caps, sounds: [sound("Thriller", "1")] });
    expect(t).toContain("1. dress reveal at msg");
    expect(t).toContain("3. diy halloween costume");
    expect(t).not.toContain("Thriller");
  });
  it("which one: the pick, in one text", () => {
    const t = finishText({ answering: "which", pickLine: "the second one, the reveal lands harder", reaction: "x", captions: caps, sounds: [sound("Thriller", "1")] });
    expect(t).toBe("the second one, the reveal lands harder");
  });
  it("nothing asked: reaction, ONE caption, ONE sound, never more than three texts", () => {
    const t = finishText({ reaction: "the dress is incredible", read: "The pacing works", captions: caps, sounds: [sound("Thriller", "1"), sound("Housewife by Tate McRae", "2")] });
    const parts = t.split("\n---\n");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("the dress is incredible. The pacing works");
    expect(parts[1]).toBe("caption: dress reveal at msg");
    expect(t).not.toContain("Housewife");
  });
  it("an unknown answering falls back to the full review", () => {
    expect(answeringOf("everything")).toBe("full");
    expect(answeringOf("sound")).toBe("sound");
  });
});

describe("no orphan lines", () => {
  it("a note about a sound she didn't show is dropped", () => {
    const shown = [sound("Nicole Kidman by Unknown")];
    const all = [...shown, sound("Cafe Mariposa by Someone")];
    expect(noteFor("Cafe Mariposa isn't cleared for business accounts", shown, all)).toBe("");
    expect(noteFor("turn on the paid partnership label", shown, all)).toBe("turn on the paid partnership label");
  });
  it("two of her lines get the full stop between them, once", () => {
    expect(joinLines("the dress is actually incredible", "The pacing is great")).toBe("the dress is actually incredible. The pacing is great");
    expect(joinLines("so good!", "The pacing")).toBe("so good! The pacing");
    expect(joinLines("so good 😭", "The pacing")).toBe("so good 😭 The pacing");
    expect(joinLines("", "only this")).toBe("only this");
  });
});
