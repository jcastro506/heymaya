/**
 * §27: discovery reads return profiles. Built from the recorded vendor responses, so a field
 * rename at the vendor fails here, not silently on a signup's empty screen.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { instagramSearchProfiles, profilesOf, profilesResult, tiktokFollowingProfiles, tiktokPopularProfiles } from "../profiles";
import { slimForCache } from "../read";

const SPEC = JSON.parse(readFileSync(new URL("../../integrations/scrapeCreators/fixtures.spec.json", import.meta.url), "utf8")) as Record<string, unknown>;

describe("discovered profiles", () => {
  it("TikTok's popular creators: the handle comes out of the profile link", () => {
    const p = tiktokPopularProfiles(SPEC["/v1/tiktok/creators/popular"]);
    expect(p.length).toBeGreaterThan(0);
    expect(p[0]).toMatchObject({ platform: "tiktok", handle: "sanievv_", displayName: "SANIEV", followerCount: 431339, isPrivate: false });
    expect(p[0].avatarUrl).toMatch(/^https:/);
  });

  it("TikTok following and Instagram search read their own field names", () => {
    const f = tiktokFollowingProfiles(SPEC["/v1/tiktok/user/following"]);
    expect(f[0]).toMatchObject({ platform: "tiktok", handle: "barstoolbeachhouse", followerCount: 2175 });
    const i = instagramSearchProfiles(SPEC["/v1/instagram/search/profiles"]);
    expect(i[0]).toMatchObject({ platform: "instagram", handle: "charliejohnsonfitness" });
    expect(typeof i[0].isPrivate).toBe("boolean");
  });

  it("adversarial: junk, missing arrays and handle-less rows give nothing, never a throw", () => {
    for (const bad of [null, undefined, "x", 42, {}, { creators: "no" }, { creators: [null, { tt_link: "https://tiktok.com/nobody" }] }]) {
      expect(tiktokPopularProfiles(bad)).toEqual([]);
    }
    expect(instagramSearchProfiles({ profiles: [{ username: "" }, { username: "@Real.One" }] }).map((p) => p.handle)).toEqual(["real.one"]);
  });

  it("the stored value keeps its profiles and what the vendor charged, and the cache no longer strips them", () => {
    const v = profilesResult({ source: "tiktok_popular_creators", raw: SPEC["/v1/tiktok/creators/popular"] }, tiktokPopularProfiles);
    expect(v.credits_charged).toBe(1);
    expect(JSON.stringify(v)).not.toContain("tcm_link");
    const cached = slimForCache(v);
    expect(profilesOf(cached)?.length, "the pre-§27 bug: raw results lost everything in the cache").toBe(v.profiles.length);
    expect(profilesOf({ source: "x", query: {} }), "a row cached before §27 reads as missing, so it is re-read").toBeNull();
  });

  it("sibling coherence: the three kinds normalize, and the belt formatter reads the same field", () => {
    const kinds = readFileSync(new URL("../kinds.ts", import.meta.url), "utf8");
    expect(kinds.match(/profilesResult\(/g)?.length, "each discovery kind stores normalized profiles").toBeGreaterThanOrEqual(3);
    for (const fn of ["tiktokFollowingProfiles", "tiktokPopularProfiles", "instagramSearchProfiles"]) expect(kinds.split(fn).length - 1, `${fn} imported and used`).toBeGreaterThanOrEqual(2);
    expect(readFileSync(new URL("../../agent/tools.ts", import.meta.url), "utf8")).toMatch(/\?\.profiles \?\?/);
  });
});
