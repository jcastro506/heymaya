/**
 * Sprint C — attribution stack: wrap_link, the public /r/<token> redirect
 * (click capture), and record_conversion.
 *
 * Mandatory categories: happy path, click capture, cross-tenant isolation,
 * idempotency, validation, auth.
 */

import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = btoa("\0".repeat(32));
});

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: `App ${subject}`,
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  const hookToken = "fake-hook-" + Math.random().toString(36).slice(2);
  await t.run(async (ctx) => {
    await ctx.db.patch(started.agentId, { hookToken });
  });
  return { agentId: started.agentId, hookToken };
}

function post(
  t: ReturnType<typeof convexTest>,
  path: string,
  hookToken: string,
  body: Record<string, unknown>
) {
  return t.fetch(path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${hookToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("Sprint C — attribution", () => {
  it("wraps a link and the redirect logs a click + 302s with UTM", async () => {
    const t = convexTest(schema, modules);
    const { agentId, hookToken } = await setupAgent(t, "u_attr_wrap");

    const wrapRes = await post(t, "/lc_gtm/wrap_link", hookToken, {
      destinationUrl: "https://bugbrief.test/signup",
      platform: "reddit",
      utmSource: "reddit",
      utmMedium: "social",
      utmCampaign: "launch",
    });
    expect(wrapRes.status).toBe(200);
    const { token } = (await wrapRes.json()) as { token: string };
    expect(token).toBeTruthy();

    // The public redirect (no auth) → 302 to the destination + UTM.
    const redirect = await t.fetch(`/r/${token}`, { method: "GET" });
    expect(redirect.status).toBe(302);
    const loc = redirect.headers.get("Location") ?? "";
    expect(loc).toContain("https://bugbrief.test/signup");
    expect(loc).toContain("utm_source=reddit");
    expect(loc).toContain("utm_campaign=launch");

    // A click row was logged for this agent.
    const clicks = await t.run(async (ctx) =>
      ctx.db
        .query("gtmLinkClicks")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .collect()
    );
    expect(clicks.length).toBe(1);
  });

  it("unknown redirect token → 404", async () => {
    const t = convexTest(schema, modules);
    await setupAgent(t, "u_attr_404");
    const res = await t.fetch("/r/doesnotexist", { method: "GET" });
    expect(res.status).toBe(404);
  });

  it("records a self-reported conversion", async () => {
    const t = convexTest(schema, modules);
    const { agentId, hookToken } = await setupAgent(t, "u_attr_conv");

    const res = await post(t, "/lc_gtm/record_conversion", hookToken, {
      idempotencyKey: "c1",
      kind: "signup",
      count: 5,
      note: "operator said 5 signups this week",
    });
    expect(res.status).toBe(200);

    const conv = await t.run(async (ctx) =>
      ctx.db
        .query("gtmConversions")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .collect()
    );
    expect(conv.length).toBe(1);
    expect(conv[0].kind).toBe("signup");
    expect(conv[0].count).toBe(5);
    expect(conv[0].source).toBe("self_report");
  });

  it("does not attribute a conversion to another agent's link token", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_attr_a");
    const b = await setupAgent(t, "u_attr_b");

    // Agent A wraps a link.
    const wrapRes = await post(t, "/lc_gtm/wrap_link", a.hookToken, {
      destinationUrl: "https://a.test/signup",
    });
    const { token: aToken } = (await wrapRes.json()) as { token: string };

    // Agent B reports a conversion citing A's token → must NOT attribute it.
    const res = await post(t, "/lc_gtm/record_conversion", b.hookToken, {
      idempotencyKey: "x1",
      kind: "signup",
      linkWrapToken: aToken,
    });
    expect(res.status).toBe(200);
    const conv = await t.run(async (ctx) =>
      ctx.db
        .query("gtmConversions")
        .withIndex("by_agent", (q) => q.eq("agentId", b.agentId))
        .collect()
    );
    expect(conv.length).toBe(1);
    expect(conv[0].linkWrapId).toBeUndefined();
  });

  it("conversion idempotency + validation + auth", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_attr_bad");

    await post(t, "/lc_gtm/record_conversion", hookToken, {
      idempotencyKey: "dup",
      kind: "signup",
      count: 1,
    });
    const replay = await post(t, "/lc_gtm/record_conversion", hookToken, {
      idempotencyKey: "dup",
      kind: "signup",
      count: 99,
    });
    expect((await replay.text())).toContain("replay");

    expect(
      (await post(t, "/lc_gtm/record_conversion", hookToken, { kind: "signup" }))
        .status
    ).toBe(400);
    expect(
      (
        await post(t, "/lc_gtm/record_conversion", hookToken, {
          idempotencyKey: "k",
          kind: "bogus",
        })
      ).status
    ).toBe(400);

    const wrapNoAuth = await post(t, "/lc_gtm/wrap_link", "bad-token", {
      destinationUrl: "https://x.test",
    });
    expect(wrapNoAuth.status).toBe(401);
  });

  it("wrap_link rejects non-http destinations", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_attr_proto");
    const res = await post(t, "/lc_gtm/wrap_link", hookToken, {
      destinationUrl: "javascript:alert(1)",
    });
    expect(res.status).toBe(400);
  });
});
