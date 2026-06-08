/**
 * S3 — publish-engine pure-decision tests: ban-safety publish mode + the
 * composed auto-post action (fail-closed AND-gate).
 */

import { describe, expect, it } from "vitest";
import {
  decidePublishMode,
  composeAutoPostAction,
  routeAutoPostStatus,
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

describe("routeAutoPostStatus — populate-time ban-safety FORCE", () => {
  it("an auto channel with a connected account => queued + autoPostJson", () => {
    const r = routeAutoPostStatus({ channel: "x", zernioAccountId: "acct_1" });
    expect(r.status).toBe("queued");
    const ap = JSON.parse(r.autoPostJson!);
    expect(ap.channel).toBe("x");
    expect(ap.zernioAccountId).toBe("acct_1");
    expect(ap.mode).toBe("auto");
  });

  it("reddit is FORCED to needs_confirm even with a connected account", () => {
    const r = routeAutoPostStatus({ channel: "reddit", zernioAccountId: "acct_r" });
    expect(r.status).toBe("needs_confirm");
    expect(JSON.parse(r.autoPostJson!).mode).toBe("manual_confirm");
  });

  it("tiktok is FORCED to needs_confirm", () => {
    const r = routeAutoPostStatus({ channel: "tiktok", zernioAccountId: "acct_t" });
    expect(r.status).toBe("needs_confirm");
  });

  it("no channel => draft (deep-link fallback), no autoPostJson", () => {
    const r = routeAutoPostStatus({});
    expect(r.status).toBe("draft");
    expect(r.autoPostJson).toBeUndefined();
  });

  it("a channel WITHOUT a connected account => draft (can't auto-post)", () => {
    const r = routeAutoPostStatus({ channel: "x" });
    expect(r.status).toBe("draft");
  });

  it("an unknown/unoffered channel => draft", () => {
    const r = routeAutoPostStatus({ channel: "threads", zernioAccountId: "acct_x" });
    expect(r.status).toBe("draft");
  });

  it("carries reply dedup keys into autoPostJson", () => {
    const r = routeAutoPostStatus({
      channel: "x",
      zernioAccountId: "acct_1",
      targetExternalId: "t1",
      targetCommentId: "c1",
    });
    const ap = JSON.parse(r.autoPostJson!);
    expect(ap.targetExternalId).toBe("t1");
    expect(ap.targetCommentId).toBe("c1");
  });
});
