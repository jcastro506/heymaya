/**
 * Sprint 8 Slice B — memory-wiki adoption for the high-frequency creator
 * learning skills.
 *
 * Six creator-side skills (and the trend-watcher cron behavior driven from
 * the platform's standing-orders prose) used to write directly to specialized
 * Convex tables — `weeklyLearnings`, `competitorObservations`,
 * `trendObservations`. That split the learning surface and made dreaming
 * effectively useless: dreaming compiles claims FROM memory-wiki, but the
 * skills weren't writing TO memory-wiki. The compounding learning loop is
 * Maya's moat; this slice routes those skills' learnings into OpenClaw's
 * native `wiki_apply` tool instead.
 *
 * The five skills with explicit script.ts prompt scaffolds are:
 *
 *   - maya-platform-algo-researcher  → platform/<platform>/algo-signal
 *   - maya-pre-post-scorer           → creator/<creatorId>/<facet>
 *   - maya-collab-matchmaker         → creator/<creatorId>/collab-pattern/*
 *   - maya-industry-intel            → creator/<creatorId>/industry-intel/*
 *   - maya-opportunity-scout         → creator/<creatorId>/opportunity-pattern/*
 *
 * The "trend-watcher" cron behavior is encoded in playbook.md / standingOrders
 * prose (no separate skill folder). Its memory-wiki path is documented in
 * this slice's plan but its prose update lives in playbook.md (Slice A's
 * scope per the slice contract).
 *
 * What this test enforces:
 *   (1) Each SKILL.md documents `wiki_apply` + a "Memory-wiki integration"
 *       section + the topic schema with the canonical key shape.
 *   (2) Each script.ts prompt scaffold instructs the model to emit
 *       `wiki_apply` calls — and does NOT import any Convex modules
 *       (script.ts must stay pure-logic per the file headers).
 *   (3) Sibling-file scan: SKILL.md ↔ script.ts both reference
 *       `wiki_apply` consistently (no SKILL.md docs without prompt
 *       support, and no prompt support without SKILL.md docs).
 *   (4) Voice-fixture grep on the rewritten SKILL.md content (no banned
 *       sycophancy / hedge / hallucination terms slipped in via the
 *       memory-wiki prose).
 *   (5) Schema state: `weeklyLearnings` / `competitorObservations` /
 *       `trendObservations` either exist as read-only projections (with
 *       a `mirroredAt: v.optional(v.number())` field) or are absent
 *       entirely. The slice picked "downgrade-with-mirroredAt" because
 *       all three have HQ readers (Trends screen + heartbeat + GBP
 *       health score on the service side).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "agents", "skills");
const SCHEMA_PATH = join(REPO_ROOT, "convex", "schema.ts");

interface CreatorWikiSkillSpec {
  readonly slug: string;
  /** A topic-key fragment we expect to find inside the SKILL.md memory-wiki section AND inside the prompt scaffold. */
  readonly topicKeyFragment: string;
  /** The script.ts source path relative to SKILLS_ROOT/<slug>. */
  readonly scriptFile: string;
}

const CREATOR_WIKI_SKILLS: ReadonlyArray<CreatorWikiSkillSpec> = [
  {
    slug: "maya-platform-algo-researcher",
    topicKeyFragment: "platform/",
    scriptFile: "script.ts",
  },
  {
    slug: "maya-pre-post-scorer",
    topicKeyFragment: "creator/",
    scriptFile: "script.ts",
  },
  {
    slug: "maya-collab-matchmaker",
    topicKeyFragment: "collab-pattern",
    scriptFile: "script.ts",
  },
  {
    slug: "maya-industry-intel",
    topicKeyFragment: "industry-intel",
    scriptFile: "script.ts",
  },
  {
    slug: "maya-opportunity-scout",
    topicKeyFragment: "opportunity-pattern",
    scriptFile: "script.ts",
  },
];

function readSkill(slug: string): string {
  const p = join(SKILLS_ROOT, slug, "SKILL.md");
  expect(existsSync(p), `SKILL.md missing at ${p}`).toBe(true);
  return readFileSync(p, "utf8");
}

function readScript(slug: string, scriptFile: string): string {
  const p = join(SKILLS_ROOT, slug, scriptFile);
  expect(existsSync(p), `${scriptFile} missing at ${p}`).toBe(true);
  return readFileSync(p, "utf8");
}

/* -------------------------------------------------------------------------- */
/* (1) SKILL.md documents wiki_apply + Memory-wiki integration section.       */
/* -------------------------------------------------------------------------- */

describe("Sprint 8 Slice B — SKILL.md documents wiki_apply", () => {
  for (const spec of CREATOR_WIKI_SKILLS) {
    it(`${spec.slug}: SKILL.md mentions wiki_apply`, () => {
      const md = readSkill(spec.slug);
      expect(md).toContain("wiki_apply");
    });

    it(`${spec.slug}: SKILL.md has a "Memory-wiki integration" section`, () => {
      const md = readSkill(spec.slug);
      expect(md.toLowerCase()).toContain("memory-wiki integration");
    });

    it(`${spec.slug}: SKILL.md documents the canonical topic key shape`, () => {
      const md = readSkill(spec.slug);
      expect(md).toContain(spec.topicKeyFragment);
      // Provenance block is part of every wiki_apply call shape.
      expect(md.toLowerCase()).toContain("provenance");
    });
  }
});

/* -------------------------------------------------------------------------- */
/* (2) script.ts prompt scaffolds emit wiki_apply, do NOT import Convex.      */
/* -------------------------------------------------------------------------- */

