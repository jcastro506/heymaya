import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const signIn = readFileSync(new URL("../../sign-in/[[...sign-in]]/page.tsx", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../../../proxy.ts", import.meta.url), "utf8");

// Sign-up, onboarding and the old web screens live in the iPhone app now (app spec §5, M3).
describe("the web hands people to the app", () => {
  it("sends the retired web screens to the app download", () => {
    expect(proxy).toMatch(/isRetired = createRouteMatcher\(\["\/sign-up\(\.\*\)", "\/start\(\.\*\)", "\/app\(\.\*\)"\]\)/);
    expect(proxy).toContain('NextResponse.redirect(new URL("/join?where=web", req.url))');
  });

  it("keeps web sign-in only as plumbing (the calendar hand-off), landing on the app download", () => {
    expect(signIn).toContain('fallbackRedirectUrl="/join?where=signin"');
    expect(signIn).not.toContain("forceRedirectUrl");
    expect(proxy).toContain("auth.protect()");
  });
});
