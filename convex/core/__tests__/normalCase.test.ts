/** Normal capitalization in the one writer (operator, 2026-10-12): she writes like a person, links and handles untouched. */
import { describe, expect, it } from "vitest";
import { normalCase } from "../messages";

describe("normalCase", () => {
  it("capitalizes each line and sentence, and makes i into I", () => {
    expect(normalCase("got it, i'll stop texting you first.\n---\nif you only meant the comment picks, tell me. i'm always here."))
      .toBe("Got it, I'll stop texting you first.\n---\nIf you only meant the comment picks, tell me. I'm always here.");
    expect(normalCase("hey Adina! it's Maya 👋")).toBe("Hey Adina! It's Maya 👋");
    expect(normalCase("fri: the coffee walk (your hook). film around 5, post at 7")).toBe("Fri: the coffee walk (your hook). Film around 5, post at 7");
  });
  it("never touches links, emails, @handles or #hashtags", () => {
    expect(normalCase("https://staging.hey-maya.ai/m/abc")).toBe("https://staging.hey-maya.ai/m/abc");
    expect(normalCase("staging.hey-maya.ai/k/x is your kit")).toBe("staging.hey-maya.ai/k/x is your kit");
    expect(normalCase("@marlynlikethefish keeps showing up")).toBe("@marlynlikethefish keeps showing up");
    expect(normalCase("#ootd is everywhere")).toBe("#ootd is everywhere");
    expect(normalCase("it goes to creators@tracksmith.com. tell me once it's sent.")).toBe("It goes to creators@tracksmith.com. Tell me once it's sent.");
    expect(normalCase("open it: https://x.com/a. then send")).toBe("Open it: https://x.com/a. Then send");
  });
  it("leaves quotes, emoji-led lines and already-correct text alone", () => {
    expect(normalCase('"my honest taper week" is the caption')).toBe('"my honest taper week" is the caption');
    expect(normalCase("Already fine. Yes.")).toBe("Already fine. Yes.");
    expect(normalCase("😭 the dog at the tv")).toBe("😭 The dog at the tv");
    expect(normalCase("in the video i said hi")).toBe("In the video I said hi");
    expect(normalCase("this is it.")).toBe("This is it.");
  });
});
