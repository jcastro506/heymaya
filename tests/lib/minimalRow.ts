/**
 * Build the smallest row a table will accept, from the table's own validator.
 *
 * ⚠️ Deliberately NOT a hand-written fixture per table. A fixture list is the
 * same artefact behind the account-deletion bug these tests were written for —
 * it goes stale the first time someone adds a required field, and the failure
 * reads as a broken test rather than as missing coverage, so it gets skipped.
 *
 * Shared by the deletion and export suites: both need "one valid row in every
 * customer-scoped table", and neither should own a copy of how to make one.
 */

import schema from "../../convex/schema";

/** The one capability the generator needs, unbound from the schema's types. */
export interface InsertCtx {
  db: { insert: (t: string, v: unknown) => Promise<unknown> };
}

/**
 * Build the smallest row a table will accept, from the table's own validator.
 *
 * ⚠️ Deliberately NOT a hand-written fixture per table. A fixture list is the
 * same artefact that caused this bug — it goes stale the first time someone
 * adds a required field, and the failure looks like a broken test rather than
 * missing coverage, so it gets skipped.
 */
export async function minimalRow(
  ctx: InsertCtx,
  tableName: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const validator = (
    schema as unknown as {
      tables: Record<string, { validator: { fields: Record<string, Field> } }>;
    }
  ).tables[tableName].validator;

  const row: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(validator.fields)) {
    if (field.isOptional === "optional") continue;
    // A field the caller supplies is never sampled — that is how required
    // `v.id(...)` fields get a real row to point at instead of a fake string.
    if (name in overrides) continue;
    /**
     * A required foreign key gets a REAL row, inserted here. `dayPlans.ideaId`
     * is the only one today; doing it generally means the next one doesn't
     * turn this into a broken test somebody skips.
     */
    if (field.kind === "id") {
      const target = field.tableName as string;
      const inherited =
        "customerId" in overrides ? { customerId: overrides.customerId } : {};
      row[name] = await ctx.db.insert(
        target,
        await minimalRow(ctx as unknown as InsertCtx, target, inherited),
      );
      continue;
    }
    row[name] = sampleFor(field);
  }
  return { ...row, ...overrides };
}

interface Field {
  kind: string;
  tableName?: string;
  isOptional?: string;
  value?: unknown;
  member?: Field;
  members?: Field[];
  fields?: Record<string, Field>;
}

function sampleFor(field: Field): unknown {
  switch (field.kind) {
    case "string":
      return "x";
    case "float64":
    case "int64":
      return field.kind === "int64" ? BigInt(1) : 1;
    case "boolean":
      return false;
    case "literal":
      return field.value;
    case "array":
      return [];
    case "object":
      return Object.fromEntries(
        Object.entries(field.fields ?? {})
          .filter(([, f]) => f.isOptional !== "optional")
          .map(([k, f]) => [k, sampleFor(f)]),
      );
    case "union":
      return sampleFor((field.members ?? [])[0]);
    case "record":
      return {};
    case "null":
      return null;
    default:
      // `id` included: no valid foreign row exists here, and every id field on
      // these tables other than customerId is optional. If that stops being
      // true this throws loudly rather than inserting something bogus.
      throw new Error(`no sample for validator kind "${field.kind}"`);
  }
}
