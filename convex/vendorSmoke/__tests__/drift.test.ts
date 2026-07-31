import { describe, expect, it } from "vitest";
import { z } from "zod";
import { detectDrift, findNonStrictObjects } from "../drift";

describe("detectDrift", () => {
  const schema = z.strictObject({
    id: z.string(),
    count: z.number(),
  });

  it("a matching payload is clean", () => {
    const result = detectDrift({ id: "a", count: 1 }, schema);
    expect(result.ok).toBe(true);
    expect(result.drifts).toEqual([]);
    expect(result.summary).toBe("shape matches");
  });

  it("THE SCAR: an unexpected field fails loudly instead of parsing to nothing", () => {
    // This is the Zernio incident in miniature. A lenient schema would call
    // this a success; the suite must not.
    const result = detectDrift(
      { id: "a", count: 1, platformResults: [{ status: "failed" }] },
      schema
    );
    expect(result.ok).toBe(false);
    expect(result.drifts).toEqual([
      expect.objectContaining({ kind: "unexpected", path: "platformResults" }),
    ]);
  });

  it("reports every unexpected key separately, not as one blob", () => {
    const result = detectDrift({ id: "a", count: 1, x: 1, y: 2, z: 3 }, schema);
    expect(result.drifts.map((d) => d.path).sort()).toEqual(["x", "y", "z"]);
    expect(result.drifts.every((d) => d.kind === "unexpected")).toBe(true);
  });

  it("distinguishes a missing field from a changed type", () => {
    const missing = detectDrift({ id: "a" }, schema);
    expect(missing.drifts).toEqual([
      expect.objectContaining({ kind: "missing", path: "count" }),
    ]);

    const wrongType = detectDrift({ id: "a", count: "1" }, schema);
    expect(wrongType.drifts).toEqual([
      expect.objectContaining({ kind: "wrongType", path: "count" }),
    ]);
  });

  it("reports nested paths in dotted form", () => {
    const nested = z.strictObject({
      post: z.strictObject({ id: z.string() }),
    });
    const result = detectDrift({ post: { id: 1, extra: true } }, nested);
    const paths = result.drifts.map((d) => d.path).sort();
    expect(paths).toEqual(["post.extra", "post.id"]);
  });

  it("reports array element paths", () => {
    const arr = z.strictObject({
      results: z.array(z.strictObject({ ok: z.boolean() })),
    });
    const result = detectDrift({ results: [{ ok: true }, { ok: "yes" }] }, arr);
    expect(result.drifts).toEqual([
      expect.objectContaining({ kind: "wrongType", path: "results.1.ok" }),
    ]);
  });

  it("a non-object payload reports one root cause, not a pile of field errors", () => {
    for (const payload of [null, "gateway timeout", 42]) {
      const result = detectDrift(payload, schema);
      expect(result.ok).toBe(false);
      expect(result.drifts).toHaveLength(1);
      expect(result.drifts[0].kind).toBe("notAnObject");
      expect(result.drifts[0].path).toBe("");
    }
  });

  it("summary leads with unexpected fields — the signal that matters most", () => {
    const result = detectDrift({ id: "a", newField: 1 }, schema);
    expect(result.summary).toMatch(/^1 unexpected/);
  });

  it("summary truncates long drift lists but says how many were dropped", () => {
    const result = detectDrift(
      { id: "a", count: 1, a: 1, b: 2, c: 3, d: 4, e: 5 },
      schema
    );
    expect(result.summary).toMatch(/\+2 more/);
  });
});

describe("findNonStrictObjects — the guard on our own test schemas", () => {
  it("a fully strict schema has no holes", () => {
    const schema = z.strictObject({
      a: z.string(),
      nested: z.strictObject({ b: z.number() }),
      list: z.array(z.strictObject({ c: z.boolean() })),
    });
    expect(findNonStrictObjects(schema)).toEqual([]);
  });

  it("catches the nested-z.object blind spot", () => {
    // The exact mistake this guard exists for: strict at the root, lenient
    // one level down. `{ nested: { b: 1, brandNew: 2 } }` would pass.
    const schema = z.strictObject({
      nested: z.object({ b: z.number() }),
    });
    expect(findNonStrictObjects(schema)).toEqual(["nested"]);
  });

  it("catches a lenient object inside an array", () => {
    const schema = z.strictObject({
      list: z.array(z.object({ c: z.boolean() })),
    });
    expect(findNonStrictObjects(schema)).toEqual(["list.[]"]);
  });

  it("sees through optional and nullable wrappers", () => {
    const schema = z.strictObject({
      maybe: z.object({ d: z.string() }).optional(),
      orNull: z.object({ e: z.string() }).nullable(),
    });
    expect(findNonStrictObjects(schema).sort()).toEqual(["maybe", "orNull"]);
  });

  it("a lenient root is reported as <root>", () => {
    expect(findNonStrictObjects(z.object({ a: z.string() }))).toEqual(["<root>"]);
  });

  it("catches z.looseObject, not just the default z.object", () => {
    // Regression: the first version of this guard keyed off `catchall` merely
    // being present, which made looseObject (catchall = unknown) read as
    // strict. Loose is the MORE permissive of the two — it keeps unknown keys
    // instead of stripping them — so missing it defeated the whole check.
    expect(findNonStrictObjects(z.looseObject({ a: z.string() }))).toEqual([
      "<root>",
    ]);
    expect(
      findNonStrictObjects(
        z.strictObject({ nested: z.looseObject({ b: z.number() }) })
      )
    ).toEqual(["nested"]);
  });

  it("z.strictObject is the only shape that counts as strict", () => {
    expect(findNonStrictObjects(z.strictObject({ a: z.string() }))).toEqual([]);
  });
});
