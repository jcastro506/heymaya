import { describe, it, expect } from "vitest";
import { buildDeepLink } from "../deepLink";

describe("buildDeepLink", () => {
  describe("X / Twitter — Tier 1 pre-fill", () => {
    it("new post pre-fills text", () => {
      const d = buildDeepLink("x", "post", {}, "hello world & co");
      expect(d.tier).toBe(1);
      expect(d.url).toBe("https://x.com/intent/post?text=hello%20world%20%26%20co");
    });
    it("reply pre-fills in_reply_to + text", () => {
      const d = buildDeepLink("x", "reply", { tweetId: "12345" }, "nice point");
      expect(d.tier).toBe(1);
      expect(d.url).toContain("in_reply_to=12345");
      expect(d.url).toContain("text=nice%20point");
    });
    it("reply without a tweetId degrades to a plain pre-filled post (no broken in_reply_to)", () => {
      const d = buildDeepLink("x", "reply", {}, "hey");
      expect(d.url).toBe("https://x.com/intent/post?text=hey");
      expect(d.url).not.toContain("in_reply_to");
    });
  });

  describe("Reddit", () => {
    it("post pre-fills submit with title + body, strips r/ prefix", () => {
      const d = buildDeepLink("reddit", "post", { subreddit: "r/SaaS", title: "my title" }, "body text");
      expect(d.tier).toBe(1);
      expect(d.url).toContain("/r/SaaS/submit?selftext=true");
      expect(d.url).toContain("title=my%20title");
      expect(d.url).toContain("text=body%20text");
    });
    it("comment opens the thread (Tier 2, paste)", () => {
      const d = buildDeepLink("reddit", "reply", { url: "https://reddit.com/r/x/comments/abc" }, "reply");
      expect(d.tier).toBe(2);
      expect(d.url).toBe("https://reddit.com/r/x/comments/abc");
    });
  });

  describe("Hacker News", () => {
    it("post pre-fills submitlink with u + t", () => {
      const d = buildDeepLink("hn", "post", { url: "https://myapp.com", title: "Show HN: my thing" }, "");
      expect(d.tier).toBe(1);
      expect(d.url).toContain("submitlink?u=https%3A%2F%2Fmyapp.com");
      expect(d.url).toContain("t=Show%20HN%3A%20my%20thing");
    });
    it("comment opens the item (Tier 2)", () => {
      const d = buildDeepLink("hn", "reply", { url: "https://news.ycombinator.com/item?id=42" }, "x");
      expect(d.tier).toBe(2);
      expect(d.url).toContain("item?id=42");
    });
  });

  it("Threads — Tier 1 pre-fill", () => {
    const d = buildDeepLink("threads", "post", {}, "ship it");
    expect(d.tier).toBe(1);
    expect(d.url).toBe("https://www.threads.net/intent/post?text=ship%20it");
  });

  describe("LinkedIn / Instagram / YouTube — Tier 2 (no pre-fill)", () => {
    it("LinkedIn comment opens the post, paste", () => {
      const d = buildDeepLink("linkedin", "reply", { url: "https://linkedin.com/posts/abc" }, "great");
      expect(d.tier).toBe(2);
      expect(d.url).toBe("https://linkedin.com/posts/abc");
      expect(d.instruction.toLowerCase()).toContain("paste");
    });
    it("Instagram falls back to the platform when no target url", () => {
      const d = buildDeepLink("instagram", "post", {}, "caption");
      expect(d.tier).toBe(2);
      expect(d.url).toBe("https://www.instagram.com/");
    });
    it("YouTube reply opens the video", () => {
      const d = buildDeepLink("youtube", "reply", { url: "https://youtube.com/watch?v=z" }, "c");
      expect(d.tier).toBe(2);
      expect(d.url).toBe("https://youtube.com/watch?v=z");
    });
  });

  it("every link is a valid absolute URL", () => {
    const cases: Array<Parameters<typeof buildDeepLink>> = [
      ["x", "post", {}, "a"],
      ["reddit", "post", { subreddit: "test", title: "t" }, "b"],
      ["hn", "post", { url: "https://a.com", title: "t" }, ""],
      ["threads", "post", {}, "c"],
      ["linkedin", "reply", { url: "https://linkedin.com/x" }, "d"],
    ];
    for (const c of cases) {
      const d = buildDeepLink(...c);
      expect(() => new URL(d.url)).not.toThrow();
    }
  });
});
