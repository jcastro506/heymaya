import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { callbacksSection, pickCallbacks, CALLBACKS } from "../callbacks";
import { textForPost } from "../postMemory";

const NOW = Date.UTC(2026, 8, 7, 14);
const day = 86_400_000;

describe("callbacks: what a friend would bring up (2026-09-07)", () => {
  it("a saved-never-filmed idea, a recent win, a live note, then their world; three at most; never a list in a message", () => {
    const cb = pickCallbacks({
      now: NOW,
      world: "the fluffy dog, the london flat, the notes app",
      posts: [
        { caption: "I have no words", createTime: NOW - 20 * day, multiple: 8.99, signature: "Candid handheld video of a pet reacting to a television screen" },
        { caption: "old hit", createTime: NOW - 90 * day, multiple: 12, signature: null },
      ],
      ideas: [
        { hook: "the tier list of apps i almost built", savedAt: NOW - 10 * day, sentAt: NOW - 11 * day, status: "sent" },
        { hook: "filmed one", savedAt: NOW - 12 * day, sentAt: NOW - 12 * day, status: "posted" },
        { hook: "too fresh", savedAt: NOW - 2 * day, sentAt: NOW - 2 * day, status: "sent" },
      ],
      notes: [{ text: "training for chicago in october", kind: "life", expiresHint: NOW + 40 * day }, { text: "never suggest dance trends", kind: "rule" }],
    });
    expect(cb.map((c) => c.kind)).toEqual(["unfilmed", "win", "note"]);
    expect(cb[0].line).toMatch(/tier list.*10 days ago; not marked posted/);
    expect(cb[1].line).toMatch(/pet reacting to a television screen.*8.99×/);
    expect(cb[1].line).not.toMatch(/old hit/);
    expect(cb[2].line).toMatch(/chicago/);
    expect(cb.length).toBeLessThanOrEqual(CALLBACKS.max);
    expect(callbacksSection(cb)).toMatch(/never as a list, never all three/);
    expect(callbacksSection([])).toBeNull();
    // With room, their world fills in.
    const few = pickCallbacks({ now: NOW, world: "the fluffy dog", posts: [], ideas: [], notes: [] });
    expect(few.map((c) => c.kind)).toEqual(["world"]);
  });

  it("a post's memory text is what it is and what she saw in it, so meaning finds it", () => {
    const t = textForPost({ caption: "I have no words", transcript: null, createTime: NOW - 20 * day, metrics: { views: 119 }, multiple: 8.99 }, { signature: "Candid handheld video of a pet reacting to a television screen in a dark room.", them: { world: "living room with a fluffy dog", humor: "observational amusement at pet reactions" }, aFriendWouldNotice: "they film the dog before they film themselves" }, "America/New_York");
    expect(t).toMatch(/"I have no words"/);
    expect(t).toMatch(/pet reacting to a television screen/);
    expect(t).toMatch(/fluffy dog/);
    expect(t).toMatch(/8.99× their normal/);
    expect(t.length).toBeLessThanOrEqual(1200);
  });

  it("their posts are a kind of memory now, and the prefix carries the callbacks", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true }, dossier: { persona: { summary: "s", world: "the fluffy dog and the london flat" }, keywords: ["running"] } }));
    await t.mutation(internal.agent.memory.upsert, { creatorId, kind: "post", refId: "p1", text: "the dog barking at the tv", embedding: Array.from({ length: 768 }, () => 0.01) });
    const rows = await t.run((ctx) => ctx.db.query("memories").collect());
    expect(rows[0].kind).toBe("post");
    const g = await t.query(internal.agent.context.gather, { creatorId });
    expect(g?.history).toMatch(/Worth calling back this week/);
    expect(g?.history).toMatch(/fluffy dog/);
  });
});
