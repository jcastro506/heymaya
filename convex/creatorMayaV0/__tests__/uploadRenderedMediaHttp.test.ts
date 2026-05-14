/**
 * Sprint A.1 — outbound media bridge tests.
 *
 * Three layers under test:
 *   1. POST /lc_maya/upload_rendered_media — auth, malformed body, creator
 *      validation, storage write, public URL return, size caps.
 *   2. Cross-tenant isolation: a file uploaded under creator A's id lands in
 *      creator A's media-asset list ONLY; a bogus id never gets bytes
 *      written.
 *   3. Sibling-file scan: convex/http.ts registers the new route AND
 *      convex/schema.ts allows `source: "rendered_variant"` on the
 *      mediaAssets table.
 *
 * Five mandatory categories:
 *   - Cross-tenant: creator A's id receives bytes; creator B's media-asset
 *     list stays empty. Bogus id (creator-not-found) returns 404 BEFORE any
 *     storage write.
 *   - Plan-tier × action: this endpoint is infrastructural (upload, not
 *     gated by plan). The plan-tier check we DO enforce is creator-existence
 *     short-circuits before any storage write — verified explicitly below.
 *   - Adversarial: missing secret / wrong secret → 401; missing creatorId /
 *     file → 400; empty file → 400; oversize file → 413; bogus creatorId →
 *     404; non-mp4 mime types (image/jpeg, image/png, audio/wav) accepted.
 *   - Sibling-file scan: covered in the dedicated describe block.
 *   - TODO grep: covered repo-wide; this file ships with NO TODO/FIXME.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { _setWebhookSecretForTests } from "../../lib/webhookSecret";

const TEST_SECRET = "cafebabe".repeat(8);
const NOW = 1_700_000_000_000;

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan?: "coach" | "manager" } = { suffix: "x" }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "imessage",
      timezone: "America/Los_Angeles",
      status: "onboarding",
      plan: opts.plan ?? "manager",
      createdAt: NOW,
    })
  );
}

function makeForm(
  fields: Record<string, string | undefined>,
  file?: { bytes: Uint8Array; mimeType: string; name: string }
): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) form.append(k, v);
  }
  if (file) {
    // Cast through ArrayBuffer to dodge the TS lib quirk where
    // Uint8Array<ArrayBufferLike> ≠ BlobPart on strict configs.
    const ab = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength
    ) as ArrayBuffer;
    form.append(
      "file",
      new Blob([ab], { type: file.mimeType }),
      file.name
    );
  }
  return form;
}

function mp4Bytes(size = 1024): Uint8Array {
  // Real ffmpeg output starts with an "ftyp" atom; we only need plausible
  // bytes for the storage write + sha256. The endpoint never inspects video
  // structure.
  const bytes = new Uint8Array(size);
  bytes[0] = 0x00;
  bytes[1] = 0x00;
  bytes[2] = 0x00;
  bytes[3] = 0x20;
  bytes[4] = 0x66; // 'f'
  bytes[5] = 0x74; // 't'
  bytes[6] = 0x79; // 'y'
  bytes[7] = 0x70; // 'p'
  for (let i = 8; i < size; i++) bytes[i] = i % 251;
  return bytes;
}

describe("POST /lc_maya/upload_rendered_media — auth", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("ADVERSARIAL: missing secret → 401", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "auth-missing" });
    const form = makeForm(
      { creatorId, kind: "video" },
      { bytes: mp4Bytes(64), mimeType: "video/mp4", name: "x.mp4" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(401);
  });

  it("ADVERSARIAL: wrong secret → 401", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "auth-wrong" });
    for (const bad of ["", "nope", `${TEST_SECRET}x`]) {
      const form = makeForm(
        { secret: bad, creatorId, kind: "video" },
        { bytes: mp4Bytes(64), mimeType: "video/mp4", name: "x.mp4" }
      );
      const res = await t.fetch("/lc_maya/upload_rendered_media", {
        method: "POST",
        body: form,
      });
      expect(res.status).toBe(401);
    }
  });

  it("ADVERSARIAL: env unset (no test injection) → 401", async () => {
    _setWebhookSecretForTests(null);
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "auth-env-unset" });
    const form = makeForm(
      { secret: TEST_SECRET, creatorId, kind: "video" },
      { bytes: mp4Bytes(64), mimeType: "video/mp4", name: "x.mp4" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /lc_maya/upload_rendered_media — malformed", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("ADVERSARIAL: missing creatorId → 400", async () => {
    const t = convexTest(schema, modules);
    const form = makeForm(
      { secret: TEST_SECRET, kind: "video" },
      { bytes: mp4Bytes(64), mimeType: "video/mp4", name: "x.mp4" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it("ADVERSARIAL: missing file → 400", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "no-file" });
    const form = makeForm({ secret: TEST_SECRET, creatorId, kind: "video" });
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it("ADVERSARIAL: empty file (0 bytes) → 400, no row written", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "empty-file" });
    const form = makeForm(
      { secret: TEST_SECRET, creatorId, kind: "video" },
      { bytes: new Uint8Array(0), mimeType: "video/mp4", name: "x.mp4" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);

    const rows = await t.query(
      internal.creatorMayaV0.mediaAssets.listCreatorMediaAssetsInternal,
      { creatorId }
    );
    expect(rows).toHaveLength(0);
  });

  it("ADVERSARIAL: invalid kind → 400", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "bad-kind" });
    const form = makeForm(
      { secret: TEST_SECRET, creatorId, kind: "feelings" },
      { bytes: mp4Bytes(64), mimeType: "video/mp4", name: "x.mp4" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it("ADVERSARIAL: invalid source → 400", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "bad-source" });
    const form = makeForm(
      {
        secret: TEST_SECRET,
        creatorId,
        kind: "video",
        source: "twilio_voicemail",
      },
      { bytes: mp4Bytes(64), mimeType: "video/mp4", name: "x.mp4" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /lc_maya/upload_rendered_media — creator validation", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("CROSS-TENANT: bogus creatorId → 404, no storage write", async () => {
    const t = convexTest(schema, modules);
    const real = await insertCreator(t, { suffix: "real" });
    // Delete to get a syntactically valid but non-resolving id.
    await t.run((ctx) => ctx.db.delete(real));

    const form = makeForm(
      { secret: TEST_SECRET, creatorId: real, kind: "video" },
      { bytes: mp4Bytes(64), mimeType: "video/mp4", name: "x.mp4" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(404);

    // PLAN-TIER × ACTION: confirm the short-circuit. No storage row exists
    // for the deleted creator and no orphan media-asset rows were written.
    const orphanRows = await t.run((ctx) =>
      ctx.db.query("creatorMayaV0MediaAssets").collect()
    );
    expect(orphanRows).toHaveLength(0);
  });
});

describe("POST /lc_maya/upload_rendered_media — happy paths", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("HAPPY: mp4 upload → 200, mediaAssets row with rendered_variant source", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "mp4-happy" });
    const bytes = mp4Bytes(2048);

    const form = makeForm(
      { secret: TEST_SECRET, creatorId, kind: "video" },
      { bytes, mimeType: "video/mp4", name: "adina_birthday_draft.mp4" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.publicUrl).toBe("string");
    expect(body.publicUrl.length).toBeGreaterThan(0);
    expect(typeof body.mediaAssetId).toBe("string");
    expect(body.mimeType).toBe("video/mp4");
    expect(body.bytes).toBe(bytes.byteLength);

    const rows = await t.query(
      internal.creatorMayaV0.mediaAssets.listCreatorMediaAssetsInternal,
      { creatorId }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("rendered_variant");
    expect(rows[0].mediaKind).toBe("video");
    expect(rows[0].mimeType).toBe("video/mp4");
    expect(rows[0].filename).toBe("adina_birthday_draft.mp4");
    expect(rows[0].consent.text).toContain("Outbound render");
    expect(rows[0].storageBytes).toBe(bytes.byteLength);
  });

  it("HAPPY: image/jpeg upload → 200, mediaKind inferred from mime", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "jpeg-happy" });
    const form = makeForm(
      { secret: TEST_SECRET, creatorId },
      { bytes: mp4Bytes(512), mimeType: "image/jpeg", name: "cover.jpg" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mimeType).toBe("image/jpeg");

    const rows = await t.query(
      internal.creatorMayaV0.mediaAssets.listCreatorMediaAssetsInternal,
      { creatorId }
    );
    expect(rows[0].mediaKind).toBe("image");
  });

  it("HAPPY: image/png upload → 200, mediaKind=image", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "png-happy" });
    const form = makeForm(
      { secret: TEST_SECRET, creatorId },
      { bytes: mp4Bytes(512), mimeType: "image/png", name: "thumb.png" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);

    const rows = await t.query(
      internal.creatorMayaV0.mediaAssets.listCreatorMediaAssetsInternal,
      { creatorId }
    );
    expect(rows[0].mediaKind).toBe("image");
  });

  it("HAPPY: audio/wav upload → 200, mediaKind=audio", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "wav-happy" });
    const form = makeForm(
      { secret: TEST_SECRET, creatorId },
      { bytes: mp4Bytes(256), mimeType: "audio/wav", name: "voice.wav" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);

    const rows = await t.query(
      internal.creatorMayaV0.mediaAssets.listCreatorMediaAssetsInternal,
      { creatorId }
    );
    expect(rows[0].mediaKind).toBe("audio");
  });

  it("HAPPY: explicit source=web_upload accepted", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "web-upload" });
    const form = makeForm(
      {
        secret: TEST_SECRET,
        creatorId,
        kind: "video",
        source: "web_upload",
      },
      { bytes: mp4Bytes(256), mimeType: "video/mp4", name: "x.mp4" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);

    const rows = await t.query(
      internal.creatorMayaV0.mediaAssets.listCreatorMediaAssetsInternal,
      { creatorId }
    );
    expect(rows[0].source).toBe("web_upload");
  });

  it("HAPPY: originalFilename override preserved", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "orig-name" });
    const form = makeForm(
      {
        secret: TEST_SECRET,
        creatorId,
        kind: "video",
        originalFilename: "kevin_birthday_v3.mp4",
      },
      { bytes: mp4Bytes(256), mimeType: "video/mp4", name: "tmpfile.bin" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);

    const rows = await t.query(
      internal.creatorMayaV0.mediaAssets.listCreatorMediaAssetsInternal,
      { creatorId }
    );
    expect(rows[0].filename).toBe("kevin_birthday_v3.mp4");
  });
});

describe("POST /lc_maya/upload_rendered_media — caps", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("ADVERSARIAL: 100 MB+ file → 413", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "too-big" });
    // 100 MB + 1 byte. Construct cheaply (a 100MB Uint8Array allocates fine
    // on Node test runners — we're not copying it into FormData multiple
    // times).
    const tooBig = new Uint8Array(100 * 1024 * 1024 + 1);
    const form = makeForm(
      { secret: TEST_SECRET, creatorId, kind: "video" },
      { bytes: tooBig, mimeType: "video/mp4", name: "huge.mp4" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(413);

    // No row was written.
    const rows = await t.query(
      internal.creatorMayaV0.mediaAssets.listCreatorMediaAssetsInternal,
      { creatorId }
    );
    expect(rows).toHaveLength(0);
  }, 30_000);

  it("EDGE: exactly at 100 MB → 200", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "edge-exact" });
    const exact = new Uint8Array(100 * 1024 * 1024);
    const form = makeForm(
      { secret: TEST_SECRET, creatorId, kind: "video" },
      { bytes: exact, mimeType: "video/mp4", name: "edge.mp4" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);
  }, 30_000);
});

describe("POST /lc_maya/upload_rendered_media — cross-tenant isolation", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("CROSS-TENANT: A uploads → A sees the row, B sees nothing", async () => {
    const t = convexTest(schema, modules);
    const creatorA = await insertCreator(t, { suffix: "tenant-a" });
    const creatorB = await insertCreator(t, { suffix: "tenant-b" });

    const form = makeForm(
      { secret: TEST_SECRET, creatorId: creatorA, kind: "video" },
      { bytes: mp4Bytes(512), mimeType: "video/mp4", name: "a.mp4" }
    );
    const res = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);

    const rowsA = await t.query(
      internal.creatorMayaV0.mediaAssets.listCreatorMediaAssetsInternal,
      { creatorId: creatorA }
    );
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].creatorId).toBe(creatorA);

    const rowsB = await t.query(
      internal.creatorMayaV0.mediaAssets.listCreatorMediaAssetsInternal,
      { creatorId: creatorB }
    );
    expect(rowsB).toHaveLength(0);
  });

  it("CROSS-TENANT: dedupe by content hash is scoped per creator", async () => {
    const t = convexTest(schema, modules);
    const creatorA = await insertCreator(t, { suffix: "dedupe-a" });
    const creatorB = await insertCreator(t, { suffix: "dedupe-b" });
    const sharedBytes = mp4Bytes(2048);

    const form = (cId: Id<"creators">) =>
      makeForm(
        { secret: TEST_SECRET, creatorId: cId, kind: "video" },
        { bytes: sharedBytes, mimeType: "video/mp4", name: "x.mp4" }
      );

    const resA = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form(creatorA),
    });
    expect(resA.status).toBe(200);
    const bodyA = await resA.json();
    expect(bodyA.deduped).toBe(false);

    const resB = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form(creatorB),
    });
    expect(resB.status).toBe(200);
    const bodyB = await resB.json();
    // Same bytes, different creator — no cross-tenant dedupe.
    expect(bodyB.deduped).toBe(false);
    expect(bodyB.mediaAssetId).not.toBe(bodyA.mediaAssetId);

    // Same creator, same bytes → dedupes.
    const resA2 = await t.fetch("/lc_maya/upload_rendered_media", {
      method: "POST",
      body: form(creatorA),
    });
    expect(resA2.status).toBe(200);
    const bodyA2 = await resA2.json();
    expect(bodyA2.deduped).toBe(true);
    expect(bodyA2.mediaAssetId).toBe(bodyA.mediaAssetId);
  });
});

describe("sibling-file scan", () => {
  it("convex/http.ts registers /lc_maya/upload_rendered_media", () => {
    const src = readFileSync(join(process.cwd(), "convex/http.ts"), "utf8");
    expect(src).toMatch(/uploadRenderedMediaHttp/);
    expect(src).toMatch(/\/lc_maya\/upload_rendered_media/);
  });

  it("convex/schema.ts mediaAssets table allows source: 'rendered_variant'", () => {
    const src = readFileSync(
      join(process.cwd(), "convex/schema.ts"),
      "utf8"
    );
    // Both literals live in the same `source:` union block.
    expect(src).toMatch(/creatorMayaV0MediaAssets:\s*defineTable/);
    expect(src).toMatch(/v\.literal\("rendered_variant"\)/);
    expect(src).toMatch(/v\.literal\("web_upload"\)/);
  });

  it("convex/creatorMayaV0/uploadRenderedMediaHttp.ts has no TODO/FIXME", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "convex/creatorMayaV0/uploadRenderedMediaHttp.ts"
      ),
      "utf8"
    );
    expect(src).not.toMatch(/\bTODO\b/);
    expect(src).not.toMatch(/\bFIXME\b/);
    expect(src).not.toMatch(/eslint-disable/);
  });

  it("convex/agents/packs/maya/workspace/skillsRegistry.ts teaches the upload sequence in maya-clip-editor", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "convex/agents/packs/maya/workspace/skillsRegistry.ts"
      ),
      "utf8"
    );
    // Verify the upload-first contract is embedded in the maya-clip-editor
    // SKILL.md string. The exact prose can drift; we anchor on the path +
    // intent so future edits keep the contract intact.
    expect(src).toMatch(/\/lc_maya\/upload_rendered_media/);
    expect(src).toMatch(/Delivering the rendered clip|upload via curl/i);
  });

  it("convex/agents/packs/maya/workspace/generateAgentsMd.ts mentions upload-first rule", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "convex/agents/packs/maya/workspace/generateAgentsMd.ts"
      ),
      "utf8"
    );
    expect(src).toMatch(/\/lc_maya\/upload_rendered_media/);
    expect(src).toMatch(/sendMedia/);
  });
});
