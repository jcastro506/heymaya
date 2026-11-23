/** A1 account setup: the account type from public profile flags, and the one piece of advice per platform. */
import { describe, expect, it } from "vitest";
import { setupAdvice } from "../setup";
import { tiktokAccountType } from "../../integrations/scrapeCreators/platforms/tiktok";

describe("account type from the public profile", () => {
  it("TikTok: a commerce user is business; unknown stays unknown", () => {
    expect(tiktokAccountType({ commerceUserInfo: { commerceUser: true } })).toBe("business");
    expect(tiktokAccountType({ commerceUserInfo: { commerceUser: false } })).toBe("personal");
    expect(tiktokAccountType({})).toBeNull();
  });
});

describe("setup advice", () => {
  it("TikTok business gets the one optional switch; an old Instagram row gets nothing", () => {
    expect(setupAdvice("tiktok", "business")).toMatchObject({ needed: false });
    expect(setupAdvice("tiktok", "personal")).toBeNull();
    for (const t of ["personal", "creator", "business", null] as const) expect(setupAdvice("instagram", t)).toBeNull();
  });
});
