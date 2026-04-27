/**
 * R2 endpoints — unit tests.
 *
 * Covers the five mandatory categories that apply at the integration layer:
 *   1. Cross-tenant: the bucket key always nests under
 *      `businesses/{businessId}/...`, so two businesses sending the same
 *      bytes produce DISTINCT keys (no shared cross-tenant storage).
 *   2. Plan-tier: n/a at this layer (R2 client is plan-agnostic; per-tier
 *      caps live in mediaAssets/processCatalogerQueue.ts).
 *   3. Adversarial:
 *        - oversize upload (>50 MB) rejected
 *        - empty upload rejected
 *        - mime claim mismatch (claim image/jpeg, send PNG bytes) rejected
 *        - unsupported mime claim rejected
 *        - malformed signed-url args rejected
 *   4. Sibling-file scan: covered repo-wide.
 *   5. TODO grep: covered repo-wide.
 *
 * The test injects a `R2ClientImpl` stub via `_setR2ClientForTests` so we
 * never make real HTTP calls. The stub records every call so we can
 * assert path construction + bytes-uploaded.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  _setR2ClientForTests,
  buildAssetKey,
  extensionForMime,
  type R2ClientImpl,
} from "../client";
import {
  R2EndpointError,
  deleteAsset,
  getSignedUrl,
  sniffMime,
  uploadAsset,
} from "../endpoints";

interface RecordedPut {
  key: string;
  contentType: string;
  body: Uint8Array;
  metadata?: Record<string, string>;
}

function makeStub(): {
  client: R2ClientImpl;
  puts: RecordedPut[];
  signedUrls: Array<{ key: string; expiresInSec: number }>;
  deletes: string[];
} {
  const puts: RecordedPut[] = [];
  const signedUrls: Array<{ key: string; expiresInSec: number }> = [];
  const deletes: string[] = [];
  const client: R2ClientImpl = {
    async putObject(input) {
      puts.push({
        key: input.key,
        contentType: input.contentType,
        body: input.body,
        metadata: input.metadata,
      });
      return {
        storageUrl: `https://test.r2.example/${input.key}`,
        etag: '"etag-stub"',
      };
    },
    async getSignedDownloadUrl(input) {
      signedUrls.push({ key: input.key, expiresInSec: input.expiresInSec });
      return `https://test.r2.example/${input.key}?signed=1&exp=${input.expiresInSec}`;
    },
    async deleteObject(input) {
      deletes.push(input.key);
    },
    getBucketName() {
      return "test-bucket";
    },
  };
  return { client, puts, signedUrls, deletes };
}

afterEach(() => {
  _setR2ClientForTests(null);
});

/* -------------------------------------------------------------------------- */
/* Helpers — build a tiny valid JPEG / PNG so the sniff matches the claim     */
/* -------------------------------------------------------------------------- */

function jpegBytes(): Uint8Array {
  // Minimum: FF D8 FF E0 ... + JFIF marker
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
}

