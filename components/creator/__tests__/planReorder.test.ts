/**
 * planReorder + groupByStatus — pure-logic unit tests.
 *
 * These reducers underpin the Plan screen's drag-and-drop and the Deals
 * screen's kanban grouping. Pure functions, no React, no Convex — they
 * earn unit tests on math + edge cases (out-of-range indices, empty
 * arrays, status keys not present in the order list).
 */

import { describe, it, expect } from "vitest";
import { reorderArc, groupByStatus } from "../planReorder";

describe("reorderArc", () => {
  it("moves a middle entry forward", () => {
    const r = reorderArc(["a", "b", "c", "d"], 1, 3);
    expect(r).toEqual(["a", "c", "d", "b"]);
  });

  it("moves a later entry backward", () => {
    const r = reorderArc(["a", "b", "c", "d"], 3, 0);
    expect(r).toEqual(["d", "a", "b", "c"]);
  });

  it("returns a copy when from === to (no-op)", () => {
    const src = ["a", "b", "c"];
    const r = reorderArc(src, 1, 1);
    expect(r).toEqual(src);
    expect(r).not.toBe(src); // fresh array, never the same reference
  });

  it("ADVERSARIAL: out-of-range fromIdx returns a copy unchanged", () => {
    const r = reorderArc(["a", "b"], 5, 0);
    expect(r).toEqual(["a", "b"]);
  });

  it("ADVERSARIAL: out-of-range toIdx returns a copy unchanged", () => {
    const r = reorderArc(["a", "b"], 0, 7);
    expect(r).toEqual(["a", "b"]);
  });

  it("handles empty arrays", () => {
    const r = reorderArc<string>([], 0, 0);
    expect(r).toEqual([]);
  });
});

describe("groupByStatus", () => {
  type Status = "new" | "signed" | "paid";
  const ORDER: ReadonlyArray<Status> = ["new", "signed", "paid"];

  it("groups rows by status preserving the order keys", () => {
    const rows = [
      { id: 1, status: "new" as const },
      { id: 2, status: "paid" as const },
      { id: 3, status: "new" as const },
    ];
    const r = groupByStatus(rows, ORDER);
    expect(r.new.map((x) => x.id)).toEqual([1, 3]);
    expect(r.paid.map((x) => x.id)).toEqual([2]);
    expect(r.signed).toEqual([]);
  });

  it("returns empty buckets for the configured statuses on empty input", () => {
    const r = groupByStatus<Status, { status: Status }>([], ORDER);
    expect(r.new).toEqual([]);
    expect(r.signed).toEqual([]);
    expect(r.paid).toEqual([]);
  });

  it("ADVERSARIAL: rows with statuses not in the order list are silently dropped", () => {
    // Construct the array with a literal `Status` type so the legitimate row
    // satisfies the typed bound; the unknown row is cast through `unknown`
    // to a `{ status: Status }` shape so it reaches `groupByStatus` while
    // still exercising the runtime "unknown bucket dropped" behavior.
    const rows: Array<{ id: number; status: Status }> = [
      { id: 1, status: "new" },
      { id: 2, status: "unknown" as unknown as Status },
    ];
    const r = groupByStatus(rows, ORDER);
    expect(r.new).toHaveLength(1);
    // The unknown bucket is not created; iteration always sees only the
    // configured order keys.
    expect(Object.keys(r).sort()).toEqual(["new", "paid", "signed"]);
  });
});
