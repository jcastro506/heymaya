/**
 * Cloudflare R2 client — S3-compatible API.
 *
 * Purpose
 * -------
 * Service-product Sprint 3.5: every photo / video / audio note the operator
 * sends to Maya is durably stored in our own R2 bucket so OpenClaw never has
 * to re-fetch from the operator's BlueBubbles host (which has the SSRF guard
 * CVE / HEIC / race-condition bugs documented in R3 § 2). This client is the
 * thin wire layer the photo-bridge + cataloger consume.
 *
 * Why a hand-rolled SigV4 instead of `@aws-sdk/client-s3`?
 *   - Convex's Node runtime does not bundle the AWS SDK and we do not want to
 *     ship a 2MB dependency for three calls (PutObject, presigned GET,
 *     DeleteObject). The signing surface we need is small + audit-friendly.
 *   - WebCrypto (`crypto.subtle`) is universally available in both Convex's
 *     edge-style Node runtime and the convex-test edge-runtime VM, so the
 *     same code path runs in production and tests.
 *
 * Auth
 * ----
 * All four env vars must be present, otherwise constructing or using the
 * client throws `R2AuthError`:
 *   - R2_ACCOUNT_ID         — Cloudflare account id; encodes the endpoint
 *   - R2_ACCESS_KEY_ID      — S3 API access key issued for the bucket
 *   - R2_SECRET_ACCESS_KEY  — S3 API secret
 *   - R2_BUCKET_NAME        — bucket name (we never accept it from input)
 *
 * Cross-tenant safety
 * -------------------
 * This module never reads `businessId` from request bodies — `endpoints.ts`
 * accepts `businessId` only from the calling Convex action / mutation, which
 * has already resolved it from authenticated context. The bucket key path
 * (`businesses/{businessId}/{sha256}.{ext}`) is tenant-scoped by construction.
 *
 * Test seam
 * ---------
 * `_setR2ClientForTests(impl)` swaps the production HTTP impl for a fake.
 * Always reset in `afterEach` to avoid leakage between tests.
 */

export class R2AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "R2AuthError";
  }
}

export class R2HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string
  ) {
    super(
      `R2 HTTP ${status} for ${url}: ${body.slice(0, 500)}`
    );
    this.name = "R2HttpError";
  }
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  /** Optional override for tests / staging. */
  endpointHost?: string;
}

export interface R2PutInputs {
  /** Storage key, e.g. `businesses/{businessId}/{sha256}.jpg`. */
  key: string;
  body: Uint8Array;
  contentType: string;
  /**
   * Optional metadata. Stored as `x-amz-meta-*` headers. Keys are lowercased
   * by R2 on retrieval; values must be ASCII.
   */
  metadata?: Record<string, string>;
}

export interface R2PutResult {
  /** The S3-style virtual-host URL (`https://{bucket}.{host}/{key}`). */
  storageUrl: string;
  /** ETag returned by R2 (typically the md5 of the body). */
  etag: string | null;
}

export interface R2SignedUrlInputs {
  key: string;
  expiresInSec: number;
  /** Optional `response-content-type` query override. */
  responseContentType?: string;
}

export interface R2DeleteInputs {
  key: string;
}

export interface R2ClientImpl {
  putObject(input: R2PutInputs): Promise<R2PutResult>;
  getSignedDownloadUrl(input: R2SignedUrlInputs): Promise<string>;
  deleteObject(input: R2DeleteInputs): Promise<void>;
  /** Returns the bucket name (for path validation). */
  getBucketName(): string;
}

let __injectedClient: R2ClientImpl | null = null;

/**
 * Test seam — swap the R2 client implementation. `null` resets to the
 * production HTTP impl. Always reset in `afterEach`.
 */
export function _setR2ClientForTests(impl: R2ClientImpl | null): void {
  __injectedClient = impl;
}

/**
 * Build the production client from env. Throws `R2AuthError` if any of the
 * four required env vars are missing or empty.
 */
export function buildR2ClientFromEnv(): R2ClientImpl {
  if (__injectedClient) return __injectedClient;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new R2AuthError(
      "R2 client unconfigured — set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME."
    );
  }
  return new R2HttpClient({
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
  });
}

/* -------------------------------------------------------------------------- */
/* HTTP client implementation                                                  */
/* -------------------------------------------------------------------------- */

const REGION = "auto" as const;
const SERVICE = "s3" as const;

export class R2HttpClient implements R2ClientImpl {
  private readonly cfg: R2Config;
  private readonly fetchImpl: typeof fetch;
  private readonly host: string;

