/**
 * B7 follow-up (2026-09-28): a sound can mean "under my voice" or "a song over it, muted". Categories:
 * adversarial (every way people say it), sibling coherence (the reply shapes: the question when she
 * can't tell, the "tell me the vibe" when nothing checked fits), fail-closed (a pending question
 * expires after 24 hours; another creator's never routes), and the saved choice.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { finishText, keepsTheirAudio, SOUND_ASK_MS, SOUND_NONE_OVER, SOUND_QUESTION, soundPlan } from "../finish";

const talking = { audioNow: "original-voice", voiceCarriesIt: true };
const talkingIncidental = { audioNow: "original-voice", voiceCarriesIt: false };

describe("what sound they want (adversarial)", () => {
  it("their words win: a song over it", () => {
    for (const w of ["what song should i put on this", "i'm gonna mute it, need a sound", "need background music for this", "put a sound over it", "any music ideas?", "no talking in this one, just a vibe track"]) expect(soundPlan(w, talking), w).toBe("over");
  });
  it("their words win: keep my voice", () => {
    for (const w of ["keep my voice, just need a caption", "i'm talking in it, what goes under?", "voiceover stays", "keep the original audio"]) expect(soundPlan(w, talking), w).toBe("voice");
  });
  it("the clip decides when they didn't say", () => {
    expect(soundPlan("", { audioNow: "silent" })).toBe("over");
    expect(soundPlan("", { audioNow: "ambient" })).toBe("over");
    expect(soundPlan("", { audioNow: "music" })).toBe("voice");
    expect(soundPlan("caption pls", talking)).toBe("voice");
  });
  it("she asks when they talk in it and asked for a sound, or their voice is incidental", () => {
    expect(soundPlan("what sound should i use?", talking)).toBe("ask");
    expect(soundPlan("", talkingIncidental)).toBe("ask");
    expect(soundPlan("idk", null)).toBe("ask");
  });
  it("keeping what's there is recognised however it's named", () => {
    expect(keepsTheirAudio({ name: "your own audio", source: "their-own-audio" })).toBe(true);
    expect(keepsTheirAudio({ name: "keep the song already on it", source: "watched-accounts" })).toBe(true);
    expect(keepsTheirAudio({ name: "Espresso by Sabrina Carpenter", source: "trending" })).toBe(false);
  });
});

describe("what she sends (sibling coherence)", () => {
  const caps = [{ text: "one", shape: "their-usual", why: "" }, { text: "two", shape: "question", why: "" }];
  it("no sounds yet: the captions, then ONE question", () => {
    const t = finishText({ reaction: "the sizzle got me", captions: caps, sounds: [], soundAsk: SOUND_QUESTION });
    expect(t).toContain("captions:\n1. one\n2. two");
    expect(t.split("---").at(-1)?.trim()).toBe(SOUND_QUESTION);
    expect((t.match(/\?/g) ?? []).length).toBe(1);
  });
  it("a song over it, but nothing checked fits: asks for the vibe, never 'your own audio'", () => {
    const t = finishText({ reaction: "x", captions: caps, sounds: [], soundAsk: SOUND_NONE_OVER });
    expect(t).toContain("tell me the vibe");
    expect(t).not.toMatch(/own audio/);
  });
});

describe("the pending question (fail-closed)", () => {
  it("routes their answer for 24 hours, only to the creator it was asked of, and clears once picked", async () => {
    const t = convexTest(schema, modules);
    const { a, b, msg } = await t.run(async (ctx) => {
      const a = await seedCreator(ctx, "a");
      const b = await seedCreator(ctx, "b");
      const msg = await ctx.db.insert("messages", { creatorId: a, direction: "in", surface: "telegram", kind: "file", body: "what sound?", ts: Date.now() } as never);
      return { a, b, msg };
    });
    const id = await t.mutation(internal.agent.finish.record, { creatorId: a, messageId: msg, card: talking, captions: [], sounds: [], dropped: [], lookups: [], soundPlan: "ask", soundAskAt: Date.now() });
    expect(await t.query(internal.agent.finish.pendingSoundAsk, { creatorId: a, now: Date.now() })).toMatchObject({ id, plan: "ask" });
    expect(await t.query(internal.agent.finish.pendingSoundAsk, { creatorId: b, now: Date.now() })).toBeNull();
    expect(await t.query(internal.agent.finish.pendingSoundAsk, { creatorId: a, now: Date.now() + SOUND_ASK_MS + 1 })).toBeNull();
    await t.mutation(internal.agent.finish.saveSounds, { id, plan: "over", sounds: [{ name: "Espresso by Sabrina Carpenter", clipId: "1", platform: "tiktok", source: "trending", why: "the pace", howToUse: "mute the original" }], dropped: [], lookups: ["sound_info"] });
    expect(await t.query(internal.agent.finish.pendingSoundAsk, { creatorId: a, now: Date.now() })).toBeNull();
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).toMatchObject({ soundPlan: "over", sounds: [{ name: "Espresso by Sabrina Carpenter" }] });
  });
});
