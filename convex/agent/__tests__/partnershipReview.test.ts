import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { investigate } from "../investigate";

vi.mock("../investigate", () => ({ investigate: vi.fn() }));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.resetAllMocks(); });

it("delivers only the tool's exact review even when the model returns a different pitch", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const creatorId = await t.run(ctx => seedCreator(ctx, "review", { plan: { status: "comped", tier: "partner", founding: false } }));
  const { messageId } = await t.mutation(internal.core.messages.recordInbound, { creatorId, surface: "web", body: "draft the brand pitch" });
  vi.mocked(investigate).mockImplementation(async ctx => {
    await ctx.runMutation(internal.core.messages.send, { creatorId, surface: "web", body: "Exact reviewed pitch. SEND abc", dedupeKey: "partner-review:test", proactive: false, kind: "reply" });
    return { content: "Here is a DIFFERENT pitch with different terms", ended: "answer", turns: 2, trace: [{ tool: "partnership_draft", ok: true, params: {}, why: "requested draft", ms: 1 }] };
  });
  expect(await t.action(internal.agent.converse.run, { creatorId, messageId, rerouted: true })).toEqual({ ok: true });
  const out = await t.run(async ctx => (await ctx.db.query("messages").withIndex("by_creator_and_ts", q => q.eq("creatorId", creatorId)).collect()).filter(m => m.direction === "out"));
  expect(out.map(m => m.body)).toEqual(["Exact reviewed pitch. SEND abc"]);
});
