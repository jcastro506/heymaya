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

/**
 * Closing the loop on the SIGNUP side — the public conversion pixel.
 *
 *   - the redirect now passes lc_ref to the destination (the missing handoff);
 *   - /p/conversion is PUBLIC (no hookToken — a pixel can't hold the secret),
 *     token-keyed, idempotent, and 204s on any bad input (never errors a beacon);
 *   - a pixel signup ties to the exact post + stamps the app pixel-installed;
 *   - onboarding persists conversionKind + signupUrl;
 *   - get_conversion_setup hands Maya the templated snippet.
 */
function pixel(t: ReturnType<typeof convexTest>, body: Record<string, unknown>) {
  // No auth header — mimics a cross-origin beacon from the founder's site.
  return t.fetch("/p/conversion", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify(body),
  });
}

describe("conversion pixel — closing the signup side", () => {
  it("redirect passes lc_ref to the destination", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_pix_ref");
    const { token } = (await (
      await post(t, "/lc_gtm/wrap_link", hookToken, {
        destinationUrl: "https://ref.test/signup",
      })
    ).json()) as { token: string };

    const redirect = await t.fetch(`/r/${token}`, { method: "GET" });
    const loc = redirect.headers.get("Location") ?? "";
    expect(loc).toContain(`lc_ref=${token}`);
  });

  it("a public pixel POST ties a signup to the exact wrapped post + stamps the app", async () => {
    const t = convexTest(schema, modules);
    const { agentId, hookToken } = await setupAgent(t, "u_pix_tie");
    const { token } = (await (
      await post(t, "/lc_gtm/wrap_link", hookToken, {
        destinationUrl: "https://tie.test/signup",
        platform: "reddit",
      })
    ).json()) as { token: string };

    const res = await pixel(t, {
      ref: token,
      kind: "signup",
      idempotencyKey: "sess-1",
    });
    expect(res.status).toBe(204);

    const convs = await t.run(async (ctx) =>
      ctx.db
        .query("gtmConversions")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .collect()
    );
    expect(convs.length).toBe(1);
    expect(convs[0].source).toBe("pixel");
    expect(convs[0].kind).toBe("signup");
    expect(convs[0].linkWrapId).toBeDefined(); // tied to THE post

    // The app is stamped pixel-installed so Maya can stop self-report nudges.
    const app = await t.run(async (ctx) => {
      const agent = await ctx.db.get(agentId);
      return agent?.appId ? await ctx.db.get(agent.appId) : null;
    });
    expect(app?.conversionPixelInstalledAt).toBeDefined();
  });

  it("pixel is idempotent — a refresh does not double-count", async () => {
    const t = convexTest(schema, modules);
    const { agentId, hookToken } = await setupAgent(t, "u_pix_idem");
    const { token } = (await (
      await post(t, "/lc_gtm/wrap_link", hookToken, {
        destinationUrl: "https://idem.test/signup",
      })
    ).json()) as { token: string };

    await pixel(t, { ref: token, kind: "signup", idempotencyKey: "dup" });
    await pixel(t, { ref: token, kind: "signup", idempotencyKey: "dup" });

    const convs = await t.run(async (ctx) =>
      ctx.db
        .query("gtmConversions")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .collect()
    );
    expect(convs.length).toBe(1);
  });

  it("unknown / missing token → 204 with no conversion (never errors a beacon)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_pix_bad");

    expect((await pixel(t, { ref: "nope", kind: "signup" })).status).toBe(204);
    expect((await pixel(t, { kind: "signup" })).status).toBe(204);

    const convs = await t.run(async (ctx) =>
      ctx.db
        .query("gtmConversions")
        .withIndex("by_agent", (q) => q.eq("agentId", a.agentId))
        .collect()
    );
    expect(convs.length).toBe(0);
  });

  it("get_conversion_setup returns the founder's signupUrl + a templated snippet", async () => {
    const t = convexTest(schema, modules);
    const authed = t.withIdentity({
      subject: "u_pix_setup",
      email: "u_pix_setup@clawlaunch.test",
    });
    const started = await authed.mutation(
      api.gtmMaya.researchLifecycle.startGtmOnboarding,
      {}
    );
    await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
      name: "Setup App",
      url: "https://setup.test",
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
      conversionKind: "install",
      signupUrl: "https://setup.test/get-started",
    });
    const hookToken = "fake-hook-setup";
    await t.run(async (ctx) => {
      await ctx.db.patch(started.agentId, { hookToken });
    });

    const res = await t.fetch("/lc_gtm/get_conversion_setup", {
      method: "GET",
      headers: { authorization: `Bearer ${hookToken}` },
    });
    expect(res.status).toBe(200);
    const setup = (await res.json()) as {
      signupUrl: string;
      conversionKind: string;
      pixelInstalled: boolean;
      pixelSnippet: string;
    };
    expect(setup.signupUrl).toBe("https://setup.test/get-started");
    expect(setup.conversionKind).toBe("install");
    expect(setup.pixelInstalled).toBe(false);
    expect(setup.pixelSnippet).toContain("/p/conversion");
    expect(setup.pixelSnippet).toContain("window.lcMaya");
  });
});

