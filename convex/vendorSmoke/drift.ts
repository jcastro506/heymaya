/**
 * Vendor smoke suite — drift detection.
 *
 * Why this exists: the Zernio publish failures returned 200s for six days. The
 * response was a `{post, platformResults}` wrapper, and our all-optional
 * `.passthrough()` schema parsed it "successfully" into nothing. Real errors
 * were swallowed. A status-code check would have passed every single day.
 *
 * So the inversion that defines this whole module:
 *
 *   Production parses leniently to stay up.
 *   The smoke suite parses strictly to detect drift.
 *
 * The client may tolerate an unexpected field. The smoke test must fail loudly
 * on one — an unexpected field is how you learn the vendor changed the contract
 * BEFORE it costs you six days.
 *
 * This module is pure: payload + schema in, classified drift out. No network,
 * no database, no env. That's what makes it testable without a vendor key.
 */

import { z } from "zod";

/**
 * How a payload diverged from what we expect.
 *
 * - `unexpected` — upstream sent a field we don't know about. THE important
 *   one: it's the shape of every silent-contract-change incident.
 * - `missing` — our schema requires a field upstream didn't send.
 * - `wrongType` — the field is there, the type changed underneath us.
 * - `notAnObject` — the payload isn't the shape we expected at all (an array
 *   where an object was promised, a bare string, `null`).
 */
export type DriftKind = "unexpected" | "missing" | "wrongType" | "notAnObject";

export interface Drift {
  kind: DriftKind;
  /** Dotted path, e.g. `platformResults.0.status`. Empty string = the root. */
  path: string;
  /** Human-readable specifics — what we expected vs what arrived. */
  detail: string;
}

export interface DriftResult {
  ok: boolean;
  drifts: Drift[];
  /** One-line summary suitable for an alert body. */
  summary: string;
}

function joinPath(path: ReadonlyArray<PropertyKey>): string {
  return path.map((segment) => String(segment)).join(".");
}

/**
 * Classify a zod issue into our drift vocabulary.
 *
 * zod v4 shapes we care about:
 *   - `unrecognized_keys` carries a `keys: string[]` and a path to the OBJECT
 *     that held them, so one issue can expand into several drifts.
 *   - `invalid_type` with `received: "undefined"` is a missing field; with any
 *     other received value it's a type change.
 */
function classify(issue: z.core.$ZodIssue): Drift[] {
  const base = joinPath(issue.path);

  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({
      kind: "unexpected" as const,
      path: base ? `${base}.${key}` : key,
      detail: `upstream sent a field our schema doesn't know about`,
    }));
  }

  if (issue.code === "invalid_type") {
    // zod v4 words a missing field as "expected X, received undefined". The
    // message is the only place `received` survives on the public issue type.
    const isMissing = /received undefined/.test(issue.message);
    return [
      {
        kind: isMissing ? ("missing" as const) : ("wrongType" as const),
        path: base,
        detail: issue.message,
      },
    ];
  }

  return [
    {
      kind: "wrongType",
      path: base,
      detail: issue.message,
    },
  ];
}

function summarize(drifts: ReadonlyArray<Drift>): string {
  if (drifts.length === 0) return "shape matches";
  const counts = new Map<DriftKind, number>();
  for (const drift of drifts) {
    counts.set(drift.kind, (counts.get(drift.kind) ?? 0) + 1);
  }
  const parts: string[] = [];
  // Deliberate order: `unexpected` leads, because a field we've never seen is
  // the signal that the vendor changed something under us.
  for (const kind of ["unexpected", "missing", "wrongType", "notAnObject"] as const) {
    const n = counts.get(kind);
    if (n) parts.push(`${n} ${kind}`);
  }
  const worst = drifts.slice(0, 3).map((d) => (d.path === "" ? "<root>" : d.path));
  return `${parts.join(", ")} — ${worst.join(", ")}${
    drifts.length > 3 ? `, +${drifts.length - 3} more` : ""
  }`;
}

/**
 * Strict-parse a raw vendor payload and classify every way it diverged.
 *
 * The caller supplies the schema. It MUST be strict at every level — a
 * `z.object()` nested inside a `z.strictObject()` silently allows unknown keys
 * at that level, which is exactly the blind spot this suite exists to close.
 * `assertStrict()` below is the guard for that.
 */
export function detectDrift(payload: unknown, schema: z.ZodType): DriftResult {
  const parsed = schema.safeParse(payload);
  if (parsed.success) {
    return { ok: true, drifts: [], summary: "shape matches" };
  }

  // A non-object payload where an object was promised produces a pile of
  // confusing per-field issues. Report the root cause instead.
  const rootIsWrong =
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) !== schema instanceof z.ZodArray;
  if (rootIsWrong && (payload === null || typeof payload !== "object")) {
    const drifts: Drift[] = [
      {
        kind: "notAnObject",
        path: "",
        detail: `payload is ${payload === null ? "null" : typeof payload}`,
      },
    ];
    return { ok: false, drifts, summary: summarize(drifts) };
  }

  const drifts = parsed.error.issues.flatMap(classify);
  return { ok: false, drifts, summary: summarize(drifts) };
}

/**
 * Guard against the nested-`z.object()` blind spot.
 *
 * Walks a schema and returns the paths of any object node that is NOT strict.
 * A registry entry with a non-empty result here is a bug in the TEST, not the
 * vendor — it would report "shape matches" on a payload carrying brand-new
 * nested fields. The registry test asserts this returns empty for every entry.
 */
export function findNonStrictObjects(
  schema: z.ZodType,
  path: ReadonlyArray<string> = [],
  seen: Set<unknown> = new Set()
): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);

  const found: string[] = [];
  const def = (schema as unknown as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
  if (!def) return found;

  const type = def.type as string | undefined;

  if (type === "object") {
    // zod v4 encodes the unknown-key policy as the `catchall` schema:
    //   strictObject → catchall is `never`  (an extra key is an error)
    //   object       → catchall is absent   (extra keys are stripped, silently)
    //   looseObject  → catchall is `unknown` (extra keys are kept, silently)
    // Only the first one fails on drift, so anything else is a hole.
    const catchallType = (
      def.catchall as { _zod?: { def?: { type?: string } } } | undefined
    )?._zod?.def?.type;
    if (catchallType !== "never") {
      found.push(path.length === 0 ? "<root>" : path.join("."));
    }
    const shape = (def.shape ?? {}) as Record<string, z.ZodType>;
    for (const [key, child] of Object.entries(shape)) {
      found.push(...findNonStrictObjects(child, [...path, key], seen));
    }
    return found;
  }

  // Unwrap the containers that can hold an object: arrays, optionals,
  // nullables, defaults, unions.
  const children: z.ZodType[] = [];
  for (const key of ["element", "innerType", "in", "out"]) {
    const child = (def as Record<string, unknown>)[key];
    if (child && typeof child === "object") children.push(child as z.ZodType);
  }
  const options = (def as { options?: z.ZodType[] }).options;
  if (Array.isArray(options)) children.push(...options);

  const suffix = type === "array" ? [...path, "[]"] : path;
  for (const child of children) {
    found.push(...findNonStrictObjects(child, suffix, seen));
  }
  return found;
}
