/** The day sim's own judge of "the calendar matches the plan" must be right, or every run lies. */
import { describe, expect, it } from "vitest";
import { consistency } from "../daySim";

const H = 3_600_000;
const t = Date.now() + 48 * H;
const block = (id: string, over: Record<string, unknown> = {}) => ({ id, start: t, end: t + H, booked: true, live: true, googleId: `g-${id}`, deviceId: null, ...over });
const ev = (id: string, over: Record<string, unknown> = {}) => ({ id, start: new Date(t).toISOString(), end: new Date(t + H).toISOString(), status: "confirmed", maya: true, ...over });

describe("google", () => {
  it("clean when every booked block is on the calendar once, at its time", () => {
    expect(consistency([block("a"), block("b", { booked: false, googleId: null })], { kind: "google", events: [ev("g-a"), ev("life", { maya: false })] })).toEqual([]);
  });
  it("catches a missing event, a duplicate, a wrong time and a leftover", () => {
    expect(consistency([block("a")], { kind: "google", events: [] })[0]).toMatch(/on Google 0 times/);
    expect(consistency([block("a")], { kind: "google", events: [ev("g-a", { start: new Date(t + H).toISOString() })] })[0]).toMatch(/disagree on time/);
    expect(consistency([block("a", { live: false })], { kind: "google", events: [ev("g-a")] })[0]).toMatch(/no live booked block/);
    expect(consistency([block("a")], { kind: "google", events: [ev("g-a", { status: "cancelled" })] })[0]).toMatch(/0 times/);
  });
});

describe("iphone", () => {
  it("clean when the phone's list is exactly the booked blocks, same times", () => {
    expect(consistency([block("a"), block("b", { booked: false })], { kind: "iphone", write: [{ id: "a", start: t, end: t + H }], remove: [] })).toEqual([]);
  });
  it("catches a missing session, an extra one and a time mismatch", () => {
    expect(consistency([block("a")], { kind: "iphone", write: [], remove: [] })[0]).toMatch(/not on the phone/);
    expect(consistency([], { kind: "iphone", write: [{ id: "x", start: t, end: t + H }], remove: [] })[0]).toMatch(/isn't a live booked block/);
    expect(consistency([block("a")], { kind: "iphone", write: [{ id: "a", start: t + H, end: t + 2 * H }], remove: [] })[0]).toMatch(/times differ/);
  });
});
