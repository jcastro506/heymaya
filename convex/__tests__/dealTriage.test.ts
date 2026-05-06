/**
 * dealTriage — Sprint 5 acceptance.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: Creator A's webhook never writes Creator B's brandDeals row
 *   2. Plan-tier: Starter inbound is dropped silently (no triage, no row)
 *   3. Adversarial: auto-send only fires on `firm` variant + offer-under-threshold
 *      (not on enthusiastic/neutral/pass — anti-footgun)
 *   4. Sibling-file scan: covered repo-wide by sprint1Acceptance
 *   5. TODO grep: covered repo-wide; this file uses TODO(s8) justified markers
 */

import { describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../../tests/_modules";
import type { Id } from "../_generated/dataModel";
import { gmailThreadToTriagerInput } from "../dealTriage";
import type { GmailThread as TriagerGmailThread } from "../../agents/skills/maya-brand-deal-triager/script";

const NOW = 1_700_000_000_000;

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan: "coach" | "manager" }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

async function attachGmailAccount(
  t: ReturnType<typeof convexTest>,
  opts: {
    creatorId: Id<"creators">;
    encryptedComposioAccountId: string;
    autoSendThreshold?: number;
  }
): Promise<Id<"connectedAccounts">> {
  return await t.run((ctx) =>
    ctx.db.insert("connectedAccounts", {
      creatorId: opts.creatorId,
      provider: "gmail",
      composioAccountId: opts.encryptedComposioAccountId,
      composioAccountIdHash: `hash_${opts.encryptedComposioAccountId}`,
      scopes: ["gmail.readonly", "gmail.send"],
      scopeStatus: "active",
      autoSendThreshold: opts.autoSendThreshold,
      connectedAt: NOW,
    })
  );
}

const REAL_DEAL_THREAD: TriagerGmailThread = {
  threadId: "thr_real_deal_1",
  from: {
    email: "partnerships@lululemon.com",
    name: "Lululemon Partnerships",
    domain: "lululemon.com",
  },
  subject: "Partnership opportunity",
  bodyText:
    "Hi! We are thinking 1 Reel + 1 TT post, 30-day usage, $4500 total. Deadline October 15.",
  receivedMs: NOW,
  attachments: [],
};

const SUB_FLOOR_PITCH_THREAD: TriagerGmailThread = {
  threadId: "thr_sub_floor_1",
  from: {
    email: "growth@nobrand.io",
    name: "NoBrand",
    domain: "nobrand.io",
  },
  subject: "Quick collab idea",
  bodyText: "Would love to do 1 Reel for $50 — total budget. Let us know!",
  receivedMs: NOW,
  attachments: [],
};

/* -------------------------------------------------------------------------- */
/* Mock encryption — we use a fixed key so decrypt is deterministic            */
/* -------------------------------------------------------------------------- */

// 32 bytes of zeros, base64. btoa(String.fromCharCode(...Array(32).fill(0))) =
// "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" (43 'A's + '=' padding).
const TEST_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

async function withEncryptionKey<T>(fn: () => Promise<T>): Promise<T> {
  const old = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  // Reset cached key
  const enc = await import("../lib/encryption");
  enc._resetEncryptionKeyCache();
  try {
    return await fn();
  } finally {
    if (old) process.env.ENCRYPTION_KEY = old;
    else delete process.env.ENCRYPTION_KEY;
    enc._resetEncryptionKeyCache();
  }
}

/* -------------------------------------------------------------------------- */
/* Variant-drafter mock — Sprint 8 Slice A.                                    */
/*                                                                             */
/* The orchestrator now routes through `callMaya` for the variant drafter.    */
/* Tests stub the OpenRouter fetch so the route returns deterministic JSON    */
/* (NOT user-facing prose — these are fixture tokens, not the prose the      */
/* creator would actually receive).                                            */
/* -------------------------------------------------------------------------- */

const MOCK_VARIANT_JSON = JSON.stringify({
  enthusiastic: "[fixture-enthusiastic]",
  neutral: "[fixture-neutral]",
  firm: "[fixture-firm]",
  pass: "[fixture-pass]",
});

function makeOpenRouterResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      id: "gen-test",
      model: "google/gemini-3-flash",
      choices: [
        {
          message: { content },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

/**
 * Dispatch a fetch mock that handles BOTH OpenRouter (model-router) calls
 * and Composio Gmail calls. OpenRouter returns the fixture variant JSON;
 * Composio is delegated to the inner handler so each test can layer in its
 * specific Gmail-action expectations.
 */
function withDealTriageFetch(opts: {
  composio?: (
    url: string,
    init?: RequestInit
  ) => Response | Promise<Response>;
  variantContent?: string;
}) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("openrouter.ai")) {
        return makeOpenRouterResponse(opts.variantContent ?? MOCK_VARIANT_JSON);
      }
      if (opts.composio) {
        return await opts.composio(urlStr, init);
      }
      throw new Error(`Unexpected fetch in dealTriage test: ${urlStr}`);
    });
}

async function withOpenRouterEnv<T>(fn: () => Promise<T>): Promise<T> {
  const oldKey = process.env.OPENROUTER_API_KEY;
  const oldModel = process.env.OPENROUTER_DEFAULT_MODEL;
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_DEFAULT_MODEL = "google/gemini-3-flash";
  try {
    return await fn();
  } finally {
    if (oldKey) process.env.OPENROUTER_API_KEY = oldKey;
    else delete process.env.OPENROUTER_API_KEY;
    if (oldModel) process.env.OPENROUTER_DEFAULT_MODEL = oldModel;
    else delete process.env.OPENROUTER_DEFAULT_MODEL;
  }
}

/* -------------------------------------------------------------------------- */
/* triageInboundEmail — happy path                                             */
/* -------------------------------------------------------------------------- */

