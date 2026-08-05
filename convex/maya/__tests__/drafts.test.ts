/**
 * Drafts — the link whose absence stalled the whole sprint.
 *
 * `publish` takes a draftId and nothing created drafts. Found live: asked to
 * post a specific sentence she answered *"I can't post it because this exact
 * text doesn't have a draft record."* Her tools were complete and the publish
 * path worked; there was simply no way to write a sentence down.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { DRAFT_TTL_MS } from "../drafts";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 4, 12, 0, 0);

async function seed(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  channel: Partial<Doc<"channels">> = {}
): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "telegram",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    const customerId = await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("channels", {
      customerId,
      channel: "x",
      postingMode: "just_go",
      status: "connected",
      zernioAccountId: "acct_1",
      createdAt: NOW,
      updatedAt: NOW,
      ...channel,
    });
    return customerId;
  });
}

describe("WRITING IT DOWN IS WHAT MAKES IT POSTABLE", () => {
  it("a draft is created and can be published", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "create");

    const res = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "CSV in. Dashboard out. One paste.",
      now: NOW,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const draft = (await t.run((ctx) => ctx.db.get(res.draftId))) as Doc<"drafts">;
    expect(draft.snapshotText).toBe("CSV in. Dashboard out. One paste.");
    expect(draft.outcome).toBe("pending");
    expect(draft.kind).toBe("post");
    // Invariant 8 — a pending draft cannot sit forever.
    expect(draft.expiresAt).toBe(NOW + DRAFT_TTL_MS);
  });

  it("⭐ AN OVER-LENGTH POST IS CAUGHT AT WRITE TIME", async () => {
    // The whole reason preflight runs here as well as at publish. Catching it
    // later means either silently editing text the founder approved, or going
    // back to re-ask about something we could have rejected instantly.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "long");

    const res = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "a".repeat(400),
      now: NOW,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failure).toBe("over_length");
    // The message is written for a person, not a log.
    expect(res.message).toMatch(/too long/i);

    const rows = await t.run((ctx) => ctx.db.query("drafts").collect());
    expect(rows).toEqual([]);
  });

  it("an unconnected channel is refused with a reason", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "nochan");

    const res = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "tiktok",
      text: "hello",
      now: NOW,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/connected/i);
  });

  it("empty text is refused", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "empty");
    const res = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "   ",
      now: NOW,
    });
    expect(res.ok).toBe(false);
  });
});

describe("THE FOUNDER'S EDIT IS THE POST", () => {
  it("⭐ EDITED TEXT REPLACES snapshotText, because publishing reads THAT", async () => {
    // Leaving the original here would publish the version they rejected — the
    // single worst outcome available, since they'd have watched themselves
    // approve something else.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "edit");
    const created = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "Widgetly is a game changer for data teams.",
      now: NOW,
    });
    if (!created.ok) throw new Error("setup failed");

    await t.mutation(internal.maya.drafts.decide, {
      draftId: created.draftId,
      outcome: "edited",
      editedText: "CSV in. Dashboard out.",
      now: NOW + 1000,
    });

    const draft = (await t.run((ctx) =>
      ctx.db.get(created.draftId)
    )) as Doc<"drafts">;
    expect(draft.snapshotText).toBe("CSV in. Dashboard out.");
    expect(draft.outcome).toBe("edited");
  });

  it("the edit DIFF is kept — it's the best voice data we get", async () => {
    // §7.5.2 layer 2: {what I wrote → what they changed it to} is the
    // highest-signal training data in the system, and it costs nothing because
    // the edit already happened.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "diff");
    const created = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "Widgetly is a game changer.",
      now: NOW,
    });
    if (!created.ok) throw new Error("setup failed");

    await t.mutation(internal.maya.drafts.decide, {
      draftId: created.draftId,
      outcome: "edited",
      editedText: "csv in, dashboard out",
      now: NOW + 1000,
    });

    const draft = (await t.run((ctx) =>
      ctx.db.get(created.draftId)
    )) as Doc<"drafts">;
    const diff = JSON.parse(draft.editDiff!) as { before: string; after: string };
    expect(diff.before).toBe("Widgetly is a game changer.");
    expect(diff.after).toBe("csv in, dashboard out");
  });

  it("an approval leaves the text exactly alone", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "approve");
    const created = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "CSV in. Dashboard out.",
      now: NOW,
    });
    if (!created.ok) throw new Error("setup failed");

    await t.mutation(internal.maya.drafts.decide, {
      draftId: created.draftId,
      outcome: "approved",
      now: NOW + 1000,
    });

    const draft = (await t.run((ctx) =>
      ctx.db.get(created.draftId)
    )) as Doc<"drafts">;
    expect(draft.snapshotText).toBe("CSV in. Dashboard out.");
    expect(draft.editDiff).toBeUndefined();
  });
});

describe("A STALE DRAFT IS NOT OFFERED", () => {
  it("expired drafts drop out of pending", async () => {
    // A day-old "want me to post this?" is worse than nothing — the moment it
    // was written for has passed, and saying yes commits them to something
    // stale.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "stale");
    await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "yesterday's news",
      now: NOW,
    });

    const fresh = await t.query(internal.maya.drafts.pending, {
      customerId,
      now: NOW + 1000,
    });
    expect(fresh).toHaveLength(1);

    const later = await t.query(internal.maya.drafts.pending, {
      customerId,
      now: NOW + DRAFT_TTL_MS + 1,
    });
    expect(later).toEqual([]);
  });

  it("a decided draft is no longer pending", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "decided");
    const created = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "posted already",
      now: NOW,
    });
    if (!created.ok) throw new Error("setup failed");

    await t.mutation(internal.maya.drafts.decide, {
      draftId: created.draftId,
      outcome: "approved",
      now: NOW + 1,
    });

    const pending = await t.query(internal.maya.drafts.pending, {
      customerId,
      now: NOW + 2,
    });
    expect(pending).toEqual([]);
  });

  it("drafts are per-customer", async () => {
    const t = convexTest(schema, modules);
    const mine = await seed(t, "mine");
    const theirs = await seed(t, "theirs");
    await t.mutation(internal.maya.drafts.create, {
      customerId: mine,
      channel: "x",
      text: "my post",
      now: NOW,
    });

    const others = await t.query(internal.maya.drafts.pending, {
      customerId: theirs,
      now: NOW + 1,
    });
    expect(others).toEqual([]);
  });
});

describe("⭐ A POST TRACES TO AN IDEA, A REPLY DOES NOT", () => {
  it("a post carries its ideaId through to the draft", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "withidea");
    const ideaId = await t.run(async (ctx) =>
      ctx.db.insert("ideas", {
        customerId,
        angle: "nobody explains what it actually costs",
        evidenceJson: JSON.stringify({
          quote: "nobody explains what it actually costs",
          sourceUrls: ["https://tiktok.com/@a/video/1"],
        }),
        status: "bank",
        sourceKind: "complaint",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );

    const res = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "we don't hide pricing. it's on the page, it's one number.",
      ideaId,
      now: NOW,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const draft = (await t.run((ctx) => ctx.db.get(res.draftId))) as Doc<"drafts">;
    expect(draft.ideaId).toBe(ideaId);
  });

  it("a REPLY needs no idea — the thing being replied to is the evidence", async () => {
    // Requiring a banked idea here would stop her answering people, and §1 says
    // inbound outranks outbound.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "replynoidea");
    const res = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "that's the exact thing we fixed last month — happy to show you",
      kind: "reply",
      now: NOW,
    });
    expect(res.ok).toBe(true);
  });
});

describe("⭐ MOST POSTS DO NOT MENTION THE PRODUCT", () => {
  it("the write-post skill says so, with the failure that taught it", async () => {
    // Live, and it was hers: a genuine observation about someone building a
    // virtual coworking space, with "Widgetly keeps the dashboard part to one
    // paste" stapled underneath. The first half is a real point; the footer
    // turns the whole thing into an ad. A pitch bolted onto an observation
    // loses both halves.
    const { BUNDLED_MAYA_SKILLS } = await import(
      "../../agents/packs/maya/bundledSkills"
    );
    const writePost = BUNDLED_MAYA_SKILLS.find((s) => s.slug === "write-post");
    expect(writePost).toBeDefined();
    // Whitespace-normalised: this is prose that reflows, and a test that breaks
    // on a line wrap is a test that gets deleted rather than fixed.
    const body = writePost!.body.replace(/\s+/g, " ");
    expect(body).toMatch(/Most posts do not mention the product/i);
    // The actionable half — a rule with no test attached is a preference.
    expect(body).toMatch(/could be deleted and the post would still be good/i);
    expect(body).toMatch(/an ad, not an observation/i);
  });
});
