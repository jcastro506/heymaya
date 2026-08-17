"use client";

/**
 * Founder God-view — `/founder?token=<ADMIN_DASH_TOKEN>`.
 *
 * A read-only, phone-first operator dashboard over every Maya:
 *   - portfolio totals (accounts / deployed / in-error / spend / message volume)
 *   - channel-recommendation distribution (proves Maya isn't Reddit-only)
 *   - per-account rows with health flags
 *   - tap an account → full user↔Maya transcript with per-turn telemetry
 *
 * Gating is server-side: every query fails closed against ADMIN_DASH_TOKEN.
 * The token lives in the URL (bookmark it); treat the link as a secret.
 * Route is in the public matcher (middleware) because there is no Clerk admin
 * role — the Convex token check IS the gate.
 */

import { useState } from "react";
import { useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function usd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function ago(ts: number | null): string {
  if (ts === null) return "never";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function clock(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={on ? "text-lime-400" : "text-paper-faint/60"}>
      {on ? "✓" : "✗"} {label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-paper/10 bg-paper/[0.03] px-3 py-2">
      <div className="text-lg font-semibold tabular-nums text-paper">
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-paper-faint">
        {label}
      </div>
    </div>
  );
}

// ── Transcript drill-in ────────────────────────────────────────────────────
function Transcript({
  token,
  accountId,
  onBack,
}: {
  token: string;
  accountId: Id<"creators">;
  onBack: () => void;
}) {
  const data = useQuery(api.founder.dashboard.transcript, { token, accountId });

  if (data === undefined)
    return <p className="text-paper-faint">Loading transcript…</p>;
  if (!data.ok) return <p className="text-rose-400">Unauthorized.</p>;
  if (!data.found)
    return <p className="text-paper-faint">Account not found.</p>;

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 text-sm text-paper-faint hover:text-paper"
      >
        ← All accounts
      </button>
      <h1 className="text-xl font-semibold text-paper">{data.productName}</h1>
      {data.productUrl && (
        <a
          href={data.productUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-paper-faint underline"
        >
          {data.productUrl}
        </a>
      )}

      {data.messages.length === 0 ? (
        <p className="mt-6 text-paper-faint">
          No messages captured yet for this account.
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          {data.messages.map((m) => {
            const isMaya = m.role === "maya";
            return (
              <div
                key={m.id}
                className={isMaya ? "flex justify-start" : "flex justify-end"}
              >
                <div
                  className={[
                    "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                    isMaya
                      ? "bg-paper/[0.06] text-paper"
                      : "bg-lime-300/90 text-ink",
                  ].join(" ")}
                >
                  <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide opacity-60">
                    <span>{isMaya ? "Maya" : "User"}</span>
                    <span>·</span>
                    <span>{clock(m.ts)}</span>
                    {m.messageClass && <span>· {m.messageClass}</span>}
                  </div>
                  <div className="whitespace-pre-wrap break-words">
                    {m.body}
                  </div>
                  {isMaya &&
                    (m.model || m.latencyMs !== null || m.costUsd !== null) && (
                      <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] opacity-60">
                        {m.model && <span>{m.model}</span>}
                        {m.tokensIn !== null && m.tokensOut !== null && (
                          <span>
                            {m.tokensIn}→{m.tokensOut} tok
                          </span>
                        )}
                        {m.latencyMs !== null && <span>{m.latencyMs}ms</span>}
                        {m.costUsd !== null && <span>{usd(m.costUsd)}</span>}
                        {m.criticPassed !== null && (
                          <span>
                            {m.criticPassed ? "✓ critic" : "✗ critic"}
                          </span>
                        )}
                      </div>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Overview (master list) ─────────────────────────────────────────────────
function Overview({
  token,
  onOpen,
}: {
  token: string;
  onOpen: (id: Id<"creators">) => void;
}) {
  const data = useQuery(api.founder.dashboard.overview, { token });
  /**
   * ⭐ The CURRENT product. The overview above reads `gtmAgents` and
   * `mayaMessages` — the deleted product's tables — so without this the ops
   * view shows a healthy dashboard for something that no longer runs.
   */
  const fleet = useQuery(api.founder.fleetHealth.health, { token });
  /**
   * §18's other two questions. A second query rather than one fat read: this
   * scans every customer's placements, and the "is anything broken" numbers
   * above should not wait on it.
   */
  const learning = useQuery(api.founder.fleetHealth.aggregateLearning, {
    token,
  });

  if (data === undefined) return <p className="text-paper-faint">Loading…</p>;
  if (!data.ok)
    return (
      <div className="text-rose-400">
        Unauthorized. Append <code>?token=…</code> to the URL.
      </div>
    );

  const t = data.totals;
  const ci = data.channelInsight;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-paper">Founder view</h1>
      <FleetHealth fleet={fleet} learning={learning} />
      <p className="mb-5 text-xs text-paper-faint">
        Every Maya · refreshed live · {clock(data.generatedAt)}
      </p>

      <div className="mb-6 grid grid-cols-3 gap-2">
        <Stat label="Accounts" value={String(t.accounts)} />
        <Stat label="Deployed" value={String(t.deployed)} />
        <Stat label="In error" value={String(t.inError)} />
        {/* Windowed COGS — the "are we about to be surprised by a bill" numbers. */}
        <Stat label="Spend · 24h" value={usd(t.spendTodayUsd)} />
        <Stat label="Spend · 7d" value={usd(t.spendLast7dUsd)} />
        <Stat label="Spend · all" value={usd(t.totalCostUsd)} />
        <Stat label="User msgs" value={String(t.totalUserMsgs)} />
        <Stat label="Maya msgs" value={String(t.totalMayaMsgs)} />
      </div>

      {/* Channel-recommendation distribution */}
      <div className="mb-6 rounded-xl border border-paper/10 bg-paper/[0.03] p-4">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-paper-faint">
          Channel bets · across {ci.agentsWithBets} agent(s)
        </div>
        {ci.agentsWithBets === 0 ? (
          <p className="text-sm text-paper-faint">No channel bets yet.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-paper">
              Reddit bet in{" "}
              <span className="font-semibold">{ci.redditBetPct}%</span> of
              agents ({ci.redditBetCount}/{ci.agentsWithBets})
            </p>
            <div className="space-y-1.5">
              {ci.histogram.map((h) => {
                const pct =
                  ci.agentsWithBets > 0
                    ? Math.round((h.count / ci.agentsWithBets) * 100)
                    : 0;
                return (
                  <div key={h.channel} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-xs text-paper-faint">
                      {h.channel}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper/10">
                      <div
                        className="h-full rounded-full bg-lime-300/80"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-xs tabular-nums text-paper-faint">
                      {h.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Account rows */}
      <div className="mb-2 text-[11px] uppercase tracking-wide text-paper-faint">
        Accounts
      </div>
      <div className="space-y-2">
        {data.accounts.length === 0 && (
          <p className="text-sm text-paper-faint">No agents yet.</p>
        )}
        {data.accounts.map((a) => (
          <button
            key={a.accountId}
            onClick={() => onOpen(a.accountId)}
            className="w-full rounded-xl border border-paper/10 bg-paper/[0.03] p-3 text-left transition hover:bg-paper/[0.07]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-paper">
                    {a.productName}
                  </span>
                  {a.isTest && (
                    <span className="shrink-0 rounded bg-paper/10 px-1.5 py-0.5 text-[9px] uppercase text-paper-faint">
                      test
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs text-paper-faint">
                  {a.who} · {a.plan} · {a.stage ?? "—"}
                  {a.betChannels.length > 0 && ` · ${a.betChannels.join(", ")}`}
                </div>
                {/* LIVE tier flags (flat-control observability): these flip the
                    moment gtmPlanJson changes, with no redeploy. */}
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="rounded bg-paper/10 px-1.5 py-0.5 uppercase tracking-wide text-paper">
                    {a.tier.plan}/{a.tier.status}
                  </span>
                  <Flag on={a.tier.canVideo} label="video" />
                  <Flag on={a.tier.canImage} label="image" />
                  <Flag on={a.tier.canAutoPost} label="autopost" />
                  <span className="text-paper-faint">
                    {a.tier.maxActiveChannels}ch
                  </span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs tabular-nums text-paper">
                  {a.userMsgCount}↑ {a.mayaMsgCount}↓
                </div>
                <div className="text-[10px] text-paper-faint">
                  {ago(a.lastMsgAt)}
                </div>
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[10px]">
              <span
                className={a.deployed ? "text-lime-400" : "text-paper-faint"}
              >
                {a.deployed ? "● live" : "○ not deployed"}
              </span>
              {/* Today's COGS is the actionable per-tenant number; discovery
                  (the all-day hunt loop) split out so a runaway pulse is obvious. */}
              <span className="text-paper-faint">
                · {usd(a.spend.today.totalUsd)}/24h
                {a.spend.today.discoveryUsd > 0 &&
                  ` (${usd(a.spend.today.discoveryUsd)} disc.)`}
              </span>
              {a.errorState && (
                <span className="text-rose-400">· {a.errorState}</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function FounderInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [openAccount, setOpenAccount] = useState<Id<"creators"> | null>(null);

  if (!token) {
    return (
      <p className="text-rose-400">
        Missing token. Use <code>/founder?token=…</code>.
      </p>
    );
  }

  return openAccount ? (
    <Transcript
      token={token}
      accountId={openAccount}
      onBack={() => setOpenAccount(null)}
    />
  ) : (
    <Overview token={token} onOpen={setOpenAccount} />
  );
}

/**
 * ⭐ Sprint 12's thin version — the Sprint 3 question, answerable on a phone.
 *
 * Ordered by what ruins a day: has the cadence stopped · is a vendor about to
 * fail · what is it costing. Everything sits above the fold at 390px, because
 * the exit criterion is *"in under a minute and from your phone"* and a number
 * you have to scroll to is a number you check less often.
 */
function FleetHealth({
  fleet,
  learning,
}: {
  fleet: typeof api.founder.fleetHealth.health._returnType | undefined;
  learning:
    | typeof api.founder.fleetHealth.aggregateLearning._returnType
    | undefined;
}) {
  if (fleet === undefined || !fleet.ok || !fleet.cadence) return null;
  const c = fleet.cadence;
  const stuck = c.stuck ?? [];
  const degraded = fleet.vendorsDegraded ?? [];
  const unreachable = fleet.unreachable ?? [];

  return (
    <section className="mb-6 rounded-lg border border-white/10 p-3">
      <h2 className="mb-2 text-sm font-semibold text-paper">Maya · today</h2>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Active" value={String(c.activeCustomers)} />
        <Stat
          label="Posted today"
          value={`${c.doneToday}/${c.activeCustomers}`}
        />
        <Stat label="Best streak" value={String(c.bestStreak)} />
      </div>

      {/* ⚠️ The loudest thing on the page, because a stopped account is the
          failure this whole view exists to catch. */}
      {stuck.length > 0 && (
        <div className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 p-2">
          <p className="text-xs font-semibold text-rose-300">
            {stuck.length} not posting
          </p>
          <ul className="mt-1 space-y-0.5">
            {stuck.slice(0, 5).map((s) => (
              <li key={s.customerId} className="text-xs text-paper-faint">
                <code>{String(s.customerId).slice(0, 8)}…</code>{" "}
                {s.daysSince === null
                  ? "never posted"
                  : `${s.daysSince}d since last post`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ⭐ Louder than a stopped account, and above it in severity for one
          reason: a customer we cannot message doesn't know anything is wrong.
          Every other number on this page describes work they'll never hear
          about — including the warning that their card failed. */}
      {unreachable.length > 0 && (
        <div className="mt-3 rounded border border-rose-500/60 bg-rose-500/15 p-2">
          <p className="text-xs font-semibold text-rose-200">
            {unreachable.length} can&apos;t be reached
          </p>
          <ul className="mt-1 space-y-0.5">
            {unreachable.slice(0, 5).map((u) => (
              <li key={u.customerId} className="text-xs text-paper-faint">
                <code>{String(u.customerId).slice(0, 8)}…</code>{" "}
                {/* The transport's own words — "no Telegram chat paired" and
                    "bot was blocked" need different responses. */}
                {u.reason}
                {u.proactive ? " — including something she started" : ""}{" "}
                <span className="text-paper-faint/70">
                  ({u.pending} waiting since{" "}
                  {new Date(u.since).toLocaleDateString()})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {degraded.length > 0 && (
        <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 p-2">
          {degraded.map((v) => (
            <p key={v.vendor} className="text-xs text-amber-200">
              {/* `detail` is written to be relayed unchanged. */}
              {v.detail}
            </p>
          ))}
        </div>
      )}

      {/* ⭐ A statement about OUR product, not theirs: one customer stuck at
          L1 has a format problem; most customers stuck at L1 means what we
          ship doesn't travel. */}
      {learning?.ok && learning.ladder && learning.ladder.measured > 0 && (
        <p className="mt-3 text-xs text-paper-faint">
          {learning.ladder.mostCommonBreak
            ? `Most common break: ${learning.ladder.mostCommonBreak} (${learning.ladder.measured} measured)`
            : `No rung broken across ${learning.ladder.measured} measured`}
        </p>
      )}

      {/* Counted per ACCOUNT — one founder restating a rule five times is one
          signal, not five. A rule nine accounts set is a default we got wrong. */}
      {learning?.ok &&
        learning.directives &&
        learning.directives.byKind.length > 0 && (
          <p className="mt-1 text-xs text-paper-faint">
            Most-set rules:{" "}
            {learning.directives.byKind
              .slice(0, 3)
              .map((d) => `${d.kind} (${d.accounts})`)
              .join(" · ")}
          </p>
        )}

      {/* ⭐ §16.9.2's activation funnel. Every other line on this screen
          describes customers who are already working; this is the only one
          that describes the ones who never started — and the spec calls
          time-to-first-placement the headline metric. */}
      {fleet.activation && (
        <p className="mt-3 text-xs text-paper-faint">
          {fleet.activation.signedUp} signed up · {fleet.activation.connected}{" "}
          connected · {fleet.activation.placed} placed
          {fleet.activation.medianHours !== null
            ? ` · ${Math.round(fleet.activation.medianHours)}h to first post`
            : /* ⚠️ Never "0h". A zero would read as instant — the opposite
                 of the truth, which is that nobody has posted at all. */
              " · nobody's posted yet"}
          {fleet.activation.stalled.length > 0
            ? ` · ⚠️ ${fleet.activation.stalled.length} connected and stuck (longest ${fleet.activation.stalled[0].daysSinceSignup}d)`
            : ""}
        </p>
      )}

      <p className="mt-3 text-xs text-paper-faint">
        {fleet.traceability
          ? `${fleet.traceability.traceable} of ${fleet.traceability.posts} posts trace to an idea`
          : ""}
        {fleet.spend
          ? ` · ${usd(fleet.spend.totalUsd)} over ${fleet.spend.windowDays}d`
          : ""}
      </p>

      {/* ⭐ Stated, not implied. This screen gets opened when something is
          already wrong, and a gap read as an answer sends you the wrong way. */}
      {fleet.notYetAnswered.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-paper-faint">
            What this can&apos;t tell you yet
          </summary>
          <ul className="mt-1 space-y-0.5">
            {fleet.notYetAnswered.map((n) => (
              <li key={n} className="text-xs text-paper-faint">
                {n}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export default function FounderPage() {
  return (
    <div className="min-h-screen bg-ink text-paper">
      <main className="mx-auto max-w-2xl px-4 py-6">
        <Suspense fallback={<p className="text-paper-faint">Loading…</p>}>
          <FounderInner />
        </Suspense>
      </main>
    </div>
  );
}
