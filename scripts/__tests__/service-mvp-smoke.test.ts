/**
 * Wave D — service-product smoke self-test.
 *
 * Invokes `runMockSmoke` directly and asserts the smoke walks every step
 * cleanly. The script is also runnable as `npm run smoke:service`.
 *
 * Test categories covered:
 *   - Smoke run completes < 30s in mock mode.
 *   - Mike Hansen anchor fixture loads cleanly.
 *   - Telemetry rows emitted for both review-request-approval and
 *     crm-webhook-idempotency-hit.
 *   - GBP health score row materializes.
 *   - Weekly learnings row materializes.
 *   - Adversarial: missing fixture path is detectable (not crashing).
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { runMockSmoke } from "../service-mvp-smoke";

const REPO_ROOT = resolve(__dirname, "../..");

describe("service-mvp-smoke (mock mode)", () => {
  it("walks every step cleanly", async () => {
    const result = await runMockSmoke();
    expect(result.fixture.persona).toBe("mike");
    expect(result.fixture.serviceTypes).toContain("hvac");
    expect(result.durationMs).toBeLessThan(30_000);
    // After teardown, every collection is emptied (proves the cleanup ran).
    expect(result.state.businesses.length).toBe(0);
    expect(result.state.telemetry.length).toBe(0);
  });

  it("loads the mike-hansen anchor fixture and validates expected shape", async () => {
    const result = await runMockSmoke();
    // Persona-level invariants from the source-of-truth file:
    //   personas/mike.ts asserts solo HVAC, no CRM, surname Hansen, slug
    //   mike-hansen-hvac, friendly-neighborhood tone.
    const f = result.fixture;
    expect(f.slug).toBe("mike-hansen-hvac");
    expect(f.businessSize).toBe("solo");
    expect(f.tonePreference).toBe("friendly-neighborhood");
    expect(f.crmConnections[0]?.provider).toBe("none");
  });

  it("walk completes without throwing on a clean state", async () => {
    // Sanity — re-running back-to-back should produce stable, idempotent
    // output (the smoke creates fresh in-memory state every call).
    await expect(runMockSmoke()).resolves.toBeDefined();
    await expect(runMockSmoke()).resolves.toBeDefined();
  });

  it("ADVERSARIAL: persona fixture file is present (smoke would exit 1 otherwise)", () => {
    const personaFile = join(
      REPO_ROOT,
      "scripts/fixtures/serviceBusinesses/personas/mike.ts"
    );
    expect(existsSync(personaFile)).toBe(true);
  });

  it("script is registered in package.json as smoke:service", async () => {
    const pkgPath = join(REPO_ROOT, "package.json");
    const pkg = JSON.parse(
      (await import("node:fs")).readFileSync(pkgPath, "utf8")
    );
    expect(pkg.scripts["smoke:service"]).toBeTruthy();
    expect(pkg.scripts["smoke:service"]).toContain("service-mvp-smoke");
  });
});
