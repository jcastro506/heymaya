"use client";

import { useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";

const CONFIRMATION = "DELETE MAYA";

export default function DeleteAccountPage() {
  const { user, isLoaded } = useUser();
  const isSignedOut = isLoaded && !user;
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Account deletion failed.");
      }
      setDeleted(true);
      window.setTimeout(() => {
        window.location.assign("/?accountDeleted=true");
      }, 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Account deletion failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-ink px-5 py-10 text-paper sm:px-8">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-[0.2em] text-paper-faint transition hover:text-paper"
        >
          HeyMaya
        </Link>

        <section className="mt-8 rounded-2xl border border-rose/40 bg-ink-2 p-6 shadow-2xl shadow-black/20 sm:p-8">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-rose/15 text-rose">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-rose">
                Permanent deletion
              </p>
              <h1 className="mt-2 font-display text-4xl leading-tight">
                Delete your HeyMaya account
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-paper-dim">
                This removes your Maya profile, onboarding answers, connected
                account tokens, calendar context, OpenClaw channel rows,
                business data, and account identity. This cannot be undone.
              </p>
            </div>
          </div>

          <div className="mt-7 rounded-xl border border-[var(--hairline)] bg-ink-3/45 p-4 text-sm text-paper-dim">
            <p>
              Signed in as{" "}
              <span className="text-paper">
                {isLoaded
                  ? user?.primaryEmailAddress?.emailAddress ?? "unknown user"
                  : "loading..."}
              </span>
            </p>
            {isSignedOut && (
              <p className="mt-2 text-rose">
                Sign in first so Maya can delete the correct account.
              </p>
            )}
            <p className="mt-2">
              Type <span className="font-mono text-paper">{CONFIRMATION}</span>{" "}
              to confirm.
            </p>
          </div>

          <label className="mt-5 block">
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-paper-faint">
              Confirmation
            </span>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={busy || deleted}
              className="mt-2 h-12 w-full rounded-md border border-[var(--hairline-strong)] bg-ink px-3 font-mono text-sm text-paper outline-none transition focus:border-lime disabled:opacity-60"
              autoComplete="off"
            />
          </label>

          {error && <p className="mt-3 text-sm text-rose">{error}</p>}
          {deleted && (
            <p className="mt-3 text-sm text-lime">
              Account deleted. Redirecting...
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void deleteAccount()}
              disabled={busy || deleted || isSignedOut || confirmation !== CONFIRMATION}
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-rose px-4 text-sm font-medium text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete account
            </button>
            {isSignedOut && (
              <Link
                href="/sign-in?redirect_url=/account/delete"
                className="inline-flex min-h-11 items-center rounded-md bg-paper px-4 text-sm font-medium text-ink transition hover:brightness-95"
              >
                Sign in to continue
              </Link>
            )}
            <Link
              href="/"
              className="inline-flex min-h-11 items-center rounded-md border border-[var(--hairline-strong)] px-4 text-sm text-paper-dim transition hover:text-paper"
            >
              Keep account
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
