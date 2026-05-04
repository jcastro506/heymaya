/**
 * Sprint 1 acceptance — the 5 mandatory test categories.
 *
 * Per docs/SPRINT_PLAN_V0.md § 10 ("Mandatory test categories per sprint")
 * every sprint must explicitly cover:
 *   1. Cross-tenant isolation
 *   2. Plan-tier × action matrix (incl. reads, fail-closed)
 *   3. Adversarial inputs
 *   4. Sibling-file scan
 *   5. TODO grep
 *
 * Per-feature unit tests already cover the bulk of categories 1 and 3 (see
 * convex/integrations/scrapeCreators/__tests__/* and
 * convex/agents/modelRouter/__tests__/*). This file is the cross-cutting
 * acceptance gate that asserts the matrix view + the static checks (sibling
 * scan + TODO grep) at sprint-close.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import schema from "../convex/schema";
import { modules } from "./_modules";
import {
  planFeatures,
  clampThinkingBudget,
  channelAllowed,
  providerAllowed,
  type Plan,
  type ThinkingBudget,
  type Channel,
  type Provider,
} from "../convex/lib/planFeatures";

const REPO_ROOT = join(import.meta.dirname ?? __dirname, "..");
const CONVEX_DIR = join(REPO_ROOT, "convex");
const APP_DIR = join(REPO_ROOT, "app");

// ────────────────────────────────────────────────────────────────────────
// Category 2 — Plan-tier × action matrix
// ────────────────────────────────────────────────────────────────────────

describe("Sprint 1 acceptance — plan-tier × action matrix", () => {
  const PLANS: ReadonlyArray<Plan> = ["starter", "pro", "studio"];
  const BUDGETS: ReadonlyArray<ThinkingBudget> = ["none", "low", "medium", "high"];
  const CHANNELS: ReadonlyArray<Channel> = ["web", "sms", "imessage", "whatsapp", "telegram"];
  const PROVIDERS: ReadonlyArray<Provider> = ["gmail", "stripe", "calendar", "apollo", "hunter"];

  describe("thinking budget clamp", () => {
    const expected: Record<Plan, Record<ThinkingBudget, ThinkingBudget>> = {
      starter: { none: "none", low: "low", medium: "low", high: "low" },
      pro: { none: "none", low: "low", medium: "medium", high: "high" },
      studio: { none: "none", low: "low", medium: "medium", high: "high" },
    };
    for (const plan of PLANS) {
      for (const budget of BUDGETS) {
        it(`${plan} requesting ${budget} -> ${expected[plan][budget]}`, () => {
          expect(clampThinkingBudget({ plan }, budget)).toBe(expected[plan][budget]);
        });
      }
    }
  });

  describe("channel allowlist (REVISED 2026-04-26: channels are OpenClaw-native, ungated; telegram added 2026-05-03)", () => {
    const expected: Record<Plan, Record<Channel, boolean>> = {
      starter: { web: true, sms: true, imessage: true, whatsapp: true, telegram: true },
      pro: { web: true, sms: true, imessage: true, whatsapp: true, telegram: true },
      studio: { web: true, sms: true, imessage: true, whatsapp: true, telegram: true },
    };
    for (const plan of PLANS) {
      for (const channel of CHANNELS) {
        it(`${plan} channel ${channel} = ${expected[plan][channel]}`, () => {
          expect(channelAllowed({ plan }, channel)).toBe(expected[plan][channel]);
        });
      }
    }
  });

  describe("composio provider allowlist (REVISED 2026-04-26: gmail+calendar ungated; apollo/hunter Studio-only)", () => {
    const expected: Record<Plan, Record<Provider, boolean>> = {
      starter: { gmail: true, stripe: true, calendar: true, apollo: false, hunter: false },
      pro: { gmail: true, stripe: true, calendar: true, apollo: false, hunter: false },
      studio: { gmail: true, stripe: true, calendar: true, apollo: true, hunter: true },
    };
    for (const plan of PLANS) {
      for (const provider of PROVIDERS) {
        it(`${plan} provider ${provider} = ${expected[plan][provider]}`, () => {
          expect(providerAllowed({ plan }, provider)).toBe(expected[plan][provider]);
        });
      }
    }
  });

  it("plan caps don't widen accidentally — starter handles must stay at 1", () => {
    expect(planFeatures({ plan: "starter" }).maxHandles).toBe(1);
    expect(planFeatures({ plan: "pro" }).maxHandles).toBe(3);
    expect(planFeatures({ plan: "studio" }).maxHandles).toBe(5);
  });

  it("post-publish reaction latency tightens with tier", () => {
    const s = planFeatures({ plan: "starter" }).postPublishReactionLatencySec;
    const p = planFeatures({ plan: "pro" }).postPublishReactionLatencySec;
    const st = planFeatures({ plan: "studio" }).postPublishReactionLatencySec;
    expect(s).toBeGreaterThan(p);
    expect(p).toBeGreaterThan(st);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Category 1 — Cross-tenant isolation (cross-cutting smoke test)
// ────────────────────────────────────────────────────────────────────────

describe("Sprint 1 acceptance — cross-tenant isolation smoke", () => {
  it("scrapeCreatorsCache rows are isolated by creatorId at the schema level", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "u_a",
        email: "a@x.com",
        channelPreference: "web",
        timezone: "UTC",
        status: "active",
        plan: "starter",
        createdAt: 0,
      })
    );
    const b = await t.run((ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "u_b",
        email: "b@x.com",
        channelPreference: "web",
        timezone: "UTC",
        status: "active",
        plan: "starter",
        createdAt: 0,
      })
    );

    await t.run((ctx) =>
      ctx.db.insert("scrapeCreatorsCache", {
        cacheKey: "sc:tiktok:profile:shared_handle",
        creatorId: a,
        payload: { who: "a" },
        fetchedAt: 0,
        ttlSec: 3600,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("scrapeCreatorsCache", {
        cacheKey: "sc:tiktok:profile:shared_handle",
        creatorId: b,
        payload: { who: "b" },
        fetchedAt: 0,
        ttlSec: 3600,
      })
    );

    const aRows = await t.run((ctx) =>
      ctx.db
        .query("scrapeCreatorsCache")
        .withIndex("by_creator_and_key", (q) =>
          q.eq("creatorId", a).eq("cacheKey", "sc:tiktok:profile:shared_handle")
        )
        .collect()
    );
    expect(aRows).toHaveLength(1);
    expect((aRows[0].payload as { who: string }).who).toBe("a");

    const bRows = await t.run((ctx) =>
      ctx.db
        .query("scrapeCreatorsCache")
        .withIndex("by_creator_and_key", (q) =>
          q.eq("creatorId", b).eq("cacheKey", "sc:tiktok:profile:shared_handle")
        )
        .collect()
    );
    expect(bRows).toHaveLength(1);
    expect((bRows[0].payload as { who: string }).who).toBe("b");
  });

  it("aiCallLog rows are filterable per creator without leaking", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "u_a",
        email: "a@x.com",
        channelPreference: "web",
        timezone: "UTC",
        status: "active",
        plan: "starter",
        createdAt: 0,
      })
    );
    const b = await t.run((ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "u_b",
        email: "b@x.com",
        channelPreference: "web",
        timezone: "UTC",
        status: "active",
        plan: "pro",
        createdAt: 0,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("aiCallLog", {
        creatorId: a,
        taskTag: "chat_reply",
        model: "google/gemini-3-flash-preview",
        thinkingBudget: "low",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: 0.0001,
        latencyMs: 100,
        ts: 0,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("aiCallLog", {
        creatorId: b,
        taskTag: "morning_brief",
        model: "google/gemini-3-flash-preview",
        thinkingBudget: "medium",
        inputTokens: 100,
        outputTokens: 200,
        costUsd: 0.001,
        latencyMs: 800,
        ts: 0,
      })
    );

    const aLogs = await t.run((ctx) =>
      ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    expect(aLogs).toHaveLength(1);
    expect(aLogs[0].taskTag).toBe("chat_reply");

    const bLogs = await t.run((ctx) =>
      ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .collect()
    );
    expect(bLogs).toHaveLength(1);
    expect(bLogs[0].taskTag).toBe("morning_brief");
  });
});

// ────────────────────────────────────────────────────────────────────────
// Category 4 — Sibling-file scan
// ────────────────────────────────────────────────────────────────────────

describe("Sprint 1 acceptance — sibling-file scan", () => {
  it("every table with a creatorId field has a by_creator index", () => {
    const schemaSrc = readFileSync(join(CONVEX_DIR, "schema.ts"), "utf8");
    const noComments = schemaSrc.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const tableBlocks = noComments.split(/(?=\b\w+:\s*defineTable\()/);
    for (const block of tableBlocks) {
      const tableNameMatch = block.match(/^(\w+):\s*defineTable\(/);
      if (!tableNameMatch) continue;
      const tableName = tableNameMatch[1];
      const hasCreatorId = /creatorId:\s*v\.id\("creators"\)/.test(block);
      if (!hasCreatorId) continue;
      const hasByCreator = /\.index\(\s*"by_creator"/.test(block);
      expect(hasByCreator, `table '${tableName}' has creatorId but no by_creator index`).toBe(true);
    }
  });

  it("no orphan imports — every relative import in convex/ resolves to a real file", () => {
    // Files that embed skill markdown / docstring code samples containing
    // example `from '../foo'` strings inside template literals — these are
    // not real imports and the regex below cannot distinguish them. Whitelist
    // explicitly so the scan stays meaningful for real source files.
    const STRING_LITERAL_DOC_FILES = new Set([
      "pinnedClawhubSkills.ts",
    ]);
    const tsFiles = walk(CONVEX_DIR).filter(
      (f) =>
        f.endsWith(".ts") &&
        !f.includes("/_generated/") &&
        !f.endsWith(".d.ts") &&
        !STRING_LITERAL_DOC_FILES.has(f.split("/").pop() ?? "")
    );

    const importPattern = /from\s+["'](\.\.?\/[^"']+)["']/g;
    for (const file of tsFiles) {
      const src = readFileSync(file, "utf8");
      const dir = file.substring(0, file.lastIndexOf("/"));
      let m: RegExpExecArray | null;
      while ((m = importPattern.exec(src)) !== null) {
        const spec = m[1];
        const candidates = [
          spec,
          `${spec}.ts`,
          `${spec}.tsx`,
          `${spec}.js`,
          `${spec}.d.ts`,
          `${spec}/index.ts`,
          `${spec}/index.tsx`,
          `${spec}/index.d.ts`,
        ];
        const found = candidates.some((c) => existsSync(join(dir, c)));
        expect(
          found,
          `${file.replace(REPO_ROOT, "")} imports '${spec}' which doesn't resolve`
        ).toBe(true);
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Category 5 — TODO grep
// ────────────────────────────────────────────────────────────────────────

describe("Sprint 1 acceptance — TODO grep", () => {
  it("no unjustified TODO/FIXME/eslint-disable in convex/ or app/", () => {
    const isProd = (f: string): boolean =>
      !f.includes("/__tests__/") &&
      !f.includes("/_test/") &&
      !f.includes("/_generated/") &&
      !f.endsWith(".test.ts") &&
      !f.endsWith(".test.tsx");
    const files = [
      ...walk(CONVEX_DIR).filter(
        (f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && isProd(f)
      ),
      ...walk(APP_DIR).filter(
        (f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && isProd(f)
      ),
    ];
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        const hasMarker = /\bTODO\b|\bFIXME\b|eslint-disable/.test(trimmed);
        if (!hasMarker) return;
        const justified =
          /\bTODO\([sS]\d+\)/.test(trimmed) ||
          /(TODO|FIXME|eslint-disable)[^:]*:\s*\S/.test(trimmed);
        if (!justified) {
          violations.push(`${file.replace(REPO_ROOT, "")}:${idx + 1}  ${trimmed}`);
        }
      });
    }
    expect(violations, `unjustified markers:\n${violations.join("\n")}`).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function existsSync(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}
