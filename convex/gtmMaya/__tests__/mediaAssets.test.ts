/**
 * Slideshow cluster — media library (gtmAgents.mediaLibraryJson) round-trip.
 *
 * The library is a JSON string on the agent row (NOT a table — the schema is
 * at TypeScript's DataModel instantiation ceiling). These tests cover the
 * load-bearing behaviors of the internal query/mutation layer:
 *
 *   1. append + read round-trip (an entry persists and reads back).
 *   2. sha256 DEDUPE (a re-sent identical asset does not pile up; the orphan
 *      storage blob is deleted and the existing entry's id is returned).
 *   3. CROSS-TENANT ISOLATION (mandatory) — agent A's library never contains
 *      agent B's entries; each reads only its own row.
 *   4. archived entries are filtered out of reads.
 *
 * Agents are created through the real onboarding mutation so the {accountId,
 * agentId} rows are valid; storage ids come from real ctx.storage.store calls.
 */

import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = btoa("\0".repeat(32));
});

async function setupAgent(
  t: ReturnType<typeof convexTest>,
  subject: string
): Promise<{ agentId: Id<"gtmAgents">; accountId: Id<"creators"> }> {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  return { agentId: started.agentId, accountId: started.accountId };
}

async function storeBlob(
  t: ReturnType<typeof convexTest>,
  bytes: number[],
  mime = "image/png"
): Promise<Id<"_storage">> {
  return await t.run(async (ctx) =>
    ctx.storage.store(new Blob([new Uint8Array(bytes)], { type: mime }))
  );
}

function append(
  t: ReturnType<typeof convexTest>,
  args: {
    agentId: Id<"gtmAgents">;
    storageId: Id<"_storage">;
    kind?: string;
    source?: string;
    mimeType?: string;
    label?: string;
    sha256?: string;
  }
) {
  return t.mutation(internal.gtmMaya.mediaAssets.appendEntry, {
    agentId: args.agentId,
    storageId: args.storageId,
    kind: args.kind ?? "screenshot",
    source: args.source ?? "telegram",
    mimeType: args.mimeType ?? "image/png",
    storageBytes: 3,
    label: args.label,
    sha256: args.sha256,
  });
}

function read(
  t: ReturnType<typeof convexTest>,
  agentId: Id<"gtmAgents">
) {
  return t.query(internal.gtmMaya.mediaAssets.getLibrary, { agentId });
}

describe("gtm media library — gtmAgents.mediaLibraryJson", () => {
  it("append + read round-trips a media entry", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_media_rt");
    const sid = await storeBlob(t, [1, 2, 3]);

    const res = await append(t, {
      agentId: a.agentId,
      storageId: sid,
      label: "paywall screen",
      sha256: "hashA",
    });
    expect(res.deduped).toBe(false);
    expect(res.assetId).toBe(sid);

    const lib = await read(t, a.agentId);
    expect(lib.length).toBe(1);
    expect(lib[0].storageId).toBe(sid);
    expect(lib[0].label).toBe("paywall screen");
    expect(lib[0].kind).toBe("screenshot");
  });

  it("DEDUPE: re-appending the same sha256 returns the existing entry and does not pile up", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_media_dedupe");
    const first = await storeBlob(t, [9, 9, 9]);
    const second = await storeBlob(t, [9, 9, 9]); // distinct blob, same sha

    const r1 = await append(t, {
      agentId: a.agentId,
      storageId: first,
      sha256: "dupehash",
    });
    expect(r1.deduped).toBe(false);

    const r2 = await append(t, {
      agentId: a.agentId,
      storageId: second,
      sha256: "dupehash",
    });
    expect(r2.deduped).toBe(true);
    // The existing (first) entry wins; the second id is NOT what we get back.
    expect(r2.assetId).toBe(first);

    const lib = await read(t, a.agentId);
    expect(lib.length).toBe(1);
    expect(lib[0].storageId).toBe(first);
    // The orphaned second blob was deleted by the dedupe guard.
    const orphan = await t.run(async (ctx) => ctx.storage.getUrl(second));
    expect(orphan).toBeNull();
  });

  it("CROSS-TENANT: agent A's library never contains agent B's entries", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_media_a");
    const b = await setupAgent(t, "u_media_b");
    const sa = await storeBlob(t, [1]);
    const sb = await storeBlob(t, [2]);

    await append(t, { agentId: a.agentId, storageId: sa, label: "A-shot", sha256: "a" });
    await append(t, { agentId: b.agentId, storageId: sb, label: "B-shot", sha256: "b" });

    const libA = await read(t, a.agentId);
    const libB = await read(t, b.agentId);
    expect(libA.length).toBe(1);
    expect(libA[0].label).toBe("A-shot");
    expect(libB.length).toBe(1);
    expect(libB[0].label).toBe("B-shot");
    expect(libA.map((e) => e.storageId)).not.toContain(sb);
  });

  it("archived entries are filtered out of reads", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_media_arch");
    const sid = await storeBlob(t, [5, 5]);
    await append(t, { agentId: a.agentId, storageId: sid, sha256: "x" });

    // Archive it directly on the row.
    await t.run(async (ctx) => {
      const agent = await ctx.db.get(a.agentId);
      const lib = JSON.parse(agent!.mediaLibraryJson ?? "[]") as Array<
        Record<string, unknown>
      >;
      lib[0].archivedAt = Date.now();
      await ctx.db.patch(a.agentId, { mediaLibraryJson: JSON.stringify(lib) });
    });

    const lib = await read(t, a.agentId);
    expect(lib.length).toBe(0);
  });
});
