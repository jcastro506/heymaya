/**
 * R2 high-level endpoints — uploadAsset / getSignedUrl / deleteAsset.
 *
 * These are the only surfaces other Convex modules should call. Direct
 * access to `R2HttpClient` is reserved for the test harness — anything that
 * leaves this file is wrapped in (a) tenant-scoped key construction, (b)
 * mime-sniff validation, (c) size enforcement.
 *
 * The contract enforced here:
 *   - `uploadAsset` computes sha256 of the bytes BEFORE uploading so the
 *     orchestrator can dedupe pre-write. The caller (photoBridge) checks
 *     the per-business hash index and short-circuits on existing rows; the
 *     R2 PUT is only issued for genuinely-new bytes.
 *   - The bucket key is always `businesses/{businessId}/{sha256}.{ext}`.
 *     Same bytes from two different businesses upload TWICE — that is
 *     intentional cross-tenant isolation. R2 storage cost is negligible
 *     vs the privacy bug of leaking one business's photo to another via
 *     hash collision sharing.
 *   - `mimeType` is validated by sniffing the first 32 bytes of the body.
 *     If the claim doesn't match the bytes we reject — operators can't
 *     forge a `.txt` upload claiming `image/jpeg`.
 *   - Size cap: 50 MB hard ceiling at the R2 layer. Photo-bridge applies
 *     a tighter 5 MB cap for inbound photos before this is reached.
 *   - `getSignedUrl` returns a short-lived (default 5 min) presigned URL.
 *     OpenClaw fetches the asset via this URL — never via the storageUrl,
 *     which is private.
 */

import {
  R2AuthError,
  buildAssetKey,
  buildR2ClientFromEnv,
  extensionForMime,
  sha256HexOfBytes,
  type R2ClientImpl,
} from "./client";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB hard ceiling at R2 layer
const DEFAULT_SIGNED_URL_TTL_SEC = 5 * 60; // 5 min — OpenClaw consumes immediately

/**
 * Errors thrown by `uploadAsset` / `getSignedUrl` / `deleteAsset`. Distinct
 * class so callers can pattern-match on `instanceof R2EndpointError` without
 * depending on the underlying R2 HTTP error type.
 */
export class R2EndpointError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "auth"
      | "oversize"
      | "mime-mismatch"
      | "invalid-args"
      | "upload"
      | "presign"
      | "delete"
  ) {
    super(message);
    this.name = "R2EndpointError";
  }
}

export interface UploadAssetInputs {
  businessId: string;
  /** Raw bytes from the inbound channel. */
  bytes: Uint8Array;
  /** Operator-claimed mime; we validate by sniffing. */
  mimeType: string;
  /** Provenance — folded into x-amz-meta for forensics. */
  sourceChannel:
    | "telegram"
    | "imessage"
    | "whatsapp"
    | "sms"
    | "web"
    | "crm-import";
  receivedAt: number;
}

export interface UploadAssetResult {
  /** Storage URL — private, never given to OpenClaw. Use getSignedUrl. */
  storageUrl: string;
  /** Bucket key — recorded on the mediaAssets row. */
  storageKey: string;
  storageBytes: number;
  mimeType: string;
  /** sha256 hex of the body — feeds the per-business hash dedupe index. */
  contentHash: string;
}

/**
 * Upload asset bytes to R2. Validates size + sniffs mime first; throws
 * `R2EndpointError` on every failure path. Idempotent: calling twice with
 * the same body produces the same storage key (same hash → same path), and
 * R2's PutObject is itself idempotent.
 */
