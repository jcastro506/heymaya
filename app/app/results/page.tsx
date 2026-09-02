"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const RUNG_WORDS: Record<string, string> = {
  L0: "You posted less than you planned. Nothing else to diagnose yet.",
  L1: "Nobody saw it. Reach fell well under your normal; that's a format problem before a topic one.",
  L2: "They saw it and scrolled. Reach held; engagement per view didn't. That's the topic or the promise.",
  healthy: "Healthy week. Reach and engagement both in your range.",
  unknown: "Not enough posts with two days of numbers to say anything honest.",
};

export default function ResultsPage() {
  const r = useQuery(api.ui.results);
  if (r === undefined) return <p className="opacity-60 text-sm">loading…</p>;
  if (r === null) return <p className="text-sm">No account yet.</p>;
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-lg font-semibold">Results</h1>
        <p className="text-sm opacity-70 mt-1">Last seven days, the way she saw them on Sunday.</p>
      </section>

      <section className="border border-white/10 rounded-lg p-4">
        <div className="text-[11px] uppercase tracking-wide opacity-50">The week</div>
        <p className="text-sm mt-1">{RUNG_WORDS[r.rung.rung]}</p>
        <p className="text-xs opacity-60 mt-1">{r.rung.why}{r.rung.medianMultiple !== null ? ` · median ${r.rung.medianMultiple}× your normal` : ""}{r.rung.planned ? ` · ${r.rung.posted} of ${r.rung.planned} planned` : ` · ${r.rung.posted} posted`}</p>
        <p className="text-xs opacity-60 mt-1">{r.lane.usable ? `Your lane's median this week: ${r.lane.medianViews?.toLocaleString()} views (top quarter from ${r.lane.p75Views?.toLocaleString()}), from ${r.lane.why}.` : `No lane median yet: ${r.lane.why}.`}</p>
        {r.override && <p className="text-xs mt-2 opacity-80">She read it differently: {r.override.rung}. {r.override.why}</p>}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide opacity-50">Posts this week</h2>
        {r.week.length === 0 ? (
          <p className="text-sm opacity-60 mt-2">Nothing posted in the last seven days.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {r.week.map((p) => (
              <li key={p.id} className="text-sm border-b border-white/5 py-2">
                <div className="flex items-center justify-between">
                  <a className="underline truncate max-w-[55%]" href={p.url} target="_blank" rel="noreferrer">{p.platform} · {new Date(p.createTime).toLocaleDateString()}</a>
                  <span className="tabular-nums opacity-80">{p.views.toLocaleString()}{p.multiple !== null ? ` · ${p.multiple}×` : ""}</span>
                </div>
                <div className="text-[11px] opacity-50 mt-0.5">{p.sampled ? "two-day sample in" : "too fresh to judge"}{p.engagementPerView !== null ? ` · ${(p.engagementPerView * 100).toFixed(1)}% engaged per view` : ""} · from {p.source === "scrape" ? "public counts" : p.source}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide opacity-50">Her track record</h2>
        {r.trackRecord.length === 0 ? (
          <p className="text-sm opacity-60 mt-2">No scored calls yet.{r.openPredictions ? ` ${r.openPredictions} waiting on two days of numbers.` : " Ask her what she thinks of a draft and she goes on the record."}</p>
        ) : (
          <table className="mt-2 text-sm w-full">
            <thead className="text-[11px] uppercase tracking-wide opacity-50 text-left"><tr><th>she said</th><th>expected</th><th>actual (median)</th><th>calls</th></tr></thead>
            <tbody className="tabular-nums">
              {r.trackRecord.map((t) => (
                <tr key={t.confidence} className="border-t border-white/5"><td className="py-1">{t.confidence}</td><td>{t.expected}×</td><td>{t.medianActual}×</td><td>{t.n}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide opacity-50">Experiments</h2>
        {r.experiments.length === 0 ? (
          <p className="text-sm opacity-60 mt-2">The first one arrives with the first Sunday review.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {r.experiments.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3">
                <span>{e.text}</span>
                <span className={`text-[11px] uppercase tracking-wide shrink-0 ${e.result === "held" ? "text-emerald-300" : e.result === "failed" ? "text-red-300" : "opacity-50"}`}>{e.result ?? "this week"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {r.lastReview && (
        <section>
          <h2 className="text-sm uppercase tracking-wide opacity-50">What she said on {new Date(r.lastReview.ts).toLocaleDateString()}</h2>
          <p className="text-sm mt-2 whitespace-pre-wrap border border-white/10 rounded-2xl rounded-bl-sm px-4 py-3">{r.lastReview.body}</p>
        </section>
      )}
    </div>
  );
}
