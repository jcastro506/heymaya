/**
 * M4 core: what they did in the app reaches her context once (app spec §7.2–7.3).
 * Mandatory: cross-tenant isolation (A's actions never in B's context).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../../tests/_modules";
import { seedCreator } from "../../tests/lib/creatorRow";
import { appActionsSection } from "../core/act";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await seedCreator(ctx, "a", { clerkUserId: "user_a" });
    const b = await seedCreator(ctx, "b", { clerkUserId: "user_b" });
    const idea = (creatorId: typeof a, hook: string) => ctx.db.insert("ideas", { creatorId, evidenceLinks: [], fit: "yes", fitWhy: "f", version: { hook }, messageText: "m", status: "sent", produced: { skillVersion: "t", model: "t", thresholdsVersion: "t" }, createdAt: Date.now(), sentAt: Date.now() } as never);
    return { a, b, i1: await idea(a, "the bus to the start line"), i2: await idea(a, "5am alarm") };
  });
  return { t, ...ids };
}

type T = Awaited<ReturnType<typeof setup>>;
const section = async (t: T["t"], creatorId: T["a"]) => (await t.query(internal.agent.context.gather, { creatorId }))?.history ?? "";

describe("app actions reach her context", () => {
  it("a pass in the app shows up for her, and only for that creator", async () => {
    const { t, a, b, i1 } = await setup();
    await t.withIdentity({ subject: "user_a" }).mutation(api.ui.passIdea, { id: i1 });
    expect(await section(t, a)).toMatch(/Since you last spoke, in the app[\s\S]*passed on your idea "the bus to the start line"/);
    expect(await section(t, b)).not.toMatch(/Since you last spoke/);
  });

  it("state-only kinds (a save) don't clutter her context", async () => {
    const { t, a, i2 } = await setup();
    await t.withIdentity({ subject: "user_a" }).mutation(api.ui.saveIdea, { id: i2, saved: true });
    expect(await section(t, a)).not.toMatch(/Since you last spoke/);
    const rows = await t.run((ctx) => ctx.db.query("userActions").collect());
    expect(rows.map((r) => r.kind)).toEqual(["idea.save"]); // still recorded
  });

  it("seen only when SHE speaks: a code confirmation leaves it for her next turn", async () => {
    const { t, a, i1 } = await setup();
    await t.withIdentity({ subject: "user_a" }).mutation(api.ui.passIdea, { id: i1 });
    await t.mutation(internal.core.messages.send, { creatorId: a, surface: "telegram", body: "saved.", dedupeKey: "code:1" });
    expect(await section(t, a)).toMatch(/passed on your idea/);
    await t.mutation(internal.core.messages.send, { creatorId: a, surface: "telegram", body: "fair, skipping that one", dedupeKey: "model:1", produced: { skillVersion: "s", model: "m", thresholdsVersion: "t" } });
    expect(await section(t, a)).not.toMatch(/passed on your idea/);
  });

  it("collapses repeats of one kind into one line", () => {
    const now = Date.now();
    const s = appActionsSection([1, 2, 3].map((n) => ({ kind: "idea.pass", summary: `passed on your idea "${n}"`, at: now - n * 60_000, source: "app" as const })), now);
    expect(s.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
    expect(s).toMatch(/3× idea pass/);
  });
});
