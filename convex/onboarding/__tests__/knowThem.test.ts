/**
 * Getting to know them: what she knows (their own words, from their own messages) reaches every path;
 * what's still worth asking reaches only replies; an answer or a shrug closes a topic for good; and the
 * guidance keeps it a conversation, not a form.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { knowThemSection, TOPICS } from "../knowThem";
import { personalHistoryFor } from "../../agent/personalHistory";

const NOW = Date.now();

describe("the section (pure)", () => {
  it("lists what they said, in their words, and only the questions still open", () => {
    const s = knowThemSection([{ kind: "goal", text: "brand deals", at: NOW }, { kind: "hesitation", text: "being on camera honestly", at: NOW - 86_400_000 }], NOW, true);
    expect(s).toContain('what gets in the way: "being on camera honestly" (1d ago');
    expect(s).toContain('what they want out of this: "brand deals"');
    expect(s).not.toMatch(/- what gets in the way, when/);
    expect(s).toMatch(/- what they won't do on camera, when/);
    expect(s).toMatch(/- how they started, when/);
  });
  it("proactive paths get what's known, never the questions; with nothing known they get nothing", () => {
    expect(knowThemSection([{ kind: "boundary", text: "no face", at: NOW }], NOW, false)).toMatch(/no face[\s\S]*Never suggest anything a boundary rules out/);
    expect(knowThemSection([{ kind: "boundary", text: "no face", at: NOW }], NOW, false)).not.toMatch(/Still worth asking/);
    expect(knowThemSection([], NOW, false)).toBe("");
  });
  it("reads as a friend, not a form", () => {
    const s = knowThemSection([], NOW, true);
    expect(s).toMatch(/at most one of these a day/);
    expect(s).toMatch(/never in the same text as an idea/);
    expect(s).toMatch(/Never ask about family, health, money, relationships, where they live or their age/);
    expect(s).toMatch(/Never number questions, mention a profile, or make it feel like a form/);
    for (const t of TOPICS) expect(t.ask, t.kind).not.toMatch(/—|profile|survey|question \d/);
  });
});

describe("on rows", () => {
  it("an answer, or a shrug, from their own message is saved under its topic; a quote they never sent is not", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "kt1"));
    const msg = await t.run((ctx) => ctx.db.insert("messages", { creatorId: c, direction: "in", surface: "imessage", body: "honestly being on camera, i freeze up", ts: NOW }));
    const shrug = await t.run((ctx) => ctx.db.insert("messages", { creatorId: c, direction: "in", surface: "imessage", body: "idk tbh", ts: NOW + 1 }));
    const epoch = (await t.run((ctx) => ctx.db.get(c)))!.memoryEpoch ?? 0;
    expect(await t.mutation(internal.agent.remember.recordExperience, { creatorId: c, sourceMessageId: msg, kind: "hesitation", quote: "being on camera, i freeze up", epoch })).toBe(true);
    expect(await t.mutation(internal.agent.remember.recordExperience, { creatorId: c, sourceMessageId: shrug, kind: "origin", quote: "idk tbh", epoch })).toBe(true);
    expect(await t.mutation(internal.agent.remember.recordExperience, { creatorId: c, sourceMessageId: msg, kind: "boundary", quote: "no kids on camera", epoch }), "invented quote").toBe(false);

    const reply = await t.query(internal.agent.context.gather, { creatorId: c, messageId: msg });
    expect(reply!.history).toContain('what gets in the way: "being on camera, i freeze up"');
    expect(reply!.history).not.toMatch(/- how they started, when/); // the shrug closed it
    expect(reply!.history).toMatch(/- what they won't do on camera, when/);
    const scout = await t.query(internal.agent.context.gather, { creatorId: c });
    expect(scout!.history).toContain("being on camera, i freeze up");
    expect(scout!.history).not.toMatch(/Still worth asking/);
    // Said once: not again in the general personal history.
    expect(await t.run((ctx) => personalHistoryFor(ctx as never, c))).not.toContain("being on camera, i freeze up");
  });

  it("one creator's answers never reach another's context", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "kt2"));
    const b = await t.run((ctx) => seedCreator(ctx, "kt3"));
    const msg = await t.run((ctx) => ctx.db.insert("messages", { creatorId: a, direction: "in", surface: "imessage", body: "my coworkers finding it", ts: NOW }));
    await t.mutation(internal.agent.remember.recordExperience, { creatorId: a, sourceMessageId: msg, kind: "hesitation", quote: "my coworkers finding it", epoch: 0 });
    const other = await t.query(internal.agent.context.gather, { creatorId: b });
    expect(other!.history).not.toContain("coworkers");
    expect(await t.mutation(internal.agent.remember.recordExperience, { creatorId: b, sourceMessageId: msg, kind: "hesitation", quote: "my coworkers finding it", epoch: 0 }), "another creator's message").toBe(false);
  });
});

describe("when they film", () => {
  it("their words become days and an hour the week planner uses; nothing usable is nothing", async () => {
    const { parseFilmTime } = await import("../../agent/remember");
    expect(parseFilmTime({ days: ["Mon", "tue", "wed", "thu", "fri"], hour: 19, quote: "weekday evenings around 7" })).toEqual({ days: [1, 2, 3, 4, 5], hour: 19, said: "weekday evenings around 7" });
    expect(parseFilmTime({ days: ["sat", "sun"], hour: null, quote: "weekends" })).toEqual({ days: [0, 6], hour: null, said: "weekends" });
    expect(parseFilmTime({ days: [], hour: 3, quote: "3am lol" }), "an hour outside 5–23 isn't a plan").toBeNull();
    expect(parseFilmTime({ days: ["mon"], hour: 19, quote: "" }), "no words of theirs").toBeNull();
    expect(parseFilmTime(null)).toBeNull();
  });

  it("saved only from their own message; then it's known and the planner reads it", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "ft1"));
    const msg = await t.run((ctx) => ctx.db.insert("messages", { creatorId: c, direction: "in", surface: "imessage", body: "weekday evenings around 7 usually", ts: NOW }));
    expect(await t.mutation(internal.agent.remember.setFilmPrefs, { creatorId: c, sourceMessageId: msg, days: [1, 2, 3, 4, 5], hour: 19, said: "made up words", epoch: 0 })).toBe(false);
    expect(await t.mutation(internal.agent.remember.setFilmPrefs, { creatorId: c, sourceMessageId: msg, days: [1, 2, 3, 4, 5], hour: 19, said: "weekday evenings around 7", epoch: 0 })).toBe(true);
    const reply = await t.query(internal.agent.context.gather, { creatorId: c, messageId: msg });
    expect(reply!.history).toContain('when they usually film: "weekday evenings around 7"');
    const inp = await t.query(internal.calendar.weekPlan.inputsFor, { creatorId: c, now: NOW });
    expect(inp).toMatchObject({ filmDays: [1, 2, 3, 4, 5], filmHour: 19 });
  });
});
