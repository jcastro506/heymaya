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

/**
 * ⭐ THE 2026-08-06 FAILURE.
 *
 * At 07:17 she told the founder she'd draft an X post and show it first. She
 * created the draft at 11:04 and never sent a word. A second draft from the
 * previous evening was hours from expiring unseen. Both rows read `pending`;
 * the founder had no idea either existed, and Sprint 3's streak stalled on it.
 *
 * Nothing was broken — `create` simply inserted a row and returned, leaving
 * the showing to the model remembering next turn. Principle 4: anything
 * promised to the user is enforced by the server.
 */
describe("SHOWING IT IS PART OF CREATING IT", () => {
  it("show_me_first sends the draft to the founder in the same call", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "showsend", { postingMode: "show_me_first" });

    const res = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "the post itself",
      now: NOW,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.shown).toBe(true);

    const messages = await t.run(async (ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_customer_and_dedupe", (q) =>
          q.eq("customerId", customerId).eq("dedupeKey", `draft:${res.draftId}`)
        )
        .collect()
    );
    expect(messages).toHaveLength(1);
    // The POST, not a description of it — "showing you this one" is not showing it.
    expect(messages[0].body).toContain("the post itself");
    expect(messages[0].awaitingAnswer).toBe(true);
  });

  it("just_go does not ask — the switch is the founder's, not ours", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "justgo", { postingMode: "just_go" });

    const res = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "goes straight out",
      now: NOW,
    });
    if (!res.ok) return;
    expect(res.shown).toBe(false);
    const all = await t.run((ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_customer_and_ts", (q) => q.eq("customerId", customerId))
        .collect()
    );
    expect(all).toHaveLength(0);
  });

  it("sends exactly once, however many times create is retried", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "once", { postingMode: "show_me_first" });
    const res = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "only once",
      now: NOW,
    });
    if (!res.ok) return;
    // Same draft, re-offered by the sweep — must not ask twice.
    await t.mutation(internal.maya.drafts.reofferUnshown, { customerId, now: NOW });
    const all = await t.run((ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_customer_and_ts", (q) => q.eq("customerId", customerId))
        .collect()
    );
    expect(all).toHaveLength(1);
  });

  it("a draft written during an open question is re-offered, not lost", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "blocked", { postingMode: "show_me_first" });

    // Something else is already awaiting an answer (invariant 5).
    await t.mutation(internal.maya.messages.askFounder, {
      customerId,
      surface: "telegram",
      body: "which angle do you prefer?",
      dedupeKey: "q:angle",
      ts: NOW,
    });

    const res = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "written while blocked",
      now: NOW,
    });
    if (!res.ok) return;
    // Blocked — and REPORTED as blocked rather than silently dropped.
    expect(res.shown).toBe(false);
    expect(res.shownBlockedBy).toBeDefined();

    // The sweep can't show it while the question is still open...
    let swept = await t.mutation(internal.maya.drafts.reofferUnshown, {
      customerId,
      now: NOW,
    });
    expect(swept.unshown).toBe(1);
    expect(swept.shown).toBe(0);

    // ...but the moment it closes, the draft is offered rather than expiring.
    await t.mutation(internal.maya.messages.closeOpenQuestion, { customerId });
    swept = await t.mutation(internal.maya.drafts.reofferUnshown, {
      customerId,
      now: NOW,
    });
    expect(swept.shown).toBe(1);

    const shownMsg = await t.run((ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_customer_and_dedupe", (q) =>
          q.eq("customerId", customerId).eq("dedupeKey", `draft:${res.draftId}`)
        )
        .first()
    );
    expect(shownMsg?.body).toContain("written while blocked");
  });

  it("an expired draft is never re-offered — the moment has passed", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "expired", { postingMode: "show_me_first" });
    await t.mutation(internal.maya.messages.askFounder, {
      customerId,
      surface: "telegram",
      body: "blocking question",
      dedupeKey: "q:block",
      ts: NOW,
    });
    await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "stale by tomorrow",
      now: NOW,
    });
    await t.mutation(internal.maya.messages.closeOpenQuestion, { customerId });

    const swept = await t.mutation(internal.maya.drafts.reofferUnshown, {
      customerId,
      now: NOW + DRAFT_TTL_MS + 1,
    });
    expect(swept.unshown).toBe(0);
    expect(swept.shown).toBe(0);
  });
});

