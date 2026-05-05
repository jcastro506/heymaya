/**
 * Account section — restrained bottom-of-page surface for the two account-
 * level actions: take your data, leave.
 *
 * Both are rendered as text links rather than buttons. The brief explicitly
 * says "no big destructive button — link, restrained."
 *
 * Data export still uses the existing api.profile.exportCreatorData action.
 * The brief lists data export under the legacy section list but doesn't
 * include it in the target shape. We keep it because (a) it's wired and
 * working, (b) it pairs naturally with "Delete my account" — both are
 * "leaving Maya" affordances — and (c) removing a working privacy feature is
 * worse than restraining the visual weight.
 *
 * Delete routes to /account/delete (the existing destructive flow that
 * confirms via Maya in chat first).
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";

export function AccountSection() {
  const exportData = useAction(api.profile.exportCreatorData);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onExport = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await exportData({});
      setUrl(res.url);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Export failed.";
      setErr(raw.replace(/\[CONVEX[^\]]*\]\s*/g, "").trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-t border-[var(--hairline)] px-5 pb-20 pt-10 sm:px-8 sm:pt-12">
      <div className="mx-auto max-w-2xl">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
          Account
        </span>

        <ul className="mt-6 divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
          <li className="grid grid-cols-1 gap-1 py-5 sm:grid-cols-[160px_1fr] sm:items-baseline sm:gap-6">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
              Your data
            </span>
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => void onExport()}
                disabled={busy}
                className="inline-flex min-h-11 items-center gap-2 text-sm text-paper underline-offset-4 transition-colors hover:underline disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Bundling
                  </>
                ) : (
                  <>Download a copy</>
                )}
              </button>
              {url && (
                <a
                  href={url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="ml-4 text-sm text-lime underline-offset-4 hover:underline"
                >
                  Open download
                </a>
              )}
              <p className="mt-1 text-xs text-paper-faint">
                JSON export of everything Maya knows about you. Credentials are
                scrubbed.
              </p>
              {err && <p className="mt-2 text-sm text-rose">{err}</p>}
            </div>
          </li>

          <li className="grid grid-cols-1 gap-1 py-5 sm:grid-cols-[160px_1fr] sm:items-baseline sm:gap-6">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
              Leaving
            </span>
            <div className="min-w-0">
              <Link
                href="/account/delete"
                className="inline-flex min-h-11 items-center text-sm text-paper-dim underline-offset-4 transition-colors hover:text-rose hover:underline"
              >
                Delete my account
              </Link>
              <p className="mt-1 text-xs text-paper-faint">
                Confirms in your Maya thread before anything is touched.
              </p>
            </div>
          </li>
        </ul>
      </div>
    </section>
  );
}
