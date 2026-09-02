"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
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
  const ev = useQuery(api.eval.run.report, token ? { token } : "skip");
  const label = useMutation(api.eval.run.label);
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

      <section>
        <h2 className="text-xs uppercase tracking-wide opacity-50 mb-2">Evals · is she corny, generic, flattering, leaking, inventing?</h2>
        {!ev ? <p className="opacity-60">no runs yet</p> : (
          <div className="flex flex-col gap-4">
            <div className="overflow-x-auto">
              <table className="tabular-nums">
                <thead className="text-[11px] uppercase tracking-wide opacity-50 text-left"><tr><th className="pr-4">skill</th><th className="pr-4">runs</th><th className="pr-4">pass</th><th className="pr-4">corny</th><th className="pr-4">generic</th><th className="pr-4">specific</th><th className="pr-4">would send</th></tr></thead>
                <tbody>{ev.perSkill.map((s) => <tr key={s.skill} className="border-t border-white/5"><td className="pr-4 py-1">{s.skill}</td><td className="pr-4">{s.n}</td><td className="pr-4">{s.passRate}%</td><td className="pr-4">{s.corny ?? "—"}</td><td className="pr-4">{s.generic ?? "—"}</td><td className="pr-4">{s.specific ?? "—"}</td><td className="pr-4">{s.wouldSend ?? "—"}</td></tr>)}</tbody>
              </table>
              <p className="text-[11px] opacity-50 mt-1">judge scores 0–3; corny/generic lower is better, specific/would-send higher. {ev.labels} labels{ev.agreement !== null ? ` · judge agrees with you ${ev.agreement}%` : " · label 5+ to see judge agreement"}</p>
            </div>
            <ul className="flex flex-col gap-2">
              {ev.recent.map((r) => (
                <li key={r.id} className={`border rounded p-2 ${r.pass ? "border-white/10" : "border-amber-400/40"}`}>
                  <div className="flex items-center justify-between text-[11px] opacity-60"><span>{r.suite} · {r.skill} · {new Date(r.at).toLocaleString()} · {r.pass ? "pass" : "FAIL"}{r.judge ? ` · corny ${r.judge.corny} generic ${r.judge.generic} specific ${r.judge.specific} send ${r.judge.wouldSend}` : ""}</span><span>{r.label ? `you: ${r.label}` : ""}</span></div>
                  <p className="whitespace-pre-wrap mt-1">{r.text}</p>
                  {r.failed.length > 0 && <p className="text-[11px] text-amber-300 mt-1">{r.failed.join(" · ")}</p>}
                  {r.judge?.note && <p className="text-[11px] opacity-60 mt-1">judge: {r.judge.note}</p>}
                  {!r.label && (
                    <div className="mt-1 flex gap-2 text-[11px]">
                      <button className="underline" onClick={() => label({ token, evalRunId: r.id, skill: r.skill, label: "good", reason: "" })}>👍 good</button>
                      <button className="underline" onClick={() => { const reason = window.prompt("what's wrong with it?") ?? ""; label({ token, evalRunId: r.id, skill: r.skill, label: "bad", reason }); }}>👎 bad</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
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
