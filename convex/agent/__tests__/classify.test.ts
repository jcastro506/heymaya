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
