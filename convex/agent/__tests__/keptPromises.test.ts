/**
 * A promise to stop is a tool call (2026-11-12). A season sim found her saying "no more plans" and "i'll stay
 * quiet" over and over with nothing she could change behind it. Each stop she can promise has a tool, the tool
 * only runs in a reply to them, and the critic treats it as an action that must have happened.
 */
import { describe, expect, it } from "vitest";
import { REPLY_ONLY_TOOLS, TOOLS, TOOL_CREDITS } from "../tools";
import { EXPERIMENT_FIT_PROMPT } from "../../review/weekly";

describe("every stop she can promise has a tool behind it", () => {
  const names = TOOLS.map((t) => t.function.name);
  it("week_plans and pause_texts exist, are free, and only run when they asked", () => {
    for (const n of ["week_plans", "pause_texts", "texting_pace", "routine_stop"]) {
      expect(names, n).toContain(n);
      expect(REPLY_ONLY_TOOLS.has(n), n).toBe(true);
      expect(TOOL_CREDITS[n], n).toBe(0);
    }
  });

  it("the tools tell her never to promise without calling them", () => {
    for (const n of ["week_plans", "pause_texts"]) expect(TOOLS.find((t) => t.function.name === n)!.function.description).toMatch(/[Nn]ever promise/);
  });

  it("the weekly experiment is screened by meaning against what they said", () => {
    expect(EXPERIMENT_FIT_PROMPT).toMatch(/by meaning/);
    expect(EXPERIMENT_FIT_PROMPT).toMatch(/aren't chasing views/);
  });
});
