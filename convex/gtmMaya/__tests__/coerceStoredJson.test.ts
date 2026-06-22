/**
 * coerceStoredJson — the model-agnostic JSON-string tolerance that unblocked
 * DeepSeek (2026-06-22). A tool-supplied "JSON string" arg must NEVER hard-fail
 * a save on formatting: valid JSON passes through, anything else is wrapped so
 * the column always holds valid JSON. The old JSON.parse-or-throw stalled the
 * worker → 0 threads, no synthesis.
 */
import { describe, expect, it } from "vitest";
import { coerceStoredJson } from "../managerStore";

describe("coerceStoredJson", () => {
  it("passes a valid JSON object string through unchanged", () => {
    const v = '{"pains":["x"],"voices":["@a"]}';
    expect(coerceStoredJson(v, "icpKnowledge")).toBe(v);
  });

  it("passes a valid JSON array string through unchanged", () => {
    const v = '["a","b"]';
    expect(coerceStoredJson(v, "styleExemplarsJson")).toBe(v);
  });

  it("undefined stays undefined (absent field)", () => {
    expect(coerceStoredJson(undefined, "icpKnowledge")).toBeUndefined();
  });

  it("wraps a non-JSON prose string into valid JSON (the DeepSeek case)", () => {
    const prose = "busy professionals who quit MyFitnessPal";
    const out = coerceStoredJson(prose, "icpKnowledge");
    expect(out).toBe(JSON.stringify(prose));
    // The whole point: every downstream consumer's JSON.parse now succeeds.
    expect(() => JSON.parse(out as string)).not.toThrow();
    expect(JSON.parse(out as string)).toBe(prose);
  });

  it("wraps half-formed JSON rather than throwing", () => {
    const broken = "{pains: [unquoted, trailing,]}";
    const out = coerceStoredJson(broken, "icpKnowledge");
    expect(() => JSON.parse(out as string)).not.toThrow();
  });

  it("never throws on any string input", () => {
    for (const s of ["", "   ", "null-ish", "<xml/>", "42abc", "{"]) {
      expect(() => coerceStoredJson(s, "f")).not.toThrow();
      expect(() => JSON.parse(coerceStoredJson(s, "f") as string)).not.toThrow();
    }
  });
});
