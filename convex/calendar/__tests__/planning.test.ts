/**
 * The week plan is arithmetic (Sprint 4b). Every fact she books comes from a row or a
 * clock, so every one of them is testable without a model.
 */
import { describe, expect, it } from "vitest";
import { atLocalHour, buildPostTimeModel, localHour, nextPostTime, DEFAULT_HOUR } from "../postTime";
import { draftWeek, editMinutesFor, freeSlotOn, pickIdeas, PLAN } from "../planning";

const TZ = "America/New_York";
// Tuesday 1 Sep 2026, 12:00 New York (16:00 UTC).
const NOON = Date.UTC(2026, 8, 1, 16, 0);
const at = (dayOffset: number, hour: number) => atLocalHour(NOON + dayOffset * 86_400_000, hour, TZ);

describe("post time from their own history", () => {
  it("learns the hour their posts do best, in their timezone", () => {
    const posts = [
      ...[1, 2, 3].map((i) => ({ createTime: at(-i, 19), multiple: 2.5 })),
      ...[1, 2, 3].map((i) => ({ createTime: at(-i, 9), multiple: 0.8 })),
    ];
    const m = buildPostTimeModel(posts, TZ);
    expect(m.hours[0].hour).toBe(19);
    expect(m.hours[0].n).toBe(3);
    expect(m.confidence).toBe("thin");
    expect(m.defaultHour).toBe(19);
  });

  it("one lucky post in an hour is an anecdote, not a rule", () => {
    const m = buildPostTimeModel([{ createTime: at(-1, 3), multiple: 40 }, { createTime: at(-2, 18), multiple: 1.1 }, { createTime: at(-3, 18), multiple: 1.2 }], TZ);
    expect(m.hours.map((h) => h.hour)).toEqual([18]);
  });

  it("says none, and uses a default it will call a default, with nothing to learn from", () => {
    const m = buildPostTimeModel([{ createTime: NOON, multiple: null }], TZ);
    expect(m.confidence).toBe("none");
    expect(m.hours).toHaveLength(0);
    expect(m.defaultHour).toBe(DEFAULT_HOUR);
    expect(nextPostTime(m, NOON, TZ).fromHistory).toBe(false);
  });

  it("the next post time is the best hour still ahead today, else tomorrow", () => {
    const m = buildPostTimeModel([...[1, 2].map((i) => ({ createTime: at(-i, 19), multiple: 2 })), ...[1, 2].map((i) => ({ createTime: at(-i, 8), multiple: 1.5 }))], TZ);
    const today = nextPostTime(m, NOON, TZ);
    expect(localHour(today.at, TZ)).toBe(19);
    const late = nextPostTime(m, at(0, 21), TZ);
    expect(localHour(late.at, TZ)).toBe(19);
    expect(late.at).toBeGreaterThan(at(0, 21));
  });
});

describe("the editing block", () => {
  it("a single-shot creator gets the floor, an editor gets more, and 'i don't edit' gets none", () => {
    expect(editMinutesFor({ cutsPerTenSeconds: 0.5 })).toBe(PLAN.editMinutesFloor);
    expect(editMinutesFor({ cutsPerTenSeconds: 6 })).toBe(PLAN.editMinutesCeiling);
    expect(editMinutesFor({ medianCutSeconds: 2 })).toBeGreaterThan(PLAN.editMinutesFloor);
    expect(editMinutesFor(null)).toBe(PLAN.editMinutesFloor);
    expect(editMinutesFor({ cutsPerTenSeconds: 6 }, true)).toBe(0);
  });
});

describe("free slots", () => {
  it("takes the preferred hour when it is free and walks outward when it is not", () => {
    const busy = [{ start: at(0, 17), end: at(0, 19) }];
    const free = freeSlotOn(NOON, 45, busy, 17, TZ)!;
    expect(free).not.toBeNull();
    expect(free.start >= at(0, 19) || free.end <= at(0, 17)).toBe(true);
    expect(localHour(free.start, TZ)).toBeGreaterThanOrEqual(PLAN.dayStartHour);
    const open = freeSlotOn(NOON, 45, [], 17, TZ)!;
    expect(localHour(open.start, TZ)).toBe(17);
  });

  it("a fully booked day yields nothing rather than 3am", () => {
    const busy = [{ start: at(0, PLAN.dayStartHour), end: at(0, PLAN.dayEndHour) + 3_600_000 }];
    expect(freeSlotOn(NOON, 45, busy, 17, TZ)).toBeNull();
  });
});

