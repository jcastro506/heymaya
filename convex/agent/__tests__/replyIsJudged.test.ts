/**
 * Every outbound surface is judged, including the one the creator actually talks to.
 * The reply path was the only ungated one until a live conversation came back with a
 * markdown heading and a bulleted shot list (2026-09-02).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runChecks } from "../../eval/checks";

const converse = readFileSync(new URL("../converse.ts", import.meta.url), "utf8");
const critic = readFileSync(new URL("../critic.ts", import.meta.url), "utf8");
const soul = readFileSync(new URL("../soul.ts", import.meta.url), "utf8");

describe("the reply path is judged", () => {
  it("converse critiques its reply before sending", () => {
    expect(converse).toMatch(/critique\(ctx, \{[^}]*kind: "reply"/);
  });

  it("a failed critique rewrites but never blocks the reply", () => {
    // The send must not sit behind the verdict: a person is waiting on it.
    const afterCritique = converse.slice(converse.indexOf('kind: "reply", text'));
    expect(afterCritique).toMatch(/converse_rewrite/);
    expect(afterCritique, "a reply must send even when the critic fails it").toMatch(/dedupeKey: `reply:\$\{args\.messageId\}`/);
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
