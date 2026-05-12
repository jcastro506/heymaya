/**
 * Sprint 12.7.3 — outbound-send firewall tests.
 *
 * Three layers under test:
 *   1. Pure helper — `checkImessageFormat` markdown detection.
 *   2. `validate_outbound_send` HTTP endpoint — auth, malformed body,
 *      creator existence, combined trend + format verdicts.
 *   3. Sibling-file scan — endpoint exported from `lcMayaHttp.ts` and
 *      registered at `/lc_maya/validate_outbound_send` in `convex/http.ts`.
 *
 * Five mandatory categories:
 *   - Cross-tenant: the endpoint is stateless beyond a creator-existence
 *     check; a non-existent creatorId returns 404 (never leaks any other
 *     creator's data).
 *   - Plan-tier × action: validation endpoint is open to all tiers (any
 *     active Fly machine will call it on every send regardless of plan).
 *   - Adversarial: empty / whitespace / very long / unicode-heavy / mixed
 *     markdown-like fragments inside legit prose.
 *   - Sibling-file scan: covered explicitly below.
 *   - TODO grep: covered repo-wide.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { _setWebhookSecretForTests } from "../../lib/webhookSecret";
import { checkImessageFormat } from "../lcMayaHttp";

const TEST_SECRET = "deadbeef".repeat(8);
const NOW = 1_700_000_000_000;

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan: "coach" | "manager" }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "imessage",
      timezone: "America/Los_Angeles",
      status: "onboarding",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

/* -------------------------------------------------------------------------- */
/* Layer 1 — checkImessageFormat                                                */
/* -------------------------------------------------------------------------- */

describe("checkImessageFormat — clean inputs", () => {
  it("PASS: plain prose", () => {
    const v = checkImessageFormat(
      "Thursday's Brooklyn shoot — want me to draft a hook for the build-up?"
    );
    expect(v.ok).toBe(true);
    expect(v.categoriesTripped).toEqual([]);
    expect(v.suggestedFix).toBeNull();
  });

  it("PASS: empty string", () => {
    const v = checkImessageFormat("");
    expect(v.ok).toBe(true);
  });

  it("PASS: single '1. ' line — could be conversational, not a list", () => {
    const v = checkImessageFormat(
      "1. Hit the gym at 7am — just one thing today."
    );
    expect(v.categoriesTripped).not.toContain("numbered-list");
  });

  it("PASS: single '- ' line — conversational dash, not a bullet", () => {
    const v = checkImessageFormat("- this is just a dashed sentence on its own.");
    expect(v.categoriesTripped).not.toContain("bullet-list");
  });

  it("PASS: asterisk inside a word doesn't trigger italic", () => {
    const v = checkImessageFormat("foo*bar*baz inside a word");
    expect(v.categoriesTripped).not.toContain("markdown-italic");
  });

  it("PASS: long natural prose (5KB)", () => {
    const long = "Brooklyn shoot Thursday. ".repeat(200);
    const v = checkImessageFormat(long);
    expect(v.ok).toBe(true);
  });
});

describe("checkImessageFormat — each category trips", () => {
  it("BLOCK: markdown-bold", () => {
    const v = checkImessageFormat("This is **important** info.");
    expect(v.ok).toBe(false);
    expect(v.categoriesTripped).toContain("markdown-bold");
    expect(v.suggestedFix).toMatch(/iMessage/);
  });

  it("BLOCK: markdown-italic", () => {
    const v = checkImessageFormat("This is *bigly* a problem.");
    expect(v.ok).toBe(false);
    expect(v.categoriesTripped).toContain("markdown-italic");
  });

  it("BLOCK: markdown-headers (level 1)", () => {
    const v = checkImessageFormat("# Heading here\nThen prose.");
    expect(v.ok).toBe(false);
    expect(v.categoriesTripped).toContain("markdown-headers");
  });

  it("BLOCK: markdown-headers (level 3)", () => {
    const v = checkImessageFormat("### Smaller heading\nThen prose.");
    expect(v.ok).toBe(false);
    expect(v.categoriesTripped).toContain("markdown-headers");
  });

  it("BLOCK: numbered-list with 2+ entries", () => {
    const v = checkImessageFormat(
      "Today's three things:\n1. Gym\n2. Shoot\n3. Edit"
    );
    expect(v.ok).toBe(false);
    expect(v.categoriesTripped).toContain("numbered-list");
  });

  it("BLOCK: bullet-list with dash", () => {
    const v = checkImessageFormat("Plan:\n- gym\n- shoot\n- edit");
    expect(v.ok).toBe(false);
    expect(v.categoriesTripped).toContain("bullet-list");
  });

  it("BLOCK: bullet-list with asterisk", () => {
    const v = checkImessageFormat("Plan:\n* gym\n* shoot");
    expect(v.ok).toBe(false);
    expect(v.categoriesTripped).toContain("bullet-list");
  });

  it("BLOCK: triple-backtick code fence", () => {
    const v = checkImessageFormat("Try this:\n```\nnpm test\n```");
    expect(v.ok).toBe(false);
    expect(v.categoriesTripped).toContain("code-fence");
  });

  it("BLOCK: multiple categories trip independently", () => {
    const v = checkImessageFormat(
      "# Header\nThis is **bold** and:\n- a bullet\n- another bullet"
    );
    expect(v.ok).toBe(false);
    expect(v.categoriesTripped).toEqual(
      expect.arrayContaining([
        "markdown-bold",
        "markdown-headers",
        "bullet-list",
      ])
    );
  });
});