function pngBytes(): Uint8Array {
  // Standard PNG signature
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

/* -------------------------------------------------------------------------- */
/* uploadAsset                                                                 */
/* -------------------------------------------------------------------------- */

describe("uploadAsset", () => {
  it("uploads bytes + builds tenant-scoped key + returns sha256 hash", async () => {
    const { client, puts } = makeStub();
    _setR2ClientForTests(client);

    const result = await uploadAsset({
      businessId: "biz_alpha",
      bytes: jpegBytes(),
      mimeType: "image/jpeg",
      sourceChannel: "imessage",
      receivedAt: 1_700_000_000_000,
    });

    expect(result.storageBytes).toBe(jpegBytes().byteLength);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.storageKey).toBe(
      `businesses/biz_alpha/${result.contentHash}.jpg`
    );
    expect(result.storageUrl).toContain(result.storageKey);

    expect(puts).toHaveLength(1);
    expect(puts[0].key).toBe(result.storageKey);
    expect(puts[0].contentType).toBe("image/jpeg");
    expect(puts[0].metadata).toMatchObject({
      "business-id": "biz_alpha",
      "source-channel": "imessage",
    });
  });

  it("CROSS-TENANT: same bytes from different businesses → distinct keys", async () => {
    const { client, puts } = makeStub();
    _setR2ClientForTests(client);

    const bytes = jpegBytes();
    const a = await uploadAsset({
      businessId: "biz_a",
      bytes,
      mimeType: "image/jpeg",
      sourceChannel: "web",
      receivedAt: 1_700_000_000_000,
    });
    const b = await uploadAsset({
      businessId: "biz_b",
      bytes,
      mimeType: "image/jpeg",
      sourceChannel: "web",
      receivedAt: 1_700_000_000_000,
    });

    expect(a.contentHash).toBe(b.contentHash);
    expect(a.storageKey).not.toBe(b.storageKey);
    expect(a.storageKey.startsWith("businesses/biz_a/")).toBe(true);
    expect(b.storageKey.startsWith("businesses/biz_b/")).toBe(true);
    expect(puts).toHaveLength(2);
  });

  it("ADVERSARIAL: oversize upload (>50MB) rejected with code='oversize'", async () => {
    const { client } = makeStub();
    _setR2ClientForTests(client);

    const huge = new Uint8Array(50 * 1024 * 1024 + 1);
    huge[0] = 0xff;
    huge[1] = 0xd8;
    huge[2] = 0xff;
    await expect(
      uploadAsset({
        businessId: "biz_a",
        bytes: huge,
        mimeType: "image/jpeg",
        sourceChannel: "web",
        receivedAt: 1_700_000_000_000,
      })
    ).rejects.toMatchObject({
      name: "R2EndpointError",
      code: "oversize",
    });
  });

  it("ADVERSARIAL: empty upload rejected with code='invalid-args'", async () => {
    const { client } = makeStub();
    _setR2ClientForTests(client);

    await expect(
      uploadAsset({
        businessId: "biz_a",
        bytes: new Uint8Array(0),
        mimeType: "image/jpeg",
        sourceChannel: "web",
        receivedAt: 1_700_000_000_000,
      })
    ).rejects.toMatchObject({
      name: "R2EndpointError",
      code: "invalid-args",
    });
  });

  it("ADVERSARIAL: claim image/jpeg but send PNG bytes → mime-mismatch", async () => {
    const { client } = makeStub();
    _setR2ClientForTests(client);

    await expect(
      uploadAsset({
        businessId: "biz_a",
        bytes: pngBytes(),
        mimeType: "image/jpeg",
        sourceChannel: "web",
        receivedAt: 1_700_000_000_000,
      })
    ).rejects.toMatchObject({
      name: "R2EndpointError",
      code: "mime-mismatch",
    });
  });

  it("ADVERSARIAL: claim outside allowlist (text/plain) → mime-mismatch", async () => {
    const { client } = makeStub();
    _setR2ClientForTests(client);

    await expect(
      uploadAsset({
        businessId: "biz_a",
        bytes: jpegBytes(),
        mimeType: "text/plain",
        sourceChannel: "web",
        receivedAt: 1_700_000_000_000,
      })
    ).rejects.toMatchObject({
      name: "R2EndpointError",
      code: "mime-mismatch",
    });
  });

  it("IDEMPOTENCY: same bytes → same storageKey + same contentHash", async () => {
    const { client } = makeStub();
    _setR2ClientForTests(client);

    const r1 = await uploadAsset({
      businessId: "biz_a",
      bytes: jpegBytes(),
      mimeType: "image/jpeg",
      sourceChannel: "web",
      receivedAt: 1,
    });
    const r2 = await uploadAsset({
      businessId: "biz_a",
      bytes: jpegBytes(),
      mimeType: "image/jpeg",
      sourceChannel: "web",
      receivedAt: 2,
    });
    expect(r1.contentHash).toBe(r2.contentHash);
    expect(r1.storageKey).toBe(r2.storageKey);
  });

  it("rejects invalid businessId (empty string)", async () => {
    const { client } = makeStub();
    _setR2ClientForTests(client);
    await expect(
      uploadAsset({
        businessId: "",
        bytes: jpegBytes(),
        mimeType: "image/jpeg",
        sourceChannel: "web",
        receivedAt: 1,
      })
    ).rejects.toMatchObject({ name: "R2EndpointError", code: "invalid-args" });
  });

  it("auth error flows through with code='auth' (no env vars + no injected client)", async () => {
    _setR2ClientForTests(null);
    // No env present in the edge-runtime test environment + no injection.
    const original = {
      a: process.env.R2_ACCOUNT_ID,
      k: process.env.R2_ACCESS_KEY_ID,
      s: process.env.R2_SECRET_ACCESS_KEY,
      b: process.env.R2_BUCKET_NAME,
    };
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;
    try {
      await expect(
        uploadAsset({
          businessId: "biz_a",
          bytes: jpegBytes(),
          mimeType: "image/jpeg",
          sourceChannel: "web",
          receivedAt: 1,
        })
      ).rejects.toMatchObject({ name: "R2EndpointError", code: "auth" });
    } finally {
      if (original.a !== undefined) process.env.R2_ACCOUNT_ID = original.a;
      if (original.k !== undefined) process.env.R2_ACCESS_KEY_ID = original.k;
      if (original.s !== undefined) process.env.R2_SECRET_ACCESS_KEY = original.s;
      if (original.b !== undefined) process.env.R2_BUCKET_NAME = original.b;
    }
  });
});

