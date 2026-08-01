import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { toEntry } from "../archive";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 1, 9, 0, 0);
const DAY = 86_400_000;

async function seedCustomer(
  t: ReturnType<typeof convexTest>,
  suffix: string
): Promise<Id<"customers">> {
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

async function seedPlacement(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  over: Partial<Doc<"placements">> = {}
): Promise<Id<"placements">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("placements", {
      customerId,
      kind: "post",
      channel: "x",
      url: "https://x.com/a/1",
      linkStatus: "live",
      publishedAt: NOW,
      snapshotText: "a post about something",
      idempotencyKey: `idem_${Math.round(over.publishedAt ?? NOW)}_${
        over.snapshotText ?? "d"
      }_${over.channel ?? "x"}`,
      ...over,
    })
  );
}

describe("search", () => {
  it("finds a placement by its text", async () => {
    // §16.8.2: "find that post about pricing" has to work, or the archive is a
    // scroll rather than a resource. ~1,500 rows a year is past the point where
    // scrolling substitutes for search.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "find");
    await seedPlacement(t, customerId, {
      snapshotText: "why we raised our pricing last month",
    });
    await seedPlacement(t, customerId, {
      snapshotText: "a totally unrelated thought about onboarding",
      publishedAt: NOW + 1,
    });

    const hits = await t.query(internal.maya.archive.search, {
      customerId,
      query: "pricing",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].snapshotText).toMatch(/pricing/);
  });

  it("ONE CUSTOMER NEVER SEES ANOTHER'S ARCHIVE", async () => {
    // The cross-tenant test that matters most here: search is the one read path
    // where a naive implementation ranks across every tenant's rows first and
    // filters after, which leaks both content and ranking.
    const t = convexTest(schema, modules);
    const mine = await seedCustomer(t, "mine");
    const theirs = await seedCustomer(t, "theirs");
    await seedPlacement(t, theirs, {
      snapshotText: "their confidential pricing experiment",
    });

    const hits = await t.query(internal.maya.archive.search, {
      customerId: mine,
      query: "pricing",
    });
    expect(hits).toEqual([]);
  });

  it("an empty query returns nothing rather than everything", async () => {
    // A blank search field that dumps the whole archive looks like a bug and
    // costs a full scan.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "blank");
    await seedPlacement(t, customerId, { snapshotText: "something" });

    expect(
      await t.query(internal.maya.archive.search, { customerId, query: "   " })
    ).toEqual([]);
  });

  it("filters by channel", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "chan");
    await seedPlacement(t, customerId, {
      channel: "x",
      snapshotText: "shipping notes",
    });
    await seedPlacement(t, customerId, {
      channel: "tiktok",
      snapshotText: "shipping notes",
      publishedAt: NOW + 1,
    });

    const hits = await t.query(internal.maya.archive.search, {
      customerId,
      query: "shipping",
      channel: "tiktok",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].channel).toBe("tiktok");
  });

  it("filters by kind", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "kind");
    await seedPlacement(t, customerId, {
      kind: "post",
      snapshotText: "answering the latency question",
    });
    await seedPlacement(t, customerId, {
      kind: "reply",
      snapshotText: "answering the latency question",
      publishedAt: NOW + 1,
    });

    const hits = await t.query(internal.maya.archive.search, {
      customerId,
      query: "latency",
      kind: "reply",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe("reply");
  });

  it("filters by date range, inclusive at both ends", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "dates");
    await seedPlacement(t, customerId, {
      snapshotText: "quarterly retro",
      publishedAt: NOW - 10 * DAY,
    });
    await seedPlacement(t, customerId, {
      snapshotText: "quarterly retro",
      publishedAt: NOW,
    });

    const recent = await t.query(internal.maya.archive.search, {
      customerId,
      query: "retro",
      since: NOW - DAY,
    });
    expect(recent).toHaveLength(1);
    expect(recent[0].publishedAt).toBe(NOW);

    // Inclusive: a placement exactly on the boundary is inside the window.
    const boundary = await t.query(internal.maya.archive.search, {
      customerId,
      query: "retro",
      since: NOW,
      until: NOW,
    });
    expect(boundary).toHaveLength(1);
  });
});

