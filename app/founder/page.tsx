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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-paper/10 bg-paper/[0.03] px-3 py-2">
      <div className="text-lg font-semibold tabular-nums text-paper">{value}</div>
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
  if (!data.found) return <p className="text-paper-faint">Account not found.</p>;

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
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                  {isMaya && (m.model || m.latencyMs !== null || m.costUsd !== null) && (
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
                        <span>{m.criticPassed ? "✓ critic" : "✗ critic"}</span>
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

  if (data === undefined)
    return <p className="text-paper-faint">Loading…</p>;
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
      <p className="mb-5 text-xs text-paper-faint">
        Every Maya · refreshed live · {clock(data.generatedAt)}
      </p>

      <div className="mb-6 grid grid-cols-3 gap-2">
        <Stat label="Accounts" value={String(t.accounts)} />
        <Stat label="Deployed" value={String(t.deployed)} />
        <Stat label="In error" value={String(t.inError)} />
        <Stat label="Spend" value={usd(t.totalCostUsd)} />
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
              <span className="font-semibold">{ci.redditBetPct}%</span> of agents
              ({ci.redditBetCount}/{ci.agentsWithBets})
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
                className={
                  a.deployed ? "text-lime-400" : "text-paper-faint"
                }
              >
                {a.deployed ? "● live" : "○ not deployed"}
              </span>
              <span className="text-paper-faint">· {usd(a.costUsd)}</span>
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
