/** The onboarding-read sim can't touch a real creator or run on production. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { OR_PREFIX } from "../onboardingRead";

describe("the onboarding-read simulation's guards", () => {
  const src = readFileSync(new URL("../onboardingRead.ts", import.meta.url), "utf8");
  it("refuses production, scopes every read and delete to its own run, and deletes by index", () => {
    expect(OR_PREFIX).toBe("eval-run:or-");
    expect(src).toMatch(/ENVIRONMENT_NAME === "production"/);
    expect(src).toMatch(/refusing to delete a creator outside the simulation/);
    expect(src).toMatch(/\^or-\[a-z0-9\]\+\$/);
    expect(src).toMatch(/withIndex\(index/); // never a table scan (account deletion's purge hit the 16 MB limit on dev)
    expect(src).not.toMatch(/TODO|FIXME/);
  });
});
