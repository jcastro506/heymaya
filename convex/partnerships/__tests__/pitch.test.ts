/**
 * K1: the pitch's promises, by code. Categories: adversarial (invented numbers in every way people
 * write them, a generic subject, three questions, an attachment), fail-closed (a first pitch with no
 * kit link is refused; a scheduled send re-checks a relationship that closed overnight), sibling
 * coherence (the send window on their clock, across a weekend and a timezone).
 */
import { describe, expect, it } from "vitest";
import { backed, disclosureLine, kitNumbers, nextSendAt, performanceNumbers, pitchProblems, sendWhen, wordCount } from "../pitch";
import type { KitV2 } from "../kitData";

const KIT: KitV2 = {
  name: "sam", lane: "running", asOf: 0, photo: null, photoSetting: "auto", photoCheck: null, oneLine: null, showAudience: true, services: [], region: null, contactEmail: null, brandWork: [],
  platforms: [
    { platform: "instagram", handle: "sam", followers: 8050, followersAsOf: 0, normalViews: 9800, posts: 20, engagement: { perView: 0.061, perFollower: 0.021, posts: 12 }, growth30d: { net: 214, gained: null, lost: null }, audience: { source: "connected", asOf: 0, age: [{ label: "25-34", share: 0.41 }], gender: [{ label: "Women", share: 0.71 }], countries: [], cities: [] }, best: [{ url: "https://www.instagram.com/reel/a/", platform: "instagram", views: 31200, multiple: 3.1, caption: "", createTime: 0, cover: null }] },
    { platform: "tiktok", handle: "sam", followers: 2140, followersAsOf: 0, normalViews: 5100, posts: 10, engagement: null, growth30d: null, audience: null, best: [] },
  ],
};
const LINK = "https://hey-maya.ai/k/abcdefgh12";
const GOOD = `Hi Pacefern team, I'm Sam, a Brisbane runner with 8.1K followers on Instagram. Two runners I watch posted your gels this month, and my hill video did 31K views (3.1x my usual), so a 15-second hill repeat with the gel at the top feels right for you. Open to me sending a concept? My kit: ${LINK} Sam`;
const pitch = (over: Partial<Parameters<typeof pitchProblems>[0]> = {}) => pitchProblems({ route: "email", firstTouch: true, brand: "Pacefern Hydration", subject: "Pacefern x @sam: a 15-second hill-repeat idea", body: GOOD, kitLinks: [LINK], ...over }, KIT);

describe("a good first pitch passes", () => {
  it("names the brand, one ask, the kit link, only the kit's numbers", () => {
    expect(pitch()).toEqual([]);
    expect(wordCount(GOOD)).toBeLessThan(80);
  });
});

describe("what gets a draft refused (adversarial)", () => {
  it("numbers that aren't theirs, however they're written", () => {
    for (const bad of ["with 12K followers", "my videos average 50,000 views", "an 8% engagement rate", "that did 7x my usual", "reached 1.2M people"]) {
      expect(pitch({ body: `${GOOD} (${bad})` }).join(" ")).toMatch(/aren't in their kit/);
    }
    // rounding the way people do is fine
    for (const ok of ["8,050 followers", "8K followers", "31,200 views", "6.1%", "71% women", "3.1x", "10K followers across both"]) expect(pitch({ body: GOOD.replace("Open to", `${ok}. Open to`) })).toEqual([]);
    // durations, times and prices aren't performance claims
    expect(pitch({ body: GOOD.replace("Open to", "It's a 15-second, 7am shoot, $400. Open to") })).toEqual([]);
  });
  it("a generic or brandless subject, or a long one", () => {
    expect(pitch({ subject: "Collaboration opportunity" }).join(" ")).toMatch(/name Pacefern Hydration.*generic|generic/);
    expect(pitch({ subject: "A running idea" }).join(" ")).toMatch(/should name Pacefern/);
    expect(pitch({ subject: `Pacefern x @sam: ${"a very long idea ".repeat(5)}` }).join(" ")).toMatch(/characters/);
  });
  it("more than one question, more than three links, an attachment, too long", () => {
    expect(pitch({ body: `${GOOD} Would you like that? When?` }).join(" ")).toMatch(/3 questions/);
    expect(pitch({ body: `${GOOD} https://a.com/1 https://a.com/2 https://a.com/3` }).join(" ")).toMatch(/4 links/);
    expect(pitch({ body: `${GOOD} I've attached my rate card.` }).join(" ")).toMatch(/attachments/);
    expect(pitch({ body: `${GOOD} ${"really ".repeat(120)}` }).join(" ")).toMatch(/words/);
  });
  it("a first email pitch without the kit link is refused; a follow-up doesn't need it", () => {
    expect(pitch({ kitLinks: [] }).join(" ")).toMatch(/kit_for_brand/);
    expect(pitch({ body: GOOD.replace(LINK, "") }).join(" ")).toMatch(/link their media kit/);
    expect(pitch({ firstTouch: false, body: "Just bumping this, happy to send a concept?", subject: "Re: Pacefern x @sam", kitLinks: [] })).toEqual([]);
  });
  it("an application's answers aren't a pitch", () => {
    expect(pitchProblems({ route: "application", firstTouch: true, brand: "X", subject: "x", body: "anything 99K followers", kitLinks: [] }, KIT)).toEqual([]);
  });
});

describe("numbers (pure)", () => {
  it("reads performance numbers as written", () => {
    expect(performanceNumbers("8.1K followers, 31,200 views, 6.1%, 3.1x, 2M plays").map((n) => [n.value, n.unit])).toEqual([[8100, "count"], [31200, "count"], [6.1, "%"], [3.1, "x"], [2_000_000, "count"]]);
    expect(performanceNumbers("a 15-second video at 7am in 2026")).toEqual([]);
  });
  it("backs a number within the way people round", () => {
    const nums = kitNumbers(KIT);
    expect(backed({ value: 8100, unit: "count" }, nums)).toBe(true);
    expect(backed({ value: 10_190, unit: "count" }, nums)).toBe(true); // both platforms together
    expect(backed({ value: 9000, unit: "count" }, nums)).toBe(false);
    expect(backed({ value: 2.1, unit: "%" }, nums)).toBe(true);
  });
});

describe("the send window (their clock)", () => {
  const LA = "America/Los_Angeles";
  it("now, on a weekday morning", () => {
    const tue10 = Date.UTC(2026, 8, 29, 17); // Tue 10:00 in LA
    expect(nextSendAt(tue10, LA)).toBe(tue10);
  });
  it("Friday afternoon waits for Monday 9:00; Saturday too", () => {
    const fri15 = Date.UTC(2026, 9, 2, 22); // Fri 15:00 LA
    const at = nextSendAt(fri15, LA);
    expect(sendWhen(at, LA)).toBe("monday 09:00");
    expect(nextSendAt(Date.UTC(2026, 9, 3, 18), LA)).toBe(at); // Sat 11:00 LA
  });
  it("a weekday evening waits for the next morning, in their zone, not ours", () => {
    const wed20 = Date.UTC(2026, 8, 30, 10); // Wed 20:00 in Brisbane
    expect(sendWhen(nextSendAt(wed20, "Australia/Brisbane"), "Australia/Brisbane")).toBe("thursday 09:00");
  });
  it("the disclosure line names the brand and says the toggle isn't enough", () => {
    expect(disclosureLine("Pacefern")).toMatch(/#ad.*paid partnership with Pacefern.*toggle alone isn't enough/);
  });
});
