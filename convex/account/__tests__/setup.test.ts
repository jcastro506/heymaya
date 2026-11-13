/** A1 account setup: the account type from public profile flags, and the one piece of advice per platform. */
import { describe, expect, it } from "vitest";
import { setupAdvice } from "../setup";
import { igAccountType } from "../../integrations/scrapeCreators/platforms/instagram";
import { tiktokAccountType } from "../../integrations/scrapeCreators/platforms/tiktok";

describe("account type from the public profile", () => {
  it("Instagram: personal, creator, business, unknown", () => {
    expect(igAccountType({ is_professional_account: false, is_business_account: false })).toBe("personal");
    expect(igAccountType({ is_professional_account: true, is_business_account: false })).toBe("creator");
    expect(igAccountType({ is_professional_account: true, is_business_account: true })).toBe("business");
    expect(igAccountType({})).toBeNull();
  });
  it("TikTok: a commerce user is business; unknown stays unknown", () => {
    expect(tiktokAccountType({ commerceUserInfo: { commerceUser: true } })).toBe("business");
    expect(tiktokAccountType({ commerceUserInfo: { commerceUser: false } })).toBe("personal");
    expect(tiktokAccountType({})).toBeNull();
  });
});

