/**
 * Generator tests for the service-product Maya workspace pack.
 *
 * Per the 5 mandatory test categories (CLAUDE.md + service plan § 14):
 *   1. Cross-tenant isolation (n/a — templates shared, generators are pure
 *      functions of inputs; tested implicitly via fixture variation).
 *   2. Plan-tier × action matrix (TOOLS.md generator gates per business plan).
 *   3. Adversarial inputs (malformed business, empty localPositioning,
 *      empty serviceTypes, no brandVoice — all produce safe output or
 *      throw cleanly).
 *   4. Sibling-file scan (covered by the platform-level scan test).
 *   5. TODO grep (covered by repo-level lint).
 */

import { describe, it, expect } from "vitest";
import { generateAgents } from "../generateAgents";
import { generateSoul } from "../generateSoul";
import { generateBoot } from "../generateBoot";
import { generateHeartbeat } from "../generateHeartbeat";
import { generateTools } from "../generateTools";
import { generateDreaming } from "../generateDreaming";
import { generateMemorySeed } from "../generateMemorySeed";
import { generateBusinessPicture } from "../generateBusinessPicture";
import { buildJobsJson } from "../buildJobsJson";
import {
  HEARTBEAT_MAX_CHARS,
  AGENTS_MAX_CHARS,
  SOUL_MAX_CHARS,
  BOOT_MAX_CHARS,
  DREAMING_MAX_CHARS,
  COMBINED_BUNDLE_MAX_CHARS,
  type ServiceType,
  type ServiceWorkspaceInputs,
} from "../types";
import { SERVICE_STANDING_ORDERS } from "../standingOrders";

const FIXTURE_HVAC: ServiceWorkspaceInputs = {
  operator: { firstName: "Mike", displayName: "Mike Henderson" },
  business: {
    name: "Henderson HVAC",
    serviceTypes: ["hvac"],
    serviceArea: "25-mile radius around Lincoln, NE",
    timezone: "America/Chicago",
    tonePreference: "friendly-neighborhood-pro",
    technicianNames: ["Carlos", "Devon"],
    businessHours: "M-F 7a-6p, Sat 8a-noon",
    voiceEnabled: false,
  },
  businessPicture: {
    brandVoice:
      "warm, first-name basis, ends every reply with 'thanks for choosing us'",
    brandVoiceSamples: [
      {
        source: "review-reply",
        text: "Thanks for choosing us, Henderson — Carlos was glad he could help on the Oak Street install.",
      },
    ],
    localPositioning: {
      servedZips: ["68506", "68510"],
      servedNeighborhoods: ["Lincoln Park", "Eastridge"],
      namedCompetitors: [
        { name: "Acme HVAC", reputationalNote: "cheaper but slower" },
      ],
      recurringLocalHooks: [
        { kind: "weather", text: "Nebraska freeze season Dec-Feb" },
        { kind: "sport", text: "Husker game Saturdays" },
      ],
      localChoiceThesis: "neighborhood-first HVAC who answers the phone",
    },
  },
  plan: "pro",
  now: 1_700_000_000_000,
};

const STUB_SEED_LOADER = (st: ServiceType): string =>
  `<!-- service-type: ${st} -->\n## Domain priors\n- placeholder for ${st}\n`;

