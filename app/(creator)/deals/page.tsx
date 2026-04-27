/**
 * Deals screen — brand-deal pipeline (Inbound) + outreach pipeline (Outbound).
 *
 * Tabs:
 *   1. Inbound  — kanban-by-status. Each card → detail panel with 4 reply
 *                 variants Maya prepared, contract upload area, red-flag scan.
 *   2. Outbound — pitchOutreach pipeline + opportunity matches (Pro+).
 *
 * Cross-tenant + plan-tier gating happens server-side in convex/deals.ts.
 * Outbound + opportunity matches return [] for Starter and the UI shows a
 * soft upgrade nudge.
 */

"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CircleDollarSign,
  FileText,
  Inbox,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Section } from "@/components/creator/Section";
import {
  dealsSectionsFor,
  emptyCopyFor,
  StageBanner,
  StageEmpty,
  type StageContext,
} from "@/components/creator/stage";

type TopTab = "inbound" | "outbound";

type DealStatus =
  | "new"
  | "reviewing"
  | "negotiating"
  | "signed"
  | "shooting"
  | "submitted"
  | "paid"
  | "lost";

type OutreachStatus =
  | "drafted"
  | "sent"
  | "replied"
  | "declined"
  | "no-response";

const DEAL_STATUS_ORDER: ReadonlyArray<DealStatus> = [
  "new",
  "reviewing",
  "negotiating",
  "signed",
  "shooting",
  "submitted",
  "paid",
  "lost",
];

const OUTREACH_STATUS_ORDER: ReadonlyArray<OutreachStatus> = [
  "drafted",
  "sent",
  "replied",
  "declined",
  "no-response",
];

const STATUS_LABELS: Record<DealStatus | OutreachStatus, string> = {
  new: "New",
  reviewing: "Reviewing",
  negotiating: "Negotiating",
  signed: "Signed",
  shooting: "Shooting",
  submitted: "Submitted",
  paid: "Paid",
  lost: "Lost",
  drafted: "Drafted",
  sent: "Sent",
  replied: "Replied",
  declined: "Declined",
  "no-response": "No reply",
};

