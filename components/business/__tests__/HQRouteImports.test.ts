/**
 * HQ route import smoke — substitute for the Playwright e2e shell since
 * Playwright isn't wired in this repo.
 *
 * Each of the 6 HQ page modules imports `convex/react`'s `useQuery` and
 * resolves through `@/convex/_generated/api`. If any of those imports fail
 * (typo in api path, broken re-export, missing component), the dynamic
 * import at the top of this test will throw and the test fails.
 *
 * This catches the most common breakage: agent X renames a query module
 * and agent Y's page still imports the old name.
 */

import { describe, it, expect } from "vitest";

const HQ_ROUTES = [
  "../../../app/(business)/biz/today/page",
  "../../../app/(business)/biz/jobs/page",
  "../../../app/(business)/biz/reviews/page",
  "../../../app/(business)/biz/posts/page",
  "../../../app/(business)/biz/customers/page",
  "../../../app/(business)/biz/profile/page",
] as const;

describe("HQ route module imports", () => {
  for (const path of HQ_ROUTES) {
    it(`${path} imports cleanly`, async () => {
      const mod = await import(/* @vite-ignore */ path);
      expect(mod.default).toBeTypeOf("function");
    });
  }
});
