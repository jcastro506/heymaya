/**
 * The human cadence (plan §24). Cross-tenant, fail-closed on every rail, adversarial rows,
 * sibling coherence (the cron, the buttons, the kinds, the dedupe keys), no TODOs. And the
 * image skill is off her belt.
 */
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { CADENCE, followerMilestone, morningReasons, streakWeeks } from "../cadence";
import { TOOLS, TOOL_CREDITS } from "../tools";
import { THRESHOLDS } from "../../config/thresholds";
import { PROBES } from "../../eval/converse";

const H = 3_600_000, D = 24 * H;
// A Tuesday at 08:30 UTC; every creator here lives on UTC so "8 on their clock" is this hour.
const NOW = Date.UTC(2026, 8, 8, 8, 30);
const produced = { skillVersion: "t", model: "m", thresholdsVersion: "t" };

async function seed(t: ReturnType<typeof convexTest>, suffix = "a") {
  return await t.run((ctx) => seedCreator(ctx, suffix, { timezone: "UTC", channel: { paired: true, pairedAt: NOW - 20 * D }, telegramChatId: `chat-${suffix}`, plan: { status: "active", founding: true }, createdAt: NOW - 20 * D, dossier: { persona: { summary: "runner" }, keywords: ["running"], cadence: { postsPerWeek: 2 } } }));
}
async function block(t: ReturnType<typeof convexTest>, creatorId: string, extra: Record<string, unknown>) {
  return await t.run((ctx) => ctx.db.insert("calendarBlocks", { creatorId, kind: "film", title: "film: the shoe rack list", status: "confirmed", consentAt: NOW - 3 * D, touches: [], createdAt: NOW - 3 * D, ...extra } as never));
}

