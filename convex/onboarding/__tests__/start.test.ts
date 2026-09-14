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
});
