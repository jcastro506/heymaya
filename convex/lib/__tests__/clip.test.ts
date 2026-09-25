/** clip never leaves half an emoji (a lone surrogate makes Convex reject the whole value). */
import { describe, expect, it } from "vitest";
import { clip } from "../clip";

describe("clip", () => {
  it("cuts before an emoji rather than through it", () => {
    const cut = clip("legs are gone \u{1F62D} lol", 15);
    expect(cut).toBe("legs are gone ");
    expect(/[\uD800-\uDBFF]$/.test(cut)).toBe(false);
  });
  it("leaves plain text and whole emoji alone", () => {
    expect(clip("hello", 3)).toBe("hel");
    expect(clip("hi \u{1F62D}", 10)).toBe("hi \u{1F62D}");
  });
});
