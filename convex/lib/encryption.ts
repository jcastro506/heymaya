/**
 * AES-256-GCM for small secrets at rest (calendar tokens). Ported from legacy
 * `convex/lib/encryption.ts` (salvage verdict PORT). Web Crypto only: Convex runs
 * in a V8 isolate where `node:crypto` is not guaranteed.
 *
 * Key: `ENCRYPTION_KEY`, base64 of 32 random bytes (`openssl rand -base64 32`), set
 * per deployment and never shared between deployments. Stored format is base64 of
 * `iv (12) || ciphertext+tag`. Rotation would need a keyVersion field; not yet.
 */

export const ENCRYPTION_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: CryptoKey | null = null;

async function loadKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("encryption: ENCRYPTION_KEY is not set (openssl rand -base64 32)");
  const keyBytes = base64ToBytes(raw);
  if (keyBytes.length !== ENCRYPTION_KEY_BYTES) throw new Error(`encryption: ENCRYPTION_KEY must decode to ${ENCRYPTION_KEY_BYTES} bytes (got ${keyBytes.length})`);
  cachedKey = await crypto.subtle.importKey("raw", keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  return cachedKey;
}

/** Tests: drop the cached key so a stubbed env var is re-read. */
export function _resetEncryptionKeyCache(): void {
  cachedKey = null;
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await loadKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: TAG_BYTES * 8 }, key, new TextEncoder().encode(plaintext)));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return bytesToBase64(out);
}

export async function decrypt(blob: string): Promise<string> {
  const key = await loadKey();
  const all = base64ToBytes(blob);
  if (all.length < IV_BYTES + TAG_BYTES) throw new Error("decrypt: ciphertext too short");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, IV_BYTES), tagLength: TAG_BYTES * 8 }, key, all.slice(IV_BYTES));
  return new TextDecoder().decode(plain);
}

function base64ToBytes(b64: string): Uint8Array {
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
