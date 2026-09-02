"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";

function minutesAgo(ts: number): number {
  return Math.max(1, Math.round((Date.now() - ts) / 60_000));
}

export default function SettingsPage() {
  const s = useQuery(api.ui.settings);
  const update = useMutation(api.ui.updateSettings);
  const correct = useMutation(api.ui.correct);
  const revoke = useMutation(api.ui.revokeRule);
  const [correction, setCorrection] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteNote, setDeleteNote] = useState<string | null>(null);
  const cal = useQuery(api.calendar.oauth.status);
  const selectCalendars = useMutation(api.calendar.oauth.selectCalendars);
  const disconnect = useAction(api.calendar.oauth.disconnect);
  // The connect round trip lands here with a query string; read it once, at mount, without an effect.
  const [calNote, setCalNote] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search);
    const err = q.get("calendar_error");
    if (q.get("calendar") === "connected") return "Calendar connected. She reads it every half hour.";
    if (err === "denied") return "You said no to Google. Fine; connect later from here.";
    return err ? `Couldn't connect the calendar (${err}). Try again.` : null;
  });
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
        <h2 className="text-sm uppercase tracking-wide opacity-50">Calendar</h2>
        {calNote && <p className="text-xs opacity-80">{calNote}</p>}
        {!cal || cal.status === "disconnected" ? (
          <div>
            <p className="opacity-70">Not connected. With it she plans filming around your life and finds ideas in it. She keeps only titles and times, never details, and skips anything private.</p>
            <a className="btn mt-2 inline-flex" href="/api/google-calendar/start">Connect Google Calendar</a>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div>
              {cal.status === "connected" ? "Connected" : cal.status === "attention" ? "Connected, with a hiccup" : "Needs reconnecting"}
              {cal.lastSyncedAt ? <span className="opacity-50"> · read {minutesAgo(cal.lastSyncedAt)} min ago</span> : null}
              {cal.detail && <div className="text-xs opacity-70">{cal.detail}</div>}
              {cal.status === "needs_reconnect" && <a className="underline text-xs" href="/api/google-calendar/start">reconnect</a>}
            </div>
            {cal.calendars.length > 1 && (
              <div className="flex flex-col gap-1">
                <div className="opacity-50 text-xs">which calendars she may read</div>
                {cal.calendars.map((k) => (
                  <label key={k.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={k.selected} onChange={(e) => selectCalendars({ ids: cal.calendars.filter((x) => (x.id === k.id ? e.target.checked : x.selected)).map((x) => x.id) })} />
                    {k.name}
                  </label>
                ))}
              </div>
            )}
            <button className="text-xs underline opacity-60 self-start" onClick={async () => { await disconnect({}); setCalNote("Disconnected. Everything she stored from it is gone."); }}>disconnect and forget my calendar</button>
          </div>
        )}
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
        <h2 className="text-sm uppercase tracking-wide opacity-50">What she&apos;s learned about your taste</h2>
        {!s.taste.events ? (
          <p className="opacity-60">Nothing yet. Every heart, &ldquo;not me&rdquo;, shot list and post teaches her; she writes it up here weekly.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p>{s.taste.note ?? "She has the reactions; the write-up lands after the first few."}</p>
            {s.taste.likes.length > 0 && <div className="text-xs opacity-70">you take: {s.taste.likes.join(" · ")}</div>}
            {s.taste.dislikes.length > 0 && <div className="text-xs opacity-70">you pass on: {s.taste.dislikes.join(" · ")}</div>}
            <p className="text-xs opacity-40">Scores fade over about six weeks, so changing direction is allowed. Correct her above if she has it wrong.</p>
          </div>
        )}
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

      <section className="flex flex-col gap-2 text-sm">
        <h2 className="text-sm uppercase tracking-wide opacity-50">Your data</h2>
        <p className="opacity-70">Everything she keeps about you, as one file. Take it any time.</p>
        <a className="underline self-start" href="/api/account/export">download my export</a>
        <details className="mt-2">
          <summary className="cursor-pointer opacity-70">Delete my account</summary>
          <div className="mt-2 flex flex-col gap-2">
            <p className="opacity-70">This deletes everything: your posts as she read them, every idea, every message, calendar fields, notes, and the Telegram pairing. Not undoable. Download the export first if you want it.</p>
            <div className="flex gap-2">
              <input className="input flex-1" placeholder="type DELETE" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
              <button className="btn" disabled={confirmText.trim().toUpperCase() !== "DELETE" || deleting} onClick={async () => {
                setDeleting(true);
                const r = await fetch("/api/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: confirmText }) }).then((x) => x.json()).catch(() => ({ ok: false, reason: "network" }));
                if (r.ok) window.location.href = "/?deleted=1";
                else { setDeleteNote(r.reason ?? "couldn't delete"); setDeleting(false); }
              }}>{deleting ? "deleting…" : "delete everything"}</button>
            </div>
            {deleteNote && <p className="text-xs text-red-400">{deleteNote}</p>}
          </div>
        </details>
      </section>
    </div>
  );
}