describe("picking ideas", () => {
  it("saved beats hearted beats sent, and the experiment always gets the last slot", () => {
    const ideas = [
      { ideaId: "s", hook: "sent one", status: "sent", sentAt: 3 },
      { ideaId: "h", hook: "hearted one", status: "hearted", sentAt: 2 },
      { ideaId: "v", hook: "saved one", status: "saved", savedAt: 1 },
      { ideaId: "x", hook: "expired", status: "expired" },
    ];
    const picked = pickIdeas(ideas, 3, "open on an object");
    expect(picked.map((p) => p.ideaId)).toEqual(["v", "h", null]);
    expect(picked[2].experiment).toBe(true);
  });
});

describe("draftWeek", () => {
  const model = buildPostTimeModel([...[1, 2, 3].map((i) => ({ createTime: at(-i, 19), multiple: 2 }))], TZ);
  it("lays out cadence-many slots, each with film, edit and a post after the edit, days ascending", () => {
    const ideas = [{ ideaId: "a", hook: "a", experiment: false }, { ideaId: "b", hook: "b", experiment: false }, { ideaId: null, hook: "exp", experiment: true }];
    const slots = draftWeek({ now: NOON, timeZone: TZ, postsPerWeek: 3, filmDays: [], filmHour: null, editMinutes: 30, busy: [], model, ideas });
    expect(slots).toHaveLength(3);
    for (const s of slots) {
      expect(s.film.end - s.film.start).toBe(PLAN.filmMinutes * 60_000);
      expect(s.edit, "editing block is default on").not.toBeNull();
      expect(s.edit!.start).toBeGreaterThanOrEqual(s.film.end);
      expect(s.post.at).toBeGreaterThan(s.edit!.end);
      expect(s.post.hour).toBe(19);
      expect(s.film.start).toBeGreaterThan(NOON);
    }
    expect(slots.map((s) => s.day)).toEqual([...slots.map((s) => s.day)].sort((a, b) => a - b));
    expect(slots[2].experiment).toBe(true);
  });

  it("no editing block when they said they don't edit", () => {
    const slots = draftWeek({ now: NOON, timeZone: TZ, postsPerWeek: 1, filmDays: [], filmHour: null, editMinutes: 0, busy: [], model, ideas: [{ ideaId: "a", hook: "a", experiment: false }] });
    expect(slots[0].edit).toBeNull();
    expect(slots[0].post.at).toBeGreaterThan(slots[0].film.end);
  });

  it("respects their filming days and never double-books a gap", () => {
    const ideas = [{ ideaId: "a", hook: "a", experiment: false }, { ideaId: "b", hook: "b", experiment: false }];
    const slots = draftWeek({ now: NOON, timeZone: TZ, postsPerWeek: 2, filmDays: [6, 0], filmHour: 10, editMinutes: 20, busy: [], model, ideas });
    expect(slots).toHaveLength(2);
    const wd = (e: number) => new Date(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(e)).getDay();
    expect(slots.map((s) => wd(s.film.start)).sort()).toEqual([0, 6]);
    expect(localHour(slots[0].film.start, TZ)).toBe(10);
    const [x, y] = slots;
    expect(x.film.end <= y.film.start || y.film.end <= x.film.start).toBe(true);
  });

  it("cadence is clamped to something a person can do", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ideaId: String(i), hook: "h", experiment: false }));
    expect(draftWeek({ now: NOON, timeZone: TZ, postsPerWeek: 9, filmDays: [], filmHour: null, editMinutes: 20, busy: [], model, ideas: many })).toHaveLength(PLAN.maxSlots);
    expect(draftWeek({ now: NOON, timeZone: TZ, postsPerWeek: 0, filmDays: [], filmHour: null, editMinutes: 20, busy: [], model, ideas: many })).toHaveLength(PLAN.minSlots);
  });
});
