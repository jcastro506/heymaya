/**
 * The daily memory checkpoint (§2.9.6).
 *
 * `MEMORY.md` is the one artifact on the machine that isn't reproducible. The
 * workspace is regenerated on deploy, and the memory vector index is derived —
 * `openclaw memory index --force` rebuilds it from the markdown. This is the
 * only copy of her curated memory that exists anywhere else.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { evaluate, type LivenessInput } from "../liveness";
import { hashToken } from "../hooks";
import { SNAPSHOT_RETENTION } from "../checkpoint";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 1, 6, 30, 0);
const DAY = 86_400_000;

async function seed(
  t: ReturnType<typeof convexTest>,
  suffix: string
): Promise<{ customerId: Id<"customers">; token: string }> {
  const token = `tok_${suffix}`;
  const tokenHash = await hashToken(token);
  const customerId = await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "web",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      agentTokenHash: tokenHash,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
  return { customerId, token };
}

function post(
  t: ReturnType<typeof convexTest>,
  token: string | null,
  body: unknown
): Promise<Response> {
  return t.fetch("/maya/checkpoint", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("the checkpoint stores what can't be rebuilt", () => {
  it("records the markdown and its size", async () => {
    const t = convexTest(schema, modules);
    const { customerId, token } = await seed(t, "store");
    const res = await post(t, token, {
      memoryMarkdown: "# MEMORY.md\n\n- they hate emoji\n",
    });
    const env = (await res.json()) as { ok: boolean; data?: { bytes: number } };
    expect(env.ok).toBe(true);

    const snap = await t.query(internal.maya.checkpoint.latest, { customerId });
    expect(snap?.markdown).toMatch(/hate emoji/);
    expect(snap?.bytes).toBe("# MEMORY.md\n\n- they hate emoji\n".length);
  });

  it("keeps a month of history, not just the last one", async () => {
    // Enough to recover from "dreaming promoted something wrong last week",
    // not only "the volume died last night".
    const t = convexTest(schema, modules);
    const { customerId } = await seed(t, "history");
    for (let i = 0; i < SNAPSHOT_RETENTION + 5; i += 1) {
      await t.mutation(internal.maya.checkpoint.record, {
        customerId,
        markdown: `# MEMORY.md\nday ${i}\n`,
        now: NOW + i * DAY,
      });
    }
    const all = (await t.run((ctx) =>
      ctx.db.query("memorySnapshots").collect()
    )) as Doc<"memorySnapshots">[];
    expect(all).toHaveLength(SNAPSHOT_RETENTION);
    // Oldest pruned, newest kept.
    expect(all.some((s) => s.markdown.includes(`day ${SNAPSHOT_RETENTION + 4}`))).toBe(
      true
    );
    expect(all.some((s) => s.markdown.includes("day 0"))).toBe(false);
  });

  it("one customer's history never prunes another's", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "cust_a");
    const b = await seed(t, "cust_b");
    for (let i = 0; i < SNAPSHOT_RETENTION + 3; i += 1) {
      await t.mutation(internal.maya.checkpoint.record, {
        customerId: a.customerId,
        markdown: `busy ${i}`,
        now: NOW + i * DAY,
      });
    }
    await t.mutation(internal.maya.checkpoint.record, {
      customerId: b.customerId,
      markdown: "quiet",
      now: NOW,
    });
    const quiet = await t.query(internal.maya.checkpoint.latest, {
      customerId: b.customerId,
    });
    expect(quiet?.markdown).toBe("quiet");
  });
});

describe("A SHRINKING MEMORY IS AN INCIDENT", () => {
  it("a sharp drop is recorded as an error and reported back to her", async () => {
    // This is the shape the clobber bug had: 8KB yesterday, a template today.
    // Catching it is what stops a month of learning disappearing unnoticed.
    const t = convexTest(schema, modules);
    const { customerId, token } = await seed(t, "shrink");
    await t.mutation(internal.maya.checkpoint.record, {
      customerId,
      markdown: "x".repeat(8_000),
      now: NOW - DAY,
    });

    const env = (await (
      await post(t, token, { memoryMarkdown: "# MEMORY.md\n" })
    ).json()) as { ok: boolean; why?: string; next?: string };

    expect(env.why).toMatch(/shrank/i);
    expect(env.next).toMatch(/overwrit|overwrote/i);

    const events = (await t.run((ctx) =>
      ctx.db.query("gtmAuditEvents").collect()
    )) as Doc<"gtmAuditEvents">[];
    const shrink = events.find((e) => e.eventType === "memory.shrank");
    // `error`, not `warn` — memory vanishing is invisible from the outside.
    expect(shrink?.severity).toBe("error");
  });

  it("GROWTH is never an incident", async () => {
    // Memory getting bigger is the system working. Alerting on it would train
    // the operator to ignore the alert that matters.
    const t = convexTest(schema, modules);
    const { customerId } = await seed(t, "grow");
    await t.mutation(internal.maya.checkpoint.record, {
      customerId,
      markdown: "small",
      now: NOW - DAY,
    });
    const result = await t.mutation(internal.maya.checkpoint.record, {
      customerId,
      markdown: "x".repeat(9_000),
      now: NOW,
    });
    expect(result.shrankBy).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("gtmAuditEvents").collect())).toEqual(
      []
    );
  });

  it("ordinary tidying is not an incident either", async () => {
    // She's told to keep MEMORY.md short. A 20% trim is her doing her job.
    const t = convexTest(schema, modules);
    const { customerId } = await seed(t, "tidy");
    await t.mutation(internal.maya.checkpoint.record, {
      customerId,
      markdown: "x".repeat(1_000),
      now: NOW - DAY,
    });
    const result = await t.mutation(internal.maya.checkpoint.record, {
      customerId,
      markdown: "x".repeat(800),
      now: NOW,
    });
    expect(result.shrankBy).toBeUndefined();
  });

  it("the first checkpoint is never a shrink", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seed(t, "first");
    const result = await t.mutation(internal.maya.checkpoint.record, {
      customerId,
      markdown: "# MEMORY.md\n",
      now: NOW,
    });
    expect(result.shrankBy).toBeUndefined();
  });
});

describe("the hook is tenant-safe like every other", () => {
  it("an unknown token stores nothing", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "real");
    const res = await post(t, "tok_wrong", { memoryMarkdown: "stolen" });
    expect(res.status).toBe(401);
    expect(await t.run((ctx) => ctx.db.query("memorySnapshots").collect())).toEqual(
      []
    );
  });

  it("takes no customerId — tenancy comes from the token", async () => {
    const t = convexTest(schema, modules);
    const mine = await seed(t, "mine");
    const theirs = await seed(t, "theirs");
    await post(t, mine.token, {
      memoryMarkdown: "mine",
      // Ignored: there is no such parameter.
      customerId: theirs.customerId,
    });
    expect(
      await t.query(internal.maya.checkpoint.latest, {
        customerId: theirs.customerId,
      })
    ).toBeNull();
  });

  it("a missing markdown is refused rather than storing an empty memory", async () => {
    const t = convexTest(schema, modules);
    const { token, customerId } = await seed(t, "nomd");
    const res = await post(t, token, {});
    expect(res.status).toBe(400);
    expect(
      await t.query(internal.maya.checkpoint.latest, { customerId })
    ).toBeNull();
  });
});

describe("liveness notices a machine that stops checking in", () => {
  const base: LivenessInput = {
    now: NOW,
    hourLocal: 20,
    briefSentToday: true,
    recapSentToday: true,
    placementsToday: 1,
    priorZeroDayStreak: 0,
    customerState: "active",
    hoursSinceCheckpoint: 6,
    // Established, so the new-customer grace doesn't suppress the contract.
    hoursSinceFirstSpoke: 72,
    contextTruncated: false,
  };

  it("a stale checkpoint breaches", () => {
    const breaches = evaluate({ ...base, hoursSinceCheckpoint: 72 });
    expect(breaches.map((b) => b.kind)).toContain("memory_not_checkpointed");
  });

  it("one missed day does NOT breach — 48h of grace", () => {
    // A single failed daily cron shouldn't page anyone.
    expect(evaluate({ ...base, hoursSinceCheckpoint: 30 })).toEqual([]);
  });

  it("A BRAND-NEW ACCOUNT IS NOT A BACKUP FAILURE", () => {
    // The same shape as the zero-day-streak bug that opened a support thread
    // for someone on their first morning: "never checkpointed" and "failing to
    // checkpoint" are the same query unless you clamp to account age.
    expect(
      evaluate({ ...base, hoursSinceCheckpoint: 2, everCheckpointed: false })
    ).toEqual([]);
  });

  it("truncated context breaches, and stays OPERATOR-ONLY", () => {
    // The founder can't act on this, and telling them their agent's context is
    // truncated is noise dressed as transparency.
    const breaches = evaluate({ ...base, contextTruncated: true });
    const truncated = breaches.find((b) => b.kind === "context_truncated");
    expect(truncated?.action).toBe("operator_alert_only");
  });

  it("a paused account is never nagged about backups", () => {
    expect(
      evaluate({
        ...base,
        customerState: "paused",
        hoursSinceCheckpoint: 500,
        contextTruncated: true,
      })
    ).toEqual([]);
  });
});
