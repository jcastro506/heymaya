"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/** The operator console (plan §7). Token in the URL once, then in session storage; fail-closed on the server. */
export default function OpsPage() {
  const [token] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const q = new URLSearchParams(window.location.search).get("token");
    try {
      if (q) window.sessionStorage.setItem("ops_token", q);
      return q ?? window.sessionStorage.getItem("ops_token") ?? "";
    } catch {
      return q ?? "";
    }
  });
  const o = useQuery(api.ops.overview, token ? { token } : "skip");
  if (!token) return <p className="p-6 text-sm opacity-60">No token.</p>;
  if (o === undefined) return <p className="p-6 text-sm opacity-60">loading…</p>;
  if (o === null) return <p className="p-6 text-sm">Not authorized.</p>;
  const PULSE: Record<string, string> = { warm: "text-emerald-300", steady: "opacity-80", cooling: "text-amber-300", silent: "text-red-300", new: "opacity-60" };
  return (
    <main className="p-6 max-w-5xl mx-auto flex flex-col gap-8 text-sm">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Maya · operator</h1>
        <span className="text-xs opacity-50">as of {new Date(o.at).toLocaleTimeString()} · queued {o.queued} · running {o.running}</span>
      </header>

      <section>
        <h2 className="text-xs uppercase tracking-wide opacity-50 mb-2">Creators</h2>
        <div className="overflow-x-auto">
          <table className="w-full tabular-nums">
            <thead className="text-[11px] uppercase tracking-wide opacity-50 text-left"><tr><th>creator</th><th>plan</th><th>pulse</th><th>sent/replied/taken (7d)</th><th>spend 24h / 7d</th><th>last out</th></tr></thead>
            <tbody>
              {o.creators.map((c) => (
                <tr key={c.id} className="border-t border-white/5 align-top">
                  <td className="py-2 pr-3">{c.handle}<div className="text-[11px] opacity-50">{c.paired ? "paired" : "unpaired"} · {c.mode} · dossier v{c.dossierVersion}{c.founding ? " · founding" : ""}</div></td>
                  <td className="py-2 pr-3">{c.plan}</td>
                  <td className={`py-2 pr-3 ${PULSE[c.pulse.word] ?? ""}`}>{c.pulse.word}<div className="text-[11px] opacity-50">{c.pulse.why}</div></td>
                  <td className="py-2 pr-3">{c.sentWeek} / {c.repliesWeek} / {c.takenWeek}</td>
                  <td className="py-2 pr-3">${c.spendDayUsd} / ${c.spendWeekUsd}</td>
                  <td className="py-2 pr-3 max-w-xs">{c.lastOut ? <span>{new Date(c.lastOut.ts).toLocaleString()} · {c.lastOut.kind}{c.lastOut.delivered ? "" : " · NOT delivered"}{c.lastOut.error ? ` · ${c.lastOut.error}` : ""}<div className="text-[11px] opacity-60 truncate">{c.lastOut.body}</div></span> : "—"}{c.undelivered > 0 && <div className="text-[11px] text-red-300">{c.undelivered} undelivered in 24h</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-6">
        <div>
          <h2 className="text-xs uppercase tracking-wide opacity-50 mb-2">Spend today by vendor</h2>
          {Object.keys(o.spendDayByVendor).length === 0 ? <p className="opacity-60">nothing yet</p> : <ul>{Object.entries(o.spendDayByVendor).map(([v, usd]) => <li key={v} className="flex justify-between tabular-nums"><span>{v}</span><span>${usd}</span></li>)}</ul>}
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-wide opacity-50 mb-2">Vendors</h2>
          {o.breakers.length === 0 ? <p className="opacity-60">no readings yet</p> : <ul>{o.breakers.map((b) => <li key={b.vendor} className={b.verdict === "ok" ? "" : "text-amber-300"}>{b.vendor}: {b.verdict} · {b.balance} · <span className="opacity-60">{b.detail}</span></li>)}</ul>}
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-wide opacity-50 mb-2">Failed jobs</h2>
          {o.failedJobs.length === 0 ? <p className="opacity-60">none in the last 200</p> : <ul className="flex flex-col gap-1">{o.failedJobs.map((j) => <li key={j.id}><span className="opacity-80">{j.kind}</span> · {j.status} · {j.attempts} tries<div className="text-[11px] opacity-60 break-all">{j.error}</div></li>)}</ul>}
        </div>
      </section>
    </main>
  );
}