describe("the human cadence: pure", () => {
  it("the morning has reasons or it has nothing", () => {
    const base = { now: NOW, timezone: "UTC", events: [], milestone: null, streakWeeks: 0, said: [] as string[] };
    expect(morningReasons({ ...base, blocks: [] })).toEqual([]);
    const today = { _id: "b1" as never, kind: "film", start: NOW + 9 * H, end: NOW + 10 * H, title: "film: the shoe rack list", status: "confirmed", consentAt: 1 };
    expect(morningReasons({ ...base, blocks: [today] }).map((r) => r.kind)).toEqual(["shoot_today"]);
    expect(morningReasons({ ...base, blocks: [today] })[0].text).toMatch(/filming today at 5:30 pm: the shoe rack list/);
    const yesterday = { _id: "b2" as never, kind: "film", start: NOW - 15 * H, end: NOW - 14 * H, title: "film: the dog at the tv", status: "confirmed", consentAt: 1 };
    expect(morningReasons({ ...base, blocks: [yesterday] }).map((r) => r.kind)).toEqual(["missed"]);
    expect(morningReasons({ ...base, blocks: [{ ...yesterday, filmedAt: 1 }] })).toEqual([]);
    expect(morningReasons({ ...base, blocks: [{ ...yesterday, missedAt: 1 }] }), "handled the evening before").toEqual([]);
    expect(morningReasons({ ...base, blocks: [{ ...yesterday, status: "deleted" }] })).toEqual([]);
    expect(morningReasons({ ...base, blocks: [{ ...today, consentAt: undefined }] }), "a proposed block is not a plan").toEqual([]);
    expect(morningReasons({ ...base, blocks: [], events: [{ title: "Chicago marathon", start: NOW + 2 * H, class: "filmable", status: "active", allDay: false }] })[0].text).toMatch(/Chicago marathon at 10:30 am/);
    expect(morningReasons({ ...base, blocks: [], events: [{ title: "therapy", start: NOW + 2 * H, class: "private", status: "active", allDay: false }] })).toEqual([]);
    expect(morningReasons({ ...base, blocks: [], milestone: { key: "views:100000", line: "that one crossed 100k." } })[0]).toMatchObject({ kind: "milestone", milestoneKey: "views:100000" });
    expect(morningReasons({ ...base, blocks: [], streakWeeks: 3 })[0]).toMatchObject({ kind: "streak", milestoneKey: "streak:3w" });
    expect(morningReasons({ ...base, blocks: [], streakWeeks: 3, said: ["streak:3w"] })).toEqual([]);
    expect(morningReasons({ ...base, blocks: [today, yesterday], events: [{ title: "x", start: NOW + H, class: "unknown", status: "active", allDay: true }], milestone: { key: "k", line: "l" }, streakWeeks: 4 }).length, "three at most").toBe(3);
  });

  it("a streak is whole weeks on their own plan, ending last week", () => {
    const w = 7 * D;
    const twoAWeek = [1, 2, 8, 9, 15, 16].map((d) => NOW - d * D);
    expect(streakWeeks({ now: NOW, timezone: "UTC", postsPerWeek: 2, postTimes: twoAWeek })).toBe(3);
    expect(streakWeeks({ now: NOW, timezone: "UTC", postsPerWeek: 3, postTimes: twoAWeek })).toBe(0);
    expect(streakWeeks({ now: NOW, timezone: "UTC", postsPerWeek: null, postTimes: twoAWeek })).toBe(0);
    expect(streakWeeks({ now: NOW, timezone: "UTC", postsPerWeek: 1, postTimes: [NOW - 2 * D, NOW - w - 2 * D, NOW - 3 * w - 2 * D] })).toBe(2);
  });

  it("followers cross a round number once", () => {
    expect(followerMilestone(12_400, [])).toMatchObject({ key: "followers:10000" });
    expect(followerMilestone(12_400, ["followers:10000"])).toBeNull();
    expect(followerMilestone(999, [])).toBeNull();
    expect(followerMilestone(null, [])).toBeNull();
    expect(followerMilestone(1_200_000, [])?.line).toMatch(/a million/);
  });

  it("sibling coherence: the cron, the buttons, the kinds; the image skill is gone", () => {
    const crons = readFileSync(new URL("../../crons.ts", import.meta.url), "utf8");
    expect(crons).toMatch(/internal\.agent\.cadence\.runAll/);
    const converse = readFileSync(new URL("../converse.ts", import.meta.url), "utf8");
    expect(converse).toMatch(/\^shot:\(\[a-zA-Z0-9\]\+\):\(yes\|no\)\$/);
    expect(converse).toMatch(/\^missed:\(\[a-zA-Z0-9\]\+\):\(rebook\|drop\)\$/);
    const cadence = readFileSync(new URL("../cadence.ts", import.meta.url), "utf8");
    for (const key of ["morning:${day}", "howdidit:${block._id}", "sawit:${a.ownPostId}", "quiet:${monthKey}", "foryou:${a.postId}"]) expect(cadence, `dedupe key ${key}`).toContain(key);
    expect(cadence).not.toMatch(/TODO|FIXME/);
    // Live 2026-09-08: "i'll read your lane that way from the next pass" reached a creator. Plumbing words stay out of code strings.
    const manage = readFileSync(new URL("../manage.ts", import.meta.url), "utf8");
    expect(manage).not.toMatch(/next pass/);
    // Frames: no tool, no button, no proactive, no line in the soul, nothing she can reach.
    expect(TOOLS.some((t) => t.function.name === "show_frames")).toBe(false);
    expect(TOOL_CREDITS.show_frames).toBeUndefined();
    expect(THRESHOLDS.framesPerWeek).toBe(0);
    const scout = readFileSync(new URL("../../scout/scout.ts", import.meta.url), "utf8");
    const moment = readFileSync(new URL("../moment.ts", import.meta.url), "utf8");
    const soul = readFileSync(new URL("../soul.ts", import.meta.url), "utf8");
    for (const src of [scout, moment]) expect(src).not.toMatch(/label: "show me"/);
    expect(soul).not.toMatch(/show_frames/);
    expect(converse).not.toMatch(/call show_frames/);
    expect(PROBES.some((p) => p.category === "frames")).toBe(true);
  });
});

