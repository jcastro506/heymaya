/**
 * Found by the product sim (2026-09-25): "pass on the "…" one, not for me" named an earlier idea, was
 * routed to drop_idea, and the LATEST idea took the change. A quote of another idea's words is about that
 * idea. Categories: adversarial (quotes, punctuation, curly quotes), sibling coherence with the classifier's rule.
 */
import { describe, expect, it } from "vitest";
import { quotesAnotherIdea } from "../converse";

describe("quotesAnotherIdea", () => {
  const latest = "Today we have 20 miles and I'm freaking out a little bit";
  it("a quote of an earlier idea is about that idea", () => {
    expect(quotesAnotherIdea('pass on the "the 5 minutes right after your watch stops" one, not for me', latest)).toBe(true);
    expect(quotesAnotherIdea("pass on the “mile 20 pacing mistake” one", latest)).toBe(true);
  });
  it("a quote of the latest idea, or no quote at all, is about the latest", () => {
    expect(quotesAnotherIdea('scrap the "today we have 20 miles" one', latest)).toBe(false);
    expect(quotesAnotherIdea("nah not that one", latest)).toBe(false);
    expect(quotesAnotherIdea('kill it "ok"', latest), "a short quote is not an idea's words").toBe(false);
  });
});
