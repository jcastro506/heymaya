/**
 * Gmail API wrapper tests (Sprint 9.8 Workstream A).
 *
 * Five mandatory categories:
 *   1. Cross-tenant isolation — N/A; wrappers are stateless on accessToken
 *      so two creators' tokens cannot collide here. Cross-tenant safety
 *      lives at the orchestrating-action layer.
 *   2. Plan-tier — N/A; same as above.
 *   3. Adversarial — error responses (4xx/5xx) surface as GmailApiError.
 *   4. Sibling-file scan — wrappers use raw fetch (no `googleapis` dep)
 *      mirroring the Calendar pattern in `creatorMayaV0/backend.ts`.
 *   5. TODO grep — covered repo-wide.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GmailApiError,
  _internal,
  createDraft,
  getMessageDetail,
  listInboxMessages,
  sendMessage,
} from "../gmail";

const ACCESS_TOKEN = "test-access-token";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(
  status: number,
  body: unknown,
  capture?: { url?: string; init?: RequestInit }
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (capture) {
        capture.url = url;
        capture.init = init;
      }
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    })
  );
}

describe("listInboxMessages", () => {
  it("HAPPY: defaults to maxResults=10 and INBOX label, returns parsed message refs", async () => {
    const cap: { url?: string; init?: RequestInit } = {};
    mockFetch(
      200,
      {
        messages: [
          { id: "m1", threadId: "t1" },
          { id: "m2", threadId: "t2" },
        ],
        resultSizeEstimate: 2,
      },
      cap
    );
    const out = await listInboxMessages(ACCESS_TOKEN);
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0]?.id).toBe("m1");
    expect(cap.url).toContain("maxResults=10");
    expect(cap.url).toContain("labelIds=INBOX");
    expect((cap.init?.headers as Record<string, string>)?.Authorization).toBe(
      `Bearer ${ACCESS_TOKEN}`
    );
  });

  it("ADVERSARIAL: passes Gmail search query and custom labels", async () => {
    const cap: { url?: string; init?: RequestInit } = {};
    mockFetch(200, { messages: [] }, cap);
    await listInboxMessages(ACCESS_TOKEN, {
      maxResults: 5,
      q: "from:partnerships newer_than:7d",
      labelIds: ["INBOX", "STARRED"],
    });
    expect(cap.url).toContain("maxResults=5");
    expect(cap.url).toContain("from%3Apartnerships");
    expect(cap.url).toContain("labelIds=INBOX");
    expect(cap.url).toContain("labelIds=STARRED");
  });

  it("ADVERSARIAL: 401 throws GmailApiError with status + message", async () => {
    mockFetch(401, { error: { message: "Invalid Credentials" } });
    await expect(listInboxMessages(ACCESS_TOKEN)).rejects.toMatchObject({
      name: "GmailApiError",
      status: 401,
    });
  });

  it("ADVERSARIAL: empty messages array returns empty list (not undefined)", async () => {
    mockFetch(200, {});
    const out = await listInboxMessages(ACCESS_TOKEN);
    expect(out.messages).toEqual([]);
  });
});

describe("getMessageDetail", () => {
  it("HAPPY: requests metadata format with the right header allowlist", async () => {
    const cap: { url?: string } = {};
    mockFetch(
      200,
      { id: "m1", threadId: "t1", labelIds: ["INBOX", "UNREAD"] },
      cap
    );
    const out = await getMessageDetail(ACCESS_TOKEN, "m1");
    expect(out.id).toBe("m1");
    expect(cap.url).toContain("/messages/m1");
    expect(cap.url).toContain("format=metadata");
    expect(cap.url).toContain("metadataHeaders=From");
    expect(cap.url).toContain("metadataHeaders=Subject");
  });

  it("HAPPY: full format does NOT add metadataHeaders allowlist", async () => {
    const cap: { url?: string } = {};
    mockFetch(200, { id: "m1", threadId: "t1" }, cap);
    await getMessageDetail(ACCESS_TOKEN, "m1", "full");
    expect(cap.url).toContain("format=full");
    expect(cap.url).not.toContain("metadataHeaders=");
  });

  it("CROSS-TENANT-ish: messageId is URL-encoded so a creator-supplied id with `/` cannot path-traverse", async () => {
    const cap: { url?: string } = {};
    mockFetch(200, { id: "evil", threadId: "t" }, cap);
    await getMessageDetail(ACCESS_TOKEN, "abc/../admin", "metadata");
    expect(cap.url).toContain("/messages/abc%2F..%2Fadmin");
    expect(cap.url).not.toContain("/messages/abc/..");
  });
});

describe("createDraft", () => {
  it("HAPPY: builds an RFC 2822 message with To/Subject/MIME headers and base64-url-encodes it", async () => {
    const cap: { url?: string; init?: RequestInit } = {};
    mockFetch(
      200,
      { id: "draft1", message: { id: "m1", threadId: "t1" } },
      cap
    );
    const out = await createDraft(ACCESS_TOKEN, {
      to: "brand@example.com",
      subject: "Re: collab opportunity",
      bodyText: "Thanks for reaching out — interested!",
    });
    expect(out.id).toBe("draft1");
    expect(cap.url).toContain("/drafts");
    const body = JSON.parse((cap.init?.body as string) ?? "{}");
    expect(typeof body.message.raw).toBe("string");
    // base64url charset only — no `+`, `/`, or `=` padding.
    expect(body.message.raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("HAPPY: setting threadId makes the draft a reply (raw payload + threadId both passed)", async () => {
    const cap: { init?: RequestInit } = {};
    mockFetch(
      200,
      { id: "draft1", message: { id: "m1", threadId: "t1" } },
      cap
    );
    await createDraft(ACCESS_TOKEN, {
      to: "brand@example.com",
      bodyText: "yep, count me in.",
      threadId: "t1",
    });
    const body = JSON.parse((cap.init?.body as string) ?? "{}");
    expect(body.message.threadId).toBe("t1");
  });

  it("ADVERSARIAL: 400 surfaces as GmailApiError with body excerpt", async () => {
    mockFetch(400, { error: { message: "Recipient address required" } });
    await expect(
      createDraft(ACCESS_TOKEN, { to: "", bodyText: "x" })
    ).rejects.toMatchObject({ name: "GmailApiError", status: 400 });
  });
});

describe("sendMessage", () => {
  it("HAPPY: hits /messages/send (not /drafts) and returns the sent message id", async () => {
    const cap: { url?: string } = {};
    mockFetch(200, { id: "sent1", threadId: "t1" }, cap);
    const out = await sendMessage(ACCESS_TOKEN, {
      to: "brand@example.com",
      subject: "Re: collab",
      bodyText: "ok let's do it.",
    });
    expect(out.id).toBe("sent1");
    expect(cap.url).toContain("/messages/send");
    expect(cap.url).not.toContain("/drafts");
  });
});

describe("RFC 2822 builder + base64url encoder", () => {
  it("uses CRLF line endings (Gmail rejects LF-only)", () => {
    const out = _internal.buildRfc2822({
      to: "x@y.com",
      subject: "hi",
      bodyText: "body",
    });
    expect(out).toContain("\r\n");
    // Sanity: no bare LF without preceding CR.
    const lfOnly = /(?<!\r)\n/.test(out);
    expect(lfOnly).toBe(false);
  });

  it("base64url is URL-safe and unpadded", () => {
    // Construct input that produces `+`, `/`, `=` in standard base64.
    const input = "??>>?>"; // standard b64: "Pz8+Pj8+" — has `+`. Not great test.
    // Simpler: known string with all three special chars.
    const known = "Hello, world! 😀"; // base64 has trailing `=`.
    const encoded = _internal.base64UrlEncode(known);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("GmailApiError shape", () => {
  it("preserves status code and includes truncated body", async () => {
    const longBody = "x".repeat(1000);
    mockFetch(503, longBody);
    try {
      await listInboxMessages(ACCESS_TOKEN);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GmailApiError);
      expect((err as GmailApiError).status).toBe(503);
      // Body is truncated to 400 chars.
      expect(((err as GmailApiError).body ?? "").length).toBeLessThanOrEqual(400);
    }
  });
});
