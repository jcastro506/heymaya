/**
 * Customer detail panel — opens when an operator clicks a row in the
 * Customers list.
 *
 * Per Service Sprint Plan § 12.5: job history, review history,
 * communication history, lifetime value.
 *
 * Communication history is a Sprint 6 surface (voice transcripts come
 * online then). For v0 we render job + review history.
 */

"use client";

import type { Doc } from "@/convex/_generated/dataModel";
import { Mail, Phone, X } from "lucide-react";
import { CustomerProvenanceChain } from "./growth/CustomerProvenanceChain";

export interface CustomerDetailProps {
  customer: Doc<"serviceCustomers">;
  jobs: Doc<"serviceJobs">[];
  reviews: Doc<"reviews">[];
  reviewRequests: Doc<"reviewRequests">[];
  onClose: () => void;
}

export function CustomerDetail({
  customer,
  jobs,
  reviews,
  reviewRequests,
  onClose,
}: CustomerDetailProps) {
  return (
    <aside
      data-testid="biz-customer-detail-panel"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-[var(--hairline)] bg-ink-2 shadow-[ -16px_0_40px_-20px_rgba(0,0,0,0.6)] sm:max-w-md"
    >
      <header className="flex items-center justify-between border-b border-[var(--hairline)] px-6 py-5">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
            Customer
          </span>
          <h3 className="mt-1 font-display text-2xl tracking-tight text-paper">
            {customer.name}
          </h3>
          {customer.lifetimeValueUsd !== undefined && (
            <p className="mt-0.5 text-sm text-paper-dim">
              Lifetime value $
              {customer.lifetimeValueUsd.toLocaleString()}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail"
          className="rounded-full border border-[var(--hairline)] p-2 text-paper-dim transition-colors hover:bg-ink-3"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
        <section className="space-y-2 text-sm text-paper-dim">
          {customer.phone && (
            <div className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 text-paper-faint" aria-hidden />
              <span>{customer.phone}</span>
            </div>
          )}
          {customer.email && (
            <div className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-paper-faint" aria-hidden />
              <span>{customer.email}</span>
            </div>
          )}
          {customer.address && (
            <p className="text-paper-faint">{customer.address}</p>
          )}
        </section>

        {/* Wave C.7 — provenance chain. Renders nothing when no Maya action
            is attributed to this customer (direct contact). */}
        <CustomerProvenanceChain customerId={customer._id} />

        <section>
          <h4 className="mb-2 font-display text-base text-paper">
            Jobs ({jobs.length})
          </h4>
          {jobs.length === 0 ? (
            <p className="text-sm text-paper-faint">No jobs on file.</p>
          ) : (
            <ul className="space-y-2">
              {jobs.slice(0, 10).map((j) => (
                <li
                  key={j._id}
                  className="flex justify-between rounded-xl bg-ink-3/40 px-3 py-2 text-sm"
                >
                  <span className="text-paper">
                    {j.serviceType ?? "Service call"}
                  </span>
                  <span className="text-paper-faint">{j.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="mb-2 font-display text-base text-paper">
            Reviews ({reviews.length})
          </h4>
          {reviews.length === 0 ? (
            <p className="text-sm text-paper-faint">No reviews matched yet.</p>
          ) : (
            <ul className="space-y-2">
              {reviews.map((r) => (
                <li key={r._id} className="rounded-xl bg-ink-3/40 px-3 py-2">
                  <div className="flex justify-between text-xs text-paper-faint">
                    <span>{r.starRating}-star · {r.platform}</span>
                    <span>
                      {new Date(r.receivedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-sm text-paper-dim">
                    {r.body}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="mb-2 font-display text-base text-paper">
            Review requests ({reviewRequests.length})
          </h4>
          {reviewRequests.length === 0 ? (
            <p className="text-sm text-paper-faint">
              No requests sent yet.
            </p>
          ) : (
            <ul className="space-y-1 text-sm text-paper-dim">
              {reviewRequests.map((r) => (
                <li key={r._id} className="flex justify-between">
                  <span>
                    {r.channel} · {r.status}
                  </span>
                  <span className="text-paper-faint">
                    {r.sentAt
                      ? new Date(r.sentAt).toLocaleDateString()
                      : "queued"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
