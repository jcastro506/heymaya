/**
 * Show, don't tell (plan §22, 2026-09-08). Three doors, one path; the five mandatory
 * categories: cross-tenant, budget × action fail-closed, adversarial input, sibling
 * coherence (the job kind, the button, the tool, the weights), and no TODOs.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { FAILED_LINE, MAX_FRAMES, MIN_FRAMES, framePrompt, outOfSketchesLine, planFromModel, shouldDrawProactively, sniffImage } from "../frames";
import { bytesToBase64, dataUrlToBytes, generateImage, imageRequestBody, parseImageResponse } from "../../integrations/openrouter/images";
import { mediaGroupBody } from "../../integrations/telegram/client";
import { HANDLED_KINDS, LONG_KINDS } from "../../core/scheduler";
import { WEIGHTS } from "../../taste/affinities";
import { THRESHOLDS } from "../../config/thresholds";
import { TOOLS, TOOL_CREDITS } from "../tools";
import { PROBES } from "../../eval/converse";

const NOW = Date.now();
const produced = { skillVersion: "t", model: "m", thresholdsVersion: "t" };

async function seedIdea(t: ReturnType<typeof convexTest>, creatorId: string, extra: Record<string, unknown> = {}) {
  return await t.run((ctx) => ctx.db.insert("ideas", { creatorId, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook: "the shoe rack list", onScreenText: "5 things", lengthSec: 25 }, messageText: "open on the shoe rack", produced, sentAt: NOW - 3_600_000, status: "sent", createdAt: NOW - 3_600_000, ...extra } as never));
}

describe("frames: the pure parts", () => {
  it("the writer's plan is clamped to two-to-four frames and stripped of markdown (adversarial)", () => {
    const six = planFromModel(JSON.stringify({ style: "**bright**", them: "unknown", intro: "# rough sketch", frames: Array.from({ length: 6 }, (_, i) => ({ scene: `scene ${i}`, onScreen: "x".repeat(400), caption: "`c`" })) }));
    expect(six.ok).toBe(true);
    if (six.ok) {
      expect(six.plan.frames.length).toBe(MAX_FRAMES);
      expect(six.plan.style).toBe("bright");
      expect(six.plan.intro).toBe("rough sketch");
      expect(six.plan.them, "an unknown them is an empty line, never the word in the prompt").toBe("");
      expect(six.plan.frames[0].onScreen.length).toBe(60);
      expect(six.plan.frames[0].caption).toBe("c");
    }
    const one = planFromModel(JSON.stringify({ frames: [{ scene: "only one" }] }));
    expect(one.ok).toBe(false);
    expect(planFromModel("not json at all").ok).toBe(false);
    expect(planFromModel(JSON.stringify({ frames: [{ scene: "" }, { scene: "" }, { scene: "real" }] })).ok).toBe(false);
    expect(MIN_FRAMES).toBe(2);
  });

  it("every frame prompt carries the rails in code: no face, no interface, no numbers, the exact on-screen text", () => {
    const plan = { style: "morning light", them: "grey hoodie from behind, the narrow flat, the fluffy dog", intro: "i", frames: [{ scene: "a rack", onScreen: "5 things", caption: "c" }, { scene: "a door", onScreen: "", caption: "c" }] };
    const p0 = framePrompt(plan, 0, true);
    expect(p0, "what she knows of them is pinned into every frame").toMatch(/The person and their place, the same in every frame: grey hoodie from behind, the narrow flat, the fluffy dog/);
    expect(framePrompt({ ...plan, them: "" }, 0, false)).not.toMatch(/The person and their place/);
    expect(p0).toMatch(/No recognisable face/);
    expect(p0).toMatch(/No app interface, no view counts or numbers, no logos, no watermarks/);
    expect(p0).toMatch(/"5 things"/);
    expect(p0).toMatch(/reference photos/);
    const p1 = framePrompt(plan, 1, false);
    expect(p1).toMatch(/No text anywhere/);
    expect(p1).not.toMatch(/reference photos/);
  });

  it("a reference still is what its bytes say, never what the CDN says", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]).buffer)).toBe("image/jpeg");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer)).toBe("image/png");
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]).buffer)).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<html>not an image").buffer as ArrayBuffer)).toBeNull();
    expect(sniffImage(new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]).buffer), "HEIC is not something the image model reads").toBeNull();
  });

  it("the scout draws only a visual pick that landed, inside the week's budget", () => {
    expect(shouldDrawProactively({ visual: true, weekCount: 0, sent: true }), "true only while the cap is above zero").toBe(THRESHOLDS.framesPerWeek > 0);
    expect(shouldDrawProactively({ visual: false, weekCount: 0, sent: true })).toBe(false);
    expect(shouldDrawProactively({ visual: true, weekCount: THRESHOLDS.framesPerWeek, sent: true })).toBe(false);
    expect(shouldDrawProactively({ visual: true, weekCount: 0, sent: false })).toBe(false);
    expect(outOfSketchesLine()).toContain(String(THRESHOLDS.framesPerWeek));
  });

  it("the image request is the unified image shape, and the response is read from message.images or a content part", () => {
    const ref = new Uint8Array([1, 2, 3]).buffer;
    const body = imageRequestBody({ model: "google/x", prompt: "p", references: [{ bytes: ref, mimeType: "image/jpeg" }], aspectRatio: "9:16" }) as { modalities: string[]; image_config: { aspect_ratio: string }; messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }> };
    expect(body.modalities).toEqual(["image", "text"]);
    expect(body.image_config.aspect_ratio).toBe("9:16");
    expect(body.messages[0].content[0].type).toBe("text");
    expect(body.messages[0].content[1].image_url?.url).toBe(`data:image/jpeg;base64,${bytesToBase64(ref)}`);
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(parseImageResponse({ choices: [{ message: { images: [{ image_url: { url: png } }] } }], usage: { cost: 0.04 } })).toEqual({ ok: true, dataUrl: png, costUsd: 0.04 });
    expect(parseImageResponse({ choices: [{ message: { content: [{ type: "image_url", image_url: { url: png } }] } }] })).toMatchObject({ ok: true, dataUrl: png });
    expect(parseImageResponse({ choices: [{ message: { content: "sorry" } }] })).toMatchObject({ ok: false });
    expect(parseImageResponse({ error: { message: "blocked" } })).toMatchObject({ ok: false, reason: expect.stringContaining("blocked") });
    const back = dataUrlToBytes(png);
    expect(back?.mimeType).toBe("image/png");
    expect(back && new Uint8Array(back.bytes)[0]).toBe(0x89);
    expect(dataUrlToBytes("https://not-a-data-url")).toBeNull();
  });

  it("no API key is a named failure, never a throw (fail-closed)", async () => {
    const was = process.env.MODEL_FAKE;
    delete process.env.MODEL_FAKE;
    try {
      const r = await generateImage({ model: "google/x", prompt: "p", apiKey: "" });
      expect(r).toEqual({ ok: false, reason: "no OpenRouter API key" });
      const http = await generateImage({ model: "google/x", prompt: "p", apiKey: "k", fetchImpl: (async () => new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429, statusText: "Too Many" })) as typeof fetch });
      expect(http).toMatchObject({ ok: false, reason: expect.stringMatching(/HTTP 429.*rate limited/) });
      // The provider's own words ride along; "Provider returned error" on its own diagnosed nothing live.
      const wrapped = await generateImage({ model: "google/x", prompt: "p", apiKey: "k", fetchImpl: (async () => new Response(JSON.stringify({ error: { message: "Provider returned error", metadata: { raw: "Request payload size exceeds the limit", provider_name: "Google" } } }), { status: 400 })) as typeof fetch });
      expect(wrapped).toMatchObject({ ok: false, reason: expect.stringMatching(/Provider returned error · Request payload size exceeds the limit/) });
    } finally {
      if (was !== undefined) process.env.MODEL_FAKE = was;
    }
  });

  it("the album body is Telegram's media group: photos by URL, ten at most, captions capped", () => {
    const body = mediaGroupBody({ chatId: "1", media: Array.from({ length: 12 }, (_, i) => ({ url: `https://x/${i}`, caption: "c".repeat(2000) })) }) as { chat_id: string; media: Array<{ type: string; media: string; caption: string }> };
    expect(body.media.length).toBe(10);
    expect(body.media[0]).toMatchObject({ type: "photo", media: "https://x/0" });
    expect(body.media[0].caption.length).toBe(1024);
  });

  it("sibling coherence: the job kind stays; the skill is OFF her belt (2026-09-08)", () => {
    expect(HANDLED_KINDS.has("render_frames")).toBe(true);
    expect(LONG_KINDS.has("render_frames"), "an image fan-out takes tens of seconds; it must not run inline in the drain").toBe(true);
    expect(TOOLS.some((t) => t.function.name === "show_frames"), "no tool").toBe(false);
    expect(TOOL_CREDITS.show_frames).toBeUndefined();
    expect(WEIGHTS.frames).toBeGreaterThan(0);
    expect(THRESHOLDS.framesPerWeek, "zero sketches a week: the budget knob, not a boolean").toBe(0);
    expect(PROBES.filter((p) => p.category === "frames").length).toBeGreaterThanOrEqual(1);
    const scout = readFileSync(new URL("../../scout/scout.ts", import.meta.url), "utf8");
    const moment = readFileSync(new URL("../moment.ts", import.meta.url), "utf8");
    const converse = readFileSync(new URL("../converse.ts", import.meta.url), "utf8");
    for (const src of [scout, moment]) expect(src, "no button").not.toMatch(/idea:\$\{ideaId\}:frames/);
    expect(converse, "a stray tap still has a handler and is refused by the cap").toMatch(/shotlist\|notme\|save\|frames/);
    expect(scout).not.toMatch(/"visual": false/);
    const soul = readFileSync(new URL("../soul.ts", import.meta.url), "utf8");
    expect(soul, "nothing in the soul").not.toMatch(/show_frames/);
    for (const f of ["../frames.ts", "../../integrations/openrouter/images.ts"]) expect(readFileSync(new URL(f, import.meta.url), "utf8")).not.toMatch(/TODO|FIXME/);
  });
});

describe("frames: the three doors, on the fake model (with the cap raised for the test; it is 0 in the product)", () => {
  const knob = THRESHOLDS as unknown as { framesPerWeek: number };
  beforeEach(() => { process.env.MODEL_FAKE = "1"; delete process.env.FRAMES_FAKE_FAIL; knob.framesPerWeek = 5; });
  afterEach(() => { delete process.env.FRAMES_FAKE_FAIL; knob.framesPerWeek = 0; });

  it("with the cap at zero, a tap draws nothing and no image is asked for (the product's state)", async () => {
    knob.framesPerWeek = 0;
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const ideaId = await seedIdea(t, creatorId);
    const r = await t.action(internal.agent.frames.render, { creatorId, ideaId, requestedBy: "tap", requestId: "tap:0" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/spent/);
    expect((await t.run((ctx) => ctx.db.query("costEvents").collect())).length).toBe(0);
  });

  it("a render draws the frames onto the idea, sends one album row, and records a cost row per frame", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const ideaId = await seedIdea(t, creatorId);
    const r = await t.action(internal.agent.frames.render, { creatorId, ideaId, requestedBy: "tap", requestId: "tap:1" });
    expect(r).toMatchObject({ ok: true, reason: "drawn", frames: 3 });
    const idea = await t.run((ctx) => ctx.db.get(ideaId));
    expect(idea?.frames?.length).toBe(3);
    expect(idea?.framesBy).toBe("tap");
    expect(typeof idea?.framesAt).toBe("number");
    const out = await t.run((ctx) => ctx.db.query("messages").collect());
    const album = out.filter((m) => m.kind === "frames");
    expect(album.length).toBe(1);
    expect(album[0].frames?.length).toBe(3);
    expect(album[0].proactive, "an album is an attachment to an idea already counted; it never eats a daily slot").toBe(false);
    expect(album[0].frames?.[0].caption).toBe("open on the rack, not your face");
    const costs = await t.run((ctx) => ctx.db.query("costEvents").collect());
    expect(costs.filter((c) => c.kind.startsWith("frames:")).length).toBe(3);
    // Again: cached, free, one more row and no new files.
    const again = await t.action(internal.agent.frames.render, { creatorId, ideaId, requestedBy: "ask", requestId: "ask:2" });
    expect(again).toMatchObject({ ok: true, reason: "cached", costUsd: 0 });
    expect((await t.run((ctx) => ctx.db.query("costEvents").collect())).filter((c) => c.kind.startsWith("frames:")).length).toBe(3);
  });

  it("the sixth sketch of the week is refused with a line, and no image is made (budget × action)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    for (let i = 0; i < THRESHOLDS.framesPerWeek; i++) await seedIdea(t, creatorId, { framesAt: NOW - i * 3_600_000, framesBy: "tap", frames: [] });
    const ideaId = await seedIdea(t, creatorId);
    const r = await t.action(internal.agent.frames.render, { creatorId, ideaId, requestedBy: "tap", requestId: "tap:9" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/spent/);
    const idea = await t.run((ctx) => ctx.db.get(ideaId));
    expect(idea?.frames).toBeUndefined();
    const out = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(out.length).toBe(1);
    expect(out[0].body).toBe(outOfSketchesLine());
    expect((await t.run((ctx) => ctx.db.query("costEvents").collect())).length).toBe(0);
    // The scout asked on its own: the creator hears nothing about a limit they never hit.
    const quiet = await t.action(internal.agent.frames.render, { creatorId, ideaId, requestedBy: "scout", requestId: "scout" });
    expect(quiet.ok).toBe(false);
    expect((await t.run((ctx) => ctx.db.query("messages").collect())).length).toBe(1);
  });

  it("another creator's idea is not theirs to draw (cross-tenant)", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { channel: { paired: true } }));
    const ideaOfB = await seedIdea(t, b);
    const r = await t.action(internal.agent.frames.render, { creatorId: a, ideaId: ideaOfB, requestedBy: "tap", requestId: "tap:x" });
    expect(r).toMatchObject({ ok: false, reason: "not their idea" });
    expect(await t.run((ctx) => ctx.db.query("messages").collect())).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(ideaOfB)))?.frames).toBeUndefined();
  });

  it("images that fail to come back are a named failure and one honest line, never silence", async () => {
    process.env.FRAMES_FAKE_FAIL = "1";
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const ideaId = await seedIdea(t, creatorId);
    const r = await t.action(internal.agent.frames.render, { creatorId, ideaId, requestedBy: "tap", requestId: "tap:f" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/0 of 3 frames/);
    const out = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(out.map((m) => m.body)).toEqual([FAILED_LINE]);
    expect((await t.run((ctx) => ctx.db.get(ideaId)))?.frames).toBeUndefined();
    // The attempts still cost: one row per frame, primary and fallback both refused.
    expect((await t.run((ctx) => ctx.db.query("costEvents").collect())).length).toBe(3);
  });

  it("door one, the tap: taste recorded, a reply now, a render job queued", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const ideaId = await seedIdea(t, creatorId);
    const messageId = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", kind: "button", body: `idea:${ideaId}:frames`, ts: NOW } as never));
    const r = await t.action(internal.agent.converse.run, { creatorId, messageId });
    expect(r.ok).toBe(true);
    const taste = await t.run((ctx) => ctx.db.query("tasteEvents").collect());
    expect(taste.map((e) => e.kind)).toEqual(["frames"]);
    const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
    const render = jobs.find((j) => j.kind === "render_frames");
    expect(render, "the tap must queue a render").toBeTruthy();
    expect(JSON.parse(render!.payloadJson ?? "{}")).toMatchObject({ ideaId, requestedBy: "tap" });
    const replies = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
    expect(replies.length).toBeGreaterThanOrEqual(1);
    expect(replies[0].body).toMatch(/drawing it/);
  });

  it.skip("door two, in words: the tool is off her belt (kept for the day it returns)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    // No idea yet: refused, and the refusal tells her what to say.
    const refused = await t.action(internal.agent.frames.devToolProbe, { creatorId, idea: undefined });
    expect(refused).toMatch(/^refused/);
    const older = await seedIdea(t, creatorId, { version: { hook: "the dog at the tv" }, messageText: "the dog", sentAt: NOW - 7_200_000, createdAt: NOW - 7_200_000 });
    const latest = await seedIdea(t, creatorId);
    const ok = await t.action(internal.agent.frames.devToolProbe, { creatorId, idea: undefined });
    expect(ok).toMatch(/^ok: the frames for "the shoe rack list"/);
    expect(ok).toMatch(/Do not describe the frames/);
    const byHint = await t.action(internal.agent.frames.devToolProbe, { creatorId, idea: "the dog one" });
    expect(byHint).toMatch(/"the dog at the tv"/);
    const jobs = (await t.run((ctx) => ctx.db.query("jobs").collect())).filter((j) => j.kind === "render_frames");
    expect(jobs.map((j) => JSON.parse(j.payloadJson ?? "{}").ideaId).sort()).toEqual([latest, older].sort());
    expect(jobs.every((j) => JSON.parse(j.payloadJson ?? "{}").requestedBy === "ask")).toBe(true);
  });

  it.skip("door three, the scout: proactive drawing is off (kept for the day it returns)", async () => {
    process.env.SCRAPE_FIXTURES = "spec";
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 8, 13)); // 13:00 UTC, outside quiet hours
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", channel: { paired: true }, dossier: { persona: { summary: "runner" }, keywords: ["running"], cadence: { postsPerWeek: 2 } }, plan: { status: "active", founding: true } }));
    const trackedId = await t.run((ctx) => ctx.db.insert("trackedAccounts", { creatorId, platform: "tiktok", handle: "runwithcarly", status: "active", addedBy: "creator", baselineN: 12, medianPace24h: 4000, createdAt: NOW } as never));
    await t.run((ctx) => ctx.db.insert("signals", { creatorId, kind: "breakout", sourcePostIds: ["7395965676629888274"], trackedAccountId: trackedId, score: 6.2, corroboration: { accounts: 2, soundRising: false }, verdict: "pending", why: "6.2x their normal after 9h; https://www.tiktok.com/@runwithcarly/video/7395965676629888274", thresholdsVersion: "t", createdAt: NOW - 3_600_000 } as never));
    const r = await t.action(internal.scout.scout.run, { creatorId });
    expect(r.sent, r.reason).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const idea = (await t.run((ctx) => ctx.db.query("ideas").collect()))[0];
    const sentMsg = (await t.run((ctx) => ctx.db.query("messages").collect())).find((m) => m.kind === "scout");
    expect(sentMsg?.buttons?.some((b) => b.id === `idea:${idea._id}:frames` && b.label === "show me")).toBe(true);
    const jobs = (await t.run((ctx) => ctx.db.query("jobs").collect())).filter((j) => j.kind === "render_frames");
    expect(jobs.length, "the fake scout marks its pick visual; a render must follow the idea").toBe(1);
    expect(JSON.parse(jobs[0].payloadJson ?? "{}")).toMatchObject({ ideaId: idea._id, requestedBy: "scout" });
    expect(jobs[0].idempotencyKey).toBe(`frames:${idea._id}:scout`);
    vi.useRealTimers();
  });
});
