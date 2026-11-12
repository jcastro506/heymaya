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

describe("hashtags the way their best posts use them (2026-11-12)", async () => {
  const { capHashtags, hashtagHabit } = await import("../finish");
  it("their best posts' median, capped at two", () => {
    const posts = [
      { caption: "best one #a #b #c", multiple: 6 }, { caption: "second #a", multiple: 4 }, { caption: "third #a #b", multiple: 3 },
      { caption: "flop #x #y #z #w", multiple: 0.3 },
    ];
    expect(hashtagHabit(posts)).toBe(2);
    expect(hashtagHabit([{ caption: "no tags", multiple: 5 }, { caption: "none", multiple: 4 }, { caption: "nope", multiple: 3 }])).toBe(0);
    expect(hashtagHabit([])).toBe(1);
  });
  it("keeps the first n, removes the rest cleanly", () => {
    expect(capHashtags("ice dip before the wash 🥶 #GlowUp #skincare #acne #fyp", 1)).toBe("ice dip before the wash 🥶 #GlowUp");
    expect(capHashtags("the $4 one won #thrift", 0)).toBe("the $4 one won");
  });
});

describe("every tool schema is one a provider accepts (2026-11-12: a duplicate 'required' broke every partner turn)", () => {
  it("no duplicate or missing required fields, at any depth", () => {
    const bad: string[] = [];
    const walk = (name: string, p: unknown, path: string) => {
      if (!p || typeof p !== "object") return;
      const o = p as { required?: string[]; properties?: Record<string, unknown>; items?: unknown };
      if (Array.isArray(o.required) && new Set(o.required).size !== o.required.length) bad.push(`${name}${path}: duplicate required`);
      for (const r of o.required ?? []) if (o.properties && !(r in o.properties)) bad.push(`${name}${path}: required ${r} not a property`);
      for (const [k, v] of Object.entries(o.properties ?? {})) walk(name, v, `${path}.${k}`);
      if (o.items) walk(name, o.items, `${path}[]`);
    };
    for (const t of TOOLS) walk(t.function.name, t.function.parameters, "");
    expect(bad).toEqual([]);
  });
});
