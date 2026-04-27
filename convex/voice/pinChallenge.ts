/**
 * PIN-challenge module for sensitive CRM voice writes (Wave D — service plan
 * § 13 Sprint 6).
 *
 * Threat model: a voice call's "trust" comes from caller-ID alone. Caller-ID
 * is spoofable. Even with `inboundPolicy: "allowlist"`, a sophisticated
 * attacker can spoof the operator's number from an SS7-adjacent network. PIN
 * challenge converts caller-ID-trust into shared-secret-trust for every
 * sensitive operation Maya can execute on the operator's behalf via voice.
 *
 * Sensitive ops (locked list — service plan § 13 Sprint 6):
 *   - create job
 *   - modify customer record
 *   - send review request
 *   - send invoice
 *   - modify pricing
 *   - post to social platform (gbp, fb, ig, tiktok, etc.)
 *   - modify GBP profile
 *
 * Read-only ops (status query, schedule lookup, brief recap, "what's
 * Maya up to") are NOT PIN-gated — too much friction for the truck-bound
 * operator's primary use case.
 *
 * Hash format: `${saltB64}.${derivedB64}`. PBKDF2-SHA256, 600_000 iterations
 * (NIST 2024 floor for SHA-256), 32-byte salt, 32-byte derived key. We use
 * PBKDF2 (not bcrypt) because the V8 isolate runtime Convex ships exposes
 * `crypto.subtle.deriveBits` natively — bcrypt would require pulling a
 * pure-JS implementation that the isolate can't compile-cache (same
 * rationale as `convex/lib/encryption.ts`).
 *
 * Verification is constant-time. The PIN itself is restricted to 4-6 digit
 * numerics so a 6-digit PIN gives 10^6 = 1M combinations — combined with
 * 600_000 PBKDF2 iterations + a single-call rate limit (one wrong attempt
 * per call), brute force inside a voice call window is infeasible.
 *
 * Test seam: `_setPbkdf2IterationsForTests(n)` lets tests run the same code
 * path with a much smaller iteration count so the suite stays fast.
 *
 * Convex lifecycle:
 *   - `setPinForBusiness(businessId, pin)` — operator's mutation, ensures a
 *     `voiceChannels` row exists; writes `pinHash` + `pinSetAt`.
 *   - `verifyPinForBusiness(ctx, businessId, providedPin)` — internal helper
 *     for sensitive-op gates; fails-closed when `pinHash` is missing.
 *   - `clearPinForBusiness(businessId)` — operator can reset.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type DatabaseReader,
  type DatabaseWriter,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 6;
const PBKDF2_DEFAULT_ITERATIONS = 600_000;
const SALT_BYTES = 32;
const KEY_BYTES = 32;

let __injectedIterations: number | null = null;

/** Test seam — drop the PBKDF2 iteration count for unit tests. */
export function _setPbkdf2IterationsForTests(n: number | null): void {
  __injectedIterations = n;
}

function getIterations(): number {
  return __injectedIterations ?? PBKDF2_DEFAULT_ITERATIONS;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function assertValidPinFormat(pin: string): void {
  if (typeof pin !== "string") {
    throw new Error("pinChallenge: PIN must be a string.");
  }
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    throw new Error(
      `pinChallenge: PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits.`
    );
  }
  if (!/^[0-9]+$/.test(pin)) {
    throw new Error("pinChallenge: PIN must contain digits only.");
  }
}

/**
 * Derive a PBKDF2-SHA256 key from a PIN + salt. Returns the raw derived
 * bytes; encoding into the storage format is `hashPin`'s job.
 */
async function deriveKey(
  pin: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const saltBuf = salt.buffer.slice(
    salt.byteOffset,
    salt.byteOffset + salt.byteLength
  ) as ArrayBuffer;
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBuf,
      iterations,
    },
    baseKey,
    KEY_BYTES * 8
  );
  return new Uint8Array(bits);
}

/**
 * Hash a PIN for at-rest storage. Format: `${saltB64}.${derivedB64}`. Both
 * components are URL-safe-free base64 (standard).
 *
 * Throws on invalid format. Random salt per call so two equal PINs never
 * produce the same hash.
 */
export async function hashPin(pin: string): Promise<string> {
  assertValidPinFormat(pin);
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const derived = await deriveKey(pin, salt, getIterations());
  return `${bytesToBase64(salt)}.${bytesToBase64(derived)}`;
}

/**
 * Verify a PIN against a stored hash. Constant-time. Returns false on any
 * malformed input rather than throwing — sensitive-op callers always treat
 * a non-true return as "fail-closed, deny operation".
 */
export async function verifyPinHash(
  pin: string,
  storedHash: string | null | undefined
): Promise<boolean> {
  if (!storedHash || typeof storedHash !== "string") return false;
  if (typeof pin !== "string") return false;
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) return false;
  if (!/^[0-9]+$/.test(pin)) return false;

  const parts = storedHash.split(".");
  if (parts.length !== 2) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64ToBytes(parts[0]);
    expected = base64ToBytes(parts[1]);
  } catch {
    return false;
  }
  if (salt.length !== SALT_BYTES) return false;
  if (expected.length !== KEY_BYTES) return false;

  const derived = await deriveKey(pin, salt, getIterations());
  return constantTimeEqualBytes(derived, expected);
}

/* -------------------------------------------------------------------------- */
/* Convex surface                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Read the stored hash for a business's voice channel. Internal-only — never
 * exposed publicly because the hash itself is sensitive.
 */
export const getVoicePinHashForBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (
    ctx,
    args
  ): Promise<{ hash: string | null; channelId: Id<"voiceChannels"> | null }> => {
    const channel = await readVoiceChannelForBusiness(ctx.db, args.businessId);
    return {
      hash: channel?.pinHash ?? null,
      channelId: channel?._id ?? null,
    };
  },
});

/**
 * Operator-driven PIN setup. The Profile UI calls this via a server action.
 * Cross-tenant: the action wrapper resolves businessId via Clerk identity
 * (lives in `convex/voice/transcripts.ts` as `setMyVoicePin`) — this internal
 * mutation accepts businessId directly because tests need to drive it.
 */
export const setPinForBusinessInternal = internalMutation({
  args: {
    businessId: v.id("businesses"),
    pinHash: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"voiceChannels">> => {
    const channel = await readVoiceChannelForBusiness(ctx.db, args.businessId);
    if (!channel) {
      throw new Error(
        `pinChallenge: voiceChannels row missing for business ${args.businessId}. Provision the Twilio number first.`
      );
    }
    await ctx.db.patch(channel._id, {
      pinHash: args.pinHash,
      pinSetAt: Date.now(),
    });
    return channel._id;
  },
});

/**
 * Operator clears their PIN. Sensitive ops will fail-closed afterwards
 * (no PIN = no sensitive voice writes).
 */
export const clearPinForBusinessInternal = internalMutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<void> => {
    const channel = await readVoiceChannelForBusiness(ctx.db, args.businessId);
    if (!channel) return;
    await ctx.db.patch(channel._id, {
      pinHash: undefined,
      pinSetAt: undefined,
    });
  },
});

async function readVoiceChannelForBusiness(
  db: DatabaseReader | DatabaseWriter,
  businessId: Id<"businesses">
): Promise<{
  _id: Id<"voiceChannels">;
  pinHash?: string;
  pinSetAt?: number;
} | null> {
  const row = await db
    .query("voiceChannels")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .first();
  return row;
}
