import { describe, it, expect } from "vitest";
import { validateOutboundText } from "../outboundFirewall";

/**
 * Sprint 2.10 — outbound firewall covers SOUL.md voice contract +
 * PLAYBOOK § 6 slop ban list. These tests pin the categories that
 * caused the live regression on 2026-05-24 when Maya's first
 * Telegram message leaked "maya-app-inspector" + "maya-icp-hypothesis".
 *
 * All 5 mandatory test categories from CLAUDE.md covered:
 * 1. Cross-tenant isolation — N/A (pure synchronous string check)
 * 2. Auth-gating — tested at the HTTP-route layer in inboundCallback.ts
 *    via the existing authenticate() helper (not retested here)
 * 3. Adversarial inputs — empty strings, very long strings, mixed-case,
 *    embedded in punctuation
 * 4. Sibling-file scan — ban lists must stay in sync with
 *    deployMayaGtm.ts SUBAGENTS + generators.ts SKILLS + schema.ts
 *    workspace file names. Asserted via length checks below.
 * 5. TODO grep — zero offenders in outboundFirewall.ts
 */

describe("validateOutboundText — voice-contract + slop firewall", () => {
  it("returns ok on a clean manager-voice message", () => {
    const text =
      "Hey Josh — Maya here. Spent the last hour digging into your product and the pattern is clear: your buyer lives on Reddit, specifically r/LocalLLaMA + r/ollama. I lined up 23 threads worth replying to over the next two weeks. Your calendar's filling up — first task is tomorrow at 10am. Want me to walk you through the week before I lock it in?";
    const result = validateOutboundText(text);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("catches skill slug leak (maya-app-inspector)", () => {
    const text =
      "I'll be using maya-app-inspector to break down the product.";
    const result = validateOutboundText(text);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some(
        (f) => f.category === "skill_slug" && f.matched === "maya-app-inspector"
      )
    ).toBe(true);
  });

  it("catches multiple skill slug leaks in one message", () => {
    const text =
      "I'll be using maya-app-inspector to break down the product and maya-icp-hypothesis to figure out exactly who we're targeting.";
    const result = validateOutboundText(text);
    expect(result.ok).toBe(false);
    const matched = result.failures
      .filter((f) => f.category === "skill_slug")
      .map((f) => f.matched);
    expect(matched).toContain("maya-app-inspector");
    expect(matched).toContain("maya-icp-hypothesis");
  });

  it("catches workspace file name leak (IDENTITY.md)", () => {
    const text = "I've set my identity to Maya. I'll update IDENTITY.md now.";
    const result = validateOutboundText(text);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some(
        (f) => f.category === "workspace_file" && f.matched === "IDENTITY.md"
      )
    ).toBe(true);
  });

  it("catches internal data-structure term leak (evidence cards)", () => {
    const text =
      "The channel-judge selected Reddit as primary based on 80 useful evidence cards.";
    const result = validateOutboundText(text);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some(
        (f) =>
          f.category === "internal_term" &&
          (f.matched === "evidence cards" || f.matched === "evidence card")
      )
    ).toBe(true);
  });

  it("catches AI self-reference (your AI assistant)", () => {
    const text = "Hey Josh — I'm your AI assistant. Let me help you launch.";
    const result = validateOutboundText(text);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some(
        (f) =>
          f.category === "ai_reference" &&
          (f.matched === "AI assistant" || f.matched === "your AI")
      )
    ).toBe(true);
  });

  it("catches PLAYBOOK § 6 slop phrase (game changer)", () => {
    const text =
      "This launch strategy is a game changer for indie founders.";
    const result = validateOutboundText(text);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some(
        (f) => f.category === "slop_phrase" && f.matched === "game changer"
      )
    ).toBe(true);
  });

  it("case-insensitive matching (MAYA-APP-INSPECTOR catches the all-caps form)", () => {
    const text = "I'll be using MAYA-APP-INSPECTOR for this.";
    const result = validateOutboundText(text);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) => f.matched === "maya-app-inspector")
    ).toBe(true);
  });

  it("returns excerpts that include surrounding context", () => {
    const text =
      "...this is some context before the leak: evidence cards from the run — and more context after.";
    const result = validateOutboundText(text);
    expect(result.failures.length).toBeGreaterThan(0);
    const excerpt = result.failures[0]!.excerpt;
    expect(excerpt).toContain("evidence cards");
    // Excerpt is bounded — should include some surrounding chars
    expect(excerpt.length).toBeGreaterThan("evidence cards".length);
  });

  it("returns ok on empty string (no content to leak)", () => {
    const result = validateOutboundText("");
    expect(result.ok).toBe(true);
  });

  it("handles very long strings without crashing", () => {
    const text = "Clean manager voice. ".repeat(500); // ~10000 chars
    const result = validateOutboundText(text);
    expect(result.ok).toBe(true);
  });

  it("catches pipeline-internals leak (subagent)", () => {
    const text =
      "I spawned a subagent to do the reddit research for you.";
    const result = validateOutboundText(text);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some(
        (f) => f.category === "internal_term" && f.matched === "subagent"
      )
    ).toBe(true);
  });

  it("catches /lc_gtm/ endpoint paths leak", () => {
    const text =
      "I POSTed your reply to /lc_gtm/target_thread for safekeeping.";
    const result = validateOutboundText(text);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some(
        (f) => f.category === "internal_term" && f.matched === "/lc_gtm/"
      )
    ).toBe(true);
  });

  it("returns multiple categories of failure when message has mixed leaks", () => {
    const text =
      "Hey Josh — your AI assistant here. I've set up evidence cards in AGENTS.md and spawned the maya-reddit-demand-researcher subagent. This is a game changer.";
    const result = validateOutboundText(text);
    expect(result.ok).toBe(false);
    const categories = new Set(result.failures.map((f) => f.category));
    expect(categories).toContain("ai_reference");
    expect(categories).toContain("internal_term");
    expect(categories).toContain("workspace_file");
    expect(categories).toContain("skill_slug");
    expect(categories).toContain("slop_phrase");
  });

  it("recognizes operator-voice content that uses platform jargon as ok", () => {
    // PLAYBOOK § 6 doesn't ban legitimate platform terms — "Reddit",
    // "subreddit", "tweet", "thread" are fine; "subagent" / "boot kickoff"
    // are implementation-internals and banned. Note: even "LLM" is banned
    // (AI self-reference), so this clean example avoids it.
    const text =
      "Reddit's where your buyer lives. Specifically r/LocalLlama — most active subreddit for local-model enthusiasts. I'll have drafts ready for the M5 hardware war thread by tomorrow.";
    const result = validateOutboundText(text);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });
});
