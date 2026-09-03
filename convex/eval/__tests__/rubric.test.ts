/**
 * The ruler cannot change silently.
 *
 * A baseline is only comparable to a run measured the same way. When `has_link` was
 * tightened, the gate reported a 25-point "regression" that was purely the ruler moving —
 * the exact false alarm that teaches people to ignore a gate. This test fails when the
 * checks or the judge change without `RUBRIC_VERSION` being bumped.
 *
 * If this fails: read the diff. If a check's MEANING changed, bump RUBRIC_VERSION, update
 * the hash below, and re-record a baseline. If you only touched a comment, update the hash.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RUBRIC_VERSION } from "../checks";

/** Hash the code that decides pass or fail, ignoring the version constant itself. */
function rubricHash(): string {
  const checks = readFileSync(new URL("../checks.ts", import.meta.url), "utf8").replace(/export const RUBRIC_VERSION = "[^"]*";/, "");
  const judge = readFileSync(new URL("../judge.ts", import.meta.url), "utf8");
  // Only the judge's prompt is part of the ruler; its plumbing is not.
  const prompt = judge.slice(judge.indexOf("JUDGE_PROMPT"), judge.indexOf("export async function judge"));
  return createHash("sha256").update(checks).update(prompt).digest("hex").slice(0, 16);
}

const RECORDED = "76ddf418f259022d";

describe("the rubric", () => {
  it("has not changed without its version being bumped", () => {
    expect(rubricHash(), `the checks or the judge prompt changed. Bump RUBRIC_VERSION (now "${RUBRIC_VERSION}"), update RECORDED in this file, and re-record the eval baseline.`).toBe(RECORDED);
  });

  it("the gate refuses to compare readings taken with different rulers", () => {
    const gate = readFileSync(new URL("../gate.ts", import.meta.url), "utf8");
    expect(gate).toMatch(/RUBRIC_VERSION/);
    expect(gate).toMatch(/re-record a baseline before comparing/);
  });
});
