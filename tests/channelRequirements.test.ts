/**
 * ⭐ §6.0.15 — say what the account has to BE, before they connect it.
 *
 * > *"Some platforms accept a connection that can never post. The connection
 * > succeeds, the account appears in every listing, health looks fine — and the
 * > first evidence of a problem is a publish failing weeks later, **which reads
 * > as our bug rather than an account setting**."*
 *
 * ## The bug this file locks down
 *
 * `WRITE_PERMISSION` contained **X only**. So Instagram, TikTok and YouTube
 * could each connect cleanly, list fine, report healthy — and never publish,
 * with nothing anywhere saying why. Instagram is the case §6.0.15 calls
 * load-bearing.
 *
 * ⭐ Every scope string below was read off a LIVE `GET /api/v1/accounts`
 * response for four real connected accounts on 2026-08-11, not from a vendor
 * doc. That mattered: X's platform slug on the wire is `twitter`, and Meta
 * issues `instagram_business_content_publish` only to Business/Creator
 * accounts — which is why "is this a personal account?" arrives as a missing
 * scope and needs no special case.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { modules } from "./_modules";
import { readAccount } from "../convex/maya/channels";
import {
  CHANNEL_REQUIREMENTS,
  noticesFor,
} from "../convex/maya/channelRequirements";
import { minimalRow, type InsertCtx } from "./lib/minimalRow";

/** The scopes as the vendor actually returned them, per platform. */
const GRANTED = {
  instagram: [
    "instagram_business_basic",
    "instagram_business_content_publish",
    "instagram_business_manage_insights",
  ],
  tiktok: ["user.info.basic", "video.upload", "video.publish"],
  twitter: ["users.read", "tweet.read", "tweet.write"],
  youtube: [
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/youtube.upload",
  ],
};

function account(platform: string, permissions: string[]) {
  return {
    _id: `acct_${platform}`,
    platform,
    isActive: true,
    enabled: true,
    needsReconnection: false,
    platformStatus: "active",
    permissions,
    metadata: { profileData: { username: `the_${platform}` } },
  };
}

describe("a connection that can't publish is never called connected", () => {
  it("accepts every platform that granted its publish scope", () => {
    for (const [platform, perms] of Object.entries(GRANTED)) {
      const health = readAccount(account(platform, perms));
      expect(health?.connected, `${platform} should be postable`).toBe(true);
    }
  });

  it("⭐ catches a personal Instagram, in the founder's terms", () => {
    // Meta withholds the publish scope from personal accounts — this is what
    // a personal IG connection actually looks like coming back.
    const health = readAccount(
      account("instagram", ["instagram_business_basic"]),
    );

    expect(health?.connected).toBe(false);
    /**
     * ⚠️ The reason names what THEY have to change, not our plumbing. §11:
     * "missing instagram_business_content_publish" is true and useless.
     */
    expect(health?.reason).toMatch(/personal Instagram/i);
    expect(health?.reason).toMatch(/Business or Creator/i);
    expect(health?.reason).not.toMatch(/instagram_business_content_publish/);
  });

  it("catches every other platform missing its publish scope", () => {
    const cases: Array<[string, string[]]> = [
      // Each keeps its READ scopes — the case that authenticates and lists
      // fine, which is exactly why it goes unnoticed until a publish fails.
      ["tiktok", ["user.info.basic", "video.list"]],
      ["twitter", ["users.read", "tweet.read"]],
      ["youtube", ["https://www.googleapis.com/auth/youtube"]],
    ];

    for (const [platform, perms] of cases) {
      const health = readAccount(account(platform, perms));
      expect(health?.connected, `${platform} should be blocked`).toBe(false);
      expect(health?.reason, `${platform} needs a reason`).toBeTruthy();
    }
  });

  it("⚠️ would have passed before the fix — X alone was covered", () => {
    /**
     * The regression this file exists for. Before 2026-08-11 `WRITE_PERMISSION`
     * held `x` only, so an Instagram with no publish scope came back
     * `connected: true` and the founder learned about it weeks later, from a
     * failed post that looked like our bug.
     */
    const ig = readAccount(account("instagram", ["instagram_business_basic"]));
    const yt = readAccount(
      account("youtube", ["https://www.googleapis.com/auth/youtube"]),
    );
    expect([ig?.connected, yt?.connected]).toEqual([false, false]);
  });
});

