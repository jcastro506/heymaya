/** The simulated creators (eval/personas): eight temperaments, a parser that can't act on junk, and the numbers a run is read by. */
import { describe, expect, it } from "vitest";
import { PERSONAS, actorModel, parseActor, personaFor, personaPrompt, tenure } from "../personas";
import { dayPlan } from "../firstWeek";
import { REGISTRY } from "../../agent/registry";

describe("personas", () => {
  it("eight distinct people, covered in order; none plays on Maya's own models", () => {
    expect(new Set(PERSONAS.map((p) => p.id)).size).toBe(8);
    expect(Array.from({ length: 8 }, (_, i) => personaFor(i).id)).toEqual(PERSONAS.map((p) => p.id));
    expect(personaFor(9).id).toBe(PERSONAS[1].id);
    expect([REGISTRY.writer.primary, REGISTRY.critic.primary]).not.toContain(actorModel({}));
    for (const p of PERSONAS) expect(personaPrompt("TikTok", p)).toMatch(/"action": "none\|less\|pause\|stop"/);
  });
  it("the parser keeps only what the sim can act on", () => {
    expect(parseActor('{"mood": 2, "why": "too many texts", "replies": [{"text": "pls less"}, {"text": ""}, {"text": "b"}, {"text": "c"}], "ideas": [{"ideaId": "x", "act": "save"}, {"ideaId": "y", "act": "burn"}], "action": "less"}')).toEqual({ mood: 2, why: "too many texts", replies: ["pls less", "b"], ideas: [{ ideaId: "x", act: "save" }], action: "less" });
    expect(parseActor("not json")).toEqual({ mood: null, why: "", replies: [], ideas: [], action: "none" });
    expect(parseActor('{"mood": 9, "action": "delete everything"}')).toMatchObject({ mood: null, action: "none" });
  });
  it("a tenure in numbers: who left and when, who is still writing in the last third", () => {
    const day = (d: number, said: string[], mood: number, action = "none") => ({ d, said, acts: [], heard: [], mood, why: "", action });
    expect(tenure("eager", [day(0, ["hi"], 4), day(5, [], 3), day(12, ["filmed it"], 5)], null, 14)).toMatchObject({ replies: 2, turnsIgnored: 1, moodFirst: 4, moodLast: 5, leftDay: null, activeLastThird: true });
    expect(tenure("overwhelmed", [day(0, ["hi"], 3), day(2, ["too much"], 2, "less"), day(4, ["STOP"], 1, "stop")], { d: 4, why: "kept texting" }, 14)).toMatchObject({ askedLess: 1, leftDay: 4, activeLastThird: false });
  });
  it("every simulated day gives the editor its turn after each scout pass", () => {
    const plan = dayPlan(3, { signupWeekday: 1 });
    expect(plan[plan.indexOf("scout") + 1]).toBe("editor");
    expect(plan[plan.indexOf("scoutAfternoon") + 1]).toBe("editorAfternoon");
  });
});
