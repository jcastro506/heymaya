"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";

export default function SettingsPage() {
  const s = useQuery(api.ui.settings);
  const update = useMutation(api.ui.updateSettings);
  const correct = useMutation(api.ui.correct);
  const revoke = useMutation(api.ui.revokeRule);
  const [correction, setCorrection] = useState("");
  if (s === undefined) return <p className="opacity-60 text-sm">loading…</p>;
  if (s === null) return <p className="text-sm">No account yet. <Link className="underline" href="/start">Start here.</Link></p>;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Settings</h1>

      <section className="flex flex-col gap-2 text-sm">
        <h2 className="text-sm uppercase tracking-wide opacity-50">Accounts</h2>
        <div>TikTok: {s.handles.tiktok ? `@${s.handles.tiktok}` : "—"} · Instagram: {s.handles.instagram ? `@${s.handles.instagram}` : "—"}</div>
        <div>Telegram: {s.paired ? "connected" : <Link className="underline" href="/telegram">connect</Link>} · plan: {s.plan}</div>
      </section>

      <section className="flex flex-col gap-2 text-sm">
        <h2 className="text-sm uppercase tracking-wide opacity-50">How she texts you</h2>
        <label className="flex items-center justify-between">tone
          <select className="input w-32" value={s.tone} onChange={(e) => update({ tone: e.target.value as "coach" | "friend" | "blunt" })}>
            <option value="friend">friend</option>
            <option value="coach">coach</option>
            <option value="blunt">blunt</option>
          </select>
        </label>
        <label className="flex items-center justify-between">quiet from
          <input className="input w-24" type="time" value={s.quietHours.start} onChange={(e) => update({ quietHours: { ...s.quietHours, start: e.target.value } })} />
        </label>
        <label className="flex items-center justify-between">until
          <input className="input w-24" type="time" value={s.quietHours.end} onChange={(e) => update({ quietHours: { ...s.quietHours, end: e.target.value } })} />
        </label>
        <div className="opacity-60 text-xs">timezone {s.timezone}</div>
      </section>

      <section className="flex flex-col gap-2 text-sm">
        <h2 className="text-sm uppercase tracking-wide opacity-50">What Maya knows about you</h2>
        {!s.knows ? (
          <p className="opacity-60">She hasn&apos;t finished reading your posts yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p>{s.knows.summary ?? "—"} <span className="opacity-50">({s.knows.mode})</span></p>
            {s.knows.works.length > 0 && <div><div className="opacity-50 text-xs">what works for you</div><ul className="list-disc pl-5">{s.knows.works.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
            {s.knows.doesNot.length > 0 && <div><div className="opacity-50 text-xs">what hasn&apos;t</div><ul className="list-disc pl-5">{s.knows.doesNot.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
            {s.knows.keywords.length > 0 && <div className="opacity-70 text-xs">your lane: {s.knows.keywords.join(", ")}</div>}
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <input className="input flex-1" placeholder="correct her: e.g. I don't do gear reviews anymore" value={correction} onChange={(e) => setCorrection(e.target.value)} />
          <button className="btn" onClick={async () => { if (correction.trim()) { await correct({ text: correction }); setCorrection(""); } }}>tell her</button>
        </div>
      </section>

      <section className="flex flex-col gap-2 text-sm">
        <h2 className="text-sm uppercase tracking-wide opacity-50">House rules</h2>
        {s.rules.length === 0 ? <p className="opacity-60">None yet. Anything you tell her to always or never do lands here, in your words.</p> : (
          <ul className="flex flex-col gap-2">
            {s.rules.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 border border-white/10 rounded px-3 py-2">
                <span>&ldquo;{r.text}&rdquo; <span className="opacity-40 text-xs">{new Date(r.at).toLocaleDateString()}</span></span>
                <button className="text-xs underline opacity-60" onClick={() => revoke({ id: r.id })}>revoke</button>
              </li>
            ))}
          </ul>
        )}
        {s.notes.length > 0 && <div className="mt-2"><div className="opacity-50 text-xs">things you told her</div><ul className="list-disc pl-5">{s.notes.map((n) => <li key={n.id}>{n.text}</li>)}</ul></div>}
      </section>
    </div>
  );
}