describe("checkImessageFormat — adversarial", () => {
  it("ADVERSARIAL: whitespace-only message", () => {
    const v = checkImessageFormat("   \n\t  ");
    expect(v.ok).toBe(true);
  });

  it("ADVERSARIAL: very long (50KB) clean message", () => {
    const long = "a ".repeat(25_000);
    const v = checkImessageFormat(long);
    expect(v.ok).toBe(true);
  });

  it("ADVERSARIAL: unicode-heavy prose", () => {
    const v = checkImessageFormat(
      "你好 — Brooklyn shoot 木曜日, ready? 🎬✨"
    );
    expect(v.ok).toBe(true);
  });

  // Documented FP: italic regex over-fires on "*starring*" / "*the* talented".
  // The trade-off is acceptable: Maya can apply suggestedFix and re-emit
  // without the asterisks; false positives are cheap relative to the harm of
  // letting raw `**bold**` ship to iMessage.
  it("ADVERSARIAL: italic FP on 'starring' is acceptable (documented)", () => {
    const v = checkImessageFormat("*starring* the talented Maya");
    expect(v.ok).toBe(false);
    expect(v.categoriesTripped).toContain("markdown-italic");
  });

  it("ADVERSARIAL: empty asterisk pair does NOT trip italic", () => {
    const v = checkImessageFormat("an empty ** ** here");
    expect(v.categoriesTripped).not.toContain("markdown-italic");
  });

  it("ADVERSARIAL: lone asterisk doesn't trip bold", () => {
    const v = checkImessageFormat("just one * star");
    expect(v.categoriesTripped).not.toContain("markdown-bold");
  });

  it("ADVERSARIAL: non-string-like input", () => {
    // @ts-expect-error — runtime safety
    expect(checkImessageFormat(null).ok).toBe(true);
    // @ts-expect-error — runtime safety
    expect(checkImessageFormat(undefined).ok).toBe(true);
    // @ts-expect-error — runtime safety
    expect(checkImessageFormat(42).ok).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Layer 2 — validate_outbound_send HTTP endpoint                               */
/* -------------------------------------------------------------------------- */

describe("POST /lc_maya/validate_outbound_send", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("AUTH: missing / wrong secret → 401", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "auth-401",
      plan: "manager",
    });
    for (const bad of ["", "wrong", `${TEST_SECRET}x`]) {
      const res = await t.fetch("/lc_maya/validate_outbound_send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: bad, creatorId, message: "hi" }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("MALFORMED: non-JSON / missing fields → 400", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "malformed",
      plan: "manager",
    });
    const cases = [
      { body: "not-json", label: "non-json" },
      { body: JSON.stringify({}), label: "missing-secret" },
      { body: JSON.stringify({ secret: TEST_SECRET }), label: "missing-creator" },
      {
        body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
        label: "missing-message",
      },
      {
        body: JSON.stringify({ secret: TEST_SECRET, creatorId, message: 123 }),
        label: "non-string-message",
      },
      {
        body: JSON.stringify({ secret: TEST_SECRET, creatorId: "", message: "hi" }),
        label: "empty-creator-id",
      },
    ];
    for (const { body, label } of cases) {
      const res = await t.fetch("/lc_maya/validate_outbound_send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(res.status, `case=${label}`).toBe(400);
    }
  });

  it("CROSS-TENANT: non-existent creatorId → 404", async () => {
    const t = convexTest(schema, modules);
    // First insert a real creator, get its id format, then construct a bogus
    // id of the same shape that doesn't exist.
    const real = await insertCreator(t, {
      suffix: "cross-tenant",
      plan: "manager",
    });
    // Convex returns 400 (malformed-id) on a syntactically invalid id; we want
    // a syntactically valid id that doesn't resolve. Easiest: delete `real`
    // and reuse its id.
    await t.run((ctx) => ctx.db.delete(real));
    const res = await t.fetch("/lc_maya/validate_outbound_send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId: real,
        message: "hello",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("HAPPY: clean prose, no trend → ok=true", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "happy",
      plan: "manager",
    });
    const res = await t.fetch("/lc_maya/validate_outbound_send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        message:
          "Thursday's Brooklyn shoot — want me to draft a hook for the build-up?",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.blockedReasons).toEqual([]);
    expect(json.suggestedFix).toBeNull();
    expect(json.mentionsTrend).toBe(false);
  });

  it("HAPPY: trend mention with platform URL inline → ok=true", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "happy-trend",
      plan: "manager",
    });
    const res = await t.fetch("/lc_maya/validate_outbound_send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        message:
          "https://www.tiktok.com/@alpha/video/p1 — this trend fits your handheld POV",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.mentionsTrend).toBe(true);
  });

  it("BLOCK: trend confabulation → ok=false with trend-mention-without-citation", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "trend-block",
      plan: "manager",
    });
    const res = await t.fetch("/lc_maya/validate_outbound_send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        message:
          "I'm seeing two specific real-time trends in your lane right now — NYC Scent Map and NYC Logic.",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.blockedReasons).toContain("trend-mention-without-citation");
    expect(json.suggestedFix).toBeTruthy();
  });

  it("BLOCK: markdown-bold leak → ok=false with markdown-bold", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "md-bold",
      plan: "manager",
    });
    const res = await t.fetch("/lc_maya/validate_outbound_send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        message: "This is **important** info about Thursday.",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.blockedReasons).toContain("markdown-bold");
  });

  it("BLOCK: both trend confabulation AND markdown → ok=false with both reasons", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "both",
      plan: "manager",
    });
    const res = await t.fetch("/lc_maya/validate_outbound_send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        message:
          "Here's the **real-time trends** I'm seeing right now in your lane:\n1. NYC Scent Map\n2. NYC Logic\n3. Subway POV",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.blockedReasons).toContain("trend-mention-without-citation");
    expect(json.blockedReasons).toContain("markdown-bold");
    expect(json.blockedReasons).toContain("numbered-list");
    // Combined fix string mentions both surfaces.
    expect(json.suggestedFix).toMatch(/tiktok\.com|platform post URL/);
    expect(json.suggestedFix).toMatch(/iMessage/);
  });

  it("PLAN-TIER: coach tier also gates (firewall is plan-agnostic)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "coach",
      plan: "coach",
    });
    const res = await t.fetch("/lc_maya/validate_outbound_send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        message: "**bold** even on coach",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("ADVERSARIAL: empty message → ok=true (nothing to gate)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "empty-msg",
      plan: "manager",
    });
    const res = await t.fetch("/lc_maya/validate_outbound_send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId, message: "" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("ADVERSARIAL: very long (~50KB) clean message → ok=true", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "long",
      plan: "manager",
    });
    const long = "Brooklyn shoot Thursday. ".repeat(2000);
    const res = await t.fetch("/lc_maya/validate_outbound_send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        message: long,
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("ADVERSARIAL: unicode-heavy passes the format gate", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "uni",
      plan: "manager",
    });
    const res = await t.fetch("/lc_maya/validate_outbound_send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        message: "你好 — Brooklyn shoot 木曜日, ready? 🎬✨",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Layer 3 — sibling-file scan                                                  */
/* -------------------------------------------------------------------------- */

describe("sibling-file scan", () => {
  it("convex/http.ts registers /lc_maya/validate_outbound_send", () => {
    const httpSrc = readFileSync(
      join(process.cwd(), "convex/http.ts"),
      "utf8"
    );
    expect(httpSrc).toMatch(/validateOutboundSendHttp/);
    expect(httpSrc).toMatch(/\/lc_maya\/validate_outbound_send/);
  });

  it("convex/lcMaya/lcMayaHttp.ts exports validateOutboundSendHttp + checkImessageFormat", () => {
    const lcMayaSrc = readFileSync(
      join(process.cwd(), "convex/lcMaya/lcMayaHttp.ts"),
      "utf8"
    );
    expect(lcMayaSrc).toMatch(/export const validateOutboundSendHttp/);
    expect(lcMayaSrc).toMatch(/export function checkImessageFormat/);
  });

  it("infra patch script injects validateOutboundOrThrow into send.js", () => {
    const patchSrc = readFileSync(
      join(
        process.cwd(),
        "infra/openclaw-runtime/patch-claw-messenger-plugin.mjs"
      ),
      "utf8"
    );
    expect(patchSrc).toMatch(/validateOutboundOrThrow/);
    expect(patchSrc).toMatch(/\/lc_maya\/validate_outbound_send/);
  });

  it("deployMaya.ts seeds MAYA_CREATOR_ID into the Fly env", () => {
    const deploySrc = readFileSync(
      join(process.cwd(), "convex/onboarding/maya/deployMaya.ts"),
      "utf8"
    );
    expect(deploySrc).toMatch(/MAYA_CREATOR_ID:\s*config\.creatorId/);
  });
});
