import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import {
  buildMachineConfig,
  generateAgentToken,
  REQUIRED_SECRET_NAMES,
  VOLUME_MOUNT_PATH,
} from "../deploy";
import { hashToken } from "../hooks";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 1, 9, 0, 0);
const CONFIG = buildMachineConfig({
  image: "registry.fly.io/heymaya-openclaw:v1",
  customerId: "cust_1",
});

describe("AUTO-STOP IS THE COST LEVER, AND IT IS ON", () => {
  it("the service stops on idle and starts on demand", () => {
    // §17.36.1 — ~$100–400/mo at 200 customers instead of $1,400–3,000. A
    // machine thinks for roughly 45 minutes a day; always-on bills for 24 hours
    // of idle to serve it.
    const service = CONFIG.services![0];
    expect(service.autostop).toBe("stop");
    expect(service.autostart).toBe(true);
  });

  it("min_machines_running is ZERO", () => {
    // Any other value silently reinstates always-on billing for that many
    // machines — the lever looks pulled and isn't.
    expect(CONFIG.services![0].min_machines_running).toBe(0);
  });

  it("the restart policy does not fight auto-stop", () => {
    // `always` restarts a machine Fly deliberately stopped, which converts this
    // back into an always-on machine at ten times the price while every setting
    // above still reads as correct. The subtlest way to lose the lever.
    expect(CONFIG.restart?.policy).toBe("on-failure");
    expect(CONFIG.restart?.policy).not.toBe("always");
  });

  it("shared multi-tenant is not what this builds", () => {
    // One crash would take out N customers, and session isolation is the whole
    // premise of "an employee". The metadata pins one customer per machine.
    expect(CONFIG.metadata?.customerId).toBe("cust_1");
    expect(CONFIG.metadata?.agentVersion).toBe("v2");
  });
});

describe("the session survives a redeploy", () => {
  it("mounts a persistent volume for OpenClaw's state", () => {
    // Sprint 2's exit is "she answers from rows, ACROSS A REDEPLOY". Volumes
    // are independent of machines, so a destroy/recreate keeps the session —
    // without this, every deploy is total amnesia.
    expect(CONFIG.mounts).toHaveLength(1);
    expect(CONFIG.mounts![0].path).toBe(VOLUME_MOUNT_PATH);
  });

  it("points OpenClaw's state dir at the mount, not the ephemeral root", () => {
    // Mounting a volume nothing writes to is the failure that looks fixed.
    expect(CONFIG.env?.OPENCLAW_STATE_DIR).toBe(VOLUME_MOUNT_PATH);
  });
});

describe("SECRETS NEVER ENTER THE MACHINE CONFIG", () => {
  it("no secret NAME appears as an env key", () => {
    // A Fly machine config is readable back through the API, so anything in
    // config.env is retrievable by anyone who can read the machine.
    for (const name of REQUIRED_SECRET_NAMES) {
      expect(Object.keys(CONFIG.env ?? {}), `${name} is in env`).not.toContain(
        name
      );
    }
  });

  it("A CALLER CANNOT SMUGGLE A SECRET IN THROUGH publicEnv", () => {
    // The signature takes no secret values, but `publicEnv` is a hole if nobody
    // looks — and the first version of this test asserted the leak was possible
    // under a name claiming it wasn't. A test that documents a leak as
    // acceptable is worse than no test, so the hole was closed instead.
    const smuggled = buildMachineConfig({
      image: "img",
      customerId: "c",
      publicEnv: { MAYA_AGENT_TOKEN: "tok_leaked", HARMLESS: "keep-me" },
    });
    const serialized = JSON.stringify(smuggled);
    expect(serialized).not.toContain("tok_leaked");
    expect(smuggled.env?.MAYA_AGENT_TOKEN).toBeUndefined();
    // Every secret name, not just the one that happens to be first.
    for (const name of REQUIRED_SECRET_NAMES) {
      const leak = buildMachineConfig({
        image: "img",
        customerId: "c",
        publicEnv: { [name]: "leaked-value" },
      });
      expect(JSON.stringify(leak), `${name} leaked`).not.toContain("leaked-value");
    }
    // And non-secret settings still pass through — the filter must not be a
    // blanket drop that silently loses real configuration.
    expect(smuggled.env?.HARMLESS).toBe("keep-me");
  });

  it("nothing token-shaped is in the config by default", () => {
    const serialized = JSON.stringify(CONFIG);
    expect(serialized).not.toMatch(/[0-9a-f]{64}/);
    expect(serialized).not.toMatch(/sk-|Bearer /);
  });
});

