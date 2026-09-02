/**
 * §15.3: code decides the route. Commands never reach a model; links parse to a
 * platform, a handle and "their own"; files route by MIME; everything else is text.
 * Commands are enforced by rows (plan status, a tombstone).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { asksForOpinion, classifyInbound, parseLink, parseProfileAsk } from "../inbound";

const handles = { tiktok: "runwithmaya", instagram: "run.with.maya" };

describe("classifyInbound", () => {
  it("commands, by code, with punctuation and case", () => {
    expect(classifyInbound({ text: "STOP.", kind: "inbound", handles })).toEqual({ route: "command", command: "stop" });
    expect(classifyInbound({ text: "too much", kind: "inbound", handles })).toEqual({ route: "command", command: "stop" });
    expect(classifyInbound({ text: "resume!", kind: "inbound", handles })).toEqual({ route: "command", command: "resume" });
    expect(classifyInbound({ text: "forget that", kind: "inbound", handles })).toEqual({ route: "command", command: "forget" });
    expect(classifyInbound({ text: "can i talk to a real person", kind: "inbound", handles })).toEqual({ route: "command", command: "person" });
    expect(classifyInbound({ text: "delete my account", kind: "inbound", handles })).toEqual({ route: "command", command: "delete" });
    expect(classifyInbound({ text: "should i stop doing skits?", kind: "inbound", handles }).route).toBe("text");
  });

  it("links parse to platform, handle, post id, and 'own' by handle", () => {
    expect(parseLink("look https://www.tiktok.com/@someoneelse/video/7301234567890123456 wild")).toEqual({ platform: "tiktok", url: "https://www.tiktok.com/@someoneelse/video/7301234567890123456", handle: "someoneelse", postId: "7301234567890123456" });
    expect(parseLink("https://www.instagram.com/reel/C9abcDEfgh/")).toMatchObject({ platform: "instagram", postId: "C9abcDEfgh", handle: null });
    expect(classifyInbound({ text: "https://www.tiktok.com/@RunWithMaya/video/7300000000000000000 thoughts?", kind: "inbound", handles })).toMatchObject({ route: "link", own: true });
    expect(classifyInbound({ text: "https://www.tiktok.com/@other/video/7300000000000000001", kind: "inbound", handles })).toMatchObject({ route: "link", own: false });
    expect(classifyInbound({ text: "https://vm.tiktok.com/ZMabc123/", kind: "inbound", handles })).toMatchObject({ route: "link", own: false, link: { handle: null } });
  });

  it("files route by MIME; unknown MIME is 'other'", () => {
    expect(classifyInbound({ text: "", kind: "file", mime: "video/mp4", handles })).toEqual({ route: "file", media: "video" });
    expect(classifyInbound({ text: "", kind: "file", mime: "image/jpeg", handles })).toEqual({ route: "file", media: "image" });
    expect(classifyInbound({ text: "", kind: "file", mime: "audio/ogg", handles })).toEqual({ route: "file", media: "audio" });
    expect(classifyInbound({ text: "", kind: "file", mime: "application/pdf", handles })).toEqual({ route: "file", media: "other" });
  });

  it("a question about an account routes to profile-creator; their own handle does not", () => {
    expect(parseProfileAsk("why is @runwithcarly growing so fast lately", handles)).toEqual({ platform: "tiktok", handle: "runwithcarly" });
    expect(parseProfileAsk("what's @gymgirl.ig doing on insta that's working", handles)).toEqual({ platform: "instagram", handle: "gymgirl.ig" });
    expect(parseProfileAsk("why is @runwithmaya growing", handles)).toBeNull();
    expect(parseProfileAsk("look at https://www.tiktok.com/@x/video/1 why is @x growing", handles)).toBeNull();
    expect(classifyInbound({ text: "hows @fastguy doing", kind: "inbound", handles })).toEqual({ route: "profile", platform: "tiktok", handle: "fastguy" });
  });

  it("asksForOpinion catches the phrasings", () => {
    expect(asksForOpinion("will this go viral")).toBe(true);
    expect(asksForOpinion("thoughts?")).toBe(true);
    expect(asksForOpinion("what time is it")).toBe(false);
  });
});

describe("commands are rows", () => {
  it("stop pauses the plan (the gate then refuses), resume restores it, and each answers in one line", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { plan: { status: "active", founding: true }, channel: { paired: true }, timezone: "UTC" }));
    const stop = await t.mutation(internal.agent.commands.apply, { creatorId, command: "stop" });
    expect(stop.body).toMatch(/paused/);
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.plan.status).toBe("paused");
    const rails = await t.query(internal.scout.gate.railsFor, { creatorId, now: Date.UTC(2026, 8, 2, 13, 0) });
    expect(rails?.rails.ok).toBe(false);
    expect(rails?.rails.reason).toMatch(/paused/);
    const resume = await t.mutation(internal.agent.commands.apply, { creatorId, command: "resume" });
    expect(resume.body).toMatch(/back on/);
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.plan.status).toBe("active");
  });

  it("forget tombstones the most recent live note and says which", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { notes: [{ id: "n1", text: "training for chicago", kind: "life", at: 1 }, { id: "n2", text: "hates filming mornings", kind: "fact", at: 2 }] }));
    const r = await t.mutation(internal.agent.commands.apply, { creatorId, command: "forget" });
    expect(r.body).toContain("hates filming mornings");
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    expect(c?.notes.find((n) => n.id === "n2")?.tombstonedAt).toBeTypeOf("number");
    expect(c?.notes.find((n) => n.id === "n1")?.tombstonedAt).toBeUndefined();
  });

  it("delete never happens from a text; it points at Settings", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    const r = await t.mutation(internal.agent.commands.apply, { creatorId, command: "delete" });
    expect(r.body).toMatch(/Settings/);
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.plan.status).not.toBe("deleting");
  });
});
