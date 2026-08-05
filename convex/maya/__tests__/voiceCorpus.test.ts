/**
 * The voice corpus — §6's source 2, the one that's free and nobody uses.
 *
 * > *"Every message the founder types to Maya is an authentic, unedited voice
 * > sample from exactly the person she's imitating."*
 *
 * §7.5.2 ranks it the **highest-leverage** anti-slop layer, above the critic
 * and the denylist: *"ten real examples beat any amount of 'be casual and
 * authentic.'"*
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import {
  isVoiceSample,
  selectExcerpts,
  MIN_SAMPLE_CHARS,
  MAX_EXCERPTS,
} from "../voice";
import { buildMayaWorkspace } from "../../agents/packs/maya/generators";
import type { Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 5, 3, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const REAL_WRITING =
  "honestly the thing that kills me is when people say they'll try it later and never do";

describe("⭐ AN INSTRUCTION IS NOT A VOICE SAMPLE", () => {
  it("rejects the words that run the product", () => {
    // A corpus of instructions teaches her to write like a remote control.
    for (const command of ["post it", "yes", "go ahead", "skip", "sounds good", "approved"]) {
      expect(isVoiceSample(command), command).toBe(false);
    }
  });

  it("KEEPS an instruction that carries actual writing", () => {
    // Matched in full, not by substring — otherwise the most useful messages
    // get thrown away for starting with a yes.
    expect(
      isVoiceSample(
        "yes but make it way shorter, the last one read like a press release and nobody talks like that"
      )
    ).toBe(true);
  });

  it("keeps real writing", () => {
    expect(isVoiceSample(REAL_WRITING)).toBe(true);
  });

  it("rejects a pasted link with a few words around it", () => {
    // A reference, not a sentence. Without stripping the URL its length alone
    // would qualify it.
    expect(
      isVoiceSample("look at this https://example.com/a/very/long/url/that/pads/the/length/out")
    ).toBe(false);
  });

  it("rejects a long single token", () => {
    expect(isVoiceSample("a".repeat(MIN_SAMPLE_CHARS + 20))).toBe(false);
  });

  it("rejects an essay — they're pasting, not writing to me", () => {
    expect(isVoiceSample("word ".repeat(300))).toBe(false);
  });
});

describe("VARIANCE IS WHERE HUMANITY HIDES", () => {
  it("⭐ SPREADS ACROSS DAYS RATHER THAN TAKING ONE AFTERNOON", () => {
    // Twelve samples from one afternoon capture one mood. A corpus that's all
    // one register teaches exactly the flatness §7.5.2 exists to prevent.
    const messages = [
      ...Array.from({ length: 20 }, (_, i) => ({
        body: `${REAL_WRITING} monday number ${i}`,
        ts: NOW,
        direction: "in",
      })),
      { body: `${REAL_WRITING} on tuesday`, ts: NOW + DAY, direction: "in" },
      { body: `${REAL_WRITING} on wednesday`, ts: NOW + 2 * DAY, direction: "in" },
    ];

    const picked = selectExcerpts(messages, 5);
    expect(picked).toHaveLength(5);
    // Both quieter days are represented despite Monday having 20 candidates.
    expect(picked.some((p) => p.includes("tuesday"))).toBe(true);
    expect(picked.some((p) => p.includes("wednesday"))).toBe(true);
  });

  it("takes everything when there's little", () => {
    const messages = [{ body: REAL_WRITING, ts: NOW, direction: "in" }];
    expect(selectExcerpts(messages)).toEqual([REAL_WRITING]);
  });

  it("caps at the spec's ten-ish", () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      body: `${REAL_WRITING} number ${i}`,
      ts: NOW + i * DAY,
      direction: "in",
    }));
    expect(selectExcerpts(messages).length).toBeLessThanOrEqual(MAX_EXCERPTS);
  });

  it("an empty history yields nothing rather than throwing", () => {
    expect(selectExcerpts([])).toEqual([]);
  });
});

async function seed(t: ReturnType<typeof convexTest>): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: "u_voice",
      email: "voice@example.com",
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
    for (const [i, body] of [
      REAL_WRITING,
      "post it",
      "the second one is closer but it still sounds like an ad, drop the last line entirely",
    ].entries()) {
      await ctx.db.insert("messages", {
        customerId,
        direction: "in",
        surface: "telegram",
        body,
        ts: NOW + i * DAY,
      });
    }
    // Her own writing must never become "their voice".
    await ctx.db.insert("messages", {
      customerId,
      direction: "out",
      surface: "telegram",
      body: "Here's what I'd post tomorrow, does this sound like you at all?",
      ts: NOW,
    });
    return customerId;
  });
}

describe("BUILT FROM WHAT'S ALREADY STORED", () => {
  it("collects their writing and skips their commands", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);

    const res = await t.mutation(internal.maya.voiceCorpus.refreshVoiceCorpus, {
      customerId,
    });
    expect(res.excerpts).toBe(2);

    const excerpts = await t.query(internal.maya.voiceCorpus.voiceExcerptsFor, {
      customerId,
    });
    expect(excerpts).toContain(REAL_WRITING);
    expect(excerpts).not.toContain("post it");
  });

  it("⭐ NEVER LEARNS VOICE FROM HER OWN MESSAGES", async () => {
    // The corpus is what THEY write. Feeding her own output back would make
    // her converge on herself — the same failure as a critic on the writer's
    // model, one layer up.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.mutation(internal.maya.voiceCorpus.refreshVoiceCorpus, { customerId });
    const excerpts = await t.query(internal.maya.voiceCorpus.voiceExcerptsFor, {
      customerId,
    });
    expect(excerpts.some((e) => e.includes("does this sound like you"))).toBe(false);
  });

  it("re-running replaces rather than accumulating", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.mutation(internal.maya.voiceCorpus.refreshVoiceCorpus, { customerId });
    await t.mutation(internal.maya.voiceCorpus.refreshVoiceCorpus, { customerId });
    const excerpts = await t.query(internal.maya.voiceCorpus.voiceExcerptsFor, {
      customerId,
    });
    expect(excerpts).toHaveLength(2);
  });
});

describe("AND IT REACHES SOUL.MD", () => {
  it("⭐ real samples replace the 'no writing samples yet' fallback", () => {
    // SOUL.md has rendered voiceExcerpts since Sprint 2 with nothing ever
    // populating it — every deploy shipped the fallback.
    const soul = buildMayaWorkspace({
      founder: { email: "sam@example.com", name: "Sam", timezone: "UTC" },
      product: { name: "Widgetly", url: "https://widgetly.dev" },
      channels: [],
      voiceExcerpts: [REAL_WRITING],
    }).files.get("SOUL.md")!;

    expect(soul).toContain(REAL_WRITING);
    expect(soul).not.toContain("No writing samples yet");
  });

  it("and a customer with none still gets the honest fallback", () => {
    const soul = buildMayaWorkspace({
      founder: { email: "sam@example.com", name: "Sam", timezone: "UTC" },
      product: { name: "Widgetly", url: "https://widgetly.dev" },
      channels: [],
    }).files.get("SOUL.md")!;
    expect(soul).toContain("No writing samples yet");
  });
});

describe("LAYER 2 — WHAT THEY CHANGED", () => {
  async function seedEdited(t: ReturnType<typeof convexTest>) {
    const customerId = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("channels", {
        customerId,
        channel: "x",
        postingMode: "just_go",
        status: "connected",
        zernioAccountId: "acct_1",
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    const created = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "Widgetly is a game changer for modern data teams everywhere.",
      now: NOW,
    });
    if (!created.ok) throw new Error("setup failed");
    await t.mutation(internal.maya.drafts.decide, {
      draftId: created.draftId,
      outcome: "edited",
      editedText: "csv in, dashboard out",
      now: NOW + 1000,
    });
    return customerId;
  }

  it("⭐ an edit becomes a few-shot pair", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedEdited(t);

    const pairs = await t.query(internal.maya.voiceCorpus.editPairsFor, {
      customerId,
    });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].before).toMatch(/game changer/);
    expect(pairs[0].after).toBe("csv in, dashboard out");
  });

  it("an APPROVED draft is not an edit", async () => {
    // Nothing changed, so there's nothing to learn. Including it would teach
    // her that her own output is the target.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("channels", {
        customerId,
        channel: "x",
        postingMode: "just_go",
        status: "connected",
        zernioAccountId: "acct_1",
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    const created = await t.mutation(internal.maya.drafts.create, {
      customerId,
      channel: "x",
      text: "csv in, dashboard out, that's the product",
      now: NOW,
    });
    if (!created.ok) throw new Error("setup failed");
    await t.mutation(internal.maya.drafts.decide, {
      draftId: created.draftId,
      outcome: "approved",
      now: NOW + 1,
    });

    const pairs = await t.query(internal.maya.voiceCorpus.editPairsFor, {
      customerId,
    });
    expect(pairs).toEqual([]);
  });

  it("⭐ AND IT REACHES SOUL.MD, OUTRANKING THE SAMPLES", () => {
    // SOUL.md has claimed "when they edit something I wrote, that diff is the
    // strongest signal I get" since Sprint 2, with no diffs behind it.
    const soul = buildMayaWorkspace({
      founder: { email: "sam@example.com", name: "Sam", timezone: "UTC" },
      product: { name: "Widgetly", url: "https://widgetly.dev" },
      channels: [],
      voiceExcerpts: [REAL_WRITING],
      editPairs: [
        { before: "Widgetly is a game changer", after: "csv in, dashboard out" },
      ],
    }).files.get("SOUL.md")!;

    expect(soul).toContain("Widgetly is a game changer");
    expect(soul).toContain("csv in, dashboard out");
    expect(soul).toMatch(/strongest signal/i);
  });
});
