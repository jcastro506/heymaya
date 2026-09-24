import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const signIn = readFileSync(new URL("../../sign-in/[[...sign-in]]/page.tsx", import.meta.url), "utf8");
const signUp = readFileSync(new URL("../../sign-up/[[...sign-up]]/page.tsx", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../../../proxy.ts", import.meta.url), "utf8");

describe("Mission Control deep-link authentication", () => {
  it("preserves Clerk's requested return URL and only falls back to onboarding", () => {
    expect(signIn).toContain('fallbackRedirectUrl="/start"');
    expect(signIn).not.toContain("forceRedirectUrl");
    expect(signUp).toContain('fallbackRedirectUrl="/start"');
    expect(signUp).not.toContain("forceRedirectUrl");
  });

  it("keeps Mission Control behind authentication", () => {
    expect(proxy).not.toMatch(/\"\/app(?:\(\.\*\))?\"/);
    expect(proxy).toContain("auth.protect()");
  });
});
