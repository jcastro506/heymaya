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

  it("infra patch script also injects runtime-layer firewall (Sprint B.3)", () => {
    const patchSrc = readFileSync(
      join(
        process.cwd(),
        "infra/openclaw-runtime/patch-claw-messenger-plugin.mjs"
      ),
      "utf8"
    );
    // The runtime-layer firewall lives in
    // `/usr/local/lib/node_modules/openclaw/dist/deliver-BAZ1LU-l.js` and
    // wraps `sendTextChunks`. It is channel-agnostic (catches Telegram /
    // WhatsApp / Discord paths too if/when added) and runs once per
    // payload (before chunking, so trend citations split across chunks
    // are not false-positive-blocked).
    expect(patchSrc).toMatch(/deliver-BAZ1LU-l\.js/);
    expect(patchSrc).toMatch(/validateOutboundOrThrowRuntime/);
    expect(patchSrc).toMatch(/sendTextChunks = async/);
    // Both firewalls hit the same Convex endpoint with the same env-var
    // contract — single source of validation logic.
    const matches = patchSrc.match(/\/lc_maya\/validate_outbound_send/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("patch script is idempotent — guard prevents double-injection of runtime firewall", () => {
    const patchSrc = readFileSync(
      join(
        process.cwd(),
        "infra/openclaw-runtime/patch-claw-messenger-plugin.mjs"
      ),
      "utf8"
    );
    // Mirror the existing-marker guard pattern used by every other
    // patch in the script.
    expect(patchSrc).toMatch(
      /if \(!deliverSrc\.includes\("async function validateOutboundOrThrowRuntime\(/
    );
    // Fail-loud when the upstream openclaw layout changes.
    expect(patchSrc).toMatch(
      /Unable to patch deliver-runtime sendTextChunks; expected marker not found\./
    );
  });

  it("deployMaya.ts seeds MAYA_CREATOR_ID into the Fly env", () => {
    const deploySrc = readFileSync(
      join(process.cwd(), "convex/onboarding/maya/deployMaya.ts"),
      "utf8"
    );
    expect(deploySrc).toMatch(/MAYA_CREATOR_ID:\s*config\.creatorId/);
  });
});

/* -------------------------------------------------------------------------- */
/* Sprint C.6 — firewallEvents telemetry coverage                             */
/*                                                                            */
/* Sprint C.6 adds a `firewallEvents` table that captures every call to       */
/* /lc_maya/validate_outbound_send + /lc_maya/validate_trend_citation. The    */
/* table is the data plane for measuring real catch-rate vs false-positive   */
/* rate on the wire-level firewall. These tests cover the table writes      */
/* across the 5 mandatory categories.                                       */
/* -------------------------------------------------------------------------- */

describe("validate_outbound_send — Sprint C.6 firewallEvents telemetry", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("writes one firewallEvents row on a clean (ok=true) call", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "c6-clean", plan: "manager" });

    const res = await t.fetch("/lc_maya/validate_outbound_send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        message: "your morning post is at 2.3x your usual median for that format",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const rows = await t.run((ctx) =>
      ctx.db
        .query("firewallEvents")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe("ok");
    expect(rows[0].source).toBe("validate_outbound_send");
    expect(rows[0].matchedTrendPattern).toBeUndefined();
  });

  it("writes one firewallEvents row on a blocked call with the matched-pattern label", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "c6-blocked",
      plan: "manager",
    });

    const res = await t.fetch("/lc_maya/validate_outbound_send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        message: "this sound is going viral right now",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.blockedReasons).toContain("trend-mention-without-citation");

    const rows = await t.run((ctx) =>
      ctx.db
        .query("firewallEvents")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe("blocked");
    expect(rows[0].matchedTrendPattern).toBe("going-viral");
    expect(rows[0].blockedReasons).toContain("trend-mention-without-citation");
  });

  it("logs format violations to formatCategoriesTripped", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "c6-format",
      plan: "manager",
    });

    await t.fetch("/lc_maya/validate_outbound_send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        message: "**bold** and:\n1. one\n2. two",
      }),
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("firewallEvents")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe("blocked");
    expect(rows[0].formatCategoriesTripped).toBeDefined();
    expect(rows[0].formatCategoriesTripped).toContain("markdown-bold");
    expect(rows[0].formatCategoriesTripped).toContain("numbered-list");
  });

  it("cross-tenant — creator A's firewall events never appear in creator B's query", async () => {
    const t = convexTest(schema, modules);
    const creatorA = await insertCreator(t, { suffix: "c6-a", plan: "manager" });
    const creatorB = await insertCreator(t, { suffix: "c6-b", plan: "manager" });

    await t.fetch("/lc_maya/validate_outbound_send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId: creatorA,
        message: "going viral with no url",
      }),
    });

    const rowsB = await t.run((ctx) =>
      ctx.db
        .query("firewallEvents")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorB))
        .collect()
    );
    expect(rowsB).toHaveLength(0);

    const rowsA = await t.run((ctx) =>
      ctx.db
        .query("firewallEvents")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorA))
        .collect()
    );
    expect(rowsA).toHaveLength(1);
  });

  it("validate_trend_citation writes telemetry when creatorId is supplied", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "c6-trend", plan: "manager" });

    await t.fetch("/lc_maya/validate_trend_citation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        message: "this trend is blowing up right now",
      }),
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("firewallEvents")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("validate_trend_citation");
    expect(rows[0].verdict).toBe("blocked");
    // Most specific pattern wins; "blowing up" should match first.
    expect(rows[0].matchedTrendPattern).toBe("blowing-up");
  });

  it("validate_trend_citation does NOT write telemetry when creatorId is omitted (back-compat)", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/lc_maya/validate_trend_citation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        message: "going viral",
      }),
    });
    expect(res.status).toBe(200);
    const rows = await t.run((ctx) => ctx.db.query("firewallEvents").collect());
    expect(rows).toHaveLength(0);
  });

  it("Sprint C.6 — false-positive fix: 'I saw the X' no longer blocks the typing-bubble bug message", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "c6-fp", plan: "manager" });

    // The actual 2026-05-13 message that triggered the typing-bubble bug.
    const res = await t.fetch("/lc_maya/validate_outbound_send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        message:
          "Nice. The NYC architecture shots already read that way—they have a totally different energy than the London clips. Next: How would you describe your niche in your own words? (I saw the observational domestic and London stuff in your last 30, but I want to hear how you frame what you make.)",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mentionsTrend).toBe(false);

    const rows = await t.run((ctx) =>
      ctx.db
        .query("firewallEvents")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe("ok");
  });
});
