import { describe, expect, it } from "vitest";
import { respectEmojiHabit } from "../scout";

describe("scout voice habits", () => {
  it("removes emoji when the creator's measured voice uses none", () => {
    expect(respectEmojiHabit("that hill switch got me 😭\n---\nfilm it", "- 0% use an emoji")).toBe("that hill switch got me\n---\nfilm it");
  });

  it("keeps emoji when zero use is not established", () => {
    expect(respectEmojiHabit("the dog 😭", "- 20% use an emoji")).toBe("the dog 😭");
  });
});
