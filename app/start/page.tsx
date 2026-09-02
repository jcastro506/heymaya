"use client";

/**
 * Onboarding screens 2–4 (plan §7 S2): handles, who you wish you were, what you make.
 * Mobile-first. The catalogue read starts the moment handles are saved, so nothing
 * here waits on Telegram. Phone verification and the calendar arrive with Sprint 3.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
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

  const [step, setStep] = useState<1 | 2 | 3>(1);
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
    router.push("/telegram");
  }

  return (
    <main className="min-h-dvh max-w-md mx-auto p-6 flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Maya</h1>
        <span className="text-xs opacity-60">step {step} of 3</span>
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

      {progress && progress.posts > 0 && (
        <p className="text-xs opacity-60">She has read {progress.posts} of your posts so far{progress.transcripts ? `, ${progress.transcripts} transcribed` : ""}.</p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </main>
  );
}
