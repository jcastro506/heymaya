"use client";

/**
 * Coach/Manager rewrite (2026-05-04) — single-screen onboarding.
 *
 * Replaces the previous 6-step state machine. The user lands here after
 * Clerk sign-up, sees ONE screen with three fields (TikTok handle, name,
 * phone), submits, and is dropped on a status page that subscribes to
 * Maya's deploy progress.
 *
 * Operator framing (2026-05-04):
 *   "The user should come. They should, during onboarding, give us their
 *    handle and name. We say, 'Okay, great, that's all we needed.' Maya's
 *    taking a look at your profile right now. She's going to text you when
 *    she's done, just keep your phone handy."
 *
 * View states:
 *   - "loading"  — waiting for Convex to resolve `me`
 *   - "form"     — `me.status === "onboarding"` and no primaryHandle yet
 *   - "preparing"— submission accepted; pipeline running. Drives state from
 *                  the live `creators.status`, the bulk-pull job row, and
 *                  the synth job row (no fake setTimeout milestones).
 *   - "ready"    — `me.status === "active"`; CTA: "Open Messages"
 *
 * Why one component instead of routed sub-pages:
 *   - The form → status transition is fast (sub-1s after submit) and the
 *     URL doesn't need to change. A refresh on the status page should still
 *     land on the status page, which we get for free by reading from
 *     `me.status` instead of a router param.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";

const submitOnboardingRef = api.onboarding.maya.submitOnboarding.submitOnboarding;
const meRef = api.creators.me;
const bulkPullStatusRef = api.onboarding.maya.jobs.getJobStatus;

type ViewState = "loading" | "form" | "preparing" | "ready";

export default function MayaOnboardingPage() {
  const me = useQuery(meRef);
  const submit = useAction(submitOnboardingRef);

  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedLocally, setSubmittedLocally] = useState(false);

  // The view state is a pure function of (me.status, primaryHandle, local
  // submit flag). We derive it inside the component so a refresh on the
  // status page picks up where it left off.
  const view: ViewState = useMemo(() => {
    if (me === undefined) return "loading";
    if (me === null) return "form";
    if (me.status === "active") return "ready";
    if (submittedLocally || me.primaryHandle) return "preparing";
    return "form";
  }, [me, submittedLocally]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await submit({
        handle,
        displayName,
        phoneNumber: phone,
      });
      if (!result.ok) {
        setError(result.message);
        setSubmitting(false);
        return;
      }
      setSubmittedLocally(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative isolate flex min-h-[100dvh] flex-col bg-ink text-paper">
      <Nav />
      <main
        className="relative z-10 flex-1"
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        {view === "loading" ? <BootSkeleton /> : null}
        {view === "form" ? (
          <FormView
            handle={handle}
            setHandle={setHandle}
            displayName={displayName}
            setDisplayName={setDisplayName}
            phone={phone}
            setPhone={setPhone}
            submitting={submitting}
            error={error}
            onSubmit={onSubmit}
          />
        ) : null}
        {view === "preparing" ? <PreparingView /> : null}
        {view === "ready" ? <ReadyView /> : null}
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Form view                                                                   */
/* -------------------------------------------------------------------------- */

interface FormViewProps {
  handle: string;
  setHandle: (next: string) => void;
  displayName: string;
  setDisplayName: (next: string) => void;
  phone: string;
  setPhone: (next: string) => void;
  submitting: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
}

