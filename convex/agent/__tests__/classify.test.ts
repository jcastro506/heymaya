import { describe, expect, it } from "vitest";

describe("a brand in words is not an account lookup (deals sim)", () => {
  it("only an @handle, a profile link, or a handle-shaped token counts", async () => {
    const { namesAnAccount } = await import("../classify");
    expect(namesAnAccount("why is @andi.renay growing so fast", "andi.renay")).toBe(true);
    expect(namesAnAccount("why is andi.renay growing", "andi.renay")).toBe(true);
    expect(namesAnAccount("look at https://www.tiktok.com/@runwithcarly", "runwithcarly")).toBe(true);
    expect(namesAnAccount("can you research arcadia socks for me?", "arcadiasocks")).toBe(false);
    expect(namesAnAccount("what about verdant greens?", "verdantgreens")).toBe(false);
    expect(namesAnAccount("let's go after northline", "northline")).toBe(false);
  });
});

describe("the numbers check skips links (deals sim)", () => {
  it("a post id in a URL is not a number she claimed", async () => {
    const { numbersIn } = await import("../../eval/dealsWorldData");
    expect(numbersIn("broke 3:30, video https://www.tiktok.com/@s/video/7777777777777777773 got 12k views")).toEqual([3, 30, 12_000]);
  });
});

describe("an unmistakable watch request never needs the model (scale test)", () => {
  it("reads the ways people ask, on both platforms", async () => {
    const { obviousWatch } = await import("../classify");
    const own = { tiktok: "me_tt" };
    expect(obviousWatch("add @duckinvaders to my list", own)).toEqual({ intent: "manage", action: "add_admired", platform: "tiktok", handle: "duckinvaders" });
    expect(obviousWatch("can you keep an eye on @sbc_derm on instagram for me", own)).toMatchObject({ action: "add_admired", platform: "instagram", handle: "sbc_derm" });
    expect(obviousWatch("add @blameytwins (instagram) to my list", own)).toMatchObject({ platform: "instagram" });
    expect(obviousWatch("watch @naomiyoga on insta", own)).toMatchObject({ platform: "instagram" });
    expect(obviousWatch("stop watching @x.y", own)).toEqual({ intent: "manage", action: "stop_watching", handle: "x.y" });
  });
  it("leaves anything less clear to the model", async () => {
    const { obviousWatch } = await import("../classify");
    expect(obviousWatch("add @brand to the caption", {})).toBeNull();
    expect(obviousWatch("why is @x blowing up", {})).toBeNull();
    expect(obviousWatch("watch @me_tt", { tiktok: "me_tt" })).toBeNull();
    expect(obviousWatch("i watched @x's video and loved it", {})).toBeNull();
  });
});
