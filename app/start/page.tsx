"use client";

/**
 * Onboarding screens 2–7 (plan §7 S2): handles, who you wish you were (tap-to-pick, then
 * free entry), what you make, your calendar (skip allowed), done (timezone, quiet hours,
 * live progress from jobs), then Telegram. Mobile-first. The catalogue read starts the
 * moment handles are saved, so nothing here waits on Telegram.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type Platform = "tiktok" | "instagram";

export default function StartPage() {
  const router = useRouter();
  const start = useMutation(api.onboarding.start.start);
  const describe = useMutation(api.onboarding.start.describe);
  const validate = useAction(api.onboarding.admired.validate);
  const addAdmired = useMutation(api.onboarding.admired.add);
  const removeAdmired = useMutation(api.onboarding.admired.remove);
  const admired = useQuery(api.onboarding.admired.list) ?? [];
  const progress = useQuery(api.onboarding.start.progress);
  const suggest = useAction(api.onboarding.admired.suggest);
  const updateSettings = useMutation(api.ui.updateSettings);
  const cal = useQuery(api.calendar.oauth.status);

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(() => {
    if (typeof window === "undefined") return 1;
    const q = Number(new URLSearchParams(window.location.search).get("step"));
    return q >= 1 && q <= 5 ? (q as 1 | 2 | 3 | 4 | 5) : 1;
  });
  const [suggestions, setSuggestions] = useState<Array<{ platform: Platform; handle: string; followers: number | null; why: string }> | null>(null);
  const [tz, setTz] = useState<string>("");
  // An existing account goes straight to Today; a returning onboarding lands on its step.
  useEffect(() => {
    if (progress && progress.state !== "none" && step === 1 && !new URLSearchParams(window.location.search).get("step")) router.replace(progress.paired ? "/app/today" : "/start?step=2");
  }, [progress, step, router]);
  useEffect(() => {
    if (step === 2 && suggestions === null) suggest({}).then(setSuggestions).catch(() => setSuggestions([]));
  }, [step, suggestions, suggest]);
  const [tiktok, setTiktok] = useState("");
  const [instagram, setInstagram] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, { displayName?: string; followers?: number; avatarUrl?: string }>>({});
  const [candidate, setCandidate] = useState("");
  const [candidatePlatform, setCandidatePlatform] = useState<Platform>("tiktok");
  const [niche, setNiche] = useState("");

  async function checkHandle(platform: Platform, handle: string) {
    if (!handle.trim()) return true;
    setChecking(true);
    const r = await validate({ platform, handle });
    setChecking(false);
    if (!r.ok) {
      setError(`@${r.handle} on ${platform}: ${r.reason}`);
      return false;
    }
    setPreview((p) => ({ ...p, [`${platform}:${r.handle}`]: r }));
    return true;
  }

  async function saveHandles() {
    setError(null);
    if (!tiktok.trim() && !instagram.trim()) return setError("one handle is enough to start, but she needs at least one");
    const okT = await checkHandle("tiktok", tiktok);
    const okI = okT && (await checkHandle("instagram", instagram));
    if (!okT || !okI) return;
    const r = await start({ handles: { tiktok: tiktok || undefined, instagram: instagram || undefined }, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    if (!r.ok) return setError(r.error ?? "something went wrong");
    setStep(2);
  }

  async function addCandidate() {
    setError(null);
    if (!candidate.trim()) return;
    const ok = await checkHandle(candidatePlatform, candidate);
    if (!ok) return;
    const r = await addAdmired({ platform: candidatePlatform, handle: candidate });
    if (!r.ok) return setError(r.error ?? "couldn't add that one");
    setCandidate("");
  }

  async function saveNiche() {
    setError(null);
    if (admired.length < 3) return setError("three accounts, minimum. she watches these for you.");
    const r = await describe({ niche });
    if (!r.ok) return setError(r.error ?? "something went wrong");
    setStep(4);
  }

  return (
    <main className="min-h-dvh max-w-md mx-auto p-6 flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Maya</h1>
        <span className="text-xs opacity-60">step {step} of 5</span>
      </header>

      {step === 1 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg">Your handles</h2>
          <p className="text-sm opacity-70">Public is enough to start. She reads your posts the moment you save.</p>
          <label className="flex flex-col gap-1 text-sm">
            TikTok
            <input className="input" placeholder="@handle" value={tiktok} onChange={(e) => setTiktok(e.target.value)} autoCapitalize="none" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Instagram
            <input className="input" placeholder="@handle" value={instagram} onChange={(e) => setInstagram(e.target.value)} autoCapitalize="none" />
          </label>
          {Object.entries(preview).map(([k, p]) => (
            <div key={k} className="text-xs opacity-80 flex items-center gap-2">
              {p.avatarUrl && <img src={p.avatarUrl} alt="" className="w-6 h-6 rounded-full" />}
              <span>{k} · {p.displayName ?? ""} {p.followers !== undefined ? `· ${p.followers.toLocaleString()} followers` : ""}</span>
            </div>
          ))}
          <button className="btn" disabled={checking} onClick={saveHandles}>{checking ? "checking…" : "this is me"}</button>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg">Who do you wish you were?</h2>
          <p className="text-sm opacity-70">Three to ten accounts in your lane. She watches them every day and tells you when something of theirs is worth your time.</p>
          <div className="flex gap-2">
            <select className="input w-28" value={candidatePlatform} onChange={(e) => setCandidatePlatform(e.target.value as Platform)}>
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
            </select>
            <input className="input flex-1" placeholder="@handle" value={candidate} onChange={(e) => setCandidate(e.target.value)} autoCapitalize="none" onKeyDown={(e) => e.key === "Enter" && addCandidate()} />
            <button className="btn" disabled={checking} onClick={addCandidate}>add</button>
          </div>
          {suggestions && suggestions.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-xs opacity-50">tap to add</div>
              <div className="flex flex-wrap gap-2">
                {suggestions.filter((sg) => !admired.some((a) => a.handle === sg.handle)).map((sg) => (
                  <button key={`${sg.platform}:${sg.handle}`} className="rounded-full border border-white/20 px-3 py-1 text-xs" title={sg.why} onClick={() => addAdmired({ platform: sg.platform, handle: sg.handle })}>@{sg.handle}{sg.followers ? ` · ${Math.round(sg.followers / 1000)}k` : ""}</button>
                ))}
              </div>
            </div>
          )}
          <ul className="flex flex-col gap-2">
            {admired.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-sm border border-white/10 rounded px-3 py-2">
                <span>@{a.handle} <span className="opacity-50">· {a.platform}</span></span>
                <button className="text-xs opacity-60" onClick={() => removeAdmired({ id: a.id })}>remove</button>
              </li>
            ))}
          </ul>
          <button className="btn" disabled={admired.length < 3} onClick={() => setStep(3)}>{admired.length < 3 ? `${3 - admired.length} more` : "next"}</button>
        </section>
      )}

      {step === 3 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg">What do you make?</h2>
          <p className="text-sm opacity-70">One sentence, in your words.</p>
          <textarea className="input min-h-24" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="running and gear for people who started late" />
          <button className="btn" onClick={saveNiche}>next</button>
        </section>
      )}

      {step === 4 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg">Your calendar</h2>
          <p className="text-sm opacity-70">With it she finds ideas in your life and plans filming around it. She keeps only titles and times, never details, and skips anything private. You can skip this.</p>
          {cal?.status === "connected" ? <p className="text-sm text-emerald-300">Connected.</p> : <a className="btn" href="/api/google-calendar/start?return=%2Fstart%3Fstep%3D5">Connect Google Calendar</a>}
          <button className="btn-secondary" onClick={() => setStep(5)}>{cal?.status === "connected" ? "next" : "skip for now"}</button>
          <p className="text-xs opacity-40">Apple Calendar is coming after the pilot.</p>
        </section>
      )}

      {step === 5 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg">Almost there</h2>
          <label className="text-sm flex flex-col gap-1">your timezone
            <select className="input" value={tz || progress?.timezone || ""} onChange={(e) => { setTz(e.target.value); updateSettings({ timezone: e.target.value }); }}>
              {Array.from(new Set([progress?.timezone ?? "", Intl.DateTimeFormat().resolvedOptions().timeZone, ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [])])).filter(Boolean).map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
          <p className="text-sm opacity-70">She stays quiet between {progress?.quietHours.start ?? "22:00"} and {progress?.quietHours.end ?? "07:00"}. Change it in Settings, or just tell her.</p>
          <p className="text-sm">{progress?.dossier ? "She has read your posts." : progress?.ingest === "running" || (progress?.posts ?? 0) > 0 ? `Reading your posts now: ${progress?.posts ?? 0} so far${progress?.transcripts ? `, ${progress.transcripts} transcribed` : ""}.` : progress?.ingest === "failed" || progress?.ingest === "dead" ? "The read hit a snag; she'll retry, and you can go on." : "Starting the read of your posts."}</p>
          <p className="text-sm opacity-70">Your first message lands in about 8 minutes, on Telegram.</p>
          <Link className="btn" href="/telegram">Open Maya in Telegram</Link>
        </section>
      )}

      {progress && progress.posts > 0 && (
        <p className="text-xs opacity-60">She has read {progress.posts} of your posts so far{progress.transcripts ? `, ${progress.transcripts} transcribed` : ""}.</p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </main>
  );
}
