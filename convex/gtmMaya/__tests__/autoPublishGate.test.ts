/**
 * S2.7 — autonomous-publish gate + voice-confidence + safety-critic
 * fail-closed tests.
 *
 * The gate is the prerequisite S3 consults before auto-posting under the
 * founder's name. It must be fail-CLOSED: a draft auto-publishes ONLY when
 * voice is calibrated AND the slop firewall passed AND the safety critic
 * passed. Any miss => no auto-publish (route to needs_confirm).
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import {
  readVoiceConfidence,
  evaluateAutoPublishGate,
  type ValidateOutboundResult,
} from "../outboundFirewall";

const clean: ValidateOutboundResult = { ok: true, failures: [] };
const slopFail: ValidateOutboundResult = {
  ok: false,
  failures: [{ category: "structural_ai_tell", matched: "tricolon", excerpt: "x" }],
};
const safetyFail: ValidateOutboundResult = {
  ok: false,
  failures: [
    { category: "safety_violation", matched: "hallucinated_claim: made-up metric", excerpt: "10x" },
  ],
};
const safetyUnverifiable: ValidateOutboundResult = {
  ok: false,
  failures: [{ category: "safety_unverifiable", matched: "critic failed", excerpt: "" }],
};

function voiceJson(confidence: string): string {
  return JSON.stringify({ confidence, anchors: ["casual"] });
}

describe("readVoiceConfidence", () => {
  it("parses each level", () => {
    expect(readVoiceConfidence(voiceJson("high"))).toBe("high");
    expect(readVoiceConfidence(voiceJson("medium"))).toBe("medium");
    expect(readVoiceConfidence(voiceJson("low"))).toBe("low");
    expect(readVoiceConfidence(voiceJson("none"))).toBe("none");
  });
  it("defaults to none (most-restrictive) on missing/corrupt/unknown", () => {
    expect(readVoiceConfidence(null)).toBe("none");
    expect(readVoiceConfidence(undefined)).toBe("none");
    expect(readVoiceConfidence("not json{")).toBe("none");
    expect(readVoiceConfidence(JSON.stringify({ confidence: "bogus" }))).toBe("none");
    expect(readVoiceConfidence(JSON.stringify({}))).toBe("none");
  });
});

describe("evaluateAutoPublishGate", () => {
  it("allows auto-publish only when ALL three pass (confident voice + slop ok + safety ok)", () => {
    const r = evaluateAutoPublishGate({
      voiceProfileJson: voiceJson("high"),
      slopResult: clean,
      safetyResult: clean,
    });
    expect(r.allowAutoPublish).toBe(true);
    expect(r.blockReasons).toHaveLength(0);
    expect(r.voiceConfidence).toBe("high");
  });

  it("medium voice confidence is enough", () => {
    const r = evaluateAutoPublishGate({
      voiceProfileJson: voiceJson("medium"),
      slopResult: clean,
      safetyResult: clean,
    });
    expect(r.allowAutoPublish).toBe(true);
  });

  it("blocks when voice is none (never auto-post in an uncalibrated voice)", () => {
    const r = evaluateAutoPublishGate({
      voiceProfileJson: voiceJson("none"),
      slopResult: clean,
      safetyResult: clean,
    });
    expect(r.allowAutoPublish).toBe(false);
    expect(r.blockReasons.map((b) => b.layer)).toContain("voice_confidence");
  });

  it("blocks when voice is low", () => {
    const r = evaluateAutoPublishGate({
      voiceProfileJson: voiceJson("low"),
      slopResult: clean,
      safetyResult: clean,
    });
    expect(r.allowAutoPublish).toBe(false);
    expect(r.blockReasons.map((b) => b.layer)).toContain("voice_confidence");
  });

  it("blocks when the slop firewall failed even with confident voice + safe content", () => {
    const r = evaluateAutoPublishGate({
      voiceProfileJson: voiceJson("high"),
      slopResult: slopFail,
      safetyResult: clean,
    });
    expect(r.allowAutoPublish).toBe(false);
    expect(r.blockReasons.map((b) => b.layer)).toContain("slop");
  });

  it("blocks when the safety critic flagged a violation", () => {
    const r = evaluateAutoPublishGate({
      voiceProfileJson: voiceJson("high"),
      slopResult: clean,
      safetyResult: safetyFail,
    });
    expect(r.allowAutoPublish).toBe(false);
    expect(r.blockReasons.map((b) => b.layer)).toContain("safety");
  });

  it("blocks fail-CLOSED when safety could not be verified", () => {
    const r = evaluateAutoPublishGate({
      voiceProfileJson: voiceJson("high"),
      slopResult: clean,
      safetyResult: safetyUnverifiable,
    });
    expect(r.allowAutoPublish).toBe(false);
    expect(r.blockReasons.map((b) => b.layer)).toContain("safety");
  });

  it("reports every failing layer at once", () => {
    const r = evaluateAutoPublishGate({
      voiceProfileJson: voiceJson("none"),
      slopResult: slopFail,
      safetyResult: safetyFail,
    });
    expect(r.allowAutoPublish).toBe(false);
    const layers = r.blockReasons.map((b) => b.layer).sort();
    expect(layers).toEqual(["safety", "slop", "voice_confidence"]);
  });

  it("missing voiceProfileJson defaults to none and blocks", () => {
    const r = evaluateAutoPublishGate({
      voiceProfileJson: null,
      slopResult: clean,
      safetyResult: clean,
    });
    expect(r.allowAutoPublish).toBe(false);
    expect(r.voiceConfidence).toBe("none");
  });
});

describe("critiqueOutboundSafety — fail-closed", () => {
  it("an empty draft is blocked (nothing safe to publish)", async () => {
    const t = convexTest(schema, modules);
    const res = await t.action(
      internal.gtmMaya.outboundFirewall.critiqueOutboundSafety,
      { text: "   " }
    );
    expect(res.ok).toBe(false);
    expect(res.failures[0].category).toBe("safety_unverifiable");
  });
});