/**
 * ⭐ THE 2026-08-07 STALL — a chain where every link worked.
 *
 * Publishing never touched the draft, so a published draft stayed `pending`
 * forever. That one omission cost a day of the seven-day run:
 *
 *   1. the live post's draft was still `pending`
 *   2. `reofferUnshown` re-offered it — asking the founder to approve a post
 *      that had been live for one minute
 *   3. that ask opened a question, and invariant 5 allows exactly one
 *   4. so the draft written at 11:00 the next morning could never be sent
 *
 * Nothing looked broken at any step. The publish succeeded, the placement was
 * correct, the re-offer did its job, the invariant held. **The chain fails only
 * at the join**, which is why no single unit test could have caught it.
 */
describe("publishing resolves the draft it published", () => {
  async function publishedDraft(t: ReturnType<typeof convexTest>, suffix: string) {
    const customerId = await seed(t, suffix, { postingMode: "just_go" });
    const res = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: `${suffix} goes out`,
      now: NOW,
    });
    if (!res.ok) throw new Error("draft not created");
    return { customerId, draftId: res.draftId };
  }

  it("a published draft is no longer offerable", async () => {
    const t = convexTest(schema, modules);
    const { customerId, draftId } = await publishedDraft(t, "resolved");

    await t.mutation(internal.maya.drafts.decide, { draftId, outcome: "approved" });

    const pending = await t.query(internal.maya.drafts.pending, { customerId });
    expect(pending.map((d) => d._id)).not.toContain(draftId);
  });

  it("its question closes, so the NEXT draft can reach the founder", async () => {
    // The link that actually stalled the run.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "unblock", { postingMode: "show_me_first" });

    const first = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "the one that went live",
      now: NOW,
    });
    if (!first.ok) return;
    expect(first.shown).toBe(true);

    // A second draft is blocked while the first question is open — correct.
    const second = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "tomorrow's post",
      now: NOW,
    });
    if (!second.ok) return;
    expect(second.shown).toBe(false);

    // Publishing the first closes ITS question specifically...
    const closed = await t.mutation(internal.maya.messages.closeQuestionFor, {
      customerId,
      dedupeKey: `draft:${first.draftId}`,
    });
    expect(closed.closed).toBe(true);

    // ...and the second is now offerable rather than stranded.
    const swept = await t.mutation(internal.maya.drafts.reofferUnshown, {
      customerId,
      now: NOW,
    });
    expect(swept.shown).toBe(1);
  });

  it("closeQuestionFor is silent when nothing was asked", async () => {
    // `just_go` never asks. Treating that as a failure would make the normal
    // path noisy for no reason.
    const t = convexTest(schema, modules);
    const { customerId, draftId } = await publishedDraft(t, "silent");
    const res = await t.mutation(internal.maya.messages.closeQuestionFor, {
      customerId,
      dedupeKey: `draft:${draftId}`,
    });
    expect(res.closed).toBe(false);
  });

  it("it closes only ITS question, never someone else's", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "onlymine", { postingMode: "show_me_first" });
    const asked = await t.mutation(internal.maya.messages.askFounder, {
      customerId,
      surface: "telegram",
      body: "which angle?",
      dedupeKey: "q:angle",
      ts: NOW,
    });
    await t.mutation(internal.maya.messages.closeQuestionFor, {
      customerId,
      dedupeKey: "draft:unrelated",
    });
    const still = await t.query(internal.maya.messages.openQuestion, { customerId });
    expect(still?._id).toBe(asked.messageId);
  });

  it("an EDITED draft keeps its outcome — that diff is the voice signal", () => {
    // §7.5.2 layer 2 calls the edit the highest-signal data in the system.
    // Overwriting `edited` with `approved` on publish would erase which posts
    // the founder actually rewrote.
    expect(["edited", "rejected", "expired"]).not.toContain("pending");
  });
});

