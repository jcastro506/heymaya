import { describe, expect, it } from "vitest";
import { sanitizeForConvex } from "../platformWorkers";

/**
 * Sprint 2.11.1 — sanitize scraped text for Convex's strict JSON parser.
 * Triggered by live 2026-05-24 deploy failure on ModelHub research run
 * (column 12661 of one card's serialized form contained an unpaired
 * UTF-16 surrogate from a Reddit comment).
 *
 * Covers 5 mandatory test categories:
 * 1. Cross-tenant — N/A (pure function)
 * 2. Auth — N/A
 * 3. Adversarial inputs — lone high/low surrogates, mid-string,
 *    at edges, multi-surrogate sequences, control bytes
 * 4. Sibling-file scan — N/A (single export)
 * 5. TODO grep — zero offenders
 */

describe("sanitizeForConvex", () => {
  it("passes through plain ASCII unchanged", () => {
    expect(sanitizeForConvex("hello world")).toBe("hello world");
  });

  it("passes through valid multi-byte Unicode (emoji, CJK, accented)", () => {
    expect(sanitizeForConvex("café 中文 🚀")).toBe("café 中文 🚀");
  });

  it("preserves valid surrogate pairs (4-byte emoji)", () => {
    // 🚀 = U+1F680 = high D83D + low DE80
    const rocket = "🚀";
    expect(sanitizeForConvex(rocket)).toBe(rocket);
    expect(sanitizeForConvex(`fire ${rocket} go`)).toBe(`fire ${rocket} go`);
  });

  it("replaces lone high surrogate with U+FFFD", () => {
    // D800 alone (no low surrogate following)
    expect(sanitizeForConvex("oops \uD800 done")).toBe("oops � done");
  });

  it("replaces lone low surrogate with U+FFFD", () => {
    // DC00 alone (no high surrogate preceding)
    expect(sanitizeForConvex("oops \uDC00 done")).toBe("oops � done");
  });

  it("handles lone high surrogate at end of string", () => {
    expect(sanitizeForConvex("end\uD83D")).toBe("end�");
  });

  it("handles lone low surrogate at start of string", () => {
    expect(sanitizeForConvex("\uDE80start")).toBe("�start");
  });

  it("handles two consecutive lone high surrogates", () => {
    expect(sanitizeForConvex("\uD800\uD801")).toBe("��");
  });

  it("strips C0 control bytes (except tab, LF, CR)", () => {
    expect(sanitizeForConvex("a\x01b\x02c")).toBe("abc");
    expect(sanitizeForConvex("a\x00b")).toBe("ab");
  });

  it("preserves tab, LF, CR", () => {
    expect(sanitizeForConvex("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });

  it("output JSON-serializes cleanly (no parse errors round-trip)", () => {
    // The crash scenario: lone surrogate makes JSON.stringify produce
    // `\uD800` which Convex's strict parser rejects. Sanitized text
    // must always round-trip through JSON.
    const sanitized = sanitizeForConvex("a\uD800b\uDC00c");
    const round = JSON.parse(JSON.stringify({ s: sanitized })) as { s: string };
    expect(round.s).toBe(sanitized);
  });

  it("returns empty string on empty input", () => {
    expect(sanitizeForConvex("")).toBe("");
  });

  it("handles a 10k-char string with embedded lone surrogates", () => {
    const big = "abc".repeat(3000) + "\uD800" + "xyz".repeat(2000);
    const result = sanitizeForConvex(big);
    expect(result).not.toContain("\uD800");
    expect(result).toContain("�");
    expect(result.length).toBe(big.length); // 1-to-1 replacement
  });
});
