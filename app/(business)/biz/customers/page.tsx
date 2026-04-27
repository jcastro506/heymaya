/**
 * Customers screen — `/biz/customers`.
 *
 * Per Service Sprint Plan § 12.5.
 * Plan-tier: Starter sees a CRM-empty state (no CRM allowed). Pro+ shows
 * the customer list.
 */

"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Users } from "lucide-react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Section } from "@/components/business/Section";
import { EmptyState } from "@/components/business/EmptyState";
import { CustomerList } from "@/components/business/CustomerList";
import { CustomerDetail } from "@/components/business/CustomerDetail";

type Status = NonNullable<Doc<"serviceCustomers">["reviewStatus"]> | "all";

const STATUS_TABS: { key: Status; label: string }[] = [
  { key: "all", label: "All" },
  { key: "not-yet", label: "Not asked" },
  { key: "asked", label: "Asked" },
  { key: "left", label: "Left review" },
  { key: "declined", label: "Declined" },
];

export default function CustomersPage() {
  const [status, setStatus] = useState<Status>("all");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Id<"serviceCustomers"> | null>(
    null
  );

  const profile = useQuery(api.queries.business.profile.getProfile);
  const counts = useQuery(api.queries.business.customers.getReviewStatusCounts);
  const customers = useQuery(api.queries.business.customers.listCustomers, {
    reviewStatus: status === "all" ? undefined : status,
    nameContains: name.trim() ? name : undefined,
  });
  const detail = useQuery(
    api.queries.business.customers.getCustomer,
    selected && profile
      ? { businessId: profile.business._id, customerId: selected }
      : "skip"
  );

  if (profile === undefined) return <Skeleton />;
  if (profile === null) {
    return (
      <div className="px-5 py-10 sm:px-8">
        <EmptyState
          stage="fresh"
          title="Finish onboarding"
          body="Customers populate after you connect a CRM (Pro+) or text Maya about jobs."
          cta={{ label: "Onboarding", href: "/onboarding/business" }}
        />
      </div>
    );
  }

  const isStarter = profile.features.plan === "starter";

  return (
    <div className="pb-12 pt-4 sm:pt-6">
      <Section
        eyebrow="Customers"
        title="Your customer list"
        caption="LTV, last interaction, review status. Click a row for full job + review history."
        rightSlot={
          isStarter ? (
            <span className="rounded-full border border-amber-300/40 bg-amber-300/5 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-amber-200">
              Pro · CRM access
            </span>
          ) : counts ? (
            <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
              {counts.total} total
            </span>
          ) : null
        }
      >
        {isStarter ? (
          <EmptyState
            stage="blocked"
            title="Connect a CRM to populate Customers"
            body="On Pro and Studio, Maya mirrors Jobber, Housecall Pro, or QuickBooks customers automatically. On Starter you'd manage these in your CRM directly."
            cta={{ label: "Upgrade plan", href: "/biz/profile" }}
            icon={Users}
          />
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="search"
                placeholder="Search by name…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="biz-customers-search"
                className="w-full rounded-full border border-[var(--hairline)] bg-ink-3 px-4 py-2 text-sm text-paper placeholder:text-paper-faint focus:border-lime focus:outline-none sm:max-w-xs"
              />
              <div className="flex flex-wrap gap-2">
                {STATUS_TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    data-testid={`biz-customers-status-${t.key}`}
                    data-active={status === t.key ? "true" : "false"}
                    onClick={() => setStatus(t.key)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      status === t.key
                        ? "border-lime/40 bg-lime/5 text-lime"
                        : "border-[var(--hairline)] text-paper-dim hover:bg-ink-3"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {customers === undefined ? (
              <div className="h-72 animate-pulse rounded-2xl bg-ink-3/60" />
            ) : (
              <CustomerList
                customers={customers}
                onSelect={(id) => setSelected(id)}
              />
            )}
          </>
        )}
      </Section>

      {detail && profile && selected && (
        <CustomerDetail
          customer={detail.customer}
          jobs={detail.jobs}
          reviews={detail.reviews}
          reviewRequests={detail.reviewRequests}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="px-5 py-10 sm:px-8" data-testid="biz-customers-skeleton">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="h-9 w-1/3 animate-pulse rounded bg-ink-3" />
        <div className="h-72 animate-pulse rounded-2xl bg-ink-3" />
      </div>
    </div>
  );
}