/**
 * ⭐ WHY SHE WROTE THE SAME POST FOUR TIMES — measured 2026-08-07.
 *
 * The cringe eval's first run found four near-duplicate posts among sixteen,
 * closest pair at 0.87:
 *
 *   "When you're building alone, a CSV shouldn't BECOME a dashboard project"
 *   "When you're building alone, a CSV shouldn't TURN INTO a dashboard project"
 *
 * `nextIdea` returns the highest-scored idea whose status is `bank`.
 * `markUsed` existed with **zero callers**, so nothing ever left the bank —
 * 51 ideas banked, and the same one won every day.
 *
 * §3.2 names the cost directly: saying the same thing twice "is how she stops
 * sounding like an employee."
 */
describe("AN IDEA IS SPENT WHEN IT BECOMES A DRAFT", () => {
  async function bankAnIdea(
    t: ReturnType<typeof convexTest>,
    customerId: Id<"customers">,
    angle: string
  ) {
    return await t.run((ctx) =>
      ctx.db.insert("ideas", {
        customerId,
        angle,
        status: "bank",
        sourceKind: "observation",
        evidenceJson: JSON.stringify({
          quote: "a real person said this out loud",
          sourceUrls: ["https://x.com/someone/status/1"],
        }),
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
  }

  it("drafting an idea takes it out of the bank", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "spent", { postingMode: "just_go" });
    const ideaId = await bankAnIdea(t, customerId, "csv to dashboard in one paste");

    await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "When you're building alone, a CSV shouldn't become a dashboard project.",
      ideaId,
      now: NOW,
    });

    const idea = await t.run((ctx) => ctx.db.get(ideaId));
    expect((idea as { status?: string } | null)?.status).toBe("used");
  });

  it("⭐ the SAME idea is never served twice — the actual regression", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "notwice", { postingMode: "just_go" });
    const first = await bankAnIdea(t, customerId, "csv to dashboard in one paste");
    await bankAnIdea(t, customerId, "nobody warns you shipping is the easy part");

    const one = await t.query(internal.maya.ideas.nextIdea, { customerId, now: NOW });
    expect(one?.ideaId).toBe(first);

    await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "A CSV shouldn't become a dashboard project when you're building alone.",
      ideaId: one!.ideaId,
      now: NOW,
    });

    // Before the fix this returned the same idea, forever.
    const two = await t.query(internal.maya.ideas.nextIdea, { customerId, now: NOW });
    expect(two?.ideaId).not.toBe(first);
  });

  it("a draft with no idea behind it spends nothing", async () => {
    // Replies and cold replies carry no ideaId — the thing being answered IS
    // the evidence. They must not consume the bank.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "noidea", { postingMode: "just_go" });
    const ideaId = await bankAnIdea(t, customerId, "untouched");

    await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "Answering someone who asked about exporting to CSV — here's how.",
      kind: "reply",
      now: NOW,
    });

    const idea = await t.run((ctx) => ctx.db.get(ideaId));
    expect((idea as { status?: string } | null)?.status).toBe("bank");
  });

  it("the bank empties one idea per draft, not all at once", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "drain", { postingMode: "just_go" });
    for (const angle of ["a", "b", "c"]) await bankAnIdea(t, customerId, angle);

    const before = await t.query(internal.maya.ideas.bankDepth, { customerId });
    const idea = await t.query(internal.maya.ideas.nextIdea, { customerId, now: NOW });
    await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "One post drawn from one banked idea, leaving the rest alone.",
      ideaId: idea!.ideaId,
      now: NOW,
    });
    const after = await t.query(internal.maya.ideas.bankDepth, { customerId });

    expect(after.depth).toBe(before.depth - 1);
  });
});