const CONVEX_IMPORT_PATTERNS: ReadonlyArray<RegExp> = [
  /from\s+["']\.\.\/\.\.\/\.\.\/convex\//,
  /from\s+["']convex\/_generated/,
  /from\s+["']convex\/server/,
  /from\s+["']convex\/values/,
  /\bctx\.db\.insert\(/,
  /\bctx\.db\.patch\(/,
  /\bctx\.db\.replace\(/,
  /\bctx\.runMutation\(/,
];

describe("Sprint 8 Slice B — script.ts prompt scaffolds emit wiki_apply", () => {
  for (const spec of CREATOR_WIKI_SKILLS) {
    it(`${spec.slug}: ${spec.scriptFile} mentions wiki_apply in the prompt scaffold`, () => {
      const src = readScript(spec.slug, spec.scriptFile);
      expect(src).toContain("wiki_apply");
    });

    it(`${spec.slug}: ${spec.scriptFile} is Convex-free (no direct DB writes)`, () => {
      const src = readScript(spec.slug, spec.scriptFile);
      for (const pattern of CONVEX_IMPORT_PATTERNS) {
        expect(
          pattern.test(src),
          `${spec.slug}/${spec.scriptFile} matched forbidden Convex pattern ${pattern}`
        ).toBe(false);
      }
    });

    it(`${spec.slug}: ${spec.scriptFile} prompt mentions the topic key fragment`, () => {
      const src = readScript(spec.slug, spec.scriptFile);
      expect(src).toContain(spec.topicKeyFragment);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* (3) Sibling-file scan — SKILL.md ↔ script.ts wiki_apply consistency.       */
/* -------------------------------------------------------------------------- */

describe("Sprint 8 Slice B — sibling-file consistency", () => {
  for (const spec of CREATOR_WIKI_SKILLS) {
    it(`${spec.slug}: SKILL.md and script.ts agree on the topic key shape`, () => {
      const md = readSkill(spec.slug);
      const src = readScript(spec.slug, spec.scriptFile);
      // Both sides reference the same fragment.
      expect(md).toContain(spec.topicKeyFragment);
      expect(src).toContain(spec.topicKeyFragment);
      // Both sides reference the source attribution (skill slug or
      // "maya-..." family) inside their wiki_apply provenance shape.
      // SKILL.md docs the provenance block explicitly; script.ts seeds
      // `"source": "<slug>"` into the prompt example.
      expect(src).toContain(spec.slug);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* (4) Voice grep — no sycophancy / hallucination terms in new prose.         */
/* -------------------------------------------------------------------------- */

const BANNED_SKILL_MD_TERMS: ReadonlyArray<{ term: string; reason: string }> = [
  { term: "amazing", reason: "sycophancy" },
  { term: "incredible", reason: "sycophancy" },
  { term: "love this", reason: "sycophancy" },
  { term: "you're crushing", reason: "sycophancy" },
  // hallucination / over-promise hedges
  { term: "guarantee", reason: "over-promise" },
  { term: "always works", reason: "over-promise" },
];

describe("Sprint 8 Slice B — voice-fixture grep on rewritten SKILL.md", () => {
  for (const spec of CREATOR_WIKI_SKILLS) {
    it(`${spec.slug}: SKILL.md contains no banned sycophancy / over-promise terms`, () => {
      const md = readSkill(spec.slug).toLowerCase();
      for (const banned of BANNED_SKILL_MD_TERMS) {
        expect(
          md.includes(banned.term),
          `${spec.slug}/SKILL.md contains banned term "${banned.term}" (reason: ${banned.reason})`
        ).toBe(false);
      }
    });
  }
});

/* -------------------------------------------------------------------------- */
/* (5) Schema — three projection tables exist with mirroredAt.                */
/* -------------------------------------------------------------------------- */

describe("Sprint 8 Slice B — schema downgrade to read-only projections", () => {
  const schema = readFileSync(SCHEMA_PATH, "utf8");

  // Pulls the body between `<tableName>: defineTable({` and the matching
  // closing `})` (greedy enough for nested objects in our schema, brittle
  // enough that a totally-rewritten table will fail loudly). The three
  // tables are short enough that a non-greedy [\\s\\S]+? scoped to the
  // first `\n  })` works.
  function tableBody(name: string): string {
    const re = new RegExp(`${name}: defineTable\\(\\{([\\s\\S]+?)\\n  \\}\\)`);
    const m = schema.match(re);
    if (!m) return "";
    return m[1];
  }

  for (const tableName of ["trendObservations", "competitorObservations", "weeklyLearnings"]) {
    it(`${tableName}: present as a read-only projection with mirroredAt`, () => {
      const body = tableBody(tableName);
      expect(body, `${tableName} not found in schema.ts`).not.toBe("");
      // Either delete-outright or downgrade-with-mirroredAt; we picked
      // downgrade. The mirroredAt field marks when the wiki sync last
      // touched the row. If the slice ever revisits delete-outright,
      // this assertion flips to expect(body).toBe("").
      expect(
        body,
        `${tableName} must carry a mirroredAt field marking the wiki-sync timestamp`
      ).toMatch(/mirroredAt:\s*v\.optional\(v\.number\(\)\)/);
    });
  }

  it("schema docstring acknowledges the wiki-mirror migration window", () => {
    // The new comment block on the trend/competitor pair calls out
    // Sprint 8 Slice B + the future Sprint 8.5 sync cron + the
    // legacy-write window for HTTP endpoints. A regex-grep keeps the
    // note from getting dropped in a future refactor.
    expect(schema).toContain("Sprint 8 Slice B");
    expect(schema).toMatch(/wiki[-\s]?mirror/i);
  });
});
