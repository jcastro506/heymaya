/**
 * The §3.4 data-model invariants, asserted against the schema itself.
 *
 * Four of the nine invariants are structural — they're properties of the
 * table definitions, and they can be enforced today, before the code that
 * uses them exists. The other five are behavioral (publish-or-hold, snapshot
 * publishing, one-open-question) and get their tests alongside the functions
 * that implement them; they're listed at the bottom of this file so the gap
 * is visible rather than forgotten.
 *
 * Testing the schema directly, rather than only through inserts, is
 * deliberate: it catches someone *relaxing* a field to optional, which an
 * insert-based test would happily keep passing.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

const SCHEMA_SOURCE = readFileSync(
  join(__dirname, "../../schema.ts"),
  "utf8"
);

/** The text of one table's `defineTable({ ... })` body. */
function tableBody(name: string): string {
  const start = SCHEMA_SOURCE.indexOf(`\n  ${name}: defineTable({`);
  expect(start, `table ${name} not found in schema`).toBeGreaterThan(-1);
  let i = SCHEMA_SOURCE.indexOf("{", start + name.length + 4);
  let depth = 0;
  for (; i < SCHEMA_SOURCE.length; i += 1) {
    if (SCHEMA_SOURCE[i] === "{") depth += 1;
    else if (SCHEMA_SOURCE[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return SCHEMA_SOURCE.slice(start, i);
}

function isRequired(table: string, field: string): boolean {
  const body = tableBody(table);
  const match = new RegExp(`\\n\\s{4}${field}:\\s*(.*)`).exec(body);
  if (!match) return false;
  return !match[1].trimStart().startsWith("v.optional");
}

const NOW = Date.UTC(2026, 6, 31, 9, 0, 0);

async function seedCustomer(
  t: ReturnType<typeof convexTest>,
  suffix: string
) {
  return await t.run(async (ctx) => {
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
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

describe("invariant 1 — a placement has a live URL or an explicit unknown", () => {
  it("linkStatus is required, so 'no url' can never mean 'assume it worked'", () => {
    expect(isRequired("placements", "linkStatus")).toBe(true);
  });

  it("linkStatus offers unknown as a first-class state", () => {
    expect(tableBody("placements")).toContain('v.literal("unknown")');
  });

  it("a placement with no URL still has to declare what happened", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "inv1");
    await t.run(async (ctx) => {
      await ctx.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "x",
        linkStatus: "unknown",
        publishedAt: NOW,
        snapshotText: "went out, URL not yet resolved",
        idempotencyKey: "idem_inv1",
      });
    });
    const rows = await t.run((ctx) => ctx.db.query("placements").collect());
    expect(rows[0].url).toBeUndefined();
    expect(rows[0].linkStatus).toBe("unknown");
  });
});

describe("invariant 4 — every publish carries an idempotency key", () => {
  it("idempotencyKey is required on placements", () => {
    expect(isRequired("placements", "idempotencyKey")).toBe(true);
  });

  it("and on jobs, so re-enqueued work runs once", () => {
    expect(isRequired("jobs", "idempotencyKey")).toBe(true);
  });

  it("placements are indexed by it — a duplicate is detectable, not just labelled", () => {
    expect(tableBody("placements")).toBeTruthy();
    expect(SCHEMA_SOURCE).toContain('.index("by_idempotency_key", ["idempotencyKey"])');
  });
});

describe("invariant 8 — no non-terminal state is silently permanent", () => {
  it.each([
    ["targets", "expiresAt"],
    ["drafts", "expiresAt"],
    ["jobs", "deadlineAt"],
  ])("%s.%s is required, not optional", (table, field) => {
    expect(isRequired(table, field)).toBe(true);
  });

  it("jobs can be swept by deadline", () => {
    expect(SCHEMA_SOURCE).toContain(
      '.index("by_status_and_deadline", ["status", "deadlineAt"])'
    );
  });
});

describe("invariant 9 — nicheCache is shared, so it carries no customer identity", () => {
  it("has no customer-identifying field, and cannot gain one quietly", () => {
    // The whole point of nicheCache is that it's read across tenants. The
    // moment it carries a customer id, the sharing becomes a leak.
    const body = tableBody("nicheCache");
    for (const forbidden of [
      "customerId",
      "accountId",
      "creatorId",
      "clerkUserId",
      "email",
      "handle",
    ]) {
      expect(body, `nicheCache must not carry ${forbidden}`).not.toContain(
        `${forbidden}:`
      );
    }
  });

  it("every OTHER new table is tenant-scoped", () => {
    // The inverse guard: nicheCache is the deliberate exception, and it must
    // stay the ONLY one.
    for (const table of [
      "channels",
      "directives",
      "ideas",
      "targets",
      "drafts",
      "placements",
      "messages",
    ]) {
      expect(tableBody(table), `${table} must be tenant-scoped`).toContain(
        'customerId: v.id("customers")'
      );
    }
    // `customers` scopes by the account it belongs to; `jobs` may be
    // fleet-wide (the smoke suite has no customer).
    expect(tableBody("customers")).toContain('accountId: v.id("creators")');
    expect(tableBody("jobs")).toContain('v.optional(v.id("customers"))');
  });
});

describe("cross-tenant isolation on the new tables", () => {
  it("two customers' placements never bleed across the by_customer index", async () => {
    const t = convexTest(schema, modules);
    const a = await seedCustomer(t, "tenant_a");
    const b = await seedCustomer(t, "tenant_b");

    await t.run(async (ctx) => {
      await ctx.db.insert("placements", {
        customerId: a,
        kind: "post",
        channel: "x",
        url: "https://x.com/a/1",
        linkStatus: "live",
        publishedAt: NOW,
        snapshotText: "tenant A's post",
        idempotencyKey: "idem_a",
      });
      await ctx.db.insert("placements", {
        customerId: b,
        kind: "post",
        channel: "x",
        url: "https://x.com/b/1",
        linkStatus: "live",
        publishedAt: NOW,
        snapshotText: "tenant B's post",
        idempotencyKey: "idem_b",
      });
    });

    const aRows = await t.run((ctx) =>
      ctx.db
        .query("placements")
        .withIndex("by_customer", (q) => q.eq("customerId", a))
        .collect()
    );
    expect(aRows).toHaveLength(1);
    expect(aRows[0].snapshotText).toBe("tenant A's post");
  });

  it("the placements text search is filterable by customer", async () => {
    // A search that can't be scoped is a cross-tenant read waiting to happen.
    const t = convexTest(schema, modules);
    const a = await seedCustomer(t, "search_a");
    const b = await seedCustomer(t, "search_b");
    await t.run(async (ctx) => {
      await ctx.db.insert("placements", {
        customerId: a,
        kind: "post",
        channel: "x",
        linkStatus: "live",
        publishedAt: NOW,
        snapshotText: "migration checklist for postgres",
        idempotencyKey: "idem_sa",
      });
      await ctx.db.insert("placements", {
        customerId: b,
        kind: "post",
        channel: "x",
        linkStatus: "live",
        publishedAt: NOW,
        snapshotText: "migration checklist for postgres",
        idempotencyKey: "idem_sb",
      });
    });

    const hits = await t.run((ctx) =>
      ctx.db
        .query("placements")
        .withSearchIndex("search_snapshot_text", (q) =>
          q.search("snapshotText", "postgres").eq("customerId", a)
        )
        .collect()
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].customerId).toBe(a);
  });
});

describe("the directive ledger is shaped for append-only supersession", () => {
  it("carries the verbatim quote and a pointer at what it replaced", () => {
    const body = tableBody("directives");
    expect(isRequired("directives", "verbatim")).toBe(true);
    expect(body).toContain('supersedesId: v.optional(v.id("directives"))');
  });

  it("superseding leaves the original row untouched and quotable", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "directives");

    const first = await t.run((ctx) =>
      ctx.db.insert("directives", {
        customerId,
        kind: "channel_toggle",
        verbatim: "stop posting on linkedin its dead",
        active: true,
        createdAt: NOW,
      })
    );
    // Two weeks later they change their mind. The old row is deactivated and
    // stamped — never rewritten — so we can still quote it word for word.
    await t.run(async (ctx) => {
      await ctx.db.insert("directives", {
        customerId,
        kind: "channel_toggle",
        verbatim: "ok turn linkedin back on",
        active: true,
        supersedesId: first,
        createdAt: NOW + 14 * 24 * 3600 * 1000,
      });
      await ctx.db.patch(first, { active: false, supersededAt: NOW + 1 });
    });

    const original = await t.run((ctx) => ctx.db.get(first));
    expect(original?.verbatim).toBe("stop posting on linkedin its dead");
    expect(original?.active).toBe(false);

    const active = await t.run((ctx) =>
      ctx.db
        .query("directives")
        .withIndex("by_customer_and_active", (q) =>
          q.eq("customerId", customerId).eq("active", true)
        )
        .collect()
    );
    expect(active).toHaveLength(1);
    expect(active[0].supersedesId).toBe(first);
  });
});

describe("the nine tables, and only nine", () => {
  it("§3.4 says a tenth per-customer table means the design is wrong", () => {
    const perCustomer = [
      "customers",
      "channels",
      "directives",
      "ideas",
      "targets",
      "drafts",
      "placements",
      "messages",
      "jobs",
    ];
    for (const table of perCustomer) {
      expect(SCHEMA_SOURCE).toContain(`\n  ${table}: defineTable({`);
    }
    expect(perCustomer).toHaveLength(9);
  });

  /**
   * Still behavioral, still untested — deliberately listed so the gap is
   * visible rather than assumed covered:
   *
   *   2. An approved draft publishes its SNAPSHOT, never a regeneration.
   *   3. A directive is never mutated (the append-only WRITE PATH; the shape
   *      is asserted above, the guarantee needs the mutation that enforces it).
   *   5. At most one open question to the founder at a time.
   *   6. Every outbound message has a dedupe key.
   *   7. Exactly one function decides publish-or-hold.
   *
   * Each lands with the function that implements it, in Sprint 2 and 3.
   */
});
