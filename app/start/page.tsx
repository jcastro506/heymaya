"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { price, TIERS, TIER_NAMES, type Tier } from "@/convex/billing/tiers";
import { OnboardShell } from "../onboarding/Shell";

type Platform = "tiktok" | "instagram";
type Interval = "monthly" | "annual";
type Suggestion = { platform: Platform; handle: string; followers: number | null; why: string; displayName?: string; avatarUrl?: string };

const PLATFORM_LABEL: Record<Platform, string> = { instagram: "Instagram", tiktok: "TikTok" };

function initialStep(): 1 | 2 | 3 | 4 | 5 {
  if (typeof window === "undefined") return 1;
  const value = Number(new URLSearchParams(window.location.search).get("step"));
  return value >= 1 && value <= 5 ? (value as 1 | 2 | 3 | 4 | 5) : 1;
}

function followerLabel(value: number | null): string | null {
  if (!value) return null;
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export default function StartPage() {
  const ensureCreator = useMutation(api.onboarding.start.ensureCreator);
  const describe = useMutation(api.onboarding.start.describe);
  const progress = useQuery(api.onboarding.start.progress);
  const settings = useQuery(api.ui.settings);
  const createCheckout = useAction(api.billing.checkout.createCheckout);
  const socialConnections = useQuery(api.connections.zernio.status);
  const startSocialConnect = useAction(api.connections.zernio.startConnect);
  const reconcileSocialConnections = useAction(api.connections.zernio.reconcile);
  const suggestionsQuery = useAction(api.onboarding.admired.suggest);
  const validate = useAction(api.onboarding.admired.validate);
  const addAdmired = useMutation(api.onboarding.admired.add);
  const removeAdmired = useMutation(api.onboarding.admired.remove);
  const admired = useQuery(api.onboarding.admired.list) ?? [];
  const calendar = useQuery(api.calendar.oauth.status);
  const selectCalendars = useMutation(api.calendar.oauth.selectCalendars);
  const updateSettings = useMutation(api.ui.updateSettings);
  const setPhone = useMutation(api.onboarding.start.setPhone);
  const createPairingLink = useMutation(api.core.pairing.createPairingLink);

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(initialStep);
  const [interval, setInterval] = useState<Interval>("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [candidate, setCandidate] = useState("");
  const [candidatePlatform, setCandidatePlatform] = useState<Platform>("instagram");
  const [niche, setNiche] = useState("");
  const [phone, setPhoneValue] = useState("");
  const [consent, setConsent] = useState(false);
  const [messageLink, setMessageLink] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("");
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("07:00");

  const planIsReady = progress?.planStatus === "trialing" || progress?.planStatus === "active" || progress?.planStatus === "comped";
  const connectedPlatforms = useMemo(
    () => new Set((socialConnections?.accounts ?? []).filter((account) => !account.needsReconnect).map((account) => account.platform)),
    [socialConnections?.accounts],
  );

  useEffect(() => {
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    queueMicrotask(() => {
      setTimezone((current) => current || progress?.timezone || browserTimezone);
      setQuietStart(progress?.quietHours.start ?? "22:00");
      setQuietEnd(progress?.quietHours.end ?? "07:00");
      setPhoneValue((current) => current || progress?.phone || "");
    });
  }, [progress]);

  useEffect(() => {
    ensureCreator({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).catch(() => setError("We couldn’t start your setup. Refresh and try again."));
  }, [ensureCreator]);

  useEffect(() => {
    if (!progress || new URLSearchParams(window.location.search).has("step")) return;
    queueMicrotask(() => {
      if (progress.paired) setStep(5);
      else if (planIsReady) setStep(socialConnections && socialConnections.accounts.length > 0 ? 3 : 2);
    });
  }, [planIsReady, progress, socialConnections]);

  useEffect(() => {
    if (step !== 2 || new URLSearchParams(window.location.search).get("connect") !== "back") return;
    reconcileSocialConnections({})
      .then((result) => setNotice(result.accounts > 0 ? "Connected. I’m pulling in your account now." : "Nothing is attached yet. If you completed the connection, give it a moment and try again."))
      .catch(() => setError("I couldn’t check that connection yet. Try again in a moment."))
      .finally(() => setBusy(null));
  }, [reconcileSocialConnections, step]);

  // §27: suggestions are chosen from their own posts, so wait for the first ones (or 25 seconds, or a finished read).
  const [waitedForPosts, setWaitedForPosts] = useState(false);
  useEffect(() => {
    if (step !== 3) return;
    const timer = window.setTimeout(() => setWaitedForPosts(true), 25_000);
    return () => window.clearTimeout(timer);
  }, [step]);
  const postsReady = (progress?.posts ?? 0) > 0 || progress?.ingest === "succeeded" || progress?.ingest === "failed" || progress?.ingest === "dead";
  useEffect(() => {
    if (step !== 3 || suggestions !== null || (!postsReady && !waitedForPosts)) return;
    suggestionsQuery({}).then((rows) => setSuggestions(rows)).catch(() => setSuggestions([]));
  }, [step, suggestions, suggestionsQuery, postsReady, waitedForPosts]);

  function go(next: 1 | 2 | 3 | 4 | 5) {
    setError(null);
    setNotice(null);
    setStep(next);
    window.history.replaceState(null, "", `/start?step=${next}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function beginCheckout(tier: Tier) {
    setBusy(`checkout:${tier}`);
    setError(null);
    const result = await createCheckout({ tier, interval, returnTo: "onboarding" });
    if (result.ok) window.location.assign(result.url);
    else { setError(result.reason); setBusy(null); }
  }

  async function connect(platform: Platform) {
    setBusy(`connect:${platform}`);
    setError(null);
    const result = await startSocialConnect({ platform, returnTo: "onboarding" });
    if (result.ok) window.location.assign(result.url);
    else { setError(result.reason); setBusy(null); }
  }

  async function addSuggestion(suggestion: Suggestion) {
    const result = await addAdmired({ platform: suggestion.platform, handle: suggestion.handle, addedBy: "suggested", why: suggestion.why });
    if (!result.ok) setError(result.error ?? "I couldn’t add that creator.");
  }

  async function addCandidate() {
    const handle = candidate.trim();
    if (!handle) return;
    setBusy("candidate");
    setError(null);
    const checked = await validate({ platform: candidatePlatform, handle });
    if (!checked.ok) { setError(checked.reason ?? "I couldn’t find that account."); setBusy(null); return; }
    const result = await addAdmired({ platform: candidatePlatform, handle: checked.handle, addedBy: "creator" });
    if (!result.ok) setError(result.error ?? "I couldn’t add that creator.");
    else setCandidate("");
    setBusy(null);
  }

  async function finishInspiration() {
    setBusy("inspiration");
    setError(null);
    const text = niche.trim();
    if (text) {
      const result = await describe({ niche: text });
      if (!result.ok) { setError(result.error ?? "I couldn’t save that yet."); setBusy(null); return; }
    }
    setBusy(null);
    go(4);
  }

  async function savePhone() {
    if (!consent) { setError("Please confirm that Maya can text this number."); return; }
    setBusy("phone");
    setError(null);
    await updateSettings({ timezone, quietHours: { start: quietStart, end: quietEnd } });
    const saved = await setPhone({ phone: phone || progress?.phone || "", consent: true });
    if (!saved.ok) { setError(saved.error ?? "I couldn’t save that number."); setBusy(null); return; }
    const pairing = await createPairingLink({});
    if (pairing.ok && pairing.deepLink) {
      setMessageLink(pairing.deepLink);
      setNotice("You’re ready. Send the prefilled text so I know I’ve reached the right conversation.");
    } else {
      setNotice("Your number is saved. Mission Control is ready while messaging finishes connecting.");
      if (pairing.error) setError(pairing.error);
    }
    setBusy(null);
  }

  const connectedCount = socialConnections?.accounts.length ?? 0;
  const knownSummary = settings?.knows?.summary;

  return (
    <OnboardShell where={`step ${step} of 5`}>
      <div className="onboard-progress" aria-label={`Onboarding step ${step} of 5`}>
        {[1, 2, 3, 4, 5].map((item) => <span key={item} className={item <= step ? "is-active" : ""} />)}
      </div>

      {step === 1 && (
        <section>
          <div className="screen-heading"><span className="kicker">Choose how Maya helps</span><h1>Start with the setup that fits you.</h1><p className="muted">Seven days free. Connect your account next, then I’ll start getting to know your work.</p></div>
          <div className="interval-toggle" aria-label="Billing interval">
            <button className={interval === "monthly" ? "selected" : ""} onClick={() => setInterval("monthly")}>Monthly</button>
            <button className={interval === "annual" ? "selected" : ""} onClick={() => setInterval("annual")}>Yearly <span>save 2 months</span></button>
          </div>
          <div className="tier-list">
            {TIER_NAMES.map((tier) => {
              const item = TIERS[tier];
              const amount = interval === "monthly" ? item.priceUsd : item.annualUsd;
              return <article key={tier} className={`tier-card ${tier === "duo" ? "featured" : ""}`}>
                <div><div className="tier-topline"><h2>{item.label}</h2>{tier === "duo" ? <span className="mini-badge">most popular</span> : null}</div><p className="muted small">{item.blurb}</p></div>
                <div className="tier-price"><strong>{price(amount)}</strong><span>/{interval === "monthly" ? "mo" : "yr"}</span></div>
                <button className="btn" disabled={busy !== null} onClick={() => beginCheckout(tier)}>{busy === `checkout:${tier}` ? "Opening checkout…" : "Choose this plan"}</button>
              </article>;
            })}
          </div>
          {planIsReady ? <button className="link" onClick={() => go(2)}>My plan is already active</button> : null}
        </section>
      )}

      {step === 2 && (
        <section>
          <div className="screen-heading"><span className="kicker">Your work</span><h1>Let me get to know what you make.</h1><p className="muted">Connect Instagram or TikTok. This gives me your real account history and the analytics the platform makes available.</p></div>
          {!planIsReady ? <div className="notice-card">Your plan is still activating. This normally takes a few seconds.</div> : null}
          <div className="connection-grid">
            {(["instagram", "tiktok"] as const).map((platform) => {
              const account = socialConnections?.accounts.find((item) => item.platform === platform);
              const connected = connectedPlatforms.has(platform);
              return <article className={`connection-card ${connected ? "connected" : ""}`} key={platform}>
                <div className={`platform-mark ${platform}`}>{platform === "instagram" ? "◎" : "♪"}</div>
                <div className="connection-copy"><h2>{PLATFORM_LABEL[platform]}</h2><p className="muted small">{connected ? `@${account?.username ?? "connected"}` : "Posts, performance, and account history"}</p></div>
                {connected ? <span className="connected-label">Connected</span> : <button className="btn-secondary" disabled={!planIsReady || busy !== null} onClick={() => connect(platform)}>{busy === `connect:${platform}` ? "Opening…" : "Connect"}</button>}
              </article>;
            })}
          </div>
          {socialConnections?.status === "needs_reconnect" ? <div className="notice-card error">One account needs to be reconnected before I can rely on its numbers.</div> : null}
          {socialConnections?.detail ? <p className="tiny muted">{socialConnections.detail}</p> : null}
          <button className="btn" disabled={connectedCount < 1 || busy !== null} onClick={() => go(3)}>{connectedCount < 1 ? "Connect one account to continue" : "Continue"}</button>
          <p className="privacy-note">You stay in control. Maya reads these accounts and never publishes from onboarding.</p>
        </section>
      )}

      {step === 3 && (
        <section>
          <div className="screen-heading"><span className="kicker">Your taste</span><h1>A few creators worth keeping an eye on.</h1><p className="muted">I found people who may be useful for different reasons. Pick any that feel right, add your own, or leave this to me.</p></div>
          <div className="read-card"><span className="read-orbit" aria-hidden="true" /><div><strong>{knownSummary ? "Here’s my first read" : "I’m reading your posts now"}</strong><p className="small muted">{knownSummary ?? (progress?.posts ? `${progress.posts} posts are in. I’ll keep learning in the background.` : "I’ll share what I notice in Messages as soon as I have enough evidence.")}</p></div></div>
          <label>Anything you want me to understand from the start? <span className="muted">optional</span><textarea className="input" value={niche} onChange={(event) => setNiche(event.target.value)} placeholder="I make practical style videos for people who hate overthinking clothes." /></label>
          {suggestions === null ? <div className="suggestion-grid" aria-label={postsReady ? "Choosing creators from your posts" : "Reading your posts first"}>{[0, 1, 2].map((item) => <div className="suggestion-card skeleton" key={item} />)}</div> : suggestions.length > 0 ? (
            <div className="suggestion-grid">{suggestions.slice(0, 6).map((suggestion) => {
              const selectedRow = admired.find((item) => item.platform === suggestion.platform && item.handle === suggestion.handle);
              return <article className={`suggestion-card ${selectedRow ? "selected" : ""}`} key={`${suggestion.platform}:${suggestion.handle}`}>
                <button className="suggestion-select" aria-label={`${selectedRow ? "Remove" : "Add"} @${suggestion.handle}`} onClick={() => selectedRow ? removeAdmired({ id: selectedRow.id }) : addSuggestion(suggestion)}>{selectedRow ? "✓" : "+"}</button>
                <div className="creator-avatar" style={suggestion.avatarUrl ? { backgroundImage: `url(${suggestion.avatarUrl})` } : undefined}>{suggestion.avatarUrl ? null : suggestion.handle.slice(0, 1).toUpperCase()}</div>
                <div><strong>{suggestion.displayName || `@${suggestion.handle}`}</strong><p className="tiny muted">@{suggestion.handle} · {PLATFORM_LABEL[suggestion.platform]}{followerLabel(suggestion.followers) ? ` · ${followerLabel(suggestion.followers)}` : ""}</p></div>
                <p className="small">{suggestion.why}</p>
              </article>;
            })}</div>
          ) : <div className="notice-card">I don’t have strong suggestions yet. Add someone you already like, or let me keep looking after setup.</div>}
          <div className="manual-creator"><select className="input" value={candidatePlatform} onChange={(event) => setCandidatePlatform(event.target.value as Platform)} aria-label="Creator platform"><option value="instagram">Instagram</option><option value="tiktok">TikTok</option></select><input className="input" value={candidate} onChange={(event) => setCandidate(event.target.value)} placeholder="@someone you like" autoCapitalize="none" onKeyDown={(event) => { if (event.key === "Enter") void addCandidate(); }} /><button className="btn-secondary" disabled={!candidate.trim() || busy !== null} onClick={addCandidate}>{busy === "candidate" ? "Checking…" : "Add"}</button></div>
          {admired.length > 0 ? <p className="tiny muted">Watching {admired.length} creator{admired.length === 1 ? "" : "s"}. You can change this anytime.</p> : null}
          <button className="btn" disabled={busy !== null} onClick={finishInspiration}>{admired.length > 0 ? "Use these creators" : "Find some for me later"}</button>
        </section>
      )}

      {step === 4 && (
        <section>
          <div className="screen-heading"><span className="kicker">Your real week</span><h1>Make the plan fit your life.</h1><p className="muted">With Google Calendar, I can see what’s coming up, find content in your actual week, and suggest realistic time to film or edit.</p></div>
          {calendar?.status === "connected" ? <div className="calendar-panel"><div className="calendar-check">✓</div><div><h2>Google Calendar connected</h2><p className="small muted">Choose what I can use. I’ll never add or move anything without your approval.</p></div>{calendar.calendars.length > 0 ? <div className="calendar-list">{calendar.calendars.map((item) => <label key={item.id} className="calendar-choice"><input type="checkbox" checked={item.selected} onChange={(event) => selectCalendars({ ids: calendar.calendars.filter((calendarItem) => calendarItem.id === item.id ? event.target.checked : calendarItem.selected).map((calendarItem) => calendarItem.id) })} /><span>{item.name}</span></label>)}</div> : null}</div> : (
            <div className="calendar-panel"><div className="calendar-illustration" aria-hidden="true"><span>MON</span><strong>12</strong><i /></div><div><h2>Connect Google Calendar</h2><p className="small muted">Optional. You can always connect it later from Mission Control.</p></div><a className="btn" href="/api/google-calendar/start?return=%2Fstart%3Fstep%3D4">Connect calendar</a></div>
          )}
          <button className={calendar?.status === "connected" ? "btn" : "btn-secondary"} onClick={() => go(5)}>{calendar?.status === "connected" ? "Continue" : "Skip for now"}</button>
        </section>
      )}

      {step === 5 && (
        <section>
          <div className="screen-heading"><span className="kicker">Where Maya lives</span><h1>Let’s keep this in Messages.</h1><p className="muted">I’ll text when I find something worth your attention. You can reply naturally, send a link, ask for ideas, or tell me to remember something.</p></div>
          <label>Your mobile number<input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+1 555 123 4567" value={phone} onChange={(event) => { setPhoneValue(event.target.value); setMessageLink(null); }} /></label>
          <div className="settings-pair"><label>Timezone<select className="input" value={timezone} onChange={(event) => setTimezone(event.target.value)}>{Array.from(new Set([timezone, Intl.DateTimeFormat().resolvedOptions().timeZone, ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [])])).filter(Boolean).map((zone) => <option value={zone} key={zone}>{zone.replaceAll("_", " ")}</option>)}</select></label><div className="quiet-fields"><label>Quiet from<input className="input" type="time" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} /></label><label>Until<input className="input" type="time" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} /></label></div></div>
          <label className="consent-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I agree to receive messages from Maya at this number. Message and data rates may apply. Reply STOP anytime.</span></label>
          {!messageLink ? <button className="btn" disabled={!phone.trim() || busy !== null} onClick={savePhone}>{busy === "phone" ? "Saving…" : "Finish setup"}</button> : null}
          {(messageLink || progress?.phone) ? <div className="finish-card"><div className="finish-flower" aria-hidden="true">✿</div><h2>You’re ready.</h2><p className="muted small">I’m getting to know your posts now. I’ll bring the useful part to you in Messages.</p>{messageLink ? <a className="btn" href={messageLink}>Open Messages</a> : null}<Link className="btn-secondary" href="/app/today">Open Mission Control</Link></div> : null}
        </section>
      )}

      {notice ? <p className="notice-card" role="status">{notice}</p> : null}
      {error ? <p className="notice-card error" role="alert">{error}</p> : null}
      {step > 1 && !messageLink ? <button className="back-link" onClick={() => go((step - 1) as 1 | 2 | 3 | 4)}>← Back</button> : null}
    </OnboardShell>
  );
}
