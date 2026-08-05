/**
 * The guard on what reaches the founder's chat.
 *
 * Two failure modes, and they pull in opposite directions:
 *
 *   **Leaking** — an exception, a vendor, an id reaches a founder who bought a
 *   social media manager and got a stack trace.
 *
 *   **Over-blocking** — a guard so eager it mangles her real voice, which is
 *   worse, because the whole product is that she sounds like a person.
 *
 * Most of these tests are the second kind.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import {
  checkPlainLanguage,
  PLAIN_FALLBACK,
  INTERNAL_NAMES,
} from "../plainLanguage";
import type { Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 5, 14, 0, 0);

describe("⭐ HER REAL MESSAGES PASS UNTOUCHED", () => {
  /**
   * Every one of these is a message she actually sent on staging, or one this
   * build constructs. If the guard touches any of them it is a bug in the
   * guard — a false positive costs her voice, which is the product.
   */
  const REAL = [
    "Yes — I can make one for TikTok. I need a single 30–60 second screen recording of you using Widgetly so the video shows the real product, not a made-up interface. One recording is enough; I can pull the best moments from it.",
    "That one's 46MB and Telegram won't let me download anything over 20MB. A shorter clip — 30 seconds or so — comes in under it, and honestly works better anyway.",
    "Got the recording — that's what I needed. I can pull frames and b-roll out of it, so the videos will show the real thing.",
    "Got all 4 — saved to your library.",
    "Posted it. https://x.com/widgetly/status/1889123456789 — 2 replies so far, both asking about pricing.",
    "Quiet morning in the niche, genuinely. Nothing moved enough to be worth posting about, so I'd rather sit today out than pad it.",
    "You said no Reddit — I've dropped it. TikTok, Instagram, YouTube and X from here.",
    // ⭐ METRICS. The first draft of the guard ate every one of these: a bare
    // [45]\d{2} looks exactly like a status code, and she sends numbers in
    // this range constantly. "512 views" became " views".
    "Your post got 512 views and 43 likes yesterday.",
    "That thread pulled 450 impressions overnight — best of the week.",
    "We're at 499 followers. One away.",
    "404 people saw it, 12 clicked through.",
  ];

  it.each(REAL)("leaves it alone: %s", (body) => {
    const verdict = checkPlainLanguage(body);
    expect(verdict.ok).toBe(true);
    expect(verdict.clean).toBe(body);
  });

  it("⭐ A URL WITH A LONG ID IN IT SURVIVES", () => {
    // The id pattern is 32 lowercase alphanumerics — a post URL can carry
    // something similar, and eating the link would destroy the single most
    // valuable thing she ever sends (§2.6: the unit of work is a placement).
    const body = "It's live: https://www.tiktok.com/@widgetly/video/7653138621985230102";
    expect(checkPlainLanguage(body).clean).toBe(body);
  });

  it("a founder's own technical words come back unharmed", () => {
    // She quotes them. If they said "API" the reply may well contain "API",
    // and mangling their vocabulary back at them reads as broken.
    const body = "You asked about the API docs post — I'd lead with the error people actually hit, not the feature list.";
    expect(checkPlainLanguage(body).ok).toBe(true);
  });
});

describe("⭐ THE LEAKS THAT ACTUALLY HAPPENED", () => {
  it("⭐ AN R2 EXCEPTION NEVER REACHES THEM", () => {
    // The real one. `ingestFromTelegram` returned `error.message` and
    // `telegramFiles` interpolated it into a Telegram body, so this exact
    // shape was one bucket misconfiguration away from a founder's phone.
    const v = checkPlainLanguage(
      "That file didn't come through — NoSuchBucketError: The specified bucket does not exist. Worth another try?"
    );
    expect(v.ok).toBe(false);
    expect(v.clean).not.toMatch(/NoSuchBucketError/);
    // And what's left is still a real message, not a stub.
    expect(v.clean).toMatch(/Worth another try/);
  });

  it("a status code is not a thing a person says", () => {
    const v = checkPlainLanguage("That file didn't come through — download failed (403). Worth another try?");
    expect(v.clean).not.toMatch(/403/);
    expect(v.redacted).toContain("status-code");
  });

  it("⭐ BUT ONLY WHEN A MACHINE WORD IS NEXT TO IT", () => {
    // The distinction the first draft got wrong, stated as a test: identical
    // numbers, opposite verdicts, decided entirely by context.
    expect(checkPlainLanguage("we got 500 views").ok).toBe(true);
    expect(checkPlainLanguage("it returned HTTP 500").ok).toBe(false);
    // ⭐ The hardest pair: same verb, same number, and only the noun after it
    // decides. "returned a 502" is a machine; "returned 500 views" is good news.
    expect(checkPlainLanguage("that post returned 500 views").ok).toBe(true);
    expect(checkPlainLanguage("the post returned a 502").ok).toBe(false);
  });

  it("an ECONNREFUSED is not an explanation", () => {
    const v = checkPlainLanguage("Couldn't reach it just now — ECONNREFUSED — I'll try again in a bit.");
    expect(v.clean).not.toMatch(/ECONNREFUSED/);
    expect(v.clean).toMatch(/try again/);
  });

  it("⭐ VENDOR NAMES NEVER APPEAR — they bought a manager, not a stack", () => {
    for (const vendor of ["Zernio", "Creatify", "OpenClaw", "Convex"]) {
      const v = checkPlainLanguage(`I queued it up but ${vendor} rejected the post, so nothing went out.`);
      expect(v.clean).not.toMatch(new RegExp(vendor, "i"));
      expect(v.ok).toBe(false);
    }
  });

  it("an undefined means a variable was empty, and says nothing to a human", () => {
    const v = checkPlainLanguage("Your post got undefined views yesterday, which is up on the day before.");
    expect(v.clean).not.toMatch(/undefined/);
  });

  it("⭐ THE CHANNELS THEY OWN ARE NOT VENDORS", () => {
    // TikTok, Instagram, YouTube, X and Telegram are THEIR channels — she must
    // be able to name them. A guard that ate these would be unusable.
    const body = "Posting to TikTok and Instagram today; X gets the reply thread. I'll ping you here on Telegram when it's up.";
    expect(checkPlainLanguage(body).ok).toBe(true);
  });
});

