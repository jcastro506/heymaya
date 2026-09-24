/**
 * Every outbound surface is judged, including the one the creator actually talks to.
 * The reply path was the only ungated one until a live conversation came back with a
 * markdown heading and a bulleted shot list (2026-09-02).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runChecks } from "../../eval/checks";
import { assertsUnprovenCause, claimsUnsupportedAction, reusesVoiceExample } from "../critic";

const converse = readFileSync(new URL("../converse.ts", import.meta.url), "utf8");
const critic = readFileSync(new URL("../critic.ts", import.meta.url), "utf8");
const soul = readFileSync(new URL("../soul.ts", import.meta.url), "utf8");

describe("the reply path is judged", () => {
  it("catches a lightly paraphrased voice example before delivery", () => {
    expect(reusesVoiceExample("yep, software. still watched that interval run three times though.")).toBe(true);
    expect(reusesVoiceExample("yep, i can move that to thursday.")).toBe(false);
  });

  it("catches causal certainty that views cannot prove", () => {
    expect(assertsUnprovenCause("that post worked because strangers knew the stakes")).toBe(true);
    expect(assertsUnprovenCause("brands will notice fast")).toBe(true);
    expect(assertsUnprovenCause("which is why it stayed around 1k views")).toBe(true);
    expect(assertsUnprovenCause("my read is the clear stakes make this easier to follow")).toBe(false);
  });

  it("requires a successful mutating tool before claiming an action", () => {
    expect(claimsUnsupportedAction("done, moved it to thursday", [{ tool: "week_plan", ok: true }, { tool: "block_move", ok: false }])).toBe(true);
    expect(claimsUnsupportedAction("done, moved it to thursday", [{ tool: "block_move", ok: true }])).toBe(false);
    expect(claimsUnsupportedAction("thursday at 5 work? i'll lock it in", [])).toBe(false);
  });

  it("converse critiques its reply before sending", () => {
    expect(converse).toMatch(/critique\(ctx, \{[^}]*kind: "reply"/);
  });

  it("a failed critique rewrites but never blocks the reply", () => {
    // The send must not sit behind the verdict: a person is waiting on it.
    const afterCritique = converse.slice(converse.indexOf('kind: "reply", text'));
    expect(afterCritique).toMatch(/converse_rewrite/);
    expect(afterCritique, "a reply must send even when the critic fails it").toMatch(/const replyKey = [^\n]*`reply:\$\{args\.messageId\}`[\s\S]*dedupeKey: replyKey/);
    expect(afterCritique).not.toMatch(/if \(!verdict\.pass\) return/);
  });

  it("the critic and the soul both name markdown, since Telegram renders it literally", () => {
    expect(critic).toMatch(/markdown/i);
    expect(soul).toMatch(/markdown/i);
  });

  it("the markdown check catches what actually leaked", () => {
    const leaked = "the sweet spot is 5 to 6 seconds.\n\n**visual:** a selfie clip mid-run.";
    const checks = runChecks({ kind: "reply", text: leaked, evidence: {}, actionTaken: null } as never);
    const md = checks.find((c) => c.name === "no_markdown");
    expect(md?.pass, "the real leaked reply must fail the markdown check").toBe(false);
    const clean = runChecks({ kind: "reply", text: "the sweet spot is 5 to 6 seconds, one continuous clip.", evidence: {}, actionTaken: null } as never);
    expect(clean.find((c) => c.name === "no_markdown")?.pass).toBe(true);
  });
});