function FormView({
  handle,
  setHandle,
  displayName,
  setDisplayName,
  phone,
  setPhone,
  submitting,
  error,
  onSubmit,
}: FormViewProps) {
  // Pre-fill displayName from the verified handle once we have it. Keep
  // verification debounced — we don't ping ScrapeCreators on every keystroke.
  // The server re-verifies on submit anyway; this is just a polite preview.
  const verify = useAction(
    api.integrations.scrapeCreators.verifyHandle.verifyHandle
  );
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<{
    handle: string;
    displayName: string | null;
    followerCount: number;
  } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Debounce handle verification by 600ms. We only verify when the trimmed
  // handle is non-empty + differs from what we already verified.
  useEffect(() => {
    const trimmed = handle.trim().replace(/^@+/, "");
    if (trimmed.length === 0) {
      setVerified(null);
      setVerifyError(null);
      return;
    }
    if (verified && verified.handle === trimmed) return;
    const id = window.setTimeout(async () => {
      setVerifying(true);
      setVerifyError(null);
      try {
        const result = await verify({ platform: "tiktok", handle: trimmed });
        setVerified({
          handle: result.handle,
          displayName: result.displayName,
          followerCount: result.followerCount,
        });
        // Only auto-fill name if the user hasn't typed one yet.
        if (!displayName.trim() && result.displayName) {
          setDisplayName(result.displayName);
        }
      } catch (err) {
        setVerified(null);
        setVerifyError(stripStack((err as Error).message));
      } finally {
        setVerifying(false);
      }
    }, 600);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps: intentional — including `verified` / `displayName` in deps would re-trigger verification when the user edits the name field.
  }, [handle]);

  const canSubmit =
    handle.trim().length > 0 &&
    displayName.trim().length > 0 &&
    phone.trim().length > 0 &&
    !submitting;

  return (
    <section className="mx-auto w-full max-w-xl px-5 pb-12 pt-6 sm:px-8 sm:pt-12">
      <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
        §01 · Hand off to Maya
      </span>
      <h1 className="mt-4 font-display text-3xl leading-[1.05] tracking-tight text-paper sm:text-4xl">
        Three quick things and Maya takes it from here.
      </h1>
      <p className="mt-3 max-w-md text-base leading-relaxed text-paper-dim">
        Your TikTok, your name, and where Maya should text you. That's
        everything.
      </p>

      <form onSubmit={onSubmit} className="mt-7 space-y-5">
        <Field
          label="TikTok handle"
          hint="Maya reads your last 30 posts to learn your voice."
        >
          <div className="flex h-14 items-center rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 px-4">
            <span className="font-mono text-sm text-paper-faint">@</span>
            <input
              value={handle.replace(/^@+/, "")}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="yourhandle"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              inputMode="text"
              className="h-full w-full bg-transparent pl-2 text-base text-paper outline-none placeholder:text-paper-faint"
              aria-label="Your TikTok handle"
              disabled={submitting}
            />
            {verifying ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-paper-faint" />
            ) : verified ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-lime" />
            ) : null}
          </div>
          {verified && !verifying ? (
            <p className="mt-2 text-xs text-paper-dim">
              Found @{verified.handle}
              {verified.displayName ? ` · ${verified.displayName}` : ""}
              {verified.followerCount > 0
                ? ` · ${formatFollowers(verified.followerCount)} followers`
                : ""}
            </p>
          ) : verifyError && !verifying ? (
            <p className="mt-2 text-xs text-rose">{verifyError}</p>
          ) : null}
        </Field>

        <Field label="Your name" hint="What should Maya call you?">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="First Last"
            autoCapitalize="words"
            autoComplete="name"
            className="h-14 w-full rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 px-4 text-base text-paper outline-none placeholder:text-paper-faint"
            aria-label="Your name"
            maxLength={80}
            disabled={submitting}
          />
        </Field>

        <Field label="Phone number" hint="Maya will text you here.">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+14155551234"
            inputMode="tel"
            autoComplete="tel"
            className="h-14 w-full rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 px-4 font-mono text-base text-paper outline-none placeholder:text-paper-faint"
            aria-label="Your phone number in E.164 format"
            disabled={submitting}
          />
        </Field>

        {error ? (
          <p
            role="alert"
            className="rounded-2xl border border-rose/30 bg-rose/5 p-3 text-sm text-rose"
          >
            {error}
          </p>
        ) : null}

        <div
          className="sticky bottom-0 -mx-5 mt-8 flex flex-col gap-3 border-t border-[var(--hairline)] bg-ink/95 px-5 py-4 backdrop-blur sm:relative sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <button
            type="submit"
            disabled={!canSubmit}
            className="btn btn-primary h-14 w-full text-base disabled:opacity-40"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Handing it off…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                That's everything — hand off to Maya
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
        {label}
      </span>
      <div className="mt-2">{children}</div>
      {hint ? (
        <span className="mt-2 block text-xs text-paper-faint">{hint}</span>
      ) : null}
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Preparing view (status)                                                     */
/* -------------------------------------------------------------------------- */