describe("the agent credential", () => {
  it("is 256 bits of real randomness, hex encoded", () => {
    const token = generateAgentToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    // Two mints must differ — a constant would authenticate every tenant as one.
    expect(generateAgentToken()).not.toBe(token);
  });

  it("IS STORED HASHED AND IS NOT RECOVERABLE", async () => {
    // A database read must not yield the ability to act as somebody's agent.
    // Nothing, including us, can read the token back — a lost one is re-minted.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "tok");
    const token = generateAgentToken();
    await t.mutation(internal.maya.deploy.storeAgentTokenHash, {
      customerId,
      tokenHash: await hashToken(token),
    });

    const row = (await t.run((ctx) => ctx.db.get(customerId))) as Doc<"customers">;
    expect(row.agentTokenHash).not.toBe(token);
    expect(row.agentTokenHash).toBe(await hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("the stored hash is what the tool surface authenticates against", async () => {
    // The round-trip that matters: mint here, authenticate there.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "roundtrip");
    const token = generateAgentToken();
    await t.mutation(internal.maya.deploy.storeAgentTokenHash, {
      customerId,
      tokenHash: await hashToken(token),
    });

    const resolved = await t.query(internal.maya.hooks.customerByTokenHash, {
      tokenHash: await hashToken(token),
    });
    expect(resolved?._id).toBe(customerId);
    // And a different token resolves to nobody.
    expect(
      await t.query(internal.maya.hooks.customerByTokenHash, {
        tokenHash: await hashToken(generateAgentToken()),
      })
    ).toBeNull();
  });

  it("re-minting replaces the old credential rather than adding one", async () => {
    // Two live tokens for one account would mean revoking one achieves nothing.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "remint");
    const first = generateAgentToken();
    const second = generateAgentToken();
    await t.mutation(internal.maya.deploy.storeAgentTokenHash, {
      customerId,
      tokenHash: await hashToken(first),
    });
    await t.mutation(internal.maya.deploy.storeAgentTokenHash, {
      customerId,
      tokenHash: await hashToken(second),
    });

    expect(
      await t.query(internal.maya.hooks.customerByTokenHash, {
        tokenHash: await hashToken(first),
      })
    ).toBeNull();
    expect(
      (
        await t.query(internal.maya.hooks.customerByTokenHash, {
          tokenHash: await hashToken(second),
        })
      )?._id
    ).toBe(customerId);
  });
});

describe("the workspace is built from ROWS, not arguments", () => {
  it("reads the founder, product, and channels out of the database", async () => {
    // A deploy that took product truth as an argument could ship a machine that
    // disagrees with the database, and the database is the truth.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "ws", {
      productTruthJson: JSON.stringify({
        name: "Widgetly",
        url: "https://widgetly.dev",
        truth: "turns a CSV into a dashboard",
      }),
    });
    await addChannel(t, customerId, "x", "connected");

    const input = await t.query(internal.maya.deploy.workspaceInput, {
      customerId,
    });
    expect(input?.product.name).toBe("Widgetly");
    expect(input?.product.truth).toBe("turns a CSV into a dashboard");
    expect(input?.channels).toEqual([{ channel: "x", postingMode: "just_go" }]);
  });

  it("DORMANT AND DISCONNECTED CHANNELS SHIP NO NORMS", async () => {
    // Carrying context for a channel she can't post to spends budget to make
    // her worse — she plans around something with no live grant.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "dormant");
    await addChannel(t, customerId, "x", "connected");
    await addChannel(t, customerId, "tiktok", "dormant");
    await addChannel(t, customerId, "instagram", "disconnected");
    await addChannel(t, customerId, "youtube", "error");

    const input = await t.query(internal.maya.deploy.workspaceInput, {
      customerId,
    });
    expect(input?.channels.map((c) => c.channel)).toEqual(["x"]);

    const workspace = await t.action(internal.maya.deploy.workspaceFor, {
      customerId,
    });
    expect(Object.keys(workspace!.files)).toContain("PLATFORM_ALGO/x.md");
    expect(Object.keys(workspace!.files)).not.toContain("PLATFORM_ALGO/tiktok.md");
  });

  it("a MALFORMED json column degrades rather than failing the deploy", async () => {
    // These are operator- and model-written blobs. A truncated write shouldn't
    // mean the machine can't be deployed at all.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "badjson", {
      productTruthJson: "{not json",
      voiceProfileJson: "[]",
    });

    const input = await t.query(internal.maya.deploy.workspaceInput, {
      customerId,
    });
    expect(input).not.toBeNull();
    expect(input?.product.name).toBe("the product");
    expect(input?.voiceExcerpts).toBeUndefined();
  });

  it("the assembled workspace still fits the prompt budget", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "budget");
    await addChannel(t, customerId, "x", "connected");
    const workspace = await t.action(internal.maya.deploy.workspaceFor, {
      customerId,
    });
    expect(workspace!.alwaysLoadedChars).toBeLessThan(76_000);
    expect(workspace!.alwaysLoadedChars).toBeGreaterThan(1_000);
  });

  it("a missing customer returns null rather than a half-built machine", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "gone");
    await t.run((ctx) => ctx.db.delete(customerId));
    expect(
      await t.action(internal.maya.deploy.workspaceFor, { customerId })
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

async function seedCustomer(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  over: Partial<Doc<"customers">> = {}
): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "web",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      createdAt: NOW,
      updatedAt: NOW,
      ...over,
    });
  });
}