describe("timeline", () => {
  it("is newest first — the feed order, not insertion order", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "tl");
    await seedPlacement(t, customerId, {
      snapshotText: "oldest",
      publishedAt: NOW - 2 * DAY,
    });
    await seedPlacement(t, customerId, {
      snapshotText: "newest",
      publishedAt: NOW,
    });
    await seedPlacement(t, customerId, {
      snapshotText: "middle",
      publishedAt: NOW - DAY,
    });

    const rows = await t.query(internal.maya.archive.timeline, { customerId });
    expect(rows.map((r) => r.snapshotText)).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
  });

  it("is scoped to one customer", async () => {
    const t = convexTest(schema, modules);
    const mine = await seedCustomer(t, "tl_mine");
    const theirs = await seedCustomer(t, "tl_theirs");
    await seedPlacement(t, theirs, { snapshotText: "not mine" });

    expect(
      await t.query(internal.maya.archive.timeline, { customerId: mine })
    ).toEqual([]);
  });
});

describe("A DEAD LINK IS NEVER A BROKEN TAP", () => {
  // §16.8.1. An archive that renders a 404 as a normal entry is worse than no
  // archive: it looks like a record and behaves like a lie.
  const base = {
    _id: "p1" as Id<"placements">,
    _creationTime: NOW,
    customerId: "c1" as Id<"customers">,
    kind: "post" as const,
    channel: "x",
    publishedAt: NOW,
    snapshotText: "what actually went out",
    idempotencyKey: "k",
  };

  it("a live post is tappable and carries its url", () => {
    const entry = toEntry({
      ...base,
      linkStatus: "live",
      url: "https://x.com/a/1",
    } as Doc<"placements">);
    expect(entry.tappable).toBe(true);
    expect(entry.url).toBe("https://x.com/a/1");
    expect(entry.linkNote).toBeUndefined();
  });

  it("a deleted post keeps its TEXT and loses its LINK", () => {
    // The whole reason snapshotText exists: the platform can delete the post,
    // and the record survives anyway.
    const entry = toEntry({
      ...base,
      linkStatus: "gone",
      url: "https://x.com/a/1",
    } as Doc<"placements">);
    expect(entry.tappable).toBe(false);
    expect(entry.url).toBeUndefined();
    expect(entry.linkNote).toBe("no longer live");
    expect(entry.text).toBe("what actually went out");
  });

  it("an unresolved link is not passed off as live", () => {
    const entry = toEntry({
      ...base,
      linkStatus: "unknown",
      url: "https://x.com/a/1",
    } as Doc<"placements">);
    expect(entry.tappable).toBe(false);
    expect(entry.url).toBeUndefined();
  });

  it("'live' with NO url is still not tappable", () => {
    // The sneaky one. A status field says live, but there's nothing to open —
    // checking only the status would render a tap that goes nowhere.
    const entry = toEntry({
      ...base,
      linkStatus: "live",
      url: undefined,
    } as Doc<"placements">);
    expect(entry.tappable).toBe(false);
    expect(entry.url).toBeUndefined();
  });

  it("no state produces a tappable entry without a url", () => {
    // Exhaustive over the union: `tappable` must imply `url`, always. This is
    // the property the UI relies on to never render a dead tap.
    for (const linkStatus of ["live", "gone", "unknown"] as const) {
      for (const url of ["https://x.com/a/1", undefined]) {
        const entry = toEntry({ ...base, linkStatus, url } as Doc<"placements">);
        if (entry.tappable) expect(entry.url).toBeTruthy();
        else expect(entry.linkNote).toBeTruthy();
      }
    }
  });
});

