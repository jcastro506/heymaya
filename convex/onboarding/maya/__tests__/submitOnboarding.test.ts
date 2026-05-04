/**
 * Coach/Manager rewrite (2026-05-04) — single-screen onboarding tests.
 *
 * The legacy 6-step state machine + per-step convex tests
 * (`tests/sprint2OnboardingState.test.ts`, `tests/sprint37OnboardingState.test.ts`,
 * `convex/__tests__/dynamicOnboarding.test.ts`) have been deleted in this
 * rewrite. The new flow is one action — `submitOnboarding` — that:
 *
 *   1. validates handle / name / phone server-side
 *   2. round-trips the handle through ScrapeCreators
 *   3. patches the creators row + upserts creatorHandles
 *   4. kicks off bulk-pull + schedules deployMaya
 *
 * Five mandatory categories per `feedback_validation_gap_prevention.md`:
 *
 *   1. Cross-tenant isolation — handler resolves creator from Clerk identity
 *      only; no client-passed creatorId. A second creator can submit without
 *      colliding with the first.
 *   2. Plan-tier × action — onboarding is universal; no tier gate.
 *   3. Adversarial inputs — invalid handle, invalid name, invalid phone,
 *      handle that doesn't resolve, handle re-submission.
 *   4. Sibling-file scan — covered repo-wide (sprint1Acceptance grep).
 *   5. TODO grep — covered repo-wide.
 *
 * Plus pure-helper coverage for `isValidE164`, `isValidDisplayName`, and
 * `normalizeHandleInput`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";
import {
  isValidDisplayName,
  isValidE164,
  normalizeHandleInput,
} from "../submitOnboarding";
import { tiktokProfileFixture } from "../../../integrations/scrapeCreators/__tests__/fixtures/tiktok";

const NOW = 1_700_000_000_000;
const TZ = "America/Los_Angeles";

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Route a fetch call to the right fixture by URL path. Defaults to a
 * happy-path TikTok profile lookup; tests override per-case.
 */
