/**
 * S3 — publish-engine pure-decision tests: ban-safety publish mode + the
 * composed auto-post action (fail-closed AND-gate).
 */

import { describe, expect, it } from "vitest";
import {
  decidePublishMode,
  composeAutoPostAction,
} from "../calendarWrite";

describe("decidePublishMode — ban-safety", () => {
  it("reddit + tiktok are ALWAYS manual-confirm", () => {
    expect(decidePublishMode("reddit")).toBe("manual_confirm");
    expect(decidePublishMode("tiktok")).toBe("manual_confirm");
  });
  it("the auto-eligible channels are auto", () => {
    for (const c of ["x", "linkedin", "instagram", "youtube"]) {
      expect(decidePublishMode(c)).toBe("auto");
    }
  });
});

describe("composeAutoPostAction — fail-closed AND-gate", () => {
  const allPass = {
    mode: "auto" as const,
    planAllowsAutoPost: true,
    autoPublishAllowed: true,
    dedupAllowed: true,
    healthCanPost: true,
  };

  it("auto-publishes only when every gate passes", () => {
    const r = composeAutoPostAction(allPass);
    expect(r.action).toBe("auto");
    expect(r.reasons).toHaveLength(0);
  });

  it("ban-safety channel forces needs_confirm even if all else passes", () => {
    const r = composeAutoPostAction({ ...allPass, mode: "manual_confirm" });
    expect(r.action).toBe("needs_confirm");
    expect(r.reasons.join(" ")).toContain("ban-safety");
  });

  it("plan disallowing auto-post forces needs_confirm", () => {
    const r = composeAutoPostAction({ ...allPass, planAllowsAutoPost: false });
    expect(r.action).toBe("needs_confirm");
  });

  it("S2.7 gate failing forces needs_confirm", () => {
    const r = composeAutoPostAction({ ...allPass, autoPublishAllowed: false });
    expect(r.action).toBe("needs_confirm");
    expect(r.reasons.join(" ")).toContain("voice/slop/safety");
  });

  it("dedup block forces needs_confirm", () => {
    const r = composeAutoPostAction({ ...allPass, dedupAllowed: false });
    expect(r.action).toBe("needs_confirm");
    expect(r.reasons.join(" ")).toContain("already engaged");
  });

  it("unhealthy account forces needs_confirm", () => {
    const r = composeAutoPostAction({ ...allPass, healthCanPost: false });
    expect(r.action).toBe("needs_confirm");
  });

  it("reports all failing gates at once", () => {
    const r = composeAutoPostAction({
      mode: "manual_confirm",
      planAllowsAutoPost: false,
      autoPublishAllowed: false,
      dedupAllowed: false,
      healthCanPost: false,
    });
    expect(r.action).toBe("needs_confirm");
    expect(r.reasons.length).toBe(5);
  });
});