/**
 * ⭐ Pulled verbatim from the `messages` table on staging.
 *
 * Auditing 39 real messages she had already sent found **8 leaking** — a fifth
 * of everything the founder had received. These are those messages.
 */
describe("⭐ THE LIVE AUDIT — messages a founder actually got", () => {
  it("⭐ 'No response from OpenClaw.' — sent FOUR times", () => {
    // The clearest case in the sample: a vendor name and an internal failure
    // mode, with nothing in it a founder could act on.
    const v = checkPlainLanguage("No response from OpenClaw.");
    expect(v.clean).toBe(PLAIN_FALLBACK);
    expect(v.redacted).toContain("openclaw");
  });

  it("⭐ A RAW TOOL ENVELOPE, PASTED INTO THE CHAT", () => {
    // `{ok, data, next, why}` is our tool-response contract (§2.8) and rides
    // in every tool result on every turn — so it's always in her context, and
    // quoting it is one short step from summarising it.
    const v = checkPlainLanguage(
      'The update tool said:\n\n```json\n{"ok":false,"data":{"sent":false,"duplicate":true},"why":"you already sent them a brief today"}\n```\n\nI didn\u2019t send a duplicate.'
    );
    expect(v.clean).not.toMatch(/\{|"ok"|json/);
    expect(v.clean).not.toMatch(/tool said/i);
    // The human sentence at the end is the part worth keeping.
    expect(v.clean).toMatch(/didn\u2019t send a duplicate/);
  });

  it("⭐ A DRAFT ID, AND THE LABEL WITH IT", () => {
    // Redacting only the id leaves "Saved an X post, draft ID ``." — not an
    // improvement on the leak.
    const v = checkPlainLanguage(
      "**Draft:** Saved an X post, draft ID `md7tf0fkk39e3k0s0xxbk4k5hd8bw1v3`."
    );
    expect(v.clean).not.toMatch(/md7tf0/);
    expect(v.clean).not.toMatch(/draft ID/i);
    expect(v.clean).not.toMatch(/``/);
  });

  it("⭐ HER MARKDOWN BULLETS SURVIVE REDACTION", () => {
    // The daily brief is a bullet list. An early version stripped the leading
    // "- " as punctuation wreckage, silently reformatting her report.
    const v = checkPlainLanguage(
      "- **Scroll:** Found the strongest banked idea.\n- **Draft:** saved as `md7tf0fkk39e3k0s0xxbk4k5hd8bw1v3`."
    );
    expect(v.clean.startsWith("- **Scroll:**")).toBe(true);
  });
});

describe("⭐ REDACT, NEVER DROP", () => {
  it("a message reduced to rubble becomes a plain sentence, not silence", () => {
    // §2.5. The messages most likely to trip this guard are ERROR REPORTS —
    // exactly the ones the founder most needs to receive. Swallowing one is
    // the silent failure the principle forbids.
    const v = checkPlainLanguage("TypeError: undefined (500)");
    expect(v.clean).toBe(PLAIN_FALLBACK);
    expect(v.clean.length).toBeGreaterThan(20);
  });

  it("the fallback admits a problem rather than faking success", () => {
    // A founder who gets a cheerful message assumes it worked.
    expect(PLAIN_FALLBACK).toMatch(/went wrong|on it/i);
  });

  it("names what it redacted, so the source can be found", () => {
    const v = checkPlainLanguage("Zernio returned a 502 for id abcdefghij0123456789abcdefghij01");
    expect(v.redacted).toEqual(expect.arrayContaining(["zernio", "status-code", "id"]));
  });

  it("cleans up the wreckage — no orphaned dashes or doubled spaces", () => {
    const v = checkPlainLanguage("Saved it — TypeError: bad thing — and I'll post it tonight.");
    expect(v.clean).not.toMatch(/\s{2,}/);
    expect(v.clean).not.toMatch(/—\s*[.!?]/);
  });
});

describe("⭐ THE GUARD IS ON THE PATH, NOT BESIDE IT", () => {
  it("a leaked exception is redacted in the ROW, not just in a log", async () => {
    // A guard that logs and sends anyway is decoration. The row is what gets
    // delivered, and it's also what she reads back as her own history — so a
    // leak stored here teaches her that's how she talks.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "That file didn't come through — NoSuchBucketError: no such bucket. Worth another try?",
      dedupeKey: "leak-1",
    });
    const [row] = await t.run(async (ctx) => await ctx.db.query("messages").collect());
    expect(row.body).not.toMatch(/NoSuchBucketError/);
    expect(row.body).toMatch(/Worth another try/);
  });

  it("every internal name is a proper noun, never a common word", () => {
    // The bar for this list: a word a founder might plausibly type themselves
    // must NOT be here. "post", "account", "video", "link", "API" all stay out
    // — a false positive costs her voice, which is worse than the leak.
    for (const term of INTERNAL_NAMES) {
      expect(term.length).toBeGreaterThan(4);
      expect(["post", "account", "video", "link", "api", "job", "queue"]).not.toContain(
        term.toLowerCase()
      );
    }
  });
});

async function seed(t: ReturnType<typeof convexTest>): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: "u_plain",
      email: "plain@example.com",
      channelPreference: "telegram",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}