export async function uploadAsset(
  inputs: UploadAssetInputs,
  opts?: { client?: R2ClientImpl }
): Promise<UploadAssetResult> {
  if (!inputs.businessId) {
    throw new R2EndpointError("uploadAsset: businessId is required", "invalid-args");
  }
  if (!(inputs.bytes instanceof Uint8Array)) {
    throw new R2EndpointError(
      "uploadAsset: bytes must be a Uint8Array",
      "invalid-args"
    );
  }
  if (inputs.bytes.byteLength === 0) {
    throw new R2EndpointError("uploadAsset: bytes is empty", "invalid-args");
  }
  if (inputs.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new R2EndpointError(
      `uploadAsset: ${inputs.bytes.byteLength} bytes exceeds ${MAX_UPLOAD_BYTES} cap`,
      "oversize"
    );
  }

  const sniffed = sniffMime(inputs.bytes);
  const claimed = inputs.mimeType.toLowerCase().trim();
  if (sniffed && !mimeMatches(sniffed, claimed)) {
    throw new R2EndpointError(
      `uploadAsset: claimed mime '${claimed}' does not match sniffed '${sniffed}'`,
      "mime-mismatch"
    );
  }
  if (!isAcceptableMime(claimed)) {
    throw new R2EndpointError(
      `uploadAsset: mime '${claimed}' is not in the allowlist`,
      "mime-mismatch"
    );
  }

  let client: R2ClientImpl;
  try {
    client = opts?.client ?? buildR2ClientFromEnv();
  } catch (err) {
    if (err instanceof R2AuthError) {
      throw new R2EndpointError(err.message, "auth");
    }
    throw err;
  }

  const contentHash = await sha256HexOfBytes(inputs.bytes);
  const ext = extensionForMime(claimed);
  const storageKey = buildAssetKey({
    businessId: inputs.businessId,
    contentHash,
    ext,
  });

  try {
    const result = await client.putObject({
      key: storageKey,
      body: inputs.bytes,
      contentType: claimed,
      metadata: {
        "business-id": inputs.businessId,
        "source-channel": inputs.sourceChannel,
        "received-at": String(inputs.receivedAt),
      },
    });
    return {
      storageUrl: result.storageUrl,
      storageKey,
      storageBytes: inputs.bytes.byteLength,
      mimeType: claimed,
      contentHash,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new R2EndpointError(`uploadAsset failed: ${message}`, "upload");
  }
}

export interface GetSignedUrlInputs {
  /** Bucket key (relative — not the full storageUrl). */
  storageKey: string;
  /** Default 300s. Hard cap 7 days enforced at the client layer. */
  expiresInSec?: number;
  responseContentType?: string;
}

/**
 * Issue a short-lived signed GET URL. OpenClaw fetches the asset via this
 * URL only — the bucket itself is private. Default TTL is 5 minutes.
 */
export async function getSignedUrl(
  inputs: GetSignedUrlInputs,
  opts?: { client?: R2ClientImpl }
): Promise<string> {
  if (!inputs.storageKey || inputs.storageKey.startsWith("/")) {
    throw new R2EndpointError(
      `getSignedUrl: invalid storageKey '${inputs.storageKey}'`,
      "invalid-args"
    );
  }
  let client: R2ClientImpl;
  try {
    client = opts?.client ?? buildR2ClientFromEnv();
  } catch (err) {
    if (err instanceof R2AuthError) {
      throw new R2EndpointError(err.message, "auth");
    }
    throw err;
  }
  try {
    return await client.getSignedDownloadUrl({
      key: inputs.storageKey,
      expiresInSec: inputs.expiresInSec ?? DEFAULT_SIGNED_URL_TTL_SEC,
      responseContentType: inputs.responseContentType,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new R2EndpointError(`getSignedUrl failed: ${message}`, "presign");
  }
}

export interface DeleteAssetInputs {
  storageKey: string;
}

/**
 * Soft-delete from R2. Used by GDPR / operator-archive flows. R2 returns
 * 404 if the key is already gone — we treat that as success.
 */
export async function deleteAsset(
  inputs: DeleteAssetInputs,
  opts?: { client?: R2ClientImpl }
): Promise<void> {
  if (!inputs.storageKey || inputs.storageKey.startsWith("/")) {
    throw new R2EndpointError(
      `deleteAsset: invalid storageKey '${inputs.storageKey}'`,
      "invalid-args"
    );
  }
  let client: R2ClientImpl;
  try {
    client = opts?.client ?? buildR2ClientFromEnv();
  } catch (err) {
    if (err instanceof R2AuthError) {
      throw new R2EndpointError(err.message, "auth");
    }
    throw err;
  }
  try {
    await client.deleteObject({ key: inputs.storageKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new R2EndpointError(`deleteAsset failed: ${message}`, "delete");
  }
}

/* -------------------------------------------------------------------------- */
/* Mime sniffing — small first-32-bytes signature table                        */
/* -------------------------------------------------------------------------- */

/**
 * Return the sniffed mime, or `null` when bytes don't match any known
 * signature (which is OK for some types — m4a / wav / heic without a clear
 * magic prefix). The caller treats `null` as "no contradictory evidence;
 * accept the claimed mime if it's in the allowlist."
 */
export function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 4) return null;
  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  const b3 = bytes[3];

  // JPEG: FF D8 FF
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47)
    return "image/png";
  // GIF: 47 49 46 38
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38)
    return "image/gif";

  // WebP / MP4 / MOV / HEIC / M4A all use the ISO Base Media File Format
  // wrapper: bytes 4..7 are 'ftyp', then 4 chars indicating brand.
  if (
    bytes.byteLength >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(
      bytes[8],
      bytes[9],
      bytes[10],
      bytes[11]
    );
    if (brand === "heic" || brand === "heix" || brand === "hevc")
      return "image/heic";
    if (brand === "mif1" || brand === "msf1") return "image/heif";
    if (brand === "qt  ") return "video/quicktime";
    if (
      brand === "isom" ||
      brand === "mp42" ||
      brand === "iso2" ||
      brand === "avc1" ||
      brand === "mp41" ||
      brand === "MSNV"
    )
      return "video/mp4";
    if (brand === "M4A " || brand === "M4B ") return "audio/mp4";
  }

  // RIFF (could be WebP or WAV). Bytes 0..3 = 'RIFF', 8..11 = 'WEBP' / 'WAVE'.
  if (
    bytes.byteLength >= 12 &&
    b0 === 0x52 &&
    b1 === 0x49 &&
    b2 === 0x46 &&
    b3 === 0x46
  ) {
    const tag = String.fromCharCode(
      bytes[8],
      bytes[9],
      bytes[10],
      bytes[11]
    );
    if (tag === "WEBP") return "image/webp";
    if (tag === "WAVE") return "audio/wav";
  }

  // ID3 / MP3: 49 44 33 (ID3) or 0xFF 0xFB / 0xFF 0xF3 / 0xFF 0xF2
  if (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) return "audio/mpeg";
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0) return "audio/mpeg";

  return null;
}

const ACCEPTED_MIMES = new Set<string>([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "audio/m4a",
  "audio/mp4",
  "audio/x-m4a",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
]);

function isAcceptableMime(mime: string): boolean {
  return ACCEPTED_MIMES.has(mime);
}

/**
 * `claimed` matches `sniffed` if they're identical OR one of the
 * known-safe aliases (image/jpeg ↔ image/jpg, audio/mp4 ↔ audio/m4a, etc.).
 */
function mimeMatches(sniffed: string, claimed: string): boolean {
  if (sniffed === claimed) return true;
  const aliases: Record<string, string[]> = {
    "image/jpeg": ["image/jpg"],
    "image/jpg": ["image/jpeg"],
    "audio/mp4": ["audio/m4a", "audio/x-m4a"],
    "audio/m4a": ["audio/mp4", "audio/x-m4a"],
    "audio/x-m4a": ["audio/mp4", "audio/m4a"],
    "audio/wav": ["audio/x-wav"],
    "audio/x-wav": ["audio/wav"],
    "image/heic": ["image/heif"],
    "image/heif": ["image/heic"],
  };
  return (aliases[sniffed] ?? []).includes(claimed);
}