function makeRouter(opts?: { tiktokStatus?: number }): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (url.includes("/v1/tiktok/profile")) {
      if (opts?.tiktokStatus && opts.tiktokStatus >= 400) {
        return jsonResp({ error: "not found" }, opts.tiktokStatus);
      }
      return jsonResp(tiktokProfileFixture);
    }
    // Bulk-pull worker also calls posts/comments/transcript; return empty
    // bodies so the worker completes quickly without throwing.
    if (url.includes("/v1/tiktok/user/posts")) {
      return jsonResp({ aweme_list: [] });
    }
    if (url.includes("/v1/tiktok/comments")) {
      return jsonResp({ comments: [] });
    }
    if (url.includes("/v1/tiktok/transcript")) {
      return jsonResp({ transcript: null });
    }
    return jsonResp({ error: `unmatched url ${url}` }, 404);
  });
}

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  suffix: string
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@test.com`,
      channelPreference: "web",
      timezone: TZ,
      status: "onboarding",
      plan: "coach",
      createdAt: NOW,
    })
  );
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

beforeEach(() => {
  process.env.SCRAPE_CREATORS_API_KEY = "sc-test";
  process.env.SCRAPE_CREATORS_BASE_URL = "https://api.example-sc.test";
  // Fake timers prevent the deploy chain we schedule via runAfter(0, ...)
  // from firing during teardown — the scheduled `deployMaya` would otherwise
  // race past the test boundary and try to do db writes against a torn-down
  // convex-test instance ("Write outside of transaction"). We don't actually
  // care about exercising deployMaya here; that's covered by deployMaya.test.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

describe("normalizeHandleInput", () => {
  it("strips one or more leading @s + whitespace", () => {
    expect(normalizeHandleInput("@@yourhandle ")).toBe("yourhandle");
    expect(normalizeHandleInput("  @yourhandle")).toBe("yourhandle");
    expect(normalizeHandleInput("yourhandle")).toBe("yourhandle");
    expect(normalizeHandleInput("")).toBe("");
  });
});

describe("isValidE164", () => {
  it("accepts canonical +<country><digits>", () => {
    expect(isValidE164("+14155551234")).toBe(true);
    expect(isValidE164("+447911123456")).toBe(true);
  });
  it("rejects missing +, leading 0 country code, too short, too long, letters", () => {
    expect(isValidE164("14155551234")).toBe(false);
    expect(isValidE164("+04155551234")).toBe(false);
    expect(isValidE164("+1")).toBe(false);
    expect(isValidE164("+1234567890123456")).toBe(false);
    expect(isValidE164("+1abc5551234")).toBe(false);
    expect(isValidE164("")).toBe(false);
  });
});

describe("isValidDisplayName", () => {
  it("accepts 1-80 char names with normal punctuation", () => {
    expect(isValidDisplayName("First Last")).toBe(true);
    expect(isValidDisplayName("José García-O'Rourke")).toBe(true);
    expect(isValidDisplayName("a")).toBe(true);
  });
  it("rejects empty + over-80 + control chars", () => {
    expect(isValidDisplayName("")).toBe(false);
    expect(isValidDisplayName("   ")).toBe(false);
    expect(isValidDisplayName("a".repeat(81))).toBe(false);
    expect(isValidDisplayName("hithere")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* submitOnboarding action                                                    */
/* -------------------------------------------------------------------------- */

describe("submitOnboarding — happy path", () => {
  it("verifies the handle, persists fields, and schedules the deploy chain", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, "happy");
    vi.stubGlobal("fetch", makeRouter());

    const result = await asUser(t, "happy").action(
      api.onboarding.maya.submitOnboarding.submitOnboarding,
      {
        handle: "@fitcreator99",
        displayName: "Fit Creator",
        phoneNumber: "+14155551234",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.creatorId).toBe(creatorId);
    expect(result.bulkPullJobId).not.toBeNull();

    const refreshed = await t.run((ctx) => ctx.db.get(creatorId));
    expect(refreshed?.primaryHandle).toBe("fitcreator99");
    expect(refreshed?.displayName).toBe("Fit Creator");
    expect(refreshed?.phoneNumber).toBe("+14155551234");
    expect(refreshed?.channelPreference).toBe("imessage");

    const handles = await t.run((ctx) =>
      ctx.db
        .query("creatorHandles")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(handles).toHaveLength(1);
    expect(handles[0].platform).toBe("tiktok");
    expect(handles[0].handle).toBe("fitcreator99");
    expect(handles[0].verified).toBe(true);
  });

  it("re-submitting overwrites the existing handle row (no duplicates)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, "redo");
    vi.stubGlobal("fetch", makeRouter());

    await asUser(t, "redo").action(
      api.onboarding.maya.submitOnboarding.submitOnboarding,
      {
        handle: "fitcreator99",
        displayName: "Fit Creator",
        phoneNumber: "+14155551234",
      }
    );
    await asUser(t, "redo").action(
      api.onboarding.maya.submitOnboarding.submitOnboarding,
      {
        handle: "fitcreator99",
        displayName: "Different Name",
        phoneNumber: "+14155559999",
      }
    );

    const handles = await t.run((ctx) =>
      ctx.db
        .query("creatorHandles")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(handles).toHaveLength(1);

    const refreshed = await t.run((ctx) => ctx.db.get(creatorId));
    expect(refreshed?.displayName).toBe("Different Name");
    expect(refreshed?.phoneNumber).toBe("+14155559999");
  });
});

describe("submitOnboarding — adversarial", () => {
  it("rejects unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal("fetch", makeRouter());

    const result = await t.action(
      api.onboarding.maya.submitOnboarding.submitOnboarding,
      {
        handle: "fitcreator99",
        displayName: "Fit Creator",
        phoneNumber: "+14155551234",
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected !ok");
    expect(result.reason).toBe("unauthenticated");
  });

  it("rejects when the creator row is missing", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal("fetch", makeRouter());

    const result = await asUser(t, "ghost").action(
      api.onboarding.maya.submitOnboarding.submitOnboarding,
      {
        handle: "fitcreator99",
        displayName: "Fit Creator",
        phoneNumber: "+14155551234",
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected !ok");
    expect(result.reason).toBe("creator-not-found");
  });

  it("rejects empty / over-long handle (no fetch issued)", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, "badhandle");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const tooLong = "x".repeat(201);
    const empty = await asUser(t, "badhandle").action(
      api.onboarding.maya.submitOnboarding.submitOnboarding,
      {
        handle: "@",
        displayName: "Fit Creator",
        phoneNumber: "+14155551234",
      }
    );
    expect(empty.ok).toBe(false);
    if (empty.ok) throw new Error("expected !ok");
    expect(empty.reason).toBe("invalid-handle");

    const long = await asUser(t, "badhandle").action(
      api.onboarding.maya.submitOnboarding.submitOnboarding,
      {
        handle: tooLong,
        displayName: "Fit Creator",
        phoneNumber: "+14155551234",
      }
    );
    expect(long.ok).toBe(false);
    if (long.ok) throw new Error("expected !ok");
    expect(long.reason).toBe("invalid-handle");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid display name (no fetch issued)", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, "badname");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await asUser(t, "badname").action(
      api.onboarding.maya.submitOnboarding.submitOnboarding,
      {
        handle: "fitcreator99",
        displayName: "   ",
        phoneNumber: "+14155551234",
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected !ok");
    expect(result.reason).toBe("invalid-name");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid phone (no fetch issued)", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, "badphone");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await asUser(t, "badphone").action(
      api.onboarding.maya.submitOnboarding.submitOnboarding,
      {
        handle: "fitcreator99",
        displayName: "Fit Creator",
        phoneNumber: "415-555-1234",
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected !ok");
    expect(result.reason).toBe("invalid-phone");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects when ScrapeCreators 404s on the handle", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, "404");
    vi.stubGlobal("fetch", makeRouter({ tiktokStatus: 404 }));

    const result = await asUser(t, "404").action(
      api.onboarding.maya.submitOnboarding.submitOnboarding,
      {
        handle: "doesnotexist123",
        displayName: "Fit Creator",
        phoneNumber: "+14155551234",
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected !ok");
    expect(result.reason).toBe("handle-not-found");

    // creator row should NOT have been patched
    const creator = await t.run((ctx) => ctx.db.get(creatorId));
    expect(creator?.primaryHandle).toBeUndefined();
    expect(creator?.phoneNumber).toBeUndefined();

    // and no creatorHandles row should exist
    const handles = await t.run((ctx) =>
      ctx.db
        .query("creatorHandles")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(handles).toHaveLength(0);
  });
});

describe("submitOnboarding — cross-tenant isolation", () => {
  it("two creators submitting the same handle do not collide", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, "ctA");
    const b = await insertCreator(t, "ctB");
    vi.stubGlobal("fetch", makeRouter());

    const ra = await asUser(t, "ctA").action(
      api.onboarding.maya.submitOnboarding.submitOnboarding,
      {
        handle: "fitcreator99",
        displayName: "Creator A",
        phoneNumber: "+14155551111",
      }
    );
    const rb = await asUser(t, "ctB").action(
      api.onboarding.maya.submitOnboarding.submitOnboarding,
      {
        handle: "fitcreator99",
        displayName: "Creator B",
        phoneNumber: "+14155552222",
      }
    );
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) throw new Error("expected ok");

    const handlesA = await t.run((ctx) =>
      ctx.db
        .query("creatorHandles")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    const handlesB = await t.run((ctx) =>
      ctx.db
        .query("creatorHandles")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .collect()
    );
    expect(handlesA).toHaveLength(1);
    expect(handlesB).toHaveLength(1);
    for (const h of handlesA) expect(h.creatorId).toBe(a);
    for (const h of handlesB) expect(h.creatorId).toBe(b);

    const creatorA = await t.run((ctx) => ctx.db.get(a));
    const creatorB = await t.run((ctx) => ctx.db.get(b));
    expect(creatorA?.displayName).toBe("Creator A");
    expect(creatorA?.phoneNumber).toBe("+14155551111");
    expect(creatorB?.displayName).toBe("Creator B");
    expect(creatorB?.phoneNumber).toBe("+14155552222");
  });
});

describe("submitOnboarding — plan-tier (universal access)", () => {
  it.each(["coach", "manager"] as const)(
    "%s plan can submit onboarding (no gate)",
    async (plan) => {
      const t = convexTest(schema, modules);
      const creatorId = await t.run((ctx) =>
        ctx.db.insert("creators", {
          clerkUserId: `u_${plan}`,
          email: `${plan}@test.com`,
          channelPreference: "web",
          timezone: TZ,
          status: "onboarding",
          plan,
          createdAt: NOW,
        })
      );
      vi.stubGlobal("fetch", makeRouter());

      const result = await asUser(t, plan).action(
        api.onboarding.maya.submitOnboarding.submitOnboarding,
        {
          handle: "fitcreator99",
          displayName: "Fit Creator",
          phoneNumber: "+14155551234",
        }
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.creatorId).toBe(creatorId);
    }
  );
});
