/**
 * Sibling-file scan — Wave C HQ UI.
 *
 * Service Sprint Plan § 14 mandates: every cron entry needs a playbook entry
 * needs a skill entry. The HQ UI's analog is: every nav item in the side/
 * bottom nav must resolve to a real `page.tsx` file under
 * `app/(business)/biz/<route>/page.tsx`. Drift between the nav array and the
 * filesystem is the source of dead links.
 *
 * This test reads `app/(business)/layout.tsx` for the nav array (string-
 * matching, not parsing) and verifies every linked path resolves to a
 * `page.tsx` file on disk.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");

describe("Wave C HQ UI sibling-file scan", () => {
  it("every nav item in BusinessLayout resolves to an existing page.tsx", () => {
    const layoutPath = resolve(
      REPO_ROOT,
      "app/(business)/layout.tsx"
    );
    expect(existsSync(layoutPath)).toBe(true);
    const src = readFileSync(layoutPath, "utf8");

    // Match every `href: "/biz/<segment>"` literal in the nav definition.
    const matches = Array.from(src.matchAll(/href:\s*"(\/biz\/[a-z]+)"/g));
    expect(matches.length).toBeGreaterThan(0);
    const hrefs = Array.from(new Set(matches.map((m) => m[1])));

    for (const href of hrefs) {
      // /biz/today → app/(business)/biz/today/page.tsx
      const segment = href.replace(/^\/biz\//, "");
      const pagePath = resolve(
        REPO_ROOT,
        `app/(business)/biz/${segment}/page.tsx`
      );
      expect(existsSync(pagePath), `Nav item ${href} should resolve to ${pagePath}`).toBe(true);
    }
  });

  it("every spec'd HQ route in Service Sprint Plan § 12 has a page on disk", () => {
    // Spec § 12 lists 6 screens — they all live under app/(business)/biz/<route>/page.tsx.
    const ROUTES = [
      "today",
      "jobs",
      "reviews",
      "posts",
      "customers",
      "profile",
    ];
    for (const route of ROUTES) {
      const pagePath = resolve(
        REPO_ROOT,
        `app/(business)/biz/${route}/page.tsx`
      );
      expect(existsSync(pagePath), `Spec calls for /biz/${route}`).toBe(true);
    }
  });

  it("every Convex query file under convex/queries/business/ has a matching __tests__ file", () => {
    const QUERY_FILES = ["today", "jobs", "reviews", "posts", "customers", "profile"];
    for (const f of QUERY_FILES) {
      const queryPath = resolve(
        REPO_ROOT,
        `convex/queries/business/${f}.ts`
      );
      expect(existsSync(queryPath), `Query file ${f}.ts must exist`).toBe(true);
    }
    // Test files exist for the major surfaces (today, jobs, profile, and a
    // combined reviews/posts/customers file).
    const TEST_FILES = [
      "convex/queries/business/__tests__/today.test.ts",
      "convex/queries/business/__tests__/jobs.test.ts",
      "convex/queries/business/__tests__/profile.test.ts",
      "convex/queries/business/__tests__/reviewsPostsCustomers.test.ts",
    ];
    for (const t of TEST_FILES) {
      expect(existsSync(resolve(REPO_ROOT, t)), `Test file ${t} must exist`).toBe(true);
    }
  });
});

describe("TODO grep — Wave C HQ UI", () => {
  it("no TODO/FIXME/eslint-disable without justification in Wave C files", () => {
    const TARGETS = [
      "app/(business)/biz/today/page.tsx",
      "app/(business)/biz/jobs/page.tsx",
      "app/(business)/biz/reviews/page.tsx",
      "app/(business)/biz/posts/page.tsx",
      "app/(business)/biz/customers/page.tsx",
      "app/(business)/biz/profile/page.tsx",
      "convex/queries/business/today.ts",
      "convex/queries/business/jobs.ts",
      "convex/queries/business/reviews.ts",
      "convex/queries/business/posts.ts",
      "convex/queries/business/customers.ts",
      "convex/queries/business/profile.ts",
      "convex/queries/business/_session.ts",
    ];
    for (const target of TARGETS) {
      const path = resolve(REPO_ROOT, target);
      if (!existsSync(path)) continue;
      const src = readFileSync(path, "utf8");
      // Permit the literal strings in test files / docs but not in our source.
      // Allow `eslint-disable` only when followed by a `--` comment justification
      // (Next.js no-img-element exemption pattern used in JobDetailPanel).
      expect(src, `${target} contains plain TODO`).not.toMatch(/\bTODO\b/);
      expect(src, `${target} contains plain FIXME`).not.toMatch(/\bFIXME\b/);
      const eslintDisables = Array.from(src.matchAll(/eslint-disable[^\n]*/g));
      for (const m of eslintDisables) {
        expect(m[0], `${target} eslint-disable needs justification`).toMatch(
          /--/
        );
      }
    }
  });
});
