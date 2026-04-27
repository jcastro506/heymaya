/**
 * AES-256-GCM helper for at-rest encryption of small secrets (Composio account
 * tokens, channel pairing codes, etc.) we stash inside Convex.
 *
 * v0 scope:
 *  - Single symmetric key sourced from process.env.ENCRYPTION_KEY (base64,
 *    32 bytes once decoded). The operator generates this once at branch
 *    bootstrap (`openssl rand -base64 32`) and stores it in the Convex deploy's
 *    environment.
 *  - 12-byte random IV per ciphertext, prepended to the output. Tag is 16 bytes
 *    appended (Web Crypto's GCM puts tag at the end of the ciphertext buffer).
 *  - Stored format is base64 of:  iv (12) || ciphertext+tag (n+16).
 *
 * Why Web Crypto and not node:crypto:
 *  - Convex runs on Edge runtime (V8 isolate). `node:crypto` is not always
 *    available. `globalThis.crypto.subtle` is.
 *
 * Threat model: this protects tokens at rest in Convex if a Convex DB dump
 * leaks. It does NOT protect against a compromised Convex deployment env (the
 * key lives there). Rotating the key requires re-encrypting every row — out of
 * scope for v0 (we'll add a `keyVersion` field if we ever rotate).
 */

export const ENCRYPTION_KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96 bits — GCM standard
const TAG_BYTES = 16; // 128-bit auth tag

let cachedKey: CryptoKey | null = null;

async function loadKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "encryption: ENCRYPTION_KEY is not set. " +
        "Generate with `openssl rand -base64 32` and set in Convex env."
    );
  }
  const keyBytes = base64ToBytes(raw);
  if (keyBytes.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error(
      `encryption: ENCRYPTION_KEY must decode to ${ENCRYPTION_KEY_BYTES} bytes ` +
        `(got ${keyBytes.length}). Use \`openssl rand -base64 32\`.`
    );
  }
  cachedKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  return cachedKey;
}

/** For tests — drop the cached key so a stubbed env var is re-read. */
export function _resetEncryptionKeyCache(): void {
  cachedKey = null;
}

export async function encrypt(plaintext: string): Promise<string> {
  if (typeof plaintext !== "string") {
    throw new Error("encrypt: plaintext must be a string");
  }
  const key = await loadKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const enc = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: TAG_BYTES * 8 },
    key,
    enc
  );
  const cipher = new Uint8Array(cipherBuf);
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return bytesToBase64(out);
}

export async function decrypt(blob: string): Promise<string> {
  if (typeof blob !== "string") {
    throw new Error("decrypt: blob must be a base64 string");
  }
  const key = await loadKey();
  const all = base64ToBytes(blob);
  if (all.length < IV_BYTES + TAG_BYTES) {
    throw new Error("decrypt: ciphertext too short");
  }
  const iv = all.slice(0, IV_BYTES);
  const cipher = all.slice(IV_BYTES);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: TAG_BYTES * 8 },
    key,
    cipher
  );
  return new TextDecoder().decode(plainBuf);
}

/* -------------------------------------------------------------------------- */
/* base64 helpers — work on both Node and Edge runtimes                        */
/* -------------------------------------------------------------------------- */

function base64ToBytes(b64: string): Uint8Array {
  // atob is available in both Node 20+ and Edge.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
