/**
 * Pure reducer for the Plan screen's HTML5 drag-and-drop reordering.
 *
 * Split out of `app/(creator)/plan/page.tsx` so it can be unit-tested
 * without rendering React. The reducer is intentionally immutable +
 * pure — no side effects, no Convex calls. The page wires the result
 * into `setArcOverride` for in-session reorder; Sprint 6 persists.
 */

export type PlanArcEntry = {
  dayOffset: number;
  platform: "tiktok" | "instagram" | "youtube" | "linkedin" | "x";
  format: string;
  hookOptions: string[];
  captionDraft: string;
  postingTimeLocal: string;
  status: "draft" | "approved" | "posted";
};

/**
 * Move the entry at `fromIdx` to `toIdx`, returning a fresh array. Both
 * indices are bounds-checked — out-of-range or equal indices return the
 * source array unchanged so the caller can call this unconditionally
 * inside an event handler.
 */
export function reorderArc<T>(
  arc: ReadonlyArray<T>,
  fromIdx: number,
  toIdx: number
): T[] {
  if (fromIdx === toIdx) return arc.slice();
  if (fromIdx < 0 || fromIdx >= arc.length) return arc.slice();
  if (toIdx < 0 || toIdx >= arc.length) return arc.slice();
  const next = arc.slice();
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

/**
 * Group an array of brand deals (or pitches) by `status`, preserving the
 * caller-supplied status order so empty columns still render in the kanban.
 *
 * Used by both the Deals (Inbound + Outbound) screens. Lifted here for
 * unit-testability and to keep the page components free of grouping logic.
 */
export function groupByStatus<
  TStatus extends string,
  TRow extends { status: TStatus },
>(
  rows: ReadonlyArray<TRow>,
  order: ReadonlyArray<TStatus>
): Record<TStatus, TRow[]> {
  const out = {} as Record<TStatus, TRow[]>;
  for (const s of order) out[s] = [];
  for (const row of rows) {
    if (out[row.status] !== undefined) {
      out[row.status].push(row);
    }
  }
  return out;
}