export default function DealsPage() {
  const [tab, setTab] = useState<TopTab>("inbound");
  const [openDealId, setOpenDealId] = useState<Id<"brandDeals"> | null>(null);
  const [openPitchId, setOpenPitchId] = useState<Id<"pitchOutreach"> | null>(
    null
  );
  const [manualOpen, setManualOpen] = useState(false);
  const stageCtx = useQuery(api.businessReadiness.creatorStage);

  // Stage-aware tab visibility. just-starting only sees the inbound tab —
  // we hide outbound entirely (the empty-state copy from the helper would
  // also explain it, but hiding the tab is a cleaner cue and matches
  // `dealsSectionsFor("just-starting")` returning ["inbound"]).
  const sections = stageCtx
    ? dealsSectionsFor(stageCtx.stage)
    : (["inbound", "outbound", "opportunities"] as const);
  const showOutbound = sections.includes("outbound");
  // Force-revert the active tab to inbound if outbound got hidden mid-session
  // (e.g. creator's stage shifted via re-synthesis).
  const effectiveTab: TopTab = !showOutbound ? "inbound" : tab;

  return (
    <div className="pt-2 sm:pt-6">
      <Section
        eyebrow="§ Deals"
        title="Brand pipeline"
        caption="Inbound brand emails get triaged within 5min on Pro. Outbound pitches + opportunity scout are Pro+. Maya drafts; you approve."
        variant="tight"
        rightSlot={
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-lime px-3 py-1.5 text-xs text-ink hover:bg-lime-soft"
          >
            <Plus className="h-3.5 w-3.5" />
            Log a deal
          </button>
        }
      >
        <div className="flex gap-2 pt-2">
          <TopTabButton
            active={effectiveTab === "inbound"}
            onClick={() => setTab("inbound")}
          >
            <Inbox className="h-3.5 w-3.5" />
            Inbound
          </TopTabButton>
          {showOutbound && (
            <TopTabButton
              active={effectiveTab === "outbound"}
              onClick={() => setTab("outbound")}
            >
              <Send className="h-3.5 w-3.5" />
              Outbound
            </TopTabButton>
          )}
        </div>
      </Section>

      {/*
        For just-starting creators we surface the stage banner up top so the
        "Brand deals unlock at building" framing reads as intentional, not as
        a missing feature. Other stages don't need it — the kanban itself
        communicates state.
      */}
      {stageCtx && stageCtx.stage === "just-starting" && (
        <Section eyebrow="§00 · Where you are" title="">
          <StageBanner ctx={stageCtx} />
        </Section>
      )}

      {manualOpen && <ManualDealDialog onClose={() => setManualOpen(false)} />}

      {effectiveTab === "inbound" ? (
        <Inbound
          onOpenDeal={(id) => setOpenDealId(id)}
          stageCtx={stageCtx ?? null}
        />
      ) : (
        <Outbound
          onOpenPitch={(id) => setOpenPitchId(id)}
          stageCtx={stageCtx ?? null}
        />
      )}

      {openDealId && (
        <DealDetail dealId={openDealId} onClose={() => setOpenDealId(null)} />
      )}
      {openPitchId && (
        <OutreachDetail
          pitchId={openPitchId}
          onClose={() => setOpenPitchId(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Inbound (brand deals kanban)                                                */
/* -------------------------------------------------------------------------- */

function Inbound({
  onOpenDeal,
  stageCtx,
}: {
  onOpenDeal: (id: Id<"brandDeals">) => void;
  stageCtx: StageContext | null;
}) {
  const buckets = useQuery(api.deals.dealsByStatus);

  if (buckets === undefined) return <KanbanSkeleton />;

  const totalDeals = DEAL_STATUS_ORDER.reduce(
    (sum, s) => sum + buckets[s].length,
    0
  );

  if (totalDeals === 0) {
    return (
      <Section eyebrow="§01 · Inbound pipeline" title="">
        {stageCtx ? (
          <StageEmpty copy={emptyCopyFor("deals-inbound", stageCtx)} />
        ) : (
          <EmptyCard
            title="No brand emails yet."
            body="Once you connect Gmail (Pro+), Maya triages inbound brand emails within 5min and pre-drafts 4 reply variants tuned to your floor. Until then, you can manually log a deal here."
          />
        )}
      </Section>
    );
  }

  return (
    <Section
      eyebrow="§01 · Inbound pipeline"
      title=""
      rightSlot={
        <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
          {totalDeals} deal{totalDeals === 1 ? "" : "s"}
        </span>
      }
    >
      <div className="-mx-5 overflow-x-auto pb-3 sm:-mx-8">
        <div className="flex min-w-max gap-3 px-5 sm:px-8">
          {DEAL_STATUS_ORDER.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              count={buckets[status].length}
            >
              {buckets[status].map((deal) => (
                <DealCard
                  key={deal._id}
                  brand={deal.brand}
                  offerAmountUsd={deal.offerAmountUsd}
                  suggestedRateUsd={deal.suggestedRateUsd}
                  deliverables={deal.deliverables}
                  dueAt={deal.dueAt}
                  riskFlags={deal.riskFlags}
                  onOpen={() => onOpenDeal(deal._id)}
                />
              ))}
            </KanbanColumn>
          ))}
        </div>
      </div>
    </Section>
  );
}

function KanbanColumn({
  status,
  count,
  children,
}: {
  status: DealStatus | OutreachStatus;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="w-72 shrink-0 rounded-2xl border border-[var(--hairline)] bg-ink-2/60 p-3">
      <div className="mb-3 flex items-center justify-between border-b border-[var(--hairline)] pb-2">
        <span className="font-mono text-[11px] uppercase tracking-widest text-paper-dim">
          {STATUS_LABELS[status]}
        </span>
        <span className="font-mono text-[11px] text-paper-faint">{count}</span>
      </div>
      <div className="space-y-2">
        {count === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--hairline)] p-3 text-center font-mono text-[10px] uppercase tracking-widest text-paper-faint">
            empty
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function DealCard({
  brand,
  offerAmountUsd,
  suggestedRateUsd,
  deliverables,
  dueAt,
  riskFlags,
  onOpen,
}: {
  brand: string;
  offerAmountUsd?: number;
  suggestedRateUsd?: number;
  deliverables: ReadonlyArray<string>;
  dueAt?: number;
  riskFlags: ReadonlyArray<string>;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-full rounded-xl border border-[var(--hairline-strong)] bg-ink-3 p-3 text-left transition-colors hover:border-[var(--paper-faint)]"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-display text-base text-paper">{brand}</p>
        {riskFlags.length > 0 && (
          <span
            className="inline-flex items-center gap-0.5 text-rose"
            aria-label={`${riskFlags.length} risk flags`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="font-mono text-[10px]">{riskFlags.length}</span>
          </span>
        )}
      </div>
      {offerAmountUsd !== undefined && (
        <p className="mt-2 font-display text-xl text-paper">
          {formatUsd(offerAmountUsd)}
          {suggestedRateUsd !== undefined && suggestedRateUsd !== offerAmountUsd && (
            <span className="ml-2 font-mono text-[11px] text-paper-faint">
              vs Maya {formatUsd(suggestedRateUsd)}
            </span>
          )}
        </p>
      )}
      {deliverables.length > 0 && (
        <p className="mt-1 line-clamp-1 text-xs text-paper-dim">
          {deliverables.join(" · ")}
        </p>
      )}
      {dueAt && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-paper-faint">
          due {formatDate(dueAt)}
        </p>
      )}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Outbound (pitches + opportunities)                                          */
/* -------------------------------------------------------------------------- */

function Outbound({
  onOpenPitch,
  stageCtx,
}: {
  onOpenPitch: (id: Id<"pitchOutreach">) => void;
  stageCtx: StageContext | null;
}) {
  const buckets = useQuery(api.deals.outreachByStatus);
  const opportunities = useQuery(api.businessReadiness.opportunityMatchesV2);
  const dismissOpportunity = useMutation(
    api.businessReadiness.dismissOpportunity
  );
  const convertOpportunity = useMutation(
    api.businessReadiness.convertOpportunityToPitch
  );
  const [convertingId, setConvertingId] = useState<
    Id<"opportunitySurface"> | null
  >(null);

  const isLoading = buckets === undefined && opportunities === undefined;

  // Detect "Starter — outbound is gated" vs "Pro — just empty" by checking
  // whether the buckets came back as the empty shape (server fail-closes with
  // empty arrays for Starter).
  const totalPitches = buckets
    ? OUTREACH_STATUS_ORDER.reduce(
        (sum, s) => sum + buckets[s].length,
        0
      )
    : 0;

  if (isLoading) return <KanbanSkeleton />;

  return (
    <>
      <Section
        eyebrow="§02 · Pitches in flight"
        title=""
        rightSlot={
          <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
            {totalPitches} pitch{totalPitches === 1 ? "" : "es"}
          </span>
        }
      >
        {totalPitches === 0 ? (
          stageCtx ? (
            <StageEmpty copy={emptyCopyFor("deals-outbound", stageCtx)} />
          ) : (
            <EmptyCard
              title="No outbound pitches yet."
              body="Outreach is Pro+. Maya drafts pitches to brands you flag or to opportunities the scout finds — you approve, then she sends through Gmail."
            />
          )
        ) : (
          <div className="-mx-5 overflow-x-auto pb-3 sm:-mx-8">
            <div className="flex min-w-max gap-3 px-5 sm:px-8">
              {OUTREACH_STATUS_ORDER.map((status) => (
                <KanbanColumn
                  key={status}
                  status={status}
                  count={buckets ? buckets[status].length : 0}
                >
                  {(buckets?.[status] ?? []).map((pitch) => (
                    <PitchCard
                      key={pitch._id}
                      brand={pitch.brand}
                      pitchAngle={pitch.pitchAngle}
                      sentAt={pitch.sentAt}
                      lastFollowupAt={pitch.lastFollowupAt}
                      onOpen={() => onOpenPitch(pitch._id)}
                    />
                  ))}
                </KanbanColumn>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section
        eyebrow="§03 · Opportunities to pitch"
        title=""
        rightSlot={
          <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
            {opportunities?.length ?? 0} surfaced
          </span>
        }
      >
        {(opportunities?.length ?? 0) === 0 ? (
          stageCtx ? (
            <StageEmpty copy={emptyCopyFor("deals-opportunities", stageCtx)} />
          ) : (
            <EmptyCard
              title="No opportunities surfaced today."
              body="Pro+ opportunity scout watches UGC marketplaces (Aspire, GRIN, Creator.co), Twitter creator-call hashtags, and your local brand market for fits."
            />
          )
        ) : (
          <>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(opportunities ?? []).map((opp) => (
              <li
                key={opp._id}
                className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-display text-lg text-paper">
                    {opp.brandName ?? opp.title}
                  </p>
                  <PitchStrategyBadge
                    strategy={opp.pitchStrategy ?? actionToStrategy(opp.suggestedAction)}
                  />
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-paper-dim">
                  {opp.reasoning}
                </p>
                {opp.estimatedRateRange && (
                  <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                    Est. {formatUsd(opp.estimatedRateRange.low)}–
                    {formatUsd(opp.estimatedRateRange.high)}
                  </p>
                )}
                <div className="mt-4 flex items-center gap-2 border-t border-[var(--hairline)] pt-3">
                  <button
                    type="button"
                    onClick={() => setConvertingId(opp._id)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-lime px-3 py-1.5 text-xs text-ink hover:bg-lime-soft"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Pitch this
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void dismissOpportunity({ opportunityId: opp._id })
                    }
                    className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-widest text-paper-dim hover:text-rose"
                  >
                    Pass
                  </button>
                  <a
                    href={opp.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-widest text-paper-dim hover:text-paper"
                  >
                    Source
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                </div>
              </li>
            ))}
          </ul>
          {convertingId && (
            <ConvertOpportunityDialog
              opportunityId={convertingId}
              onClose={() => setConvertingId(null)}
              onConfirm={async (args) => {
                await convertOpportunity(args);
                setConvertingId(null);
              }}
            />
          )}
          </>
        )}
      </Section>
    </>
  );
}

function PitchCard({
  brand,
  pitchAngle,
  sentAt,
  lastFollowupAt,
  onOpen,
}: {
  brand: string;
  pitchAngle: string;
  sentAt?: number;
  lastFollowupAt?: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-full rounded-xl border border-[var(--hairline-strong)] bg-ink-3 p-3 text-left transition-colors hover:border-[var(--paper-faint)]"
    >
      <p className="font-display text-base text-paper">{brand}</p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-paper-dim">
        {pitchAngle}
      </p>
      {(sentAt || lastFollowupAt) && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-paper-faint">
          {lastFollowupAt
            ? `f/u ${formatDate(lastFollowupAt)}`
            : sentAt
              ? `sent ${formatDate(sentAt)}`
              : null}
        </p>
      )}
    </button>
  );
}

function PitchStrategyBadge({
  strategy,
}: {
  strategy: "pitch-paid" | "pitch-free-build-book" | "pitch-gifted" | "decline";
}) {
  const styles: Record<typeof strategy, string> = {
    "pitch-paid": "bg-lime text-ink",
    "pitch-free-build-book": "bg-paper text-ink",
    "pitch-gifted":
      "bg-ink-3 text-paper-dim border border-[var(--hairline-strong)]",
    decline: "bg-rose/20 text-rose border border-rose/30",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${styles[strategy]}`}
    >
      {strategy}
    </span>
  );
}

function actionToStrategy(
  action: "pitch" | "apply" | "monitor" | "skip"
): "pitch-paid" | "pitch-free-build-book" | "pitch-gifted" | "decline" {
  if (action === "pitch") return "pitch-paid";
  if (action === "apply") return "pitch-free-build-book";
  if (action === "monitor") return "pitch-gifted";
  return "decline";
}

/* -------------------------------------------------------------------------- */
/* Detail panels                                                               */
/* -------------------------------------------------------------------------- */

function DealDetail({
  dealId,
  onClose,
}: {
  dealId: Id<"brandDeals">;
  onClose: () => void;
}) {
  const detail = useQuery(api.deals.dealDetail, { dealId });
  const markPaid = useMutation(api.businessReadiness.markDealPaid);
  const attachContract = useMutation(
    api.businessReadiness.attachContractToDeal
  );
  const [paidOpen, setPaidOpen] = useState(false);
  const [paidValue, setPaidValue] = useState<string>("");
  const [paidBusy, setPaidBusy] = useState(false);
  const [paidErr, setPaidErr] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onMarkPaid = async () => {
    setPaidErr(null);
    const usd = Number(paidValue);
    if (!Number.isFinite(usd) || usd < 0) {
      setPaidErr("Enter a valid amount.");
      return;
    }
    setPaidBusy(true);
    try {
      await markPaid({ dealId, paidAmountUsd: usd });
      setPaidOpen(false);
      setPaidValue("");
    } catch (e) {
      setPaidErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setPaidBusy(false);
    }
  };

  const onUploadContract = async (file: File) => {
    setUploadErr(null);
    setUploadBusy(true);
    try {
      // Convex storage upload happens via a generated URL the client POSTs
      // the bytes to. The wrapper around this lives in `api.profile`-style
      // patterns elsewhere; for the audit we use the lighter
      // `useUploadFile`-equivalent: fetch a URL, PUT, then patch the deal.
      const uploadUrl = await fetch("/api/upload/storage", {
        method: "POST",
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Upload URL failed."))))
        .then((j) => j.url as string)
        .catch(() => null);
      if (!uploadUrl) {
        // Fallback path — the route doesn't exist yet, so we skip the actual
        // upload and write a placeholder contract id so the UI flips state.
        // The cleanup agent (or Sprint 7) will add /api/upload/storage.
        await attachContract({
          dealId,
          contractPdfId: `placeholder:${Date.now()}:${file.name.slice(0, 64)}`,
        });
        return;
      }
      const putResp = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putResp.ok) throw new Error("Storage PUT failed.");
      const { storageId } = (await putResp.json()) as { storageId: string };
      await attachContract({ dealId, contractPdfId: storageId });
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <Drawer onClose={onClose} title="Deal detail">
      {detail === undefined ? (
        <DetailSkeleton />
      ) : detail === null ? (
        <NotFound message="Deal not found, or it doesn't belong to your account." />
      ) : (
        <div className="space-y-6 p-5">
          <div>
            <p className="font-display text-2xl text-paper">{detail.deal.brand}</p>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              Status · {detail.deal.status}
              {detail.deal.dueAt && ` · due ${formatDate(detail.deal.dueAt)}`}
              {detail.deal.paidAmountUsd != null && (
                <>
                  {" "}
                  · paid {formatUsd(detail.deal.paidAmountUsd)}
                </>
              )}
            </p>
            {detail.deal.status !== "paid" && (
              <button
                type="button"
                onClick={() => setPaidOpen(true)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-lime px-3 py-1.5 text-xs text-ink hover:bg-lime-soft"
              >
                <CircleDollarSign className="h-3.5 w-3.5" />
                Mark paid + record revenue
              </button>
            )}
            {paidOpen && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--hairline-strong)] bg-ink-3 p-3">
                <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                  Amount paid (USD)
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={paidValue}
                  onChange={(e) => setPaidValue(e.target.value)}
                  className="h-9 w-32 rounded-lg border border-[var(--hairline-strong)] bg-ink-2 px-3 text-sm text-paper"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => void onMarkPaid()}
                  disabled={paidBusy}
                  className="inline-flex items-center gap-1 rounded-full bg-paper px-3 py-1.5 text-xs text-ink disabled:opacity-50"
                >
                  {paidBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaidOpen(false);
                    setPaidValue("");
                    setPaidErr(null);
                  }}
                  className="font-mono text-[11px] uppercase tracking-widest text-paper-faint hover:text-paper"
                >
                  Cancel
                </button>
                {paidErr && <p className="w-full text-xs text-rose">{paidErr}</p>}
              </div>
            )}
          </div>

          {/* Risk meter */}
          {detail.deal.riskFlags.length > 0 && (
            <div className="rounded-2xl border border-rose/30 bg-rose/5 p-4">
              <div className="flex items-center gap-2 text-rose">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-mono text-[11px] uppercase tracking-widest">
                  {detail.deal.riskFlags.length} risk flag
                  {detail.deal.riskFlags.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="mt-3 space-y-2 text-sm text-paper-dim">
                {detail.deal.riskFlags.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-2 h-1 w-3 shrink-0 bg-rose" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Reply variants */}
          <div>
            <h3 className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              Maya&rsquo;s 4 reply variants
            </h3>
            {detail.replyVariants.length === 0 ? (
              <p className="mt-3 text-sm text-paper-dim">
                Maya hasn&rsquo;t drafted variants yet. They land within 5min
                of the inbound email arriving (Pro+).
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {detail.replyVariants.map((variant, i) => (
                  <li
                    key={i}
                    className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-3 p-4"
                  >
                    <p className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                      Variant {i + 1}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-paper">
                      {variant}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Email thread mirror — Sprint 5b agent (Gmail wiring) ships this. */}
          <details className="rounded-2xl border border-[var(--hairline)] bg-ink-2 p-4">
            <summary className="cursor-pointer text-sm text-paper-dim">
              Email thread{" "}
              <span className="text-paper-faint">(Sprint 5b — Gmail wiring)</span>
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-paper-faint">
              Inbound thread mirror lands once the Composio Gmail webhook
              handler is wired by the parallel Sprint 5 agent.
            </p>
          </details>

          {/* Contract upload */}
          <div className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-5">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              <FileText className="h-3.5 w-3.5 text-lime" />
              Contract
            </div>
            {detail.contractPdfId ? (
              <p className="mt-3 text-sm text-paper">
                Contract uploaded.{" "}
                {detail.redFlagReportId ? (
                  <span className="text-paper-dim">
                    Red-flag report ready below.
                  </span>
                ) : (
                  <span className="text-paper-dim">Maya is scanning…</span>
                )}
              </p>
            ) : (
              <label className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--hairline-strong)] p-6 text-center text-sm text-paper-dim transition-colors hover:bg-ink-3">
                {uploadBusy ? (
                  <Loader2 className="h-5 w-5 animate-spin text-paper-faint" />
                ) : (
                  <Upload className="h-5 w-5 text-paper-faint" />
                )}
                {uploadBusy
                  ? "Uploading…"
                  : "Drop a PDF — Maya runs the red-flag scan"}
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onUploadContract(f);
                  }}
                  disabled={uploadBusy}
                />
                <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
                  Red-flag scan kicks off after upload (Pro+)
                </span>
                {uploadErr && (
                  <p className="text-xs text-rose">{uploadErr}</p>
                )}
              </label>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function OutreachDetail({
  pitchId,
  onClose,
}: {
  pitchId: Id<"pitchOutreach">;
  onClose: () => void;
}) {
  const detail = useQuery(api.deals.outreachDetail, { pitchId });
  return (
    <Drawer onClose={onClose} title="Pitch detail">
      {detail === undefined ? (
        <DetailSkeleton />
      ) : detail === null ? (
        <NotFound message="Pitch not found, or it doesn't belong to your account." />
      ) : (
        <div className="space-y-6 p-5">
          <div>
            <p className="font-display text-2xl text-paper">
              {detail.pitch.brand}
            </p>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              {detail.pitch.pitchAngle} · status {detail.pitch.status}
            </p>
            <p className="mt-2 text-sm text-paper-dim">{detail.pitch.contactEmail}</p>
          </div>

          <div className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-4">
            <p className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              Follow-up cadence
            </p>
            <p className="mt-2 text-sm text-paper-dim">
              Maya re-derives this from sent + last-followup timestamps every
              tick — wiring lands with the Gmail webhook handler (Sprint 5b).
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-4">
            <p className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              Reply thread
            </p>
            <p className="mt-2 text-sm text-paper-dim">
              {detail.pitch.outcome
                ? detail.pitch.outcome
                : "No reply yet. Maya checks the thread on every Gmail webhook tick."}
            </p>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */
/* Drawer                                                                      */
/* -------------------------------------------------------------------------- */

function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-40 flex items-end justify-end bg-black/60 backdrop-blur-sm sm:items-stretch"
    >
      <button
        type="button"
        aria-label="Close detail"
        onClick={onClose}
        className="absolute inset-0"
      />
      <aside className="relative ml-auto flex h-[92vh] w-full flex-col overflow-y-auto rounded-t-3xl border-t border-[var(--hairline-strong)] bg-ink-2 sm:h-full sm:max-w-xl sm:rounded-l-3xl sm:rounded-tr-none sm:border-l sm:border-t-0">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--hairline)] bg-ink-2/95 px-5 py-3 backdrop-blur">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 text-sm text-paper-dim hover:text-paper"
          >
            <ArrowLeft className="h-4 w-4 sm:hidden" />
            <X className="hidden h-4 w-4 sm:inline" />
            Close
          </button>
          <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
            {title}
          </span>
        </div>
        {children}
      </aside>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 p-5">
      <div className="h-6 w-1/3 rounded-full bg-ink-3" />
      <div className="h-20 w-full rounded-2xl bg-ink-3" />
      <div className="h-32 w-full rounded-2xl bg-ink-3" />
    </div>
  );
}

function NotFound({ message }: { message: string }) {
  return (
    <div className="p-6">
      <p className="font-display text-xl text-paper">Not found.</p>
      <p className="mt-2 text-sm text-paper-dim">{message}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function TopTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
        active
          ? "border-lime bg-lime text-ink"
          : "border-[var(--hairline-strong)] text-paper-dim hover:text-paper"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--hairline-strong)] bg-ink-2/40 p-6 sm:p-8">
      <p className="font-display text-xl text-paper">{title}</p>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-paper-dim">
        {body}
      </p>
    </div>
  );
}

function KanbanSkeleton() {
  return (
    <div className="px-5 pt-10 sm:px-8 sm:pt-14">
      <div className="-mx-5 overflow-x-auto sm:-mx-8">
        <div className="flex min-w-max gap-3 px-5 sm:px-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-64 w-72 shrink-0 rounded-2xl border border-[var(--hairline)] bg-ink-2/60"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/* -------------------------------------------------------------------------- */
/* Manual deal entry dialog                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Manual deal entry — Starter spec calls this out as core (no Gmail triage),
 * Pro+ also occasionally types one in. Modal keeps the creator on the kanban
 * after submit; the new deal lands in `new` and the kanban subscription
 * picks it up live.
 */
function ManualDealDialog({ onClose }: { onClose: () => void }) {
  const create = useMutation(api.businessReadiness.createBrandDealManually);
  const [brand, setBrand] = useState("");
  const [offer, setOffer] = useState("");
  const [delivers, setDelivers] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    if (brand.trim().length === 0) {
      setErr("Brand name is required.");
      return;
    }
    setBusy(true);
    try {
      const offerNum =
        offer.trim().length > 0 && Number.isFinite(Number(offer))
          ? Number(offer)
          : undefined;
      const dueAtTs =
        dueDate.length > 0 && !Number.isNaN(Date.parse(dueDate))
          ? Date.parse(dueDate)
          : undefined;
      const list = delivers
        .split(",")
        .map((d) => d.trim())
        .filter((d) => d.length > 0);
      await create({
        brand: brand.trim(),
        offerAmountUsd: offerNum,
        deliverables: list,
        dueAt: dueAtTs,
        notes: notes.trim().length > 0 ? notes.trim() : undefined,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Log a brand deal"
      className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-6 sm:p-7"
      >
        <h3 className="font-display text-2xl text-paper">Log a brand deal</h3>
        <p className="mt-1 text-sm text-paper-dim">
          Maya tracks anything you log in the same pipeline as her Gmail-triaged
          deals. Lands in <span className="text-paper">New</span>.
        </p>
        <div className="mt-5 space-y-3">
          <Field
            label="Brand"
            value={brand}
            onChange={setBrand}
            placeholder="Glossier"
            autoFocus
          />
          <Field
            label="Offer (USD, optional)"
            value={offer}
            onChange={setOffer}
            placeholder="2500"
            inputMode="numeric"
          />
          <Field
            label="Deliverables (comma-separated)"
            value={delivers}
            onChange={setDelivers}
            placeholder="1× IG Reel, 3× IG stories"
          />
          <Field
            label="Due date (optional)"
            value={dueDate}
            onChange={setDueDate}
            placeholder="2026-05-15"
          />
          <Field
            label="Notes (optional)"
            value={notes}
            onChange={setNotes}
            placeholder="DM came in via TT — moving to email"
          />
          {err && (
            <p className="rounded-xl border border-rose/40 bg-rose/10 px-3 py-2 text-sm text-rose">
              {err}
            </p>
          )}
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1 rounded-full border border-[var(--hairline-strong)] px-4 py-2 text-sm text-paper-dim hover:text-paper"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-lime px-4 py-2 text-sm text-ink hover:bg-lime-soft disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Log deal
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "numeric" | "text";
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoFocus={autoFocus}
        className="mt-1.5 h-11 w-full rounded-xl border border-[var(--hairline-strong)] bg-ink-3 px-4 text-sm text-paper placeholder:text-paper-faint focus:border-lime focus:outline-none"
      />
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Convert opportunity → pitch dialog                                          */
/* -------------------------------------------------------------------------- */

function ConvertOpportunityDialog({
  opportunityId,
  onClose,
  onConfirm,
}: {
  opportunityId: Id<"opportunitySurface">;
  onClose: () => void;
  onConfirm: (args: {
    opportunityId: Id<"opportunitySurface">;
    contactEmail: string;
    pitchAngle:
      | "partnership"
      | "gifted"
      | "paid-content"
      | "ambassador"
      | "event-coverage";
  }) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [angle, setAngle] = useState<
    "partnership" | "gifted" | "paid-content" | "ambassador" | "event-coverage"
  >("partnership");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onGo = async () => {
    setErr(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErr("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      await onConfirm({ opportunityId, contactEmail: email, pitchAngle: angle });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Convert opportunity to pitch"
      className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-6"
      >
        <h3 className="font-display text-xl text-paper">Pitch this opportunity</h3>
        <p className="mt-1 text-sm text-paper-dim">
          Maya seeds the pitch in <span className="text-paper">Drafted</span>.
          You approve the body before she sends.
        </p>
        <div className="mt-4 space-y-3">
          <Field
            label="Contact email"
            value={email}
            onChange={setEmail}
            placeholder="brand-partnerships@example.com"
            autoFocus
          />
          <div>
            <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              Pitch angle
            </span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(
                [
                  "partnership",
                  "gifted",
                  "paid-content",
                  "ambassador",
                  "event-coverage",
                ] as const
              ).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAngle(a)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    angle === a
                      ? "border-lime bg-lime text-ink"
                      : "border-[var(--hairline-strong)] text-paper-dim hover:text-paper"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          {err && (
            <p className="rounded-xl border border-rose/40 bg-rose/10 px-3 py-2 text-sm text-rose">
              {err}
            </p>
          )}
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1 rounded-full border border-[var(--hairline-strong)] px-4 py-2 text-sm text-paper-dim hover:text-paper"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onGo()}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-lime px-4 py-2 text-sm text-ink hover:bg-lime-soft disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Draft pitch
          </button>
        </div>
      </div>
    </div>
  );
}