function PreparingView() {
  const bulkPull = useQuery(bulkPullStatusRef, { jobType: "bulk-pull" });
  const synth = useQuery(bulkPullStatusRef, { jobType: "synth-picture" });
  const me = useQuery(meRef);

  // Map live job state to one of three high-level milestones. The text is
  // grounded in real progress (not faked with setTimeout per the spec).
  const milestone: "reading" | "building" | "first-message" = useMemo(() => {
    // If creator is active, we shouldn't render this view — but be defensive.
    if (me?.status === "active") return "first-message";
    // Synth running / done → building Maya.
    if (synth?.status === "running" || synth?.status === "done") {
      return "building";
    }
    // Bulk-pull done → likely between bulk-pull and synth-kick → still building.
    if (bulkPull?.status === "done") return "building";
    // Anything earlier → still reading.
    return "reading";
  }, [bulkPull, synth, me]);

  return (
    <section className="mx-auto w-full max-w-xl px-5 pb-12 pt-6 sm:px-8 sm:pt-12">
      <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
        §02 · Maya is working
      </span>
      <h1 className="mt-4 font-display text-3xl leading-[1.05] tracking-tight text-paper sm:text-4xl">
        Maya's taking a look at your profile right now.
      </h1>
      <p className="mt-3 max-w-md text-base leading-relaxed text-paper-dim">
        She'll text you when she's done. Keep your phone handy.
      </p>

      <ol className="mt-8 space-y-3">
        <Milestone
          done={
            milestone === "building" || milestone === "first-message"
          }
          active={milestone === "reading"}
          label="Reading your last 30 posts"
        />
        <Milestone
          done={milestone === "first-message"}
          active={milestone === "building"}
          label="Building your Maya"
        />
        <Milestone
          done={false}
          active={milestone === "first-message"}
          label="Sending you your first message"
        />
      </ol>

      <p className="mt-10 text-center text-sm text-paper-faint">
        You can close this tab. Maya keeps working.
      </p>
    </section>
  );
}

function Milestone({
  done,
  active,
  label,
}: {
  done: boolean;
  active: boolean;
  label: string;
}) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-[var(--hairline)] bg-ink-2 px-4 py-3">
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
          done
            ? "bg-lime text-ink"
            : active
              ? "bg-ink-3 text-lime"
              : "bg-ink-3 text-paper-faint"
        }`}
        aria-hidden
      >
        {done ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : active ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-paper-faint" />
        )}
      </span>
      <span
        className={`text-sm ${done || active ? "text-paper" : "text-paper-faint"}`}
      >
        {label}
      </span>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Ready view                                                                  */
/* -------------------------------------------------------------------------- */

function ReadyView() {
  return (
    <section className="mx-auto w-full max-w-xl px-5 pb-12 pt-6 sm:px-8 sm:pt-12">
      <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
        §03 · Maya is on
      </span>
      <h1 className="mt-4 font-display text-3xl leading-[1.05] tracking-tight text-paper sm:text-4xl">
        Maya just texted you.
      </h1>
      <p className="mt-3 max-w-md text-base leading-relaxed text-paper-dim">
        Open Messages and say hi. From here, the product is the thread.
      </p>

      <a
        href="sms:open"
        className="btn btn-primary mt-8 h-14 w-full text-base"
      >
        Open Messages
      </a>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Nav + skeleton + helpers                                                    */
/* -------------------------------------------------------------------------- */

function Nav() {
  return (
    <header
      className="relative z-20 px-5 pt-6 sm:px-8 sm:pt-8"
      style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between">
        <Link href="/" className="group inline-flex items-center gap-2">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-full bg-lime text-ink"
            style={{
              boxShadow:
                "0 0 0 1px rgba(214,255,61,0.3), 0 6px 24px -6px rgba(214,255,61,0.5)",
            }}
          >
            <span className="font-display text-lg leading-none">m</span>
          </span>
          <span className="font-display text-xl tracking-tight text-paper">
            HeyMaya
          </span>
        </Link>
      </div>
    </header>
  );
}

function BootSkeleton() {
  return (
    <section className="mx-auto w-full max-w-xl px-5 pb-12 pt-6 sm:px-8 sm:pt-12">
      <div className="h-3 w-24 rounded-full bg-ink-2" />
      <div className="mt-6 h-12 w-3/4 rounded-2xl bg-ink-2" />
      <div className="mt-6 h-5 w-2/3 rounded-2xl bg-ink-2" />
      <div className="mt-10 space-y-3">
        <div className="h-14 rounded-2xl bg-ink-2" />
        <div className="h-14 rounded-2xl bg-ink-2" />
        <div className="h-14 rounded-2xl bg-ink-2" />
      </div>
    </section>
  );
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function stripStack(msg: string): string {
  const cleaned = msg.replace(/\[CONVEX[^\]]*\]\s*/g, "").trim();
  return cleaned.replace(/^Server Error:?\s*/i, "");
}