describe("the human cadence: rows and rails, on the fake model", () => {
  beforeEach(() => { process.env.MODEL_FAKE = "1"; });

  it("the morning line goes once, with the rebook buttons when yesterday did not happen, and the milestone is marked said", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t);
    await block(t, creatorId, { start: NOW + 9 * H, end: NOW + 10 * H });
    const missed = await block(t, creatorId, { start: NOW - 15 * H, end: NOW - 14 * H, title: "film: the dog at the tv" });
    for (let i = 0; i < 6; i++) await t.run((ctx) => ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: `p${i}`, url: `https://t/${i}`, createTime: NOW - (1 + Math.floor(i / 2) * 7 + (i % 2)) * D, contentType: "video", caption: "c", hashtags: [], metrics: { views: 100, likes: 1, comments: 0, shares: 0 }, metricsAsOf: NOW, source: "scrape" } as never));
    const r = await t.action(internal.agent.cadence.morning, { creatorId, now: NOW });
    expect(r.sent, r.reason).toBe(true);
    expect(r.reason).toBe("shoot_today,missed,streak");
    const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({ kind: "morning", proactive: true, dedupeKey: "morning:2026-09-08", awaitingAnswer: true });
    expect(out[0].buttons?.map((b) => b.id)).toEqual([`missed:${missed}:rebook`, `missed:${missed}:drop`]);
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.milestonesSaid).toContain("streak:3w");
    const again = await t.action(internal.agent.cadence.morning, { creatorId, now: NOW + 20 * 60_000 });
    expect(again.sent, "an open question blocks the second, and the dedupe key would anyway").toBe(false);
  });

  it("no reasons, no message; and every rail holds (fail-closed)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t);
    expect(await t.action(internal.agent.cadence.morning, { creatorId, now: NOW })).toMatchObject({ sent: false, reason: "nothing to say" });
    await block(t, creatorId, { start: NOW + 9 * H, end: NOW + 10 * H });
    // Quiet hours on their clock.
    expect((await t.action(internal.agent.cadence.morning, { creatorId, now: Date.UTC(2026, 8, 8, 5) })).reason).toMatch(/quiet/);
    // The cap: three proactive already today.
    for (let i = 0; i < THRESHOLDS.dailyMessageCap; i++) await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: `idea ${i}`, dedupeKey: `d:${i}`, proactive: true, kind: "scout", ts: NOW - 60_000 });
    expect((await t.action(internal.agent.cadence.morning, { creatorId, now: NOW })).reason).toMatch(/cap/);
    expect((await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.kind === "morning").length).toBe(0);
    // A paused plan.
    const paused = await t.run((ctx) => seedCreator(ctx, "p", { timezone: "UTC", channel: { paired: true }, plan: { status: "paused", founding: true } }));
    await block(t, paused, { start: NOW + 9 * H, end: NOW + 10 * H });
    expect((await t.action(internal.agent.cadence.morning, { creatorId: paused, now: NOW })).reason).toMatch(/paused/);
  });

  it("B's block never produces A's line (cross-tenant)", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "a");
    const b = await seed(t, "b");
    await block(t, b, { start: NOW + 9 * H, end: NOW + 10 * H });
    expect((await t.action(internal.agent.cadence.morning, { creatorId: a, now: NOW })).sent).toBe(false);
    expect((await t.action(internal.agent.cadence.morning, { creatorId: b, now: NOW })).sent).toBe(true);
    expect((await t.run((ctx) => ctx.db.query("messages").collect())).every((m) => m.creatorId === b)).toBe(true);
    expect((await t.mutation(internal.agent.cadence.markMissed, { creatorId: a, blockId: (await t.run((ctx) => ctx.db.query("calendarBlocks").first()))!._id })).ok, "A cannot mark B's block").toBe(false);
  });

  it("the evening question: in its window, once, with the two buttons; filmed or future or deleted asks nothing", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t);
    const ended = await block(t, creatorId, { start: NOW - 3 * H, end: NOW - 2 * H });
    await block(t, creatorId, { start: NOW + 2 * H, end: NOW + 3 * H, title: "film: later" });
    await block(t, creatorId, { start: NOW - 4 * H, end: NOW - 3 * H, title: "film: done", filmedAt: NOW - 3 * H });
    await block(t, creatorId, { start: NOW - 4 * H, end: NOW - 3 * H, title: "film: gone", status: "deleted" });
    const r = await t.action(internal.agent.cadence.howDidItGo, { creatorId, now: NOW });
    expect(r).toMatchObject({ sent: true });
    const q = (await t.run((ctx) => ctx.db.query("messages").collect())).find((m) => m.kind === "checkin");
    expect(q?.body).toBe("how'd the shoe rack list shoot go?");
    expect(q?.buttons?.map((b) => b.id)).toEqual([`shot:${ended}:yes`, `shot:${ended}:no`]);
    expect(q?.awaitingAnswer).toBe(true);
    expect((await t.action(internal.agent.cadence.howDidItGo, { creatorId, now: NOW + 30 * 60_000 })).sent, "asked once").toBe(false);
    // Too soon (an hour after), and too late (nine hours after), both nothing.
    const c2 = await seed(t, "c");
    await block(t, c2, { start: NOW - 1.5 * H, end: NOW - H });
    expect((await t.action(internal.agent.cadence.howDidItGo, { creatorId: c2, now: NOW })).sent).toBe(false);
    expect((await t.action(internal.agent.cadence.howDidItGo, { creatorId: c2, now: NOW + 9 * H })).sent).toBe(false);
  });

  it("the buttons: filmed marks the block; didn't-happen marks it missed and offers it back; the morning then stays quiet about it", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t);
    const b = await block(t, creatorId, { start: NOW - 15 * H, end: NOW - 14 * H });
    const yes = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", kind: "button", body: `shot:${b}:yes`, ts: NOW } as never));
    await t.action(internal.agent.converse.run, { creatorId, messageId: yes });
    expect(typeof (await t.run((ctx) => ctx.db.get(b)))?.filmedAt).toBe("number");
    const b2 = await block(t, creatorId, { start: NOW - 15 * H, end: NOW - 14 * H, title: "film: two" });
    const no = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", kind: "button", body: `shot:${b2}:no`, ts: NOW } as never));
    await t.action(internal.agent.converse.run, { creatorId, messageId: no });
    expect(typeof (await t.run((ctx) => ctx.db.get(b2)))?.missedAt).toBe("number");
    const offer = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out").pop();
    expect(offer?.body).toMatch(/want it back/);
    expect(offer?.buttons?.some((x) => x.id.startsWith(`push:${b2}:`))).toBe(true);
    // The morning after: both blocks are handled, so nothing about them.
    await t.run((ctx) => ctx.db.patch(offer!._id, { awaitingAnswer: false }));
    expect((await t.action(internal.agent.cadence.morning, { creatorId, now: NOW })).reason).toBe("nothing to say");
  });

  it("saw it: a viewer's line on a new post with no digits; an old post gets nothing; a stranger's post is refused", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t);
    const post = await t.run((ctx) => ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: "n1", url: "https://www.tiktok.com/@a/video/1", createTime: NOW - 2 * H, contentType: "video", caption: "the shoe rack", hashtags: [], metrics: { views: 10, likes: 1, comments: 0, shares: 0 }, metricsAsOf: NOW, source: "scrape" } as never));
    const r = await t.action(internal.agent.cadence.sawIt, { creatorId, ownPostId: post, now: NOW });
    expect(r).toMatchObject({ sent: true });
    const m = (await t.run((ctx) => ctx.db.query("messages").collect())).find((x) => x.kind === "saw_it");
    expect(m?.body).not.toMatch(/\d/);
    expect(m?.links).toEqual(["https://www.tiktok.com/@a/video/1"]);
    expect((await t.action(internal.agent.cadence.sawIt, { creatorId, ownPostId: post, now: NOW })).sent, "once").toBe(false);
    const old = await t.run((ctx) => ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: "n2", url: "https://t/2", createTime: NOW - 3 * D, contentType: "video", caption: "old", hashtags: [], metrics: { views: 10, likes: 1, comments: 0, shares: 0 }, metricsAsOf: NOW, source: "scrape" } as never));
    expect((await t.action(internal.agent.cadence.sawIt, { creatorId, ownPostId: old, now: NOW })).reason).toBe("not new");
    const other = await seed(t, "z");
    expect((await t.action(internal.agent.cadence.sawIt, { creatorId: other, ownPostId: post, now: NOW })).reason).toBe("not their post");
  });

  it("for you: no ask, with the link, twice a week and not a third time", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t);
    for (let i = 1; i <= 3; i++) {
      const r = await t.action(internal.agent.cadence.forYou, { creatorId, postId: `fy${i}`, url: `https://www.tiktok.com/@x/video/${i}`, line: `saw this and thought of you, ${i}`, now: NOW + i * 60_000 });
      expect(r.sent, `share ${i}: ${r.reason}`).toBe(i <= THRESHOLDS.forYouPerWeek);
    }
    const shares = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.kind === "for_you");
    expect(shares.length).toBe(2);
    expect(shares[0].body).toContain("https://www.tiktok.com/@x/video/1");
    expect(shares[0].awaitingAnswer).toBeFalsy();
    expect((await t.action(internal.agent.cadence.forYou, { creatorId, postId: "fy1", url: "https://t/1", line: "again", now: NOW + 8 * D })).reason, "the same post is never shared twice").toBe("already shared");
  });

  it("quiet: after a week of silence with things sent, one line, once a month", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t);
    for (let i = 0; i < 4; i++) await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: `idea ${i}`, dedupeKey: `q:${i}`, proactive: true, kind: "scout", ts: NOW - (10 - i) * D });
    await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", kind: "inbound", body: "ok", ts: NOW - 9 * D } as never));
    const r = await t.action(internal.agent.cadence.quiet, { creatorId, now: NOW });
    expect(r, JSON.stringify(r)).toMatchObject({ sent: true });
    const q = (await t.run((ctx) => ctx.db.query("messages").collect())).find((m) => m.kind === "quiet");
    expect(q?.awaitingAnswer).toBeFalsy();
    expect((await t.action(internal.agent.cadence.quiet, { creatorId, now: NOW + D })).reason).toBe("asked this month");
    const fresh = await seed(t, "f");
    expect((await t.action(internal.agent.cadence.quiet, { creatorId: fresh, now: NOW })).reason).toBe("not quiet");
  });

  it("the hourly finds who is at 8 and who is at 18 on their own clock", async () => {
    const t = convexTest(schema, modules);
    const utc = await seed(t, "u");
    const la = await t.run((ctx) => seedCreator(ctx, "l", { timezone: "America/Los_Angeles", channel: { paired: true }, plan: { status: "active", founding: true } }));
    const due = await t.query(internal.agent.cadence.dueNow, { now: Date.UTC(2026, 8, 8, 8, 30) });
    expect(due).toEqual([{ creatorId: utc, touch: "morning" }]);
    const dueLa = await t.query(internal.agent.cadence.dueNow, { now: Date.UTC(2026, 8, 8, 15, 30) });
    expect(dueLa).toEqual([{ creatorId: la, touch: "morning" }]);
    expect(CADENCE.morningHour).toBe(8);
  });
});
