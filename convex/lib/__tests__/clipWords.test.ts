/**
 * Found by the product sim (2026-09-25): block titles cut mid-word ("turns into a half marath") and
 * mid-emoji (a week plan crashed on "🫠"), then pasted into her lines ("…in my car.," / "car..").
 * Categories: adversarial (emoji at the cut, punctuation at the end), coherence (never longer than asked + "…").
 */
import { describe, expect, it } from "vitest";
import { bare, clipWords } from "../clip";

describe("clipWords", () => {
  it("cuts at a word, drops trailing punctuation, marks the cut", () => {
    expect(clipWords("when your 'easy Sunday long run' accidentally turns into a half marathon", 60)).toBe("when your 'easy Sunday long run' accidentally turns into a…");
    expect(clipWords("short one", 60)).toBe("short one");
  });
  it("never splits an emoji at the cut", () => {
    const s = `${"x".repeat(58)} 🫠 more words here`;
    const out = clipWords(s, 60);
    expect(out.endsWith("…")).toBe(true);
    expect(/[\uD800-\uDBFF]…?$/.test(out.slice(0, -1))).toBe(false);
  });
  it("bare drops sentence punctuation so a quoted hook reads right", () => {
    expect(bare("i hit a new distance PR today and immediately cried in my car.")).toBe("i hit a new distance PR today and immediately cried in my car");
    expect(bare("  keep the emoji 🫠 ")).toBe("keep the emoji 🫠");
  });
});