async function addChannel(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  channel: "x" | "tiktok" | "instagram" | "youtube",
  status: "connected" | "dormant" | "disconnected" | "error"
): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert("channels", {
      customerId,
      channel,
      postingMode: "just_go",
      status,
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
}

describe("deployMachine fails loudly and early", () => {
  it("a missing customer is a named failure, not a half-built machine", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "deploy_gone");
    await t.run((ctx) => ctx.db.delete(customerId));

    const result = await t.action(internal.maya.deploy.deployMachine, {
      customerId,
      image: "img",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/no such customer/);
  });

  it("MISSING CREDENTIALS ARE CAUGHT BEFORE ANYTHING IS CREATED", async () => {
    // The ordering that matters: bail before creating a Fly app, a volume, or a
    // machine. A deploy that half-succeeds and then dies on a missing env var
    // leaves paid infrastructure behind that nothing points at.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "deploy_nokey");

    const result = await t.action(internal.maya.deploy.deployMachine, {
      customerId,
      image: "img",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/OPENROUTER_API_KEY|CONVEX_SITE_URL/);

    // And nothing was written to the customer — no token, no machine.
    const row = (await t.run((ctx) => ctx.db.get(customerId))) as Doc<"customers">;
    expect(row.agentTokenHash).toBeUndefined();
    expect(row.flyMachineId).toBeUndefined();
  });

  it("records the machine so a redeploy is idempotent on it", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "deploy_record");
    await t.mutation(internal.maya.deploy.recordMachine, {
      customerId,
      flyAppName: "maya-abc",
      flyMachineId: "m_123",
    });
    const row = (await t.run((ctx) => ctx.db.get(customerId))) as Doc<"customers">;
    expect(row.flyAppName).toBe("maya-abc");
    expect(row.flyMachineId).toBe("m_123");
  });
});
