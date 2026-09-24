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

describe("the advice", () => {
  it("only a personal Instagram NEEDS to change; TikTok is never pushed to business", () => {
    expect(setupAdvice("instagram", "personal")?.needed).toBe(true);
    expect(setupAdvice("instagram", "personal")?.steps.join(" ")).toContain("Creator");
    expect(setupAdvice("instagram", "creator")).toBeNull();
    expect(setupAdvice("instagram", "business")?.needed).toBe(false);
    expect(setupAdvice("tiktok", "personal")).toBeNull();
    expect(setupAdvice("tiktok", "business")?.needed).toBe(false);
    expect(setupAdvice("tiktok", null)).toBeNull();
    for (const t of ["personal", "business"] as const) for (const p of ["instagram", "tiktok"] as const) expect(JSON.stringify(setupAdvice(p, t) ?? "")).not.toMatch(/\bAI\b|Zernio|ScrapeCreators/);
  });
});