describe("dealTriage.triageInboundEmail", () => {
  it("happy path: real deal → brandDeals row + 4 reply variants", async () => {
    await withEncryptionKey(async () => {
      await withOpenRouterEnv(async () => {
        const t = convexTest(schema, modules);
        const creator = await insertCreator(t, { suffix: "pro1", plan: "manager" });
        // Encrypt a placeholder account id
        const enc = await import("../lib/encryption");
        const cipher = await enc.encrypt("composio_acc_real");
        await attachGmailAccount(t, {
          creatorId: creator,
          encryptedComposioAccountId: cipher,
        });

        const fetchSpy = withDealTriageFetch({});
        try {
          const result = await t.action(internal.dealTriage.triageInboundEmail, {
            creatorId: creator,
            gmailThread: REAL_DEAL_THREAD,
          });
          expect(result.brandDealId).not.toBeNull();
          expect(result.autoSent).toBe(false); // no autoSendThreshold set

          const deals = await t.run((ctx) =>
            ctx.db
              .query("brandDeals")
              .withIndex("by_creator", (q) => q.eq("creatorId", creator))
              .collect()
          );
          expect(deals).toHaveLength(1);
          expect(deals[0].brand.toLowerCase()).toContain("lululemon");
          expect(deals[0].replyVariants.length).toBe(4);
          expect(deals[0].gmailThreadId).toBe("thr_real_deal_1");
        } finally {
          fetchSpy.mockRestore();
        }
      });
    });
  });

  it("REGRESSION (S8 Slice A): variant drafting routes through maya-brand-deal-triager — no hardcoded prose in orchestrator", async () => {
    // The orchestrator must not template `Hi ${brand}, thanks for ...` — it
    // routes through buildVariantPrompt → callMaya. We assert the OpenRouter
    // call fired with task tag `brand_email_draft` and the prompt mentions
    // the buildVariantPrompt-built rubric (variants list, classification line).
    await withEncryptionKey(async () => {
      await withOpenRouterEnv(async () => {
        const t = convexTest(schema, modules);
        const creator = await insertCreator(t, { suffix: "regress", plan: "manager" });
        const enc = await import("../lib/encryption");
        await attachGmailAccount(t, {
          creatorId: creator,
          encryptedComposioAccountId: await enc.encrypt("acc_regress"),
        });

        const fetchSpy = withDealTriageFetch({});
        try {
          await t.action(internal.dealTriage.triageInboundEmail, {
            creatorId: creator,
            gmailThread: REAL_DEAL_THREAD,
          });

          const openRouterCalls = fetchSpy.mock.calls.filter(([u]) =>
            (typeof u === "string" ? u : (u as URL).toString()).includes(
              "openrouter.ai"
            )
          );
          expect(openRouterCalls.length).toBeGreaterThan(0);
          const init = openRouterCalls[0][1] as RequestInit;
          const body = JSON.parse(init.body as string);
          // The brand_email_draft task tag → high thinking budget.
          expect(body.reasoning).toEqual({ effort: "high" });
          // Prompt must contain the buildVariantPrompt rubric markers,
          // proving routing went through the skill (not hardcoded prose).
          const userMessage = body.messages.find(
            (m: { role: string }) => m.role === "user"
          );
          expect(userMessage.content).toContain("Required variants");
          expect(userMessage.content).toContain("Voice fingerprint to mirror");
          expect(userMessage.content).toContain("Classification:");
        } finally {
          fetchSpy.mockRestore();
        }
      });
    });
  });

  it("PLAN-TIER (REVISED): Starter Gmail deal-desk is enabled — inbound triages just like Pro", async () => {
    // Tier philosophy revised 2026-04-26: gmailDealDeskEnabled is universal.
    // The cost is small + the value is the headline reason creators sign up.
    // Starter inbound now produces a brandDeals row + 4 reply variants exactly
    // like Pro. The skipped_plan_disabled outcome is reserved for future plan
    // configurations where gmailDealDeskEnabled might be flipped off again.
    await withEncryptionKey(async () => {
      await withOpenRouterEnv(async () => {
        const t = convexTest(schema, modules);
        const creator = await insertCreator(t, { suffix: "starter1", plan: "coach" });
        const enc = await import("../lib/encryption");
        const cipher = await enc.encrypt("composio_acc_starter");
        await attachGmailAccount(t, {
          creatorId: creator,
          encryptedComposioAccountId: cipher,
        });

        const fetchSpy = withDealTriageFetch({});
        try {
          const result = await t.action(internal.dealTriage.triageInboundEmail, {
            creatorId: creator,
            gmailThread: REAL_DEAL_THREAD,
          });
          expect(result.brandDealId).not.toBeNull();
          expect(result.autoSent).toBe(false); // no autoSendThreshold set

          const deals = await t.run((ctx) =>
            ctx.db
              .query("brandDeals")
              .withIndex("by_creator", (q) => q.eq("creatorId", creator))
              .collect()
          );
          expect(deals).toHaveLength(1);
          expect(deals[0].brand.toLowerCase()).toContain("lululemon");
          expect(deals[0].replyVariants.length).toBe(4);

          // Should NOT have logged a skipped_plan_disabled row.
          const log = await t.run((ctx) =>
            ctx.db
              .query("mayaActionLog")
              .withIndex("by_creator", (q) => q.eq("creatorId", creator))
              .collect()
          );
          expect(log.some((r) => r.outcome === "skipped_plan_disabled")).toBe(
            false
          );
        } finally {
          fetchSpy.mockRestore();
        }
      });
    });
  });

  it("CROSS-TENANT: Creator A's triage never writes a row on Creator B", async () => {
    await withEncryptionKey(async () => {
      await withOpenRouterEnv(async () => {
        const t = convexTest(schema, modules);
        const a = await insertCreator(t, { suffix: "a", plan: "manager" });
        const b = await insertCreator(t, { suffix: "b", plan: "manager" });
        const enc = await import("../lib/encryption");
        await attachGmailAccount(t, {
          creatorId: a,
          encryptedComposioAccountId: await enc.encrypt("acc_a"),
        });
        await attachGmailAccount(t, {
          creatorId: b,
          encryptedComposioAccountId: await enc.encrypt("acc_b"),
        });

        const fetchSpy = withDealTriageFetch({});
        try {
          await t.action(internal.dealTriage.triageInboundEmail, {
            creatorId: a,
            gmailThread: REAL_DEAL_THREAD,
          });

          const dealsB = await t.run((ctx) =>
            ctx.db
              .query("brandDeals")
              .withIndex("by_creator", (q) => q.eq("creatorId", b))
              .collect()
          );
          expect(dealsB).toEqual([]);

          const dealsA = await t.run((ctx) =>
            ctx.db
              .query("brandDeals")
              .withIndex("by_creator", (q) => q.eq("creatorId", a))
              .collect()
          );
          expect(dealsA).toHaveLength(1);
        } finally {
          fetchSpy.mockRestore();
        }
      });
    });
  });

  it("MVP DEFAULT (S8 Slice A): under-threshold offer pre-DRAFTS via Gmail, never auto-sends", async () => {
    // Sprint 7 Slice A carry-forward locked into Sprint 8 Slice A:
    // MVP_ALLOW_AUTO_SEND is unset → the orchestrator NEVER calls
    // GMAIL_SEND_EMAIL. The under-threshold path now creates a draft via
    // GMAIL_CREATE_DRAFT for the creator to approve and send manually.
    await withEncryptionKey(async () => {
      await withOpenRouterEnv(async () => {
        const t = convexTest(schema, modules);
        const creator = await insertCreator(t, { suffix: "pro_auto", plan: "manager" });
        const enc = await import("../lib/encryption");
        const cipher = await enc.encrypt("composio_acc_autosend");
        await attachGmailAccount(t, {
          creatorId: creator,
          encryptedComposioAccountId: cipher,
          autoSendThreshold: 500, // anything under $500 auto-declines
        });

        const fetchSpy = withDealTriageFetch({
          composio: async (url) => {
            if (url.includes("GMAIL_CREATE_DRAFT")) {
              return new Response(
                JSON.stringify({
                  successful: true,
                  data: {
                    id: "draft_1",
                    message: { id: "m_draft", threadId: "thr_sub_floor_1" },
                  },
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }
              );
            }
            if (url.includes("GMAIL_SEND_EMAIL")) {
              throw new Error(
                "MVP must never call GMAIL_SEND_EMAIL — only GMAIL_CREATE_DRAFT"
              );
            }
            throw new Error(`Unexpected composio fetch: ${url}`);
          },
        });
        const oldKey = process.env.COMPOSIO_API_KEY;
        process.env.COMPOSIO_API_KEY = "test-key";
        const oldUrl = process.env.COMPOSIO_BASE_URL;
        process.env.COMPOSIO_BASE_URL = "https://api.composio.test";
        const oldAllow = process.env.MVP_ALLOW_AUTO_SEND;
        delete process.env.MVP_ALLOW_AUTO_SEND;
        const composioClient = await import("../integrations/composio/client");
        composioClient.resetDefaultComposioClient();

        try {
          const result = await t.action(internal.dealTriage.triageInboundEmail, {
            creatorId: creator,
            gmailThread: SUB_FLOOR_PITCH_THREAD,
          });
          expect(result.brandDealId).not.toBeNull();
          // MVP: autoSent is ALWAYS false because the path is createDraft.
          expect(result.autoSent).toBe(false);

          // Exactly one createDraft call, zero sendEmail calls.
          const draftCalls = fetchSpy.mock.calls.filter(([u]) =>
            (typeof u === "string" ? u : (u as URL).toString()).includes(
              "GMAIL_CREATE_DRAFT"
            )
          );
          const sendCalls = fetchSpy.mock.calls.filter(([u]) =>
            (typeof u === "string" ? u : (u as URL).toString()).includes(
              "GMAIL_SEND_EMAIL"
            )
          );
          expect(draftCalls).toHaveLength(1);
          expect(sendCalls).toHaveLength(0);

          const log = await t.run((ctx) =>
            ctx.db
              .query("mayaActionLog")
              .withIndex("by_creator", (q) => q.eq("creatorId", creator))
              .collect()
          );
          expect(
            log.some(
              (r) =>
                r.entryId === "brand_email_triage_autodraft" && r.outcome === "ran"
            )
          ).toBe(true);
          // No autosend row should have been written.
          expect(
            log.some((r) => r.entryId === "brand_email_triage_autosend")
          ).toBe(false);
        } finally {
          fetchSpy.mockRestore();
          if (oldKey) process.env.COMPOSIO_API_KEY = oldKey;
          else delete process.env.COMPOSIO_API_KEY;
          if (oldUrl) process.env.COMPOSIO_BASE_URL = oldUrl;
          else delete process.env.COMPOSIO_BASE_URL;
          if (oldAllow) process.env.MVP_ALLOW_AUTO_SEND = oldAllow;
          else delete process.env.MVP_ALLOW_AUTO_SEND;
          composioClient.resetDefaultComposioClient();
        }
      });
    });
  });

  it("S8 Slice A — MVP_ALLOW_AUTO_SEND unset by default → no auto-send fires even with threshold + firm variant", async () => {
    // Hard product rule: NEVER auto-send email in MVP. This regression test
    // proves the env flag is required + default-off, independent of the
    // createDraft test above.
    await withEncryptionKey(async () => {
      await withOpenRouterEnv(async () => {
        const t = convexTest(schema, modules);
        const creator = await insertCreator(t, { suffix: "no_autosend", plan: "manager" });
        const enc = await import("../lib/encryption");
        await attachGmailAccount(t, {
          creatorId: creator,
          encryptedComposioAccountId: await enc.encrypt("acc_no_send"),
          autoSendThreshold: 500,
        });

        // MVP_ALLOW_AUTO_SEND must be unset (the default). Assert at the
        // start of the test that the operator hasn't accidentally set it.
        expect(process.env.MVP_ALLOW_AUTO_SEND).toBeUndefined();

        const fetchSpy = withDealTriageFetch({
          composio: async (url) => {
            if (url.includes("GMAIL_SEND_EMAIL")) {
              throw new Error(
                "MVP_ALLOW_AUTO_SEND unset must mean zero send calls"
              );
            }
            if (url.includes("GMAIL_CREATE_DRAFT")) {
              return new Response(
                JSON.stringify({
                  successful: true,
                  data: {
                    id: "d_1",
                    message: { id: "m_d", threadId: "thr_sub_floor_1" },
                  },
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }
              );
            }
            throw new Error(`Unexpected: ${url}`);
          },
        });
        const oldKey = process.env.COMPOSIO_API_KEY;
        process.env.COMPOSIO_API_KEY = "test-key";
        const oldUrl = process.env.COMPOSIO_BASE_URL;
        process.env.COMPOSIO_BASE_URL = "https://api.composio.test";
        const composioClient = await import("../integrations/composio/client");
        composioClient.resetDefaultComposioClient();
        try {
          const result = await t.action(internal.dealTriage.triageInboundEmail, {
            creatorId: creator,
            gmailThread: SUB_FLOOR_PITCH_THREAD,
          });
          expect(result.autoSent).toBe(false);
          const sendCalls = fetchSpy.mock.calls.filter(([u]) =>
            (typeof u === "string" ? u : (u as URL).toString()).includes(
              "GMAIL_SEND_EMAIL"
            )
          );
          expect(sendCalls).toHaveLength(0);
        } finally {
          fetchSpy.mockRestore();
          if (oldKey) process.env.COMPOSIO_API_KEY = oldKey;
          else delete process.env.COMPOSIO_API_KEY;
          if (oldUrl) process.env.COMPOSIO_BASE_URL = oldUrl;
          else delete process.env.COMPOSIO_BASE_URL;
          composioClient.resetDefaultComposioClient();
        }
      });
    });
  });

  it("ADVERSARIAL — auto-send does NOT fire when offer is ABOVE threshold", async () => {
    await withEncryptionKey(async () => {
      await withOpenRouterEnv(async () => {
        const t = convexTest(schema, modules);
        const creator = await insertCreator(t, { suffix: "pro_above", plan: "manager" });
        const enc = await import("../lib/encryption");
        const cipher = await enc.encrypt("composio_acc_above");
        await attachGmailAccount(t, {
          creatorId: creator,
          encryptedComposioAccountId: cipher,
          autoSendThreshold: 100, // tiny threshold — REAL_DEAL_THREAD's $4500 is above
        });

        const fetchSpy = withDealTriageFetch({});
        try {
          const result = await t.action(internal.dealTriage.triageInboundEmail, {
            creatorId: creator,
            gmailThread: REAL_DEAL_THREAD,
          });
          expect(result.autoSent).toBe(false);
          // Neither SEND nor DRAFT should have fired (above-threshold path
          // never enters the autodraft branch either).
          const sendCalls = fetchSpy.mock.calls.filter(([u]) =>
            (typeof u === "string" ? u : (u as URL).toString()).includes(
              "GMAIL_SEND_EMAIL"
            )
          );
          expect(sendCalls).toHaveLength(0);
          const draftCalls = fetchSpy.mock.calls.filter(([u]) =>
            (typeof u === "string" ? u : (u as URL).toString()).includes(
              "GMAIL_CREATE_DRAFT"
            )
          );
          expect(draftCalls).toHaveLength(0);
        } finally {
          fetchSpy.mockRestore();
        }
      });
    });
  });

  it("ADVERSARIAL — when classification is NOT 'real-deal', autodraft is suppressed", async () => {
    // The webhook handler does not gate on classification — only the orchestrator
    // does. This test asserts that even with a sub-threshold offer + firm
    // variant present, a non-real-deal classification (e.g. press-inquiry) does
    // NOT trigger autodraft (or autosend). Anti-footgun.
    await withEncryptionKey(async () => {
      await withOpenRouterEnv(async () => {
        const t = convexTest(schema, modules);
        const creator = await insertCreator(t, { suffix: "pro_pressfire", plan: "manager" });
        const enc = await import("../lib/encryption");
        const cipher = await enc.encrypt("composio_acc_press");
        await attachGmailAccount(t, {
          creatorId: creator,
          encryptedComposioAccountId: cipher,
          autoSendThreshold: 1_000_000,
        });

        // press-inquiry thread — has dollar amounts but classified as press
        const pressThread: TriagerGmailThread = {
          threadId: "thr_press",
          from: { email: "writer@nyt.com", name: "NYT Writer", domain: "nyt.com" },
          subject: "Quote for our story",
          bodyText:
            "Hi, I'm writing a piece on creator economy. Could I get a quote? We pay $50 honorarium.",
          receivedMs: NOW,
          attachments: [],
        };

        const fetchSpy = withDealTriageFetch({});
        try {
          const result = await t.action(internal.dealTriage.triageInboundEmail, {
            creatorId: creator,
            gmailThread: pressThread,
          });
          expect(result.autoSent).toBe(false);
          const sendCalls = fetchSpy.mock.calls.filter(([u]) =>
            (typeof u === "string" ? u : (u as URL).toString()).includes(
              "GMAIL_SEND_EMAIL"
            )
          );
          expect(sendCalls).toHaveLength(0);
          const draftCalls = fetchSpy.mock.calls.filter(([u]) =>
            (typeof u === "string" ? u : (u as URL).toString()).includes(
              "GMAIL_CREATE_DRAFT"
            )
          );
          expect(draftCalls).toHaveLength(0);
        } finally {
          fetchSpy.mockRestore();
        }
      });
    });
  });

  it("auto-send is SKIPPED when no autoSendThreshold is set", async () => {
    await withEncryptionKey(async () => {
      await withOpenRouterEnv(async () => {
        const t = convexTest(schema, modules);
        const creator = await insertCreator(t, { suffix: "no_thresh", plan: "manager" });
        const enc = await import("../lib/encryption");
        await attachGmailAccount(t, {
          creatorId: creator,
          encryptedComposioAccountId: await enc.encrypt("acc_x"),
          // autoSendThreshold intentionally omitted
        });
        const fetchSpy = withDealTriageFetch({});
        try {
          const result = await t.action(internal.dealTriage.triageInboundEmail, {
            creatorId: creator,
            gmailThread: REAL_DEAL_THREAD,
          });
          expect(result.autoSent).toBe(false);
        } finally {
          fetchSpy.mockRestore();
        }
      });
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Webhook event recording                                                     */
/* -------------------------------------------------------------------------- */

describe("dealTriage.recordWebhookEvent", () => {
  it("idempotent on eventId — second insert lands as replay_dropped", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const first = await t.mutation(internal.dealTriage.recordWebhookEvent, {
      eventId: "evt_1",
      eventType: "gmail.message.received",
      composioAccountId: "acc_1",
      creatorId: a,
      threadId: "thr_1",
      status: "processed",
      rawPayload: { foo: "bar" },
    });
    expect(first.alreadySeen).toBe(false);
    const second = await t.mutation(internal.dealTriage.recordWebhookEvent, {
      eventId: "evt_1",
      eventType: "gmail.message.received",
      composioAccountId: "acc_1",
      creatorId: a,
      threadId: "thr_1",
      status: "processed",
      rawPayload: { foo: "bar" },
    });
    expect(second.alreadySeen).toBe(true);
    const all = await t.run((ctx) =>
      ctx.db
        .query("gmailWebhookEvents")
        .withIndex("by_event_id", (q) => q.eq("eventId", "evt_1"))
        .collect()
    );
    // Both rows present (one processed, one replay_dropped) for audit trail.
    expect(all).toHaveLength(2);
    const statuses = all.map((r) => r.status).sort();
    expect(statuses).toEqual(["processed", "replay_dropped"]);
  });
});

/* -------------------------------------------------------------------------- */
/* findCreatorByComposioAccount (cross-tenant)                                 */
/* -------------------------------------------------------------------------- */

describe("dealTriage.findCreatorByComposioAccount", () => {
  it("CROSS-TENANT: hash for Creator A's account never resolves to Creator B", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const b = await insertCreator(t, { suffix: "b", plan: "manager" });
    await attachGmailAccount(t, {
      creatorId: a,
      encryptedComposioAccountId: "enc_acc_a",
    });
    await attachGmailAccount(t, {
      creatorId: b,
      encryptedComposioAccountId: "enc_acc_b",
    });
    // The fixture sets composioAccountIdHash = `hash_${enc}` so we can look up directly
    const ownerOfA = await t.query(
      internal.dealTriage.findCreatorByComposioAccount,
      { composioAccountIdHash: "hash_enc_acc_a" }
    );
    expect(ownerOfA?.creatorId).toBe(a);
    const ownerOfB = await t.query(
      internal.dealTriage.findCreatorByComposioAccount,
      { composioAccountIdHash: "hash_enc_acc_b" }
    );
    expect(ownerOfB?.creatorId).toBe(b);
  });

  it("returns null for unrecognized account hash", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.query(
      internal.dealTriage.findCreatorByComposioAccount,
      { composioAccountIdHash: "hash_unknown" }
    );
    expect(owner).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* gmailThreadToTriagerInput — pure-function tests                             */
/* -------------------------------------------------------------------------- */

describe("gmailThreadToTriagerInput", () => {
  it("normalizes a Composio thread into the triager shape", () => {
    const composioThread = {
      id: "thr_abc",
      messages: [
        {
          id: "msg_1",
          threadId: "thr_abc",
          internalDate: "1700000000000",
          headers: [
            { name: "From", value: "Brand Name <partnerships@brand.com>" },
            { name: "Subject", value: "Partnership idea" },
          ],
          bodyText: "Hi! We want to do 1 Reel for $5000.",
          attachments: [
            { filename: "contract.pdf", mimeType: "application/pdf", url: "https://x/contract.pdf" },
          ],
        },
      ],
    };
    const triager = gmailThreadToTriagerInput(composioThread);
    expect(triager.threadId).toBe("thr_abc");
    expect(triager.from.email).toBe("partnerships@brand.com");
    expect(triager.from.domain).toBe("brand.com");
    expect(triager.from.name).toBe("Brand Name");
    expect(triager.subject).toBe("Partnership idea");
    expect(triager.bodyText).toContain("$5000");
    expect(triager.attachments).toHaveLength(1);
    expect(triager.attachments[0].kind).toBe("pdf");
  });

  it("ADVERSARIAL — empty messages array throws", () => {
    expect(() =>
      gmailThreadToTriagerInput({ id: "thr_x", messages: [] })
    ).toThrow(/no messages/);
  });
});
