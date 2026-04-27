/**
 * Customer list rows for `/biz/customers`.
 *
 * Renders LTV + last interaction + review status. Click → parent opens the
 * `CustomerDetail` panel.
 */

import type { Doc } from "@/convex/_generated/dataModel";

export interface CustomerListProps {
  customers: Doc<"serviceCustomers">[];
  onSelect?: (customerId: Doc<"serviceCustomers">["_id"]) => void;
  testId?: string;
}

const STATUS_LABEL: Record<
  NonNullable<Doc<"serviceCustomers">["reviewStatus"]>,
  string
> = {
  "not-yet": "Not asked",
  asked: "Asked",
  left: "Left review",
  declined: "Declined",
};

const STATUS_BADGE: Record<
  NonNullable<Doc<"serviceCustomers">["reviewStatus"]>,
  string
> = {
  "not-yet": "border-paper-faint/40 text-paper-faint",
  asked: "border-amber-300/40 text-amber-200",
  left: "border-lime/40 text-lime",
  declined: "border-paper-faint/40 text-paper-faint line-through",
};

export function CustomerList({
  customers,
  onSelect,
  testId,
}: CustomerListProps) {
  if (customers.length === 0) {
    return (
      <div
        data-testid="biz-customer-list-empty"
        className="rounded-2xl border border-[var(--hairline)] bg-ink-2/40 px-6 py-10 text-center text-sm text-paper-dim"
      >
        No customers in the table yet. Connect a CRM (Pro+) or text Maya a
        recent job to start populating.
      </div>
    );
  }
  return (
    <ul
      data-testid={testId ?? "biz-customer-list"}
      className="divide-y divide-[var(--hairline)] overflow-hidden rounded-2xl border border-[var(--hairline)] bg-ink-2/40"
    >
      {customers.map((c) => (
        <li key={c._id}>
          <button
            type="button"
            onClick={() => onSelect?.(c._id)}
            data-testid="biz-customer-row"
            data-customer-id={c._id}
            className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-ink-3/40"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-paper">
                {c.name}
              </div>
              <div className="mt-0.5 truncate text-xs text-paper-faint">
                {c.address ?? c.phone ?? c.email ?? "—"}
              </div>
            </div>
            {c.lifetimeValueUsd !== undefined && (
              <span className="font-mono text-xs uppercase tracking-widest text-paper-dim">
                ${c.lifetimeValueUsd.toLocaleString()}
              </span>
            )}
            {c.reviewStatus && (
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_BADGE[c.reviewStatus]}`}
              >
                {STATUS_LABEL[c.reviewStatus]}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
