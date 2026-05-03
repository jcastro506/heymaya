import { describe, expect, it } from "vitest";
import {
  applyCreatorReadbackCorrections,
  buildCreatorReadback,
  requiredCreatorMayaIntakeQuestions,
} from "../onboardingIntake";

describe("Creator Maya v0 onboarding intake", () => {
  it("keeps onboarding to six manager-style questions", () => {
    const questions = requiredCreatorMayaIntakeQuestions();

    expect(questions).toHaveLength(6);
    expect(questions[0]).toContain("90 days");
    expect(questions.join(" ")).toContain("never suggest");
  });

  it("builds Maya's read from inferred context plus user answers", () => {
    const readback = buildCreatorReadback(
      {
        inferredNiche: "founder build-in-public",
        strongestPattern: "result-first product demos",
        weakestPattern: "context-heavy personal updates",
        calendarReality: "weekday afternoons are the only realistic filming blocks",
        audienceHypothesis: "early-stage founders",
      },
      {
        ninetyDayGoal: "grow authority and get sponsor-ready",
        creatorStage: "growing_consistently",
        biggestBlocker: "inconsistent posting",
        weeklyHoursAvailable: 4,
        tone: "strategic",
        doNotSuggest: ["daily vlogs"],
      }
    );

    expect(readback.stage).toBe("growing_consistently");
    expect(readback.niche).toBe("founder build-in-public");
    expect(readback.planBias).toContain("result-first product demos");
    expect(readback.currentReality).toContain("weekday afternoons");
  });

  it("lets the creator correct Maya's read before deployment", () => {
    const readback = buildCreatorReadback(
      {
        inferredNiche: "fitness",
        strongestPattern: "before-after hooks",
        weakestPattern: "long intros",
        calendarReality: "mornings open",
        audienceHypothesis: "new gym-goers",
      },
      {
        ninetyDayGoal: "grow",
        creatorStage: "just_starting",
        biggestBlocker: "ideas",
        weeklyHoursAvailable: 2,
        tone: "supportive",
        doNotSuggest: [],
      }
    );

    const corrected = applyCreatorReadbackCorrections(readback, {
      niche: "mobility for desk workers",
      weeklyHoursAvailable: 5,
      doNotSuggest: ["shirtless gym content"],
    });

    expect(corrected.niche).toBe("mobility for desk workers");
    expect(corrected.weeklyHoursAvailable).toBe(5);
    expect(corrected.doNotSuggest).toEqual(["shirtless gym content"]);
    expect(corrected.stage).toBe("just_starting");
  });
});
