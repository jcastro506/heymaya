/**
 * Delete-account: soft-deletes the caller's own account AND makes it fail-closed
 * on every subsequent dashboard read (the backstop behind the client sign-out +
 * redirect-to-landing). Cross-tenant: A's delete never touches B.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

function authed(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
}

async function setup(t: ReturnType<typeof convexTest>, subject: string) {
  const a = authed(t, subject);
  await a.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {
    channelPreference: "telegram",
    timezone: "America/New_York",
  });
  return a;
}

describe("deleteMyGtmAccount", () => {
  it("soft-deletes, then the account fails closed on dashboard reads", async () => {
    const t = convexTest(schema, modules);
    const me = await setup(t, "del_me");
    // Active account is readable.
    expect(
      await me.query(api.gtmMaya.missionControl.getMyAccount, {})
    ).not.toBeNull();
    // Delete succeeds.
    expect(
      (await me.mutation(api.gtmMaya.missionControl.deleteMyGtmAccount, {})).ok
    ).toBe(true);
    // Now every read resolves to null (resolveMyGtmCreator gates on deleted).
    expect(
      await me.query(api.gtmMaya.missionControl.getMyAccount, {})
    ).toBeNull();
  });

  it("a second delete is a no-op (already deleted → ok:false)", async () => {
    const t = convexTest(schema, modules);
    const me = await setup(t, "del_twice");
    expect(
      (await me.mutation(api.gtmMaya.missionControl.deleteMyGtmAccount, {})).ok
    ).toBe(true);
    expect(
      (await me.mutation(api.gtmMaya.missionControl.deleteMyGtmAccount, {})).ok
    ).toBe(false);
  });

  it("is cross-tenant isolated — A's delete never affects B", async () => {
    const t = convexTest(schema, modules);
    const a = await setup(t, "del_a");
    const b = await setup(t, "del_b");
    await a.mutation(api.gtmMaya.missionControl.deleteMyGtmAccount, {});
    // B is untouched + still fully readable.
    expect(
      await b.query(api.gtmMaya.missionControl.getMyAccount, {})
    ).not.toBeNull();
    expect(
      await a.query(api.gtmMaya.missionControl.getMyAccount, {})
    ).toBeNull();
  });
});
