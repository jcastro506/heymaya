/**
 * Maya v2 — Zernio webhook profile-id extraction.
 *
 * The live `account.connected` payload shape isn't pinned (Zernio docs don't
 * publish the full body), and profileId comes back as a bare string in some
 * places and a nested `{ _id, name, slug }` object in others (the accounts list
 * uses the nested form). The webhook routes to the owning agent BY profile id,
 * so this extractor is load-bearing — it must find the id across the plausible
 * shapes rather than assume one path.
 */

import { describe, expect, it } from "vitest";
import { extractProfileId } from "../zernioWebhook";

describe("extractProfileId", () => {
  it("finds a bare-string profileId at the top level", () => {
    expect(extractProfileId({ profileId: "prof_1" })).toBe("prof_1");
  });

  it("finds a nested-object profileId ({ _id })", () => {
    expect(
      extractProfileId({ profileId: { _id: "prof_2", name: "x", slug: "x" } })
    ).toBe("prof_2");
  });

  it("finds profileId nested under account", () => {
    expect(extractProfileId({ account: { profileId: "prof_3" } })).toBe(
      "prof_3"
    );
  });

  it("finds profileId nested under data.account as an object", () => {
    expect(
      extractProfileId({ data: { account: { profileId: { _id: "prof_4" } } } })
    ).toBe("prof_4");
  });

  it("returns null when no profileId is present", () => {
    expect(extractProfileId({ foo: 1, bar: { baz: "x" } })).toBeNull();
  });

  it("returns null for non-objects", () => {
    expect(extractProfileId(null)).toBeNull();
    expect(extractProfileId("prof")).toBeNull();
    expect(extractProfileId(42)).toBeNull();
  });

  it("ignores an empty-string profileId and keeps searching", () => {
    expect(
      extractProfileId({ profileId: "", data: { profileId: "prof_5" } })
    ).toBe("prof_5");
  });
});
