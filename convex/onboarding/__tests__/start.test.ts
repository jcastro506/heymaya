import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";
import { modules } from "../../../tests/_modules";

describe("mobile onboarding tenant bootstrap", () => {
  it("creates one resumable creator before checkout without inventing a social handle", async () => {
    const t = convexTest(schema, modules);
    const asCreator = t.withIdentity({ subject: "mobile-user", email: "mobile@example.com" });
    const first = await asCreator.mutation(api.onboarding.start.ensureCreator, { timezone: "America/New_York" });
    const second = await asCreator.mutation(api.onboarding.start.ensureCreator, { timezone: "America/Chicago" });
    expect(first.ok).toBe(true);
    expect(second.creatorId).toBe(first.creatorId);
    const rows = await t.run((ctx) => ctx.db.query("creators").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].handles).toEqual({});
    expect(rows[0].timezone).toBe("America/New_York");
    expect(rows[0].channel.kind).toBe("imessage");
    expect(rows[0].plan.status).toBe("onboarding");
  });

  it("what Maya should call them: pre-filled from sign-in, confirmed only by them, cleaned, and only their own row", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity({ subject: "name-a", email: "a@example.com", givenName: "adina" });
    const b = t.withIdentity({ subject: "name-b", email: "b@example.com" });
    await a.mutation(api.onboarding.start.ensureCreator, { timezone: "America/New_York" });
    await b.mutation(api.onboarding.start.ensureCreator, { timezone: "America/New_York" });

    const before = await a.query(api.onboarding.start.progress, {});
    expect(before?.firstName).toBe("Adina");
    expect(before?.nameConfirmed).toBe(false);

    // Adversarial: junk is refused and nothing changes.
    for (const junk of ["", "   ", "<script>", "1234", "x".repeat(80)]) {
      const r = await a.mutation(api.onboarding.start.setName, { firstName: junk });
      expect(r.ok).toBe(false);
    }
    expect((await a.query(api.onboarding.start.progress, {}))?.nameConfirmed).toBe(false);

    const ok = await a.mutation(api.onboarding.start.setName, { firstName: "  dee  " });
    expect(ok).toMatchObject({ ok: true, firstName: "Dee" });
    const after = await a.query(api.onboarding.start.progress, {});
    expect(after).toMatchObject({ firstName: "Dee", nameConfirmed: true });

    // Cross-tenant: b's row is untouched.
    const theirs = await b.query(api.onboarding.start.progress, {});
    expect(theirs?.nameConfirmed).toBe(false);
    expect(theirs?.firstName ?? null).not.toBe("Dee");

    // Signed out: refused.
    expect((await t.mutation(api.onboarding.start.setName, { firstName: "Dee" })).ok).toBe(false);
  });
});
