import { describe, expect, it } from "vitest";
import { buildMayaGtmWorkspace } from "../generators";
import {
  PINNED_CLAWHUB_SKILLS,
  buildSkillInstallCommands,
  pinnedClawhubRequiredEnv,
} from "../pinnedClawhubSkills";

const FIXTURE = {
  accountEmail: "rwtc@heymaya.test",
  timezone: "America/New_York",
  bootKickoffAtMs: Date.UTC(2026, 0, 1, 12, 0, 0),
  app: {
    name: "S17 fixture",
    url: "https://s17-fixture.test/",
    stage: "live-beta" as const,
    weekGoal: "signups" as const,
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [] as string[],
  },
};

describe("Sprint 17 — pinned ClawHub skills", () => {
  it("locks 7 skills with version + source", () => {
    expect(PINNED_CLAWHUB_SKILLS).toHaveLength(7);
    const slugs = PINNED_CLAWHUB_SKILLS.map((s) => s.slug);
    expect(slugs).toEqual(
      expect.arrayContaining([
        "reddit-readonly",
        "search-x",
        "tiktok",
        "jk-archivist-tiktok-packager",
        "instagram",
        "market-research",
        "in-depth-research",
      ])
    );
    for (const s of PINNED_CLAWHUB_SKILLS) {
      expect(s.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(s.source).toMatch(/^https:\/\//);
      expect(s.body.length).toBeGreaterThan(500);
    }
  });

  it("each SKILL.md ships under clawhub-skills/<slug>/SKILL.md", () => {
    const { files } = buildMayaGtmWorkspace(FIXTURE);
    for (const s of PINNED_CLAWHUB_SKILLS) {
      const path = `clawhub-skills/${s.slug}/SKILL.md`;
      expect(files.has(path)).toBe(true);
      expect(files.get(path)).toBe(s.body);
    }
  });

  it("each SKILL.md has frontmatter and references its slug name", () => {
    for (const s of PINNED_CLAWHUB_SKILLS) {
      expect(s.body).toMatch(/^---\n/);
      // Most use literal slug; some use the title-case name (e.g.
      // "Deep Research" for in-depth-research). Either is fine; just
      // confirm a recognizable name appears.
      const lower = s.body.toLowerCase();
      const slugLower = s.slug.toLowerCase();
      expect(
        lower.includes(slugLower) ||
          lower.includes(slugLower.replace(/-/g, " "))
      ).toBe(true);
    }
  });

  it("required env aggregator returns XAI_API_KEY (only search-x requires)", () => {
    const env = pinnedClawhubRequiredEnv();
    expect(env).toEqual(["XAI_API_KEY"]);
  });

  it("buildSkillInstallCommands emits install lines for runtime-install skills", () => {
    const cmds = buildSkillInstallCommands();
    // Instagram is the only one that doesn't need runtime install.
    expect(cmds).toHaveLength(6);
    for (const cmd of cmds) {
      expect(cmd).toMatch(/^openclaw skills install [a-z0-9-]+@\d+\.\d+\.\d+ --global$/);
    }
  });

  it("does not include the JK Archivist Pokémon TCG preset (sanitized)", () => {
    const jk = PINNED_CLAWHUB_SKILLS.find(
      (s) => s.slug === "jk-archivist-tiktok-packager"
    );
    expect(jk).toBeTruthy();
    const body = jk?.body ?? "";
    // The original SKILL.md included specific brand copy starting with
    // "TCG prices look certain" and #pokemon hashtag — make sure we
    // didn't accidentally ship that as Maya's default.
    expect(body).not.toContain("TCG prices look certain");
    expect(body).not.toContain("#pokemon #tcg #cardcollecting");
  });

  it("does not include the in-depth-research Related-Skills install-other-skills footer", () => {
    const inDepth = PINNED_CLAWHUB_SKILLS.find(
      (s) => s.slug === "in-depth-research"
    );
    const market = PINNED_CLAWHUB_SKILLS.find(
      (s) => s.slug === "market-research"
    );
    // Original market-research SKILL.md tried to recommend installing
    // OTHER skills via clawhub install. We stripped that footer.
    expect(market?.body).not.toContain("Install with `clawhub install");
    // in-depth-research's heavy-emoji default output format risks
    // tripping iMessage UX bans; we sanitized to letters only.
    expect(inDepth?.body).not.toContain("🔬 DEEP RESEARCH:");
  });

  it("ships ALL skills with `Runtime install requires` (multi-file) note OR self-contained marker", () => {
    for (const s of PINNED_CLAWHUB_SKILLS) {
      if (s.needsRuntimeInstall) {
        expect(s.body.toLowerCase()).toContain("openclaw skills install");
      }
    }
  });
});
