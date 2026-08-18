import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { stagedPath } from "../../agents/packs/maya/generators";
import {
  deploymentSlug,
  flyAppName,
  buildBootScript,
  buildMachineConfig,
  PLUGIN_TGZ_PATH,
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
  timezone: "America/Los_Angeles",
});

describe("ALWAYS-ON, SO THE HEARTBEAT CAN ACTUALLY RUN", () => {
  it("the service does not stop on idle", () => {
    // A heartbeat cannot run on a machine Fly is allowed to stop: it generates
    // no inbound request to keep the machine alive, and once stopped there is
    // no process to fire it. Auto-stop doesn't coexist with the agent loop —
    // it removes it, silently, along with memory consolidation and commitment
    // follow-through, which both ride the heartbeat.
    const service = CONFIG.services![0];
    expect(service.autostop).toBe("off");
    expect(service.min_machines_running).toBeGreaterThanOrEqual(1);
  });

  it("restarts always — a crashed agent that stays crashed is silence", () => {
    // Silence is the failure mode this product exists to eliminate. The old
    // `on-failure` existed only to avoid fighting auto-stop.
    expect(CONFIG.restart?.policy).toBe("always");
  });

  it("has enough memory for the gateway, workspace, sqlite and embeddings", () => {
    // Being OOM-killed hourly would look exactly like an agent that ignores its
    // heartbeat.
    expect(CONFIG.guest?.memory_mb).toBeGreaterThanOrEqual(2048);
  });

  it("is still one machine per customer", () => {
    // Shared multi-tenant would take out N customers on one crash, and session
    // isolation is the whole premise of "an employee".
    expect(CONFIG.metadata?.customerId).toBe("cust_1");
    expect(CONFIG.metadata?.agentVersion).toBe("v2");
  });
});

describe("THE HEARTBEAT CAN ACTUALLY RESOLVE ITS OWN CLOCK", () => {
  it("ships the founder's IANA timezone as TZ", () => {
    // `activeHours: { timezone: "local" }` resolves against this. v1 once
    // shipped the literal string "operator" as a timezone; OpenClaw failed
    // closed and suppressed EVERY heartbeat tick — an agent that looked alive
    // and never woke up.
    expect(CONFIG.env?.TZ).toBe("America/Los_Angeles");
    // A real zone, not a placeholder.
    expect(CONFIG.env?.TZ).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$|^UTC$/);
  });
});