  constructor(cfg: R2Config, fetchImpl?: typeof fetch) {
    this.cfg = cfg;
    this.fetchImpl = fetchImpl ?? fetch.bind(globalThis);
    this.host =
      cfg.endpointHost ?? `${cfg.accountId}.r2.cloudflarestorage.com`;
  }

  getBucketName(): string {
    return this.cfg.bucketName;
  }

  async putObject(input: R2PutInputs): Promise<R2PutResult> {
    if (!input.key || input.key.startsWith("/")) {
      throw new Error(`R2 key must be non-empty + not start with '/': '${input.key}'`);
    }
    const url = this.buildUrl(input.key);
    const method = "PUT";
    const headers: Record<string, string> = {
      "content-type": input.contentType,
      "content-length": String(input.body.byteLength),
    };
    if (input.metadata) {
      for (const [k, v] of Object.entries(input.metadata)) {
        headers[`x-amz-meta-${k.toLowerCase()}`] = v;
      }
    }
    const signed = await signRequest({
      cfg: this.cfg,
      host: this.host,
      method,
      path: this.canonicalPath(input.key),
      query: "",
      headers,
      body: input.body,
    });
    const res = await this.fetchImpl(url, {
      method,
      headers: signed.headers,
      body: input.body as unknown as BodyInit,
    });
    if (!res.ok) {
      const body = await safeText(res);
      throw new R2HttpError(res.status, url, body);
    }
    return {
      storageUrl: url,
      etag: res.headers.get("etag"),
    };
  }

  async getSignedDownloadUrl(input: R2SignedUrlInputs): Promise<string> {
    if (input.expiresInSec < 1 || input.expiresInSec > 7 * 24 * 60 * 60) {
      throw new Error(
        `R2 signed-url TTL must be 1s..7d (got ${input.expiresInSec}s)`
      );
    }
    return await presignGet({
      cfg: this.cfg,
      host: this.host,
      path: this.canonicalPath(input.key),
      expiresInSec: input.expiresInSec,
      responseContentType: input.responseContentType,
    });
  }

  async deleteObject(input: R2DeleteInputs): Promise<void> {
    const url = this.buildUrl(input.key);
    const method = "DELETE";
    const headers: Record<string, string> = {};
    const signed = await signRequest({
      cfg: this.cfg,
      host: this.host,
      method,
      path: this.canonicalPath(input.key),
      query: "",
      headers,
      body: new Uint8Array(),
    });
    const res = await this.fetchImpl(url, {
      method,
      headers: signed.headers,
    });
    // S3 DELETE returns 204 on success, 404 is "already gone" — both are OK.
    if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
      const body = await safeText(res);
      throw new R2HttpError(res.status, url, body);
    }
  }

  private canonicalPath(key: string): string {
    // Virtual-hosted-style: bucket lives in the host, path is `/{key}`.
    return `/${encodePath(key)}`;
  }

  private buildUrl(key: string): string {
    return `https://${this.cfg.bucketName}.${this.host}${this.canonicalPath(key)}`;
  }
}

/* -------------------------------------------------------------------------- */
/* SigV4 — minimal subset for PutObject / DeleteObject                         */
/* -------------------------------------------------------------------------- */

