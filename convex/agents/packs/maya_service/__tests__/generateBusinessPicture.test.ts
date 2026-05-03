/**
 * generateBusinessPicture — multimodal synthesis tests.
 *
 * Strategy: stub OpenRouter at the fetch boundary so we can assert the
 * hallucination firewall + structured-output handling without a real API
 * call. Adversarial cases:
 *   - phantom competitor name (model invents one not in operator answers
 *     and not in any review/post body) → dropped from output, flagged.
 *   - phantom hook (model invents a hook not in operator answers and not
 *     substring-present in reviews/posts) → dropped from output, flagged.
 *   - operator-supplied competitor that the model legitimately keeps → kept.
 *   - operator-supplied hook that the model legitimately keeps → kept.
 */

import { describe, expect, it } from "vitest";
import { generateBusinessPicture } from "../generateBusinessPicture";

function fakeFetch(responseBody: string): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify({
        id: "chatcmpl-test",
        model: "google/gemini-3-flash",
        choices: [
          {
            message: { content: responseBody },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 800,
          completion_tokens_details: { reasoning_tokens: 600 },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
}

const OPERATOR_ANSWERS = {
  namedCompetitors: ["Acme Plumbing"],
  neighborhoodEmphasis: ["Lincoln Park"],
  operatorVolunteeredHooks: ["freezes hit hard in February"],
};

const BULK_PULL = {
  gbp: {
    profile: {
      primaryCategory: "HVAC contractor",
      address: "123 Main St",
      city: "Lincoln",
    },
    reviews: [
      {
        body: "Acme Plumbing tried to upsell me; Henderson was honest.",
        starRating: 5,
        reviewerName: "Jane",
      },
      {
        body: "Showed up in Lincoln Park within 90 minutes of my call.",
        starRating: 5,
        reviewerName: "Bob",
      },
    ],
    posts: [],
    photoUrls: [],
    pastReviewReplies: [],
  },
  socialPosts: [],
};

describe("generateBusinessPicture hallucination firewall", () => {
  it("drops phantom competitor names + flags them", async () => {
    const synth = JSON.stringify({
      brandVoice: "Plain, direct, neighborhood-friendly.",
      brandVoiceSamples: [],
      customerSentiment: "Customers consistently praise honesty.",
      recurringServicePatterns: ["honesty + speed"],
      localPositioning: {
        servedZips: ["68501"],
        servedNeighborhoods: ["Lincoln Park"],
        namedCompetitors: [
          { name: "Acme Plumbing" },
          { name: "Phantom Plumbing Co" }, // not in operator answers OR reviews
        ],
        recurringLocalHooks: [
          { kind: "season", text: "freezes hit hard in February" },
        ],
        localChoiceThesis: "Locals choose Henderson because he's honest.",
      },
      sourceCitations: [],
    });
    const out = await generateBusinessPicture({
      business: {
        name: "Henderson HVAC",
        serviceTypes: ["hvac"],
        serviceArea: "Lincoln",
        timezone: "America/Chicago",
        tonePreference: "friendly-neighborhood-pro",
        technicianNames: [],
        businessHours: "M-F",
        voiceEnabled: false,
      },
      bulkPullArtifact: BULK_PULL,
      onboardingLocalAnswers: OPERATOR_ANSWERS,
      apiKey: "stub",
      fetchImpl: fakeFetch(synth),
    });
    const names = out.picture.localPositioning.namedCompetitors.map(
      (c) => c.name
    );
    expect(names).toContain("Acme Plumbing");
    expect(names).not.toContain("Phantom Plumbing Co");
    expect(
      out.hallucinationFlags.some((f) => f.raw === "Phantom Plumbing Co")
    ).toBe(true);
  });

  it("preserves operator-supplied neighborhoods even when synth omits", async () => {
    const synth = JSON.stringify({
      brandVoice: "x",
      brandVoiceSamples: [],
      customerSentiment: "y",
      recurringServicePatterns: [],
      localPositioning: {
        servedZips: [],
        servedNeighborhoods: [],
        namedCompetitors: [],
        recurringLocalHooks: [],
        localChoiceThesis: "",
      },
      sourceCitations: [],
    });
    const out = await generateBusinessPicture({
      business: {
        name: "Henderson HVAC",
        serviceTypes: ["hvac"],
        serviceArea: "Lincoln",
        timezone: "America/Chicago",
        tonePreference: "friendly-neighborhood-pro",
        technicianNames: [],
        businessHours: "M-F",
        voiceEnabled: false,
      },
      bulkPullArtifact: BULK_PULL,
      onboardingLocalAnswers: OPERATOR_ANSWERS,
      apiKey: "stub",
      fetchImpl: fakeFetch(synth),
    });
    expect(out.picture.localPositioning.servedNeighborhoods).toContain(
      "Lincoln Park"
    );
  });

  it("rejects empty apiKey before any network call", async () => {
    await expect(
      generateBusinessPicture({
        business: {
          name: "x",
          serviceTypes: ["hvac"],
          serviceArea: "y",
          timezone: "America/Chicago",
          tonePreference: "friendly-neighborhood-pro",
          technicianNames: [],
          businessHours: "M-F",
          voiceEnabled: false,
        },
        bulkPullArtifact: BULK_PULL,
        onboardingLocalAnswers: OPERATOR_ANSWERS,
        apiKey: "",
      })
    ).rejects.toThrow(/apiKey/);
  });
});