describe("provenance — the chain nobody stores (§16.8.4)", () => {
  async function seedChain(
    t: ReturnType<typeof convexTest>,
    customerId: Id<"customers">
  ) {
    return await t.run(async (ctx) => {
      const ideaId = await ctx.db.insert("ideas", {
        customerId,
        angle: "founders underprice because they benchmark against tools",
        evidenceJson: JSON.stringify({
          source: "a comment on a competitor's video",
        }),
        status: "used",
        createdAt: NOW,
        updatedAt: NOW,
      });
      const draftId = await ctx.db.insert("drafts", {
        customerId,
        ideaId,
        channel: "x",
        kind: "post",
        snapshotText: "the draft as shown",
        outcome: "edited",
        editDiff: "founder cut the last line",
        proposedAt: NOW,
        expiresAt: NOW + DAY,
      });
      const placementId = await ctx.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "x",
        url: "https://x.com/a/1",
        linkStatus: "live",
        publishedAt: NOW,
        snapshotText: "what went live",
        draftId,
        ideaId,
        formatCardId: "fc_talking_head",
        idempotencyKey: "chain",
      });
      return { ideaId, draftId, placementId };
    });
  }

  it("walks post → draft → idea → format card", async () => {
    // The most persuasive thing the product can show: this post exists because
    // someone in your niche asked this question.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "chain");
    const { placementId } = await seedChain(t, customerId);

    const chain = await t.query(internal.maya.archive.provenance, {
      customerId,
      placementId,
    });
    expect(chain?.placement.text).toBe("what went live");
    expect(chain?.draft?.proposedText).toBe("the draft as shown");
    expect(chain?.draft?.editDiff).toBe("founder cut the last line");
    expect(chain?.idea?.angle).toMatch(/underprice/);
    expect(chain?.idea?.evidenceJson).toMatch(/competitor/);
    expect(chain?.formatCardId).toBe("fc_talking_head");
    expect(chain?.brokenAt).toBeUndefined();
  });

  it("ANOTHER CUSTOMER'S PLACEMENT NEVER RESOLVES", async () => {
    const t = convexTest(schema, modules);
    const mine = await seedCustomer(t, "prov_mine");
    const theirs = await seedCustomer(t, "prov_theirs");
    const { placementId } = await seedChain(t, theirs);

    expect(
      await t.query(internal.maya.archive.provenance, {
        customerId: mine,
        placementId,
      })
    ).toBeNull();
  });

  it("degrades link by link rather than all-or-nothing", async () => {
    // A deleted draft must not hide the placement we still have.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "broken_draft");
    const { draftId, placementId } = await seedChain(t, customerId);
    await t.run((ctx) => ctx.db.delete(draftId));

    const chain = await t.query(internal.maya.archive.provenance, {
      customerId,
      placementId,
    });
    expect(chain?.placement.text).toBe("what went live");
    expect(chain?.draft).toBeUndefined();
    expect(chain?.brokenAt).toBe("draft");
  });

  it("names a missing idea as a broken link, not a missing one", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "broken_idea");
    const { ideaId, placementId } = await seedChain(t, customerId);
    await t.run((ctx) => ctx.db.delete(ideaId));

    const chain = await t.query(internal.maya.archive.provenance, {
      customerId,
      placementId,
    });
    expect(chain?.draft).toBeDefined();
    expect(chain?.idea).toBeUndefined();
    expect(chain?.brokenAt).toBe("idea");
  });

  it("a founder-directed post has no idea and that is NOT an error", async () => {
    // "Post this" from Telegram produces a real placement with no idea behind
    // it. Reporting that as broken would cry wolf on a normal path.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "direct");
    const placementId = await seedPlacement(t, customerId, {
      snapshotText: "founder said post this",
    });

    const chain = await t.query(internal.maya.archive.provenance, {
      customerId,
      placementId,
    });
    expect(chain?.placement.text).toBe("founder said post this");
    expect(chain?.draft).toBeUndefined();
    expect(chain?.brokenAt).toBeUndefined();
  });

  it("falls back to the DRAFT's idea when the placement doesn't carry one", async () => {
    // Both rows can hold ideaId. Reading only the placement's would silently
    // drop the evidence on every path that sets it on the draft alone.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "fallback");
    const placementId = await t.run(async (ctx) => {
      const ideaId = await ctx.db.insert("ideas", {
        customerId,
        angle: "only the draft knows",
        status: "used",
        createdAt: NOW,
        updatedAt: NOW,
      });
      const draftId = await ctx.db.insert("drafts", {
        customerId,
        ideaId,
        channel: "x",
        kind: "post",
        snapshotText: "d",
        outcome: "approved",
        proposedAt: NOW,
        expiresAt: NOW + DAY,
      });
      return await ctx.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "x",
        linkStatus: "unknown",
        publishedAt: NOW,
        snapshotText: "p",
        draftId, // note: no ideaId on the placement
        idempotencyKey: "fallback",
      });
    });

    const chain = await t.query(internal.maya.archive.provenance, {
      customerId,
      placementId,
    });
    expect(chain?.idea?.angle).toBe("only the draft knows");
  });

  it("a missing placement returns null rather than throwing", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "missing");
    const placementId = await seedPlacement(t, customerId);
    await t.run((ctx) => ctx.db.delete(placementId));

    expect(
      await t.query(internal.maya.archive.provenance, {
        customerId,
        placementId,
      })
    ).toBeNull();
  });
});

describe("the thumbnail field is gone and stays gone", () => {
  it("no placement row carries a thumbnailId", () => {
    // The requirement was withdrawn, not deferred: we author 100% of the
    // archive's media, so nothing is ever ingested, and sizing is a serving
    // concern rather than a stored artifact. The field is named 16 times in the
    // spec's prose, so this pins the decision against a well-meaning re-add.
    const fields = Object.keys(schema.tables.placements.validator.fields);
    expect(fields).not.toContain("thumbnailId");
    expect(fields).toContain("mediaAssetIdsJson");
  });
});
