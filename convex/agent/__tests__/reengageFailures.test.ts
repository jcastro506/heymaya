/**
 * Re-engagement when the model side fails (fail-closed, 2026-09-28). A nudge is a text into a silence,
 * so a line the critic rejects, or no line at all, means NO text (named, retried tomorrow). The easy-out
 * is the exit: Linq's guidance is to halt after a last message that gives an easy way out, so it must
 * never depend on a model; if the writer or the critic can't give a clean one, the fixed line goes.
 */
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { EASY_OUT_FALLBACK } from "../reengage";

const state = vi.hoisted(() => ({ critic: "fail" as "fail" | "pass", writer: "ok" as "ok" | "empty" | "down" }));

vi.mock("../critic", async (orig) => ({
  ...(await orig<typeof import("../critic")>()),
  critique: vi.fn(async () => (state.critic === "fail" ? { pass: false, problems: ["slop"], note: "generic" } : { pass: true, problems: [], note: "" })),
}));
vi.mock("../../core/llm", async (orig) => ({
  ...(await orig<typeof import("../../core/llm")>()),
  callModel: vi.fn(async () => (state.writer === "down" ? { ok: false, reason: "provider down" } : { ok: true, content: state.writer === "empty" ? "   " : "new one for you: the shoe rack list. want it?", usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 } })),
}));

const H = 3_600_000, D = 24 * H;
const T0 = Date.UTC(2026, 8, 8, 8, 30);
const produced = { skillVersion: "t", model: "m", thresholdsVersion: "t" };

async function world(t: ReturnType<typeof convexTest>, suffix: string) {
  const c = await t.run((ctx) => seedCreator(ctx, suffix, { timezone: "UTC", channel: { paired: true, pairedAt: T0 - 20 * D }, telegramChatId: `chat-${suffix}`, plan: { status: "active", founding: true } }));
  await t.run((ctx) => ctx.db.insert("messages", { creatorId: c, direction: "in", surface: "telegram", kind: "inbound", body: "ok", ts: T0 } as never));
  await t.run((ctx) => ctx.db.insert("ideas", { creatorId: c, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook: "the shoe rack list" }, messageText: "the shoe rack list", produced, status: "sent", createdAt: T0 + 0.5 * D } as never));
  return c;
}
const out = async (t: ReturnType<typeof convexTest>, c: never) => (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.creatorId === c && m.direction === "out");

beforeEach(() => { state.critic = "pass"; state.writer = "ok"; });

describe("re-engagement fails closed", () => {
  it("a critic that rejects the line twice: the nudge is held and nothing is written", async () => {
    state.critic = "fail";
    const t = convexTest(schema, modules);
    const c = await world(t, "k1");
    const r = await t.action(internal.agent.cadence.quiet, { creatorId: c as never, now: T0 + 4 * D });
    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/^held: no clean line \(slop\)/);
    expect(await out(t, c as never)).toHaveLength(0);
  });

  it("a writer that is down or empty: the nudge is held with a named reason, and tomorrow it can try again", async () => {
    const t = convexTest(schema, modules);
    const c = await world(t, "k2");
    for (const writer of ["down", "empty"] as const) {
      state.writer = writer;
      const r = await t.action(internal.agent.cadence.quiet, { creatorId: c as never, now: T0 + 4 * D });
      expect(r).toEqual({ sent: false, reason: "held: no clean line (the writer gave nothing)" });
    }
    expect(await out(t, c as never)).toHaveLength(0);
    state.writer = "ok";
    expect(await t.action(internal.agent.cadence.quiet, { creatorId: c as never, now: T0 + 5 * D })).toMatchObject({ sent: true, reason: "nudge" });
  });

  it("the easy-out never depends on a model: a rejecting critic, or a dead writer, still ends with the fixed line", async () => {
    const t = convexTest(schema, modules);
    for (const [suffix, critic, writer] of [["k3", "fail", "ok"], ["k4", "pass", "down"], ["k5", "fail", "empty"]] as const) {
      state.critic = critic; state.writer = writer;
      const c = await world(t, suffix);
      const r = await t.action(internal.agent.cadence.quiet, { creatorId: c as never, now: T0 + 16 * D });
      expect(r, `${critic}/${writer}`).toMatchObject({ sent: true, reason: "easy_out" });
      const [m] = await out(t, c as never);
      expect(m).toMatchObject({ kind: "quiet", body: EASY_OUT_FALLBACK, criticSkipped: true, proactive: true });
      // and it is still once per spell
      expect((await t.action(internal.agent.cadence.quiet, { creatorId: c as never, now: T0 + 30 * D })).reason).toBe("dormant: the easy-out has gone; nothing until they write");
    }
  });

  it("a critic-approved line goes as the writer wrote it, with its reasons marked as said so the next rung can't repeat them", async () => {
    const t = convexTest(schema, modules);
    const c = await world(t, "k6");
    expect(await t.action(internal.agent.cadence.quiet, { creatorId: c as never, now: T0 + 4 * D })).toMatchObject({ sent: true, reason: "nudge" });
    const [m] = await out(t, c as never);
    expect(m.body).toBe("new one for you: the shoe rack list. want it?");
    const row = await t.run((ctx) => ctx.db.get(c as never)) as { milestonesSaid?: string[] } | null;
    expect(row?.milestonesSaid?.some((k) => k.startsWith("reason:ideas:"))).toBe(true);
    const again = await t.query(internal.agent.reengage.inputs, { creatorId: c as never, now: T0 + 10 * D });
    expect(again?.input.reasons, "the same idea is not a reason twice").toEqual([]);
  });
});