describe("what gets said before the OAuth redirect", () => {
  it("states the Instagram requirement, with the fix", () => {
    const notices = noticesFor("instagram");
    expect(notices.join(" ")).toMatch(/Business or Creator/i);
    // "Prevention beats diagnosis" — it has to say what to DO.
    expect(notices.join(" ")).toMatch(/settings/i);
  });

  it("⚠️ states TikTok's permanent limit up front", () => {
    /**
     * §2.3.1: a ceiling "must also be stated plainly to the customer at
     * onboarding — never let them discover it when a comment goes unanswered
     * for a week." TikTok exposes NO comment API at all, and a founder who
     * finds that out from silence concludes she is broken.
     */
    const limit = CHANNEL_REQUIREMENTS.tiktok.permanentLimit ?? "";
    expect(limit).toMatch(/comment/i);
    expect(limit).toMatch(/never reply|can't reply|but never/i);
    // And it must not read as their fault — nothing they do changes it.
    expect(CHANNEL_REQUIREMENTS.tiktok.beforeConnect).toBeUndefined();
  });

  it("says YouTube's numbers lag, so a same-day figure isn't expected", () => {
    expect(CHANNEL_REQUIREMENTS.youtube.permanentLimit ?? "").toMatch(
      /two to three days|2-3 days/i,
    );
  });

  it("has something to say about every channel", () => {
    // A channel with nothing said about it is a channel whose card renders an
    // empty space where a requirement should be.
    for (const channel of ["tiktok", "instagram", "youtube", "x"] as const) {
      expect(noticesFor(channel).length, channel).toBeGreaterThan(0);
    }
  });
});

describe("myChannels", () => {
  async function seed(ctx: unknown, clerkUserId: string): Promise<string> {
    const c = ctx as InsertCtx & {
      db: { insert: (t: string, v: unknown) => Promise<string> };
    };
    const creatorId = (await c.db.insert(
      "creators",
      await minimalRow(c, "creators", {
        clerkUserId,
        email: `${clerkUserId}@example.com`,
        accountType: "gtm-agent",
      }),
    )) as string;
    return (await c.db.insert(
      "customers",
      await minimalRow(c, "customers", { accountId: creatorId }),
    )) as string;
  }

  it("⭐ never returns the word 'connected' for an unpostable channel", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const customerId = await seed(ctx, "user_channels");
      await ctx.db.insert("channels", {
        customerId: customerId as never,
        channel: "instagram",
        postingMode: "show_me_first",
        status: "error",
        failureReason:
          "this looks like a personal Instagram — it needs to be a Business or Creator account before anything can be posted",
        handle: "someone",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const out = await t
      .withIdentity({ subject: "user_channels" })
      .query(api.maya.channels.myChannels, {});

    const ig = out.channels?.find((c) => c.channel === "instagram");
    /**
     * ⭐ The property that makes §6.0.15 point 3 impossible to get wrong: there
     * is no `connected` boolean a screen could render on its own. It gets a
     * state, and this value is not "connected".
     */
    expect(ig?.state).toBe("connected_cant_post");
    expect(ig?.reason).toMatch(/personal Instagram/i);
  });

  it("lists all four with their notices, even before anything is connected", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seed(ctx, "user_empty"));

    const out = await t
      .withIdentity({ subject: "user_empty" })
      .query(api.maya.channels.myChannels, {});

    expect(out.channels).toHaveLength(4);
    for (const c of out.channels ?? []) {
      expect(c.state).toBe("not_connected");
      // The card must know what to say BEFORE the redirect, which means the
      // notices cannot depend on a row that doesn't exist yet.
      expect(c.notices.length, c.channel).toBeGreaterThan(0);
    }
  });

  it("refuses when nobody is signed in", async () => {
    const t = convexTest(schema, modules);
    expect((await t.query(api.maya.channels.myChannels, {})).ok).toBe(false);
  });
});