describe("THE BOOTSTRAP ACTUALLY DOES SOMETHING", () => {
  const script = buildBootScript();

  it("INSTALLS THE PLUGIN — the first version never did", () => {
    // The deploy set MAYA_PLUGIN_ID/MAYA_PLUGIN_TGZ env vars that nothing
    // consumed. The machine would have booted with zero Maya tools, and she
    // would have fallen back to improvising with `exec` — which is how research
    // workers fabricated results on the live v1 machine.
    expect(script).toMatch(/openclaw plugins install npm-pack:/);
    expect(script).toContain(PLUGIN_TGZ_PATH);
  });

  it("SEEDS MEMORY.md ONLY IF ABSENT", () => {
    // The bug this sprint exists to fix. A plain copy here would wipe every
    // promoted memory on every redeploy.
    expect(script).toMatch(/if \[ ! -f .*MEMORY\.md \]/);
    // And it must not be an unconditional copy anywhere.
    expect(script).not.toMatch(/^\s*cp .*seed\/MEMORY\.md/m);
  });

  it("execs the gateway so Fly sees ITS exit code, not the shell's", () => {
    expect(script).toMatch(/^exec openclaw gateway/m);
  });

  it("survives a plugin-install failure rather than failing to boot", () => {
    // A machine that won't boot is a worse outcome than one with missing tools,
    // because the missing tools are visible and a dead machine is silence.
    const installLine = script
      .split("\n")
      .find((l) => l.includes("plugins install"))!;
    expect(installLine).toMatch(/\|\|/);
  });

  it("does not silently half-run", () => {
    expect(script.startsWith("set -e")).toBe(true);
  });

  it("NOTHING IS WRITTEN UNDER THE VOLUME MOUNT BY config.files", () => {
    // The live boot loop, 2026-08-04. Fly writes `config.files` BEFORE mounting
    // the volume, so a file at /data/... is shadowed by the mount and Fly's own
    // chown-after-mount then fails with ENOENT and kills init. Two reboots,
    // then a stopped machine.
    //
    // Everything is staged in the image and copied across after the mount.
    expect(PLUGIN_TGZ_PATH.startsWith("/data")).toBe(false);
    expect(stagedPath("/data/openclaw.json").startsWith("/data")).toBe(false);
    // And the boot script is what bridges the gap.
    expect(script).toMatch(/cp -R \/opt\/maya\/data\/workspace\/\. \/data\/workspace\//);
    expect(script).toContain("cp /opt/maya/data/openclaw.json /data/openclaw.json");
  });

  it("passes --allow-unconfigured, which 5.x REQUIRES", () => {
    // Without it OpenClaw 5.x refuses to start: "Refusing to bind gateway to
    // auto without auth."
    expect(script).toMatch(/--allow-unconfigured/);
    expect(script).toMatch(/--bind lan/);
  });

  it("routes to the port the GATEWAY actually binds, not the image's PORT", () => {
    // Verified live by probing the machine: 3000 and 8080 refuse, 18789
    // answers 200. The image's PORT=3000/EXPOSE/HEALTHCHECK describe its
    // default CMD (`--port 3000`); our boot script omits `--port`, so OpenClaw
    // binds its own default instead.
    //
    // I overrode v1's 18789 with 3000 after reading the Dockerfile — reasoning
    // from the image rather than from what the process does. Fly then routed
    // :443 at a dead port and every health probe returned 503 while the gateway
    // sat there healthy.
    expect(script).not.toMatch(/--port/);
    expect(CONFIG.services![0].internal_port).toBe(18789);
  });

  it("copies the workspace twice, against a documented race", () => {
    // v1 observed 6 of 12 root .md files vanishing between the write and
    // OpenClaw's own workspace init. `cp` overwrites, so the second pass is
    // free when the first one held.
    const copies = script
      .split("\n")
      .filter((l) => l.includes("cp -R /opt/maya/data/workspace"));
    expect(copies.length).toBe(2);
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
      timezone: "UTC",
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
        timezone: "UTC",
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
    await addChannel(t, customerId, "tiktok", "connected");

    const input = await t.query(internal.maya.deploy.workspaceInput, {
      customerId,
    });
    expect(input?.product.name).toBe("Widgetly");
    expect(input?.product.truth).toBe("turns a CSV into a dashboard");
    expect(input?.channels).toEqual([{ channel: "tiktok", postingMode: "just_go" }]);
  });

  it("DORMANT AND DISCONNECTED CHANNELS SHIP NO NORMS", async () => {
    // Carrying context for a channel she can't post to spends budget to make
    // her worse — she plans around something with no live grant.
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "dormant");
    // ⚠️ One live channel and three that are not, each for a different reason.
    // The X fixture that used to carry this went with the channel (2026-08-18).
    await addChannel(t, customerId, "tiktok", "connected");
    await addChannel(t, customerId, "instagram", "dormant");
    await addChannel(t, customerId, "youtube", "disconnected");

    const input = await t.query(internal.maya.deploy.workspaceInput, {
      customerId,
    });
    expect(input?.channels.map((c) => c.channel)).toEqual(["tiktok"]);

    const workspace = await t.action(internal.maya.deploy.workspaceFor, {
      customerId,
    });
    const files = Object.keys(workspace!.files);
    expect(files).toContain("PLATFORM_ALGO/tiktok.md");
    expect(files).not.toContain("PLATFORM_ALGO/instagram.md");
    expect(files).not.toContain("PLATFORM_ALGO/youtube.md");
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
    await addChannel(t, customerId, "tiktok", "connected");
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
  channel: "tiktok" | "instagram" | "youtube",
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


describe("STAGING AND PROD SHARE A FLY ORG — names must not collide", () => {
  // Verified 2026-08-04: both Convex deployments carry FLY_ORG_SLUG=personal
  // and FLY_REGION=sjc. A Fly app list from staging returns PRODUCTION'S
  // machines, and a teardown matching a bare `maya-` prefix destroys them.
  // `destroyAllClawlaunchApps` does exactly that and was run twice against
  // staging today — harmless only because prod has no customers yet.
  const STAGING = "https://precise-canary-781.convex.site";
  const PROD = "https://resilient-mandrill-621.convex.site";

  it("the same customer id yields DIFFERENT app names per deployment", () => {
    const id = "m57zjvtw15hm10he2rz4epp1kx8btwj1";
    expect(flyAppName(id, STAGING)).not.toBe(flyAppName(id, PROD));
  });

  it("the deployment is in the NAME, not just metadata", () => {
    // Metadata would need a per-app machine lookup to read. A name is visible
    // in the same listApps call that could destroy it — safety that needs a
    // second lookup is safety that gets skipped.
    expect(flyAppName("cust_abc123", STAGING)).toContain("precisecanary781");
    expect(flyAppName("cust_abc123", PROD)).toContain("resilientmandrill");
  });

  it("an unknown deployment does NOT fall back into a shared namespace", () => {
    // A default would put an unidentified deployment in the same namespace as a
    // known one, which is the collision this exists to prevent.
    expect(deploymentSlug(undefined)).toBe("unknown");
    expect(deploymentSlug("")).toBe("unknown");
    expect(flyAppName("c", undefined)).not.toContain("precisecanary");
  });

  it("app names stay inside Fly's constraints", () => {
    const name = flyAppName("m57zjvtw15hm10he2rz4epp1kx8btwj1", PROD);
    expect(name.length).toBeLessThan(64);
    expect(name).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("A REDEPLOY IS IDEMPOTENT", () => {
  it("destroys existing machines before creating the new one", () => {
    // Two reasons, and the second is worse:
    //
    // 1. The volume. One volume attaches to one machine, so a second machine
    //    gets `volume not found` from Fly — meaning no FREE volume by that
    //    name. Hit live on the first redeploy, 2026-08-04.
    // 2. Two machines = two heartbeats = two cron sets. v1 documents this as a
    //    direct cause of its re-doing loop: doubled foundation passes, doubled
    //    spend, an agent apparently doing everything twice. The volume error is
    //    loud; this one is silent and expensive.
    const source = readFileSync(join(__dirname, "..", "deploy.ts"), "utf8");
    const destroyAt = source.indexOf("destroyMachine(appName, stale.id");
    const createAt = source.indexOf("await fly.createMachine({");
    expect(destroyAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(-1);
    expect(destroyAt).toBeLessThan(createAt);
  });

  it("does NOT destroy the volume — that's what carries her memory across", () => {
    // The volume surviving a redeploy IS Sprint 2's exit criterion: "she
    // answers from rows, across a redeploy".
    const source = readFileSync(join(__dirname, "..", "deploy.ts"), "utf8");
    expect(source).not.toMatch(/destroyVolume|deleteVolume/);
    expect(source).toMatch(/findOrCreateVolume/);
  });

  it("a teardown failure does not block the fresh deploy", () => {
    // The new machine is the thing that matters; refusing to deploy because an
    // already-dead machine could not be destroyed again is a worse outcome.
    const source = readFileSync(join(__dirname, "..", "deploy.ts"), "utf8");
    // Bounded to the destroy block itself — the volume step that follows has
    // its own (correctly fatal) error return, and including it would make this
    // test assert the opposite of what it means.
    const start = source.indexOf("DESTROY ANY EXISTING MACHINE");
    const block = source.slice(start, source.indexOf("findOrCreateVolume", start));
    // Both the inner destroy and the outer list are guarded.
    expect((block.match(/try \{/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(block).not.toMatch(/return \{ ok: false/);
  });
});

describe("BULK TEARDOWN CANNOT REACH PRODUCTION", () => {
  // Two different destroys, and only one is safe in production:
  //
  //   • destroy-before-create inside a DEPLOY replaces one customer's machine
  //     with a newer one. The volume — her memory — survives. That is how a
  //     config change or image upgrade ships, and it is correct in prod.
  //
  //   • BULK teardown sweeps every machine in a deployment. That is a testing
  //     convenience, and a testing convenience that can reach paying customers
  //     is a loaded gun. In production a machine dies only when its owner
  //     deletes their account, per customer, on their own instruction.
  const source = readFileSync(join(__dirname, "..", "deploy.ts"), "utf8");

  it("refuses unless explicitly opted in", () => {
    expect(source).toMatch(/ALLOW_BULK_TEARDOWN !== "true"/);
    const guard = source.slice(source.indexOf("ALLOW_BULK_TEARDOWN"));
    // Refuses by RETURNING, not by throwing — a thrown sweep looks like a bug
    // to whoever ran it, and this is a deliberate answer.
    expect(guard).toMatch(/refused:/);
  });

  it("the guard is fail-CLOSED, not a deployment-name check", () => {
    // A name check is a guess about which deployment is which, and this must be
    // wrong only in the safe direction — including on deployments nobody has
    // thought about yet.
    const guard = source.slice(
      source.indexOf("FAIL CLOSED"),
      source.indexOf("const siteUrl = process.env.CONVEX_SITE_URL")
    );
    expect(guard).not.toMatch(/resilient-mandrill|precise-canary|=== "prod"/);
  });

  it("points the operator at account deletion for a single customer", () => {
    expect(source).toMatch(/use account deletion/i);
  });

  it("the DEPLOY's destroy-before-create is NOT gated by it", () => {
    // Replacing one machine on redeploy must keep working in production —
    // that is how a new config or image ships at all.
    const destroyAt = source.indexOf("destroyMachine(appName, stale.id");
    const guardAt = source.indexOf("ALLOW_BULK_TEARDOWN");
    expect(destroyAt).toBeGreaterThan(-1);
    expect(destroyAt).toBeLessThan(guardAt);
  });
});


describe("THE CRITIC STARTS FRESH, MAIN NEVER DOES", () => {
  const script = buildBootScript();

  it("⭐ clears the critic's session so config changes actually apply", () => {
    // An agent session pins the model it was created with, on the VOLUME,
    // which survives redeploys. Live 2026-08-05: openclaw.json said qwen while
    // the running critic still called kimi — two model changes and a tool-
    // profile fix had all silently not applied.
    expect(script).toContain("rm -rf /data/agents/critique/sessions");
  });

  it("⛔ AND NEVER TOUCHES MAIN'S", () => {
    // main's session is the durable one. Clearing it is precisely the amnesia
    // this architecture exists to prevent — five DMs, five conversations.
    expect(script).not.toMatch(/rm -rf \/data\/agents\/main/);
    expect(script).not.toMatch(/rm -rf \/data\/agents(\s|$)/);
  });
});