interface SignInputs {
  cfg: R2Config;
  host: string;
  method: string;
  /** URL-encoded path including leading `/`. */
  path: string;
  /** Sorted, encoded query string (without leading `?`). */
  query: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

interface SignOutput {
  headers: Record<string, string>;
}

async function signRequest(inputs: SignInputs): Promise<SignOutput> {
  const now = new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(inputs.body);

  // Always-present signed headers.
  const fullHeaders: Record<string, string> = {
    ...inputs.headers,
    host: `${inputs.cfg.bucketName}.${inputs.host}`,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };

  const { canonical, signedHeaders } = canonicalHeaders(fullHeaders);
  const canonicalRequest = [
    inputs.method,
    inputs.path,
    inputs.query,
    canonical,
    "",
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");

  const signingKey = await deriveSigningKey({
    secret: inputs.cfg.secretAccessKey,
    dateStamp,
  });
  const signature = bytesToHex(
    await hmacSha256(signingKey, new TextEncoder().encode(stringToSign))
  );

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${inputs.cfg.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    headers: {
      ...fullHeaders,
      authorization,
    },
  };
}

interface PresignInputs {
  cfg: R2Config;
  host: string;
  path: string;
  expiresInSec: number;
  responseContentType?: string;
}

async function presignGet(inputs: PresignInputs): Promise<string> {
  const now = new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const credential = `${inputs.cfg.accessKeyId}/${credentialScope}`;

  const queryParams: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(inputs.expiresInSec)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  if (inputs.responseContentType) {
    queryParams.push(["response-content-type", inputs.responseContentType]);
  }
  // Encode + sort by key.
  const encodedQuery = queryParams
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const fullHeaders: Record<string, string> = {
    host: `${inputs.cfg.bucketName}.${inputs.host}`,
  };
  const { canonical, signedHeaders } = canonicalHeaders(fullHeaders);

  const canonicalRequest = [
    "GET",
    inputs.path,
    encodedQuery,
    canonical,
    "",
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");

  const signingKey = await deriveSigningKey({
    secret: inputs.cfg.secretAccessKey,
    dateStamp,
  });
  const signature = bytesToHex(
    await hmacSha256(signingKey, new TextEncoder().encode(stringToSign))
  );

  return (
    `https://${inputs.cfg.bucketName}.${inputs.host}${inputs.path}` +
    `?${encodedQuery}&X-Amz-Signature=${signature}`
  );
}

function canonicalHeaders(
  headers: Record<string, string>
): { canonical: string; signedHeaders: string } {
  const lower: Array<[string, string]> = Object.entries(headers).map(
    ([k, v]) => [k.toLowerCase().trim(), String(v).trim()]
  );
  lower.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonical = lower.map(([k, v]) => `${k}:${v}`).join("\n");
  const signedHeaders = lower.map(([k]) => k).join(";");
  return { canonical, signedHeaders };
}

async function deriveSigningKey(opts: {
  secret: string;
  dateStamp: string;
}): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const kDate = await hmacSha256(
    enc.encode(`AWS4${opts.secret}`),
    enc.encode(opts.dateStamp)
  );
  const kRegion = await hmacSha256(kDate, enc.encode(REGION));
  const kService = await hmacSha256(kRegion, enc.encode(SERVICE));
  const kSigning = await hmacSha256(kService, enc.encode("aws4_request"));
  return kSigning;
}

async function hmacSha256(
  key: Uint8Array,
  data: Uint8Array
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    data as BufferSource
  );
  return new Uint8Array(sig);
}

async function sha256Hex(data: Uint8Array | ArrayBuffer): Promise<string> {
  const buf =
    data instanceof Uint8Array
      ? (data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength
        ) as ArrayBuffer)
      : data;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return bytesToHex(new Uint8Array(hash));
}

export async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  return await sha256Hex(bytes);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function formatAmzDate(d: Date): string {
  // YYYYMMDDTHHMMSSZ
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * RFC-3986 encode — like `encodeURIComponent` but also encodes `!`, `'`,
 * `(`, `)`, `*`. Required for SigV4 canonical-query encoding.
 */
function encodeRfc3986(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * Encode each path segment but preserve the `/` separators. This matches what
 * S3 expects in the canonical-request path component.
 */
function encodePath(key: string): string {
  return key
    .split("/")
    .map((seg) => encodeRfc3986(seg))
    .join("/");
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<failed to read body>";
  }
}

/* -------------------------------------------------------------------------- */
/* Public helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Build the per-business R2 storage key. Tenant-scoping is enforced by
 * construction — the businessId is always the first path segment under
 * `businesses/`. Same-bytes-different-business → distinct key.
 */
export function buildAssetKey(opts: {
  businessId: string;
  contentHash: string;
  ext: string;
}): string {
  if (!/^[a-f0-9]{64}$/.test(opts.contentHash)) {
    throw new Error(
      `R2 contentHash must be lowercase 64-char hex (got '${opts.contentHash}')`
    );
  }
  if (!/^[a-z0-9]{1,8}$/.test(opts.ext)) {
    throw new Error(`R2 ext must be 1..8 lowercase alnum (got '${opts.ext}')`);
  }
  if (!opts.businessId || /[/\\\s]/.test(opts.businessId)) {
    throw new Error(
      `R2 businessId must be non-empty + slash/whitespace-free (got '${opts.businessId}')`
    );
  }
  return `businesses/${opts.businessId}/${opts.contentHash}.${opts.ext}`;
}

/**
 * Map a mime type to an extension. Conservative: anything outside the
 * known-safe table falls back to "bin" so we never accept a random mime.
 */
export function extensionForMime(mime: string): string {
  const m = mime.toLowerCase().trim();
  switch (m) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/heic":
    case "image/heif":
      return "heic";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    case "audio/m4a":
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    default:
      return "bin";
  }
}
