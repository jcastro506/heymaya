import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { LONG_KINDS } from "../scheduler";

describe("a long job never blocks the drain (live 2026-09-06)", () => {
  it("the catalogue read is handed to its own action and a delivery queued behind it is claimed by the next drain", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const now = Date.now();
    const base = { creatorId, status: "queued" as const, attempts: 0, maxAttempts: 3, runAfter: now - 1000, deadlineAt: now + 600_000, createdAt: now - 1000, updatedAt: now - 1000 };
    const ingestId = await t.run((ctx) => ctx.db.insert("jobs", { ...base, kind: "ingest_catalogue", idempotencyKey: "ingest:test", payloadJson: "{}" }));
    const deliverId = await t.run((ctx) => ctx.db.insert("jobs", { ...base, kind: "deliver_message", idempotencyKey: "deliver:test", runAfter: now - 500, payloadJson: JSON.stringify({ messageId: "missing" }) }));
    expect(LONG_KINDS.has("ingest_catalogue")).toBe(true);
    // One drain, only the long kind: it is claimed and handed off, the drain returns.
    const first = await t.action(internal.core.scheduler.drainJobs, { kinds: ["ingest_catalogue"], max: 1 });
    expect(first.claimed).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(ingestId)))?.status, "claimed and running out of band").toBe("running");
    // The delivery is claimable right away, with the ingest still running.
    const second = await t.action(internal.core.scheduler.drainJobs, { kinds: ["deliver_message"], max: 1 });
    expect(second.claimed).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(deliverId)))?.attempts).toBe(1);
  });
});
