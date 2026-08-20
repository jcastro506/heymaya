/**
 * The first hour. Every assertion here is about a founder who is watching.
 */
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import {
  HELLO_BRIEF,
  HOMEWORK_BRIEF,
  THIN_BRIEF,
  MACHINE_WAIT_MS,
  HOMEWORK_WAIT_MS,
} from "../firstRun";

describe("⭐ SHE INTRODUCES HERSELF EXACTLY ONCE", () => {
  it("a founder already introduced to is never introduced to again", async () => {
    /**
     * The retry loop requeues itself while the machine boots, so without a
     * durable marker every requeue is another introduction. v1's own kickstart
     * recorded why the marker cannot live in MEMORY.md: it is wiped on restart.
     */
    const t = convexTest(schema, modules);
    const customerId = await t.run(async (ctx) => {
      const accountId = await ctx.db.insert("creators", {
        clerkUserId: "u1",
        email: "f@example.com",
        channelPreference: "web",
        timezone: "UTC",
        status: "onboarding",
        plan: "coach",
        createdAt: 1,
      } as never);
      return ctx.db.insert("customers", {
        accountId,
        agentVersion: "v2",
        plan: "mvp",
        state: "active",
        timezone: "UTC",
        telegramChatId: "123",
        helloSentAt: 1_700_000_000_000,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const res = await t.action(internal.maya.firstRun.kickoff, { customerId });
    expect(res.ok).toBe(true);
    expect(res.detail).toBe("already introduced");
  });

  it("marks the intro sent so the marker survives a restart", async () => {
    const t = convexTest(schema, modules);
    const customerId = await t.run(async (ctx) => {
      const accountId = await ctx.db.insert("creators", {
        clerkUserId: "u2",
        email: "g@example.com",
        channelPreference: "web",
        timezone: "UTC",
        status: "onboarding",
        plan: "coach",
        createdAt: 1,
      } as never);
      return ctx.db.insert("customers", {
        accountId,
        agentVersion: "v2",
        plan: "mvp",
        state: "active",
        timezone: "UTC",
        telegramChatId: "123",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await t.mutation(internal.maya.firstRun.markHelloSent, {
      customerId,
      now: 42,
    });
    const row = await t.run(async (ctx) => ctx.db.get(customerId));
    expect((row as { helloSentAt?: number }).helloSentAt).toBe(42);
  });
});

describe("⚠️ THE BRIEFS ARE BRIEFS, NOT SCRIPTS", () => {
  /**
   * ⚠️ Asserted on INSTRUCTIONS, never on the words she ends up saying — her
   * output is generated prose and a test that substring-matches it is a
   * false-alarm generator. What must hold is what she is TOLD.
   */
  it("the intro demands a specific true detail, because a template reads canned", () => {
    // v1 named the exact failure: "getting the foundation for [product] ready
    // to drive [goal]" references nothing real. The product name is not proof.
    expect(HELLO_BRIEF).toMatch(/PROVE YOU READ THEIR PRODUCT/);
    expect(HELLO_BRIEF).toMatch(/NAME alone is not proof/i);
  });

  it("the intro promises no deadline", () => {
    // A missed "15 minutes" is worse than no number at all.
    expect(HELLO_BRIEF).toMatch(/Do NOT promise a number of minutes/i);
  });

  it("the intro says the work in the founder's language, not ours", () => {
    expect(HELLO_BRIEF).toMatch(/Do NOT list your tools, skills, or internal steps/i);
  });

  it("⭐ the intro makes clear nothing gets locked in without them", () => {
    // The founder just handed over their accounts. The conversation staying
    // open is the thing that makes that survivable.
    expect(HELLO_BRIEF).toMatch(/nothing gets locked in without them/i);
  });

  it("the report leads with days-running, which is the whole signal", () => {
    expect(HOMEWORK_BRIEF).toMatch(/ad_intel/);
    expect(HOMEWORK_BRIEF).toMatch(/HOW LONG/);
  });

  it("⭐ a thin week is reported as thin, never padded", () => {
    expect(HOMEWORK_BRIEF).toMatch(/IF IT IS THIN, SAY SO/);
    expect(HOMEWORK_BRIEF).toMatch(/Never pad this/i);
  });

  it("and the report ends by asking, not by deciding", () => {
    expect(HOMEWORK_BRIEF).toMatch(/Nothing is locked in/i);
  });

  it("⭐ SHE STILL SPEAKS WHEN THE HOMEWORK COMES BACK EMPTY", () => {
    // Silence after a promise teaches the founder something false about her.
    expect(THIN_BRIEF).toMatch(/hard to read|not come back with anything usable/i);
    expect(THIN_BRIEF).toMatch(/who do they lose deals to/i);
  });
});

describe("the waits are bounded", () => {
  it("gives up on a machine that never boots rather than retrying forever", () => {
    expect(MACHINE_WAIT_MS).toBeGreaterThan(0);
    expect(MACHINE_WAIT_MS).toBeLessThanOrEqual(60 * 60_000);
  });

  it("waits longer for the homework than a flat guess would", () => {
    // The first draft fired the report on a 3-minute timer while
    // `learnBusiness` runs ~12 live searches — it would have reported an empty
    // niche on the one day the founder was watching.
    expect(HOMEWORK_WAIT_MS).toBeGreaterThan(10 * 60_000);
  });
});

describe("⚠️ MISSION CONTROL KNOWS SHE IS DEPLOYED", () => {
  /**
   * `myState.deployed` read `creator.mayaFlyAppId` — a field read in two places
   * and written in NONE. `deployMachine` patches `flyAppName` onto the customer.
   * So this was permanently false: Mission Control showed a founder that Maya
   * had never been deployed while her machine was up and running crons.
   *
   * A field that only ever reads null renders as an EMPTY state rather than a
   * broken one, which is why it survived every test asserting on shape.
   */
  async function seed(t: ReturnType<typeof convexTest>, fly?: string) {
    return t.run(async (ctx) => {
      const accountId = await ctx.db.insert("creators", {
        clerkUserId: "u_deployed",
        email: "d@example.com",
        channelPreference: "web",
        timezone: "UTC",
        status: "onboarding",
        plan: "coach",
        createdAt: 1,
      } as never);
      await ctx.db.insert("customers", {
        accountId,
        agentVersion: "v2",
        plan: "mvp",
        state: "active",
        timezone: "UTC",
        telegramChatId: "123",
        ...(fly ? { flyAppName: fly } : {}),
        createdAt: 1,
        updatedAt: 1,
      });
      return accountId;
    });
  }

  it("reports deployed once the machine exists", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "maya-precisecanary781-abc");
    const state = await t
      .withIdentity({ subject: "u_deployed" })
      .query(api.maya.setup.myState, {});
    expect(state.deployed).toBe(true);
    expect(state.flyAppId).toBe("maya-precisecanary781-abc");
  });

  it("and still reports NOT deployed before there is one", async () => {
    // The fix must not make the flag always-true, which would hide a real
    // failed deploy behind a green tick.
    const t = convexTest(schema, modules);
    await seed(t);
    const state = await t
      .withIdentity({ subject: "u_deployed" })
      .query(api.maya.setup.myState, {});
    expect(state.deployed).toBe(false);
  });
});