/**
 * Sprint 3 (top-tier) — activation: proving a signup STUCK, not just landed.
 *
 *   - record_conversion accepts kind:"activated" (self-report floor);
 *   - the pixel accepts activated + carries the "how did you hear" source as a note;
 *   - get_my_attribution surfaces `activated` in conversionsByKind + totals;
 *   - cross-tenant: an activation for A never shows in B's read.
 */
describe("Sprint 3 — activation (a signup that stuck)", () => {
  it("record_conversion accepts kind:activated (self-report floor)", async () => {
    const t = convexTest(schema, modules);
    const { agentId, hookToken } = await setupAgent(t, "u_act_self");

    const res = await post(t, "/lc_gtm/record_conversion", hookToken, {
      idempotencyKey: "act1",
      kind: "activated",
      count: 2,
      note: "2 of last week's signups came back",
    });
    expect(res.status).toBe(200);

    const conv = await t.run(async (ctx) =>
      ctx.db
        .query("gtmConversions")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .collect()
    );
    expect(conv.length).toBe(1);
    expect(conv[0].kind).toBe("activated");
    expect(conv[0].count).toBe(2);
  });

  it("pixel records an activation tied to the post + keeps the 'how did you hear' source as a note", async () => {
    const t = convexTest(schema, modules);
    const { agentId, hookToken } = await setupAgent(t, "u_act_pix");
    const { token } = (await (
      await post(t, "/lc_gtm/wrap_link", hookToken, {
        destinationUrl: "https://act.test/signup",
        platform: "reddit",
      })
    ).json()) as { token: string };

    const res = await pixel(t, {
      ref: token,
      kind: "activated",
      source: "reddit",
      idempotencyKey: "act-sess-1",
    });
    expect(res.status).toBe(204);

    const convs = await t.run(async (ctx) =>
      ctx.db
        .query("gtmConversions")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .collect()
    );
    expect(convs.length).toBe(1);
    expect(convs[0].kind).toBe("activated");
    expect(convs[0].source).toBe("pixel");
    expect(convs[0].linkWrapId).toBeDefined(); // tied to THE post
    expect(convs[0].note).toContain("reddit"); // self-reported source kept
  });

  it("get_my_attribution surfaces activated in conversionsByKind + totals", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_act_read");
    const { token } = (await (
      await post(t, "/lc_gtm/wrap_link", hookToken, {
        destinationUrl: "https://read.test/signup",
        platform: "x",
      })
    ).json()) as { token: string };

    await pixel(t, { ref: token, kind: "signup", idempotencyKey: "s" });
    await pixel(t, { ref: token, kind: "activated", idempotencyKey: "a" });

    const res = await t.fetch("/lc_gtm/get_my_attribution?windowDays=7", {
      method: "GET",
      headers: { authorization: `Bearer ${hookToken}` },
    });
    expect(res.status).toBe(200);
    const { attribution } = (await res.json()) as {
      attribution: {
        posts: Array<{ conversionsByKind: { activated: number; signup: number } }>;
        totals: { activated: number; signups: number };
      };
    };
    expect(attribution.totals.signups).toBe(1);
    expect(attribution.totals.activated).toBe(1);
    expect(attribution.posts[0].conversionsByKind.activated).toBe(1);
  });

  it("cross-tenant: an activation for A never appears in B's attribution", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_act_xa");
    const b = await setupAgent(t, "u_act_xb");
    const { token } = (await (
      await post(t, "/lc_gtm/wrap_link", a.hookToken, {
        destinationUrl: "https://xa.test/signup",
      })
    ).json()) as { token: string };
    await pixel(t, { ref: token, kind: "activated", idempotencyKey: "xa" });

    const res = await t.fetch("/lc_gtm/get_my_attribution?windowDays=7", {
      method: "GET",
      headers: { authorization: `Bearer ${b.hookToken}` },
    });
    const { attribution } = (await res.json()) as {
      attribution: { totals: { activated: number } };
    };
    expect(attribution.totals.activated).toBe(0);
  });

  it("get_conversion_setup snippet exposes activated() + signup(kind, source)", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_act_snip");
    const res = await t.fetch("/lc_gtm/get_conversion_setup", {
      method: "GET",
      headers: { authorization: `Bearer ${hookToken}` },
    });
    const setup = (await res.json()) as { pixelSnippet: string };
    expect(setup.pixelSnippet).toContain("activated:function");
    expect(setup.pixelSnippet).toContain("source"); // "how did you hear" rides along
  });
});