/* -------------------------------------------------------------------------- */
/* getSignedUrl                                                                */
/* -------------------------------------------------------------------------- */

describe("getSignedUrl", () => {
  it("returns presigned URL via injected client", async () => {
    const { client, signedUrls } = makeStub();
    _setR2ClientForTests(client);

    const url = await getSignedUrl({
      storageKey: "businesses/biz_a/abc.jpg",
      expiresInSec: 60,
    });
    expect(url).toContain("businesses/biz_a/abc.jpg");
    expect(url).toContain("signed=1");
    expect(signedUrls).toEqual([
      { key: "businesses/biz_a/abc.jpg", expiresInSec: 60 },
    ]);
  });

  it("rejects malformed storageKey (leading slash)", async () => {
    const { client } = makeStub();
    _setR2ClientForTests(client);
    await expect(
      getSignedUrl({ storageKey: "/businesses/biz_a/abc.jpg" })
    ).rejects.toBeInstanceOf(R2EndpointError);
  });

  it("rejects empty storageKey", async () => {
    const { client } = makeStub();
    _setR2ClientForTests(client);
    await expect(
      getSignedUrl({ storageKey: "" })
    ).rejects.toBeInstanceOf(R2EndpointError);
  });
});

/* -------------------------------------------------------------------------- */
/* deleteAsset                                                                 */
/* -------------------------------------------------------------------------- */

describe("deleteAsset", () => {
  it("issues delete + records the key", async () => {
    const { client, deletes } = makeStub();
    _setR2ClientForTests(client);

    await deleteAsset({ storageKey: "businesses/biz_a/abc.jpg" });
    expect(deletes).toEqual(["businesses/biz_a/abc.jpg"]);
  });

  it("rejects malformed storageKey", async () => {
    const { client } = makeStub();
    _setR2ClientForTests(client);
    await expect(
      deleteAsset({ storageKey: "/abc" })
    ).rejects.toBeInstanceOf(R2EndpointError);
  });
});

/* -------------------------------------------------------------------------- */
/* sniffMime + buildAssetKey + extensionForMime                                */
/* -------------------------------------------------------------------------- */

describe("sniffMime", () => {
  it("recognizes JPEG", () => {
    expect(sniffMime(jpegBytes())).toBe("image/jpeg");
  });
  it("recognizes PNG", () => {
    expect(sniffMime(pngBytes())).toBe("image/png");
  });
  it("recognizes HEIC via ftyp box", () => {
    const heic = new Uint8Array(16);
    // ftyp box: size (4) + 'ftyp' + 'heic'
    heic.set([0x00, 0x00, 0x00, 0x10], 0);
    heic.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'
    heic.set([0x68, 0x65, 0x69, 0x63], 8); // 'heic'
    expect(sniffMime(heic)).toBe("image/heic");
  });
  it("returns null for short / unknown bytes", () => {
    expect(sniffMime(new Uint8Array([0, 1, 2]))).toBeNull();
    expect(sniffMime(new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a]))).toBeNull();
  });
});

describe("buildAssetKey", () => {
  it("constructs the canonical path", () => {
    const hash = "a".repeat(64);
    expect(
      buildAssetKey({ businessId: "biz_a", contentHash: hash, ext: "jpg" })
    ).toBe(`businesses/biz_a/${hash}.jpg`);
  });
  it("rejects non-hex hash", () => {
    expect(() =>
      buildAssetKey({ businessId: "biz_a", contentHash: "not-hex", ext: "jpg" })
    ).toThrow();
  });
  it("rejects bad ext (uppercase)", () => {
    expect(() =>
      buildAssetKey({
        businessId: "biz_a",
        contentHash: "a".repeat(64),
        ext: "JPG",
      })
    ).toThrow();
  });
  it("rejects businessId with slashes", () => {
    expect(() =>
      buildAssetKey({
        businessId: "biz/a",
        contentHash: "a".repeat(64),
        ext: "jpg",
      })
    ).toThrow();
  });
});

describe("extensionForMime", () => {
  it("maps known mimes", () => {
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/heic")).toBe("heic");
    expect(extensionForMime("video/mp4")).toBe("mp4");
    expect(extensionForMime("audio/m4a")).toBe("m4a");
  });
  it("falls back to bin for unknown", () => {
    expect(extensionForMime("application/x-weird")).toBe("bin");
  });
});