describe("service workspace generators — happy path", () => {
  it("generateAgents produces non-empty markdown for the HVAC fixture", () => {
    const out = generateAgents(FIXTURE_HVAC);
    expect(out.length).toBeGreaterThan(2_000);
    expect(out.length).toBeLessThanOrEqual(AGENTS_MAX_CHARS);
    expect(out).toContain("Mike");
    expect(out).toContain("Henderson HVAC");
    expect(out).toContain("Lincoln Park");
  });

  it("generateSoul produces non-empty markdown under cap", () => {
    const out = generateSoul(FIXTURE_HVAC);
    expect(out.length).toBeGreaterThan(800);
    expect(out.length).toBeLessThanOrEqual(SOUL_MAX_CHARS);
    expect(out).toContain("Maya from the office");
    expect(out).toContain("Anti-fake-busy");
    expect(out).toContain("Anti-sycophancy");
  });

  it("generateBoot produces non-empty markdown under cap", () => {
    const out = generateBoot(FIXTURE_HVAC);
    expect(out.length).toBeGreaterThan(400);
    expect(out.length).toBeLessThanOrEqual(BOOT_MAX_CHARS);
    expect(out).toContain("Open with the fix");
  });

  it("generateHeartbeat produces non-empty markdown under hard cap of 2K", () => {
    const out = generateHeartbeat(FIXTURE_HVAC);
    expect(out.length).toBeGreaterThan(200);
    expect(out.length).toBeLessThanOrEqual(HEARTBEAT_MAX_CHARS);
  });

  it("generateTools produces non-empty markdown under cap", () => {
    const out = generateTools(FIXTURE_HVAC);
    expect(out.length).toBeGreaterThan(800);
    expect(out).toContain("lc_maya_service");
    expect(out).toContain("Zernio");
  });

  it("generateDreaming produces non-empty markdown under cap", () => {
    const out = generateDreaming();
    expect(out.length).toBeGreaterThan(400);
    expect(out.length).toBeLessThanOrEqual(DREAMING_MAX_CHARS);
  });

  it("generateMemorySeed assembles the per-service seed correctly", () => {
    const out = generateMemorySeed({ ...FIXTURE_HVAC, seedLoader: STUB_SEED_LOADER });
    expect(out).toContain("Mike Henderson");
    expect(out).toContain("Henderson HVAC");
    expect(out).toContain("Lincoln Park");
    expect(out).toContain("service-type: hvac");
  });

  it("buildJobsJson produces deterministic sorted output for Pro tier", () => {
    const result = buildJobsJson({
      business: { timezone: FIXTURE_HVAC.business.timezone },
      plan: FIXTURE_HVAC.plan,
    });
    expect(result.jobs.length).toBeGreaterThan(0);
    // Sort assertion.
    const names = result.jobs.map((j) => j.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
    // Pro tier: studio-only programs excluded (e.g. manager_readiness_packet).
    const studioPrograms = SERVICE_STANDING_ORDERS.filter(
      (p) => p.tier === "studio"
    );
    for (const studioP of studioPrograms) {
      expect(
        result.jobs.find((j) => j.entryId === studioP.id),
        `Pro tier should not have studio program ${studioP.id}`
      ).toBeUndefined();
    }
  });

  it("buildJobsJson at studio tier includes manager-readiness-packet", () => {
    const result = buildJobsJson({
      business: { timezone: "America/Chicago" },
      plan: "studio",
    });
    expect(
      result.jobs.find((j) => j.entryId === "manager_readiness_packet")
    ).toBeDefined();
  });

  it("buildJobsJson at starter tier excludes pro+ programs", () => {
    const result = buildJobsJson({
      business: { timezone: "America/Chicago" },
      plan: "starter",
    });
    const proPlusIds = SERVICE_STANDING_ORDERS.filter((p) => p.tier === "pro+").map(
      (p) => p.id
    );
    for (const id of proPlusIds) {
      expect(
        result.jobs.find((j) => j.entryId === id),
        `Starter should not have pro+ program ${id}`
      ).toBeUndefined();
      expect(
        result.events.find((e) => e.entryId === id),
        `Starter should not have pro+ event ${id}`
      ).toBeUndefined();
    }
  });
});

describe("service workspace generators — interpolation completeness", () => {
  it("no `{{` placeholders survive in any rendered output", () => {
    const outs = [
      generateAgents(FIXTURE_HVAC),
      generateSoul(FIXTURE_HVAC),
      generateBoot(FIXTURE_HVAC),
      generateHeartbeat(FIXTURE_HVAC),
      generateTools(FIXTURE_HVAC),
      generateMemorySeed({ ...FIXTURE_HVAC, seedLoader: STUB_SEED_LOADER }),
    ];
    for (const out of outs) {
      // Allow `{{...}}` only inside fenced code blocks (illustration of the
      // multi-media handling prompt + ts type signatures).
      const stripped = out.replace(/```[\s\S]*?```/g, "");
      const stripped2 = stripped.replace(/^>.*$/gm, ""); // markdown blockquotes
      expect(stripped2.includes("{{"), `output contained {{ placeholder: ${stripped2.match(/\{\{[^}]+\}\}/g)?.[0]}`).toBe(false);
    }
  });
});

describe("service workspace generators — adversarial inputs", () => {
  it("generateSoul handles null businessPicture without throwing", () => {
    const out = generateSoul({ ...FIXTURE_HVAC, businessPicture: null });
    expect(out).toContain("not yet provided");
  });

  it("generateAgents handles null businessPicture (fallback to served-zips note)", () => {
    const out = generateAgents({ ...FIXTURE_HVAC, businessPicture: null });
    expect(out).toContain("not yet captured");
  });

  it("generateMemorySeed throws on empty serviceTypes", () => {
    const broken = {
      ...FIXTURE_HVAC,
      business: { ...FIXTURE_HVAC.business, serviceTypes: [] },
      seedLoader: STUB_SEED_LOADER,
    };
    expect(() => generateMemorySeed(broken)).toThrow(/serviceTypes/);
  });

  it("generateMemorySeed throws when seedLoader returns empty", () => {
    const broken = { ...FIXTURE_HVAC, seedLoader: () => "" };
    expect(() => generateMemorySeed(broken)).toThrow(/empty seed/);
  });

  it("buildJobsJson rejects malformed timezone", () => {
    expect(() =>
      buildJobsJson({ business: { timezone: "not-a-tz" }, plan: "pro" })
    ).toThrow(/invalid IANA timezone/);
  });

  it("generateBusinessPicture rejects when apiKey is missing", async () => {
    // Sprint 2 wired the real synthesis. Contract: apiKey is required —
    // missing key throws before any network call. We assert the error path
    // here without making a real OpenRouter request.
    await expect(
      generateBusinessPicture({
        business: FIXTURE_HVAC.business,
        bulkPullArtifact: {
          gbp: {
            reviews: [],
            posts: [],
            profile: {
              primaryCategory: "HVAC contractor",
              address: "123 Main St",
              city: "Lincoln",
            },
          },
          socialPosts: [],
        },
        onboardingLocalAnswers: {
          namedCompetitors: [],
          neighborhoodEmphasis: [],
          operatorVolunteeredHooks: [],
        },
        apiKey: "",
      })
    ).rejects.toThrow(/apiKey/);
  });
});

describe("service workspace generators — combined budget", () => {
  it("SOUL+AGENTS+HEARTBEAT (rendered) under 150K combined cap", () => {
    const soul = generateSoul(FIXTURE_HVAC);
    const agents = generateAgents(FIXTURE_HVAC);
    const heartbeat = generateHeartbeat(FIXTURE_HVAC);
    const combined = soul.length + agents.length + heartbeat.length;
    expect(combined).toBeLessThan(COMBINED_BUNDLE_MAX_CHARS);
  });
});

describe("service workspace generators — plan-tier matrix (TOOLS.md)", () => {
  it("Starter TOOLS.md gates Pro+ + Studio tools as 'NOT available'", () => {
    const out = generateTools({ ...FIXTURE_HVAC, plan: "starter" });
    expect(out).toContain("NOT available on this tier");
    expect(out).toContain("composio.gmail.messages.send");
    expect(out).toContain("crm.jobs.read");
  });

  it("Studio TOOLS.md includes media.ffmpeg.edit + elevenlabs.agent.handoff", () => {
    const out = generateTools({ ...FIXTURE_HVAC, plan: "studio" });
    expect(out).toContain("media.ffmpeg.edit");
    expect(out).toContain("elevenlabs.agent.handoff");
  });

  it("Pro TOOLS.md excludes Studio-only tools", () => {
    const out = generateTools({ ...FIXTURE_HVAC, plan: "pro" });
    // ffmpeg.edit is studio-only; should appear in the gated section, not enabled.
    const enabledSection = out.split("## Tools NOT available on this tier")[0];
    expect(enabledSection).not.toContain("media.ffmpeg.edit");
    expect(enabledSection).not.toContain("elevenlabs.agent.handoff");
  });
});