/**
 * Sprint 4 (top-tier) — attribute outcomes (which content attribute converts)
 * + the pure experiment verdict. The Beta-Bernoulli math itself is covered in
 * experimentStats.test.ts; here we test the JOIN (clicks→signups grouped by a
 * draft attribute), cross-tenant isolation, and the verdict HTTP wrapper.
 */
async function agentAccountId(
  t: ReturnType<typeof convexTest>,
  agentId: Id<"gtmAgents">
): Promise<Id<"creators">> {
  return await t.run(async (ctx) => {
    const agent = await ctx.db.get(agentId);
    return agent!.accountId;
  });
}

/** Wrap a link tied to a freshly-inserted draft carrying a hookType, then seed
 *  N clicks + M signups directly. Returns nothing — drives the join inputs. */
async function seedAttributeArm(
  t: ReturnType<typeof convexTest>,
  agentId: Id<"gtmAgents">,
  accountId: Id<"creators">,
  hookToken: string,
  hookType: string,
  clicks: number,
  signups: number
): Promise<void> {
  const draftId = await t.run(async (ctx) =>
    ctx.db.insert("gtmDraftedContent", {
      accountId,
      agentId,
      kind: "post",
      platform: "reddit",
      draftText: `draft for ${hookType}`,
      slopCriticPassed: true,
      approvalState: "approved",
      attributes: { hookType },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
  const wrapRes = await post(t, "/lc_gtm/wrap_link", hookToken, {
    destinationUrl: "https://exp.test/signup",
    draftId,
    platform: "reddit",
  });
  const { token } = (await wrapRes.json()) as { token: string };
  await t.run(async (ctx) => {
    const wrap = await ctx.db
      .query("gtmLinkWraps")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    for (let i = 0; i < clicks; i++) {
      await ctx.db.insert("gtmLinkClicks", {
        accountId,
        agentId,
        linkWrapId: wrap!._id,
        clickedAt: Date.now(),
      });
    }
    for (let i = 0; i < signups; i++) {
      await ctx.db.insert("gtmConversions", {
        accountId,
        agentId,
        kind: "signup",
        count: 1,
        source: "self_report",
        linkWrapId: wrap!._id,
        occurredAt: Date.now(),
      });
    }
  });
}

describe("Sprint 4 — attribute outcomes + experiment verdict", () => {
  it("groups clicks→signups by hookType and returns a real verdict", async () => {
    const t = convexTest(schema, modules);
    const { agentId, hookToken } = await setupAgent(t, "u_exp_join");
    const accountId = await agentAccountId(t, agentId);

    // punchy: 6/12 (clears floor, clearly best) · explainer: 0/10
    await seedAttributeArm(t, agentId, accountId, hookToken, "punchy", 12, 6);
    await seedAttributeArm(t, agentId, accountId, hookToken, "explainer", 10, 0);

    const res = (await t.fetch(
      "/lc_gtm/get_attribute_outcomes?dimension=hookType",
      { method: "GET", headers: { authorization: `Bearer ${hookToken}` } }
    ).then((r) => r.json())) as {
      dimension: string;
      arms: Array<{ label: string; trials: number; conversions: number }>;
      verdict: { winner: string | null; leader: string | null; verdict: string };
    };

    expect(res.dimension).toBe("hookType");
    const punchy = res.arms.find((a) => a.label === "punchy")!;
    expect(punchy.trials).toBe(12);
    expect(punchy.conversions).toBe(6);
    expect(res.verdict.leader).toBe("punchy");
    expect(res.verdict.winner).toBe("punchy"); // 6 ≥ floor AND high P(best)
  });

  it("does NOT mix another agent's drafts into the outcomes (cross-tenant)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_exp_a");
    const b = await setupAgent(t, "u_exp_b");
    const accA = await agentAccountId(t, a.agentId);
    const accB = await agentAccountId(t, b.agentId);

    await seedAttributeArm(t, a.agentId, accA, a.hookToken, "punchy", 8, 4);
    // B has a 'punchy' arm too, with different numbers — must not leak into A.
    await seedAttributeArm(t, b.agentId, accB, b.hookToken, "punchy", 99, 99);

    const res = (await t.fetch(
      "/lc_gtm/get_attribute_outcomes?dimension=hookType",
      { method: "GET", headers: { authorization: `Bearer ${a.hookToken}` } }
    ).then((r) => r.json())) as {
      arms: Array<{ label: string; trials: number; conversions: number }>;
    };
    const punchy = res.arms.find((x) => x.label === "punchy")!;
    expect(punchy.trials).toBe(8); // A's numbers only — never 99
    expect(punchy.conversions).toBe(4);
  });

  it("get_experiment_verdict scores arbitrary arms (pure stats, no DB)", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_exp_verdict");
    const res = (await post(t, "/lc_gtm/get_experiment_verdict", hookToken, {
      arms: [
        { label: "cta_demo", trials: 40, conversions: 12 },
        { label: "cta_signup", trials: 38, conversions: 1 },
      ],
    }).then((r) => r.json())) as {
      verdict: { winner: string | null; verdict: string; conversionsNeeded: number };
    };
    expect(res.verdict.verdict).toBe("winner");
    expect(res.verdict.winner).toBe("cta_demo");
    expect(res.verdict.conversionsNeeded).toBe(0);
  });

  it("get_experiment_verdict is honest about thin data (not_enough_data)", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_exp_thin");
    const res = (await post(t, "/lc_gtm/get_experiment_verdict", hookToken, {
      arms: [
        { label: "a", trials: 4, conversions: 1 },
        { label: "b", trials: 5, conversions: 0 },
      ],
    }).then((r) => r.json())) as {
      verdict: { winner: string | null; conversionsNeeded: number };
    };
    expect(res.verdict.winner).toBeNull();
    expect(res.verdict.conversionsNeeded).toBeGreaterThan(0);
  });
});
