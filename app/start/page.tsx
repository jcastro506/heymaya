"use client";

/**
 * ⭐ The on-ramp — §18.9.25 screens ① ② ③.
 *
 * > *"**Six web screens total. Four before any value is asked for**, two after.
 * > No progress bar, no 'step 3 of 7,' no wizard chrome — a wizard signals a
 * > form, and the whole pitch is that this isn't one."*
 *
 * ## One screen, three states — never a navigation
 *
 * §18.9.25 ② is explicit: *"same screen, transformed — never a navigation."*
 * So this is a single route with a phase, not three pages. The URL collapses to
 * a chip and the read appears beneath it; the page never reloads, because a
 * reload is the moment a person remembers they were filling in a form.
 *
 *   ① url      one input, centered, large. Nothing else on the screen.
 *   ② read     three beats — what it is → who buys it → what's different
 *              then "Right?" — one tap for yes, one box for a correction
 *   ③ pair     one link, one line. "She'll take it from here."
 *
 * ## ⚠️ The read happens BEFORE signup, deliberately
 *
 * §6.0: *"That live read is the hook, and it delivers value **before** asking
 * for anything — which is what makes the pairing ask convert."* So ① and ② run
 * anonymously through `/api/demo/read`, which carries the IP limit, the URL
 * cache and the daily spend cap. Clerk is only reached once they've already
 * seen her be right about their company.
 *
 * ⚠️ Styling is plain Tailwind, deliberately. `mc-btn` and friends live in
 * `mission.css`, which is imported by the Mission Control layout — on this
 * route those class names resolve to nothing, and the first build rendered the
 * primary button as bare text. Caught by looking at the page at 390px, which
 * no typecheck or test would have done.
 *
 * ⚠️ This route is NOT linked from any public CTA. Those still point at
 * `/onboarding/gtm` — the product currently serving customers. Flipping them is
 * the cutover, and that is an operator decision, not a side effect of building
 * the thing it will need.
 */

import { useState } from "react";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import { SignInButton } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";

interface Read {
  name?: string;
  whatItIs?: string;
  whoItsFor?: string;
  whatsDifferent?: string;
}

type Phase =
  | { at: "url" }
  | { at: "reading" }
  | { at: "read"; read: Read }
  | { at: "failed"; detail: string }
  | { at: "pair"; link?: string };

export default function StartPage() {
  const { isAuthenticated } = useConvexAuth();
  const start = useMutation(api.maya.onramp.startFromRead);
  const createPairingLink = useMutation(api.maya.pairing.createPairingLink);
  const deployMine = useAction(api.maya.setup.deployMine);

  const [url, setUrl] = useState("");
  const [correction, setCorrection] = useState("");
  const [phase, setPhase] = useState<Phase>({ at: "url" });
  const [busy, setBusy] = useState(false);

  async function read(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || phase.at === "reading") return;
    setPhase({ at: "reading" });

    try {
      const res = await fetch("/api/demo/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        read?: Read;
        detail?: string;
      };
      if (data.ok && data.read?.whatItIs)
        setPhase({ at: "read", read: data.read });
      else
        setPhase({
          at: "failed",
          // Her words, relayed. §12 — an honest "I couldn't read that" beats a
          // generic error, and beats a confident guess by more.
          detail: data.detail ?? "I couldn't get a read on that one.",
        });
    } catch {
      setPhase({
        at: "failed",
        detail: "I couldn't reach that site — try again?",
      });
    }
  }

  /**
   * ⭐ Commit: the read becomes product truth, the correction becomes a rule.
   *
   * Only reachable once signed in — the button below is a Clerk sign-in until
   * then, so this never runs unauthenticated.
   */
  async function commit(read: Read) {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await start({
        url: url.trim(),
        read,
        correction: correction.trim() || undefined,
        // Their clock, not the server's. Every "today" she counts is in it.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      if (!saved.ok) {
        setPhase({
          at: "failed",
          detail: saved.error ?? "something went wrong",
        });
        return;
      }

      const link = await createPairingLink({});
      setPhase({ at: "pair", link: link.deepLink });

      /**
       * ⚠️ Deploy is fired but NOT awaited, and the screen does not depend on
       * it. §18.9.24: Fly's "accepted" and "started" are ~90 seconds apart, and
       * making a person watch a spinner for that is how the last screen before
       * the product becomes a conversation turns into the one they abandon.
       * Pairing is what matters here; the machine catches up.
       */
      void deployMine({}).catch(() => {
        /* Surfaced by the setup screen and fleet health, not by blocking this. */
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-16">
      {/* ① ─ near-empty, full-bleed. "The entire screen is a question and a
          box. Anything else on it is a distraction from the only thing that
          matters." No nav, no logo wall, no feature strip. */}
      {(phase.at === "url" ||
        phase.at === "reading" ||
        phase.at === "failed") && (
        <>
          <h1 className="text-2xl font-semibold tracking-tight text-paper">
            What did you build?
          </h1>
          <form onSubmit={read} className="mt-5">
            <input
              type="url"
              inputMode="url"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="yourproduct.com"
              disabled={phase.at === "reading"}
              /* Large and centered — this input IS the screen. */
              className="w-full rounded-lg border border-white/15 bg-transparent px-4 py-4 text-lg text-paper outline-none placeholder:text-paper-faint/60 focus:border-white/40 disabled:opacity-60"
            />
          </form>

          {phase.at === "reading" && (
            <p className="mt-4 text-sm text-paper-faint">Reading it now…</p>
          )}
          {phase.at === "failed" && (
            <p className="mt-4 text-sm text-paper-faint">{phase.detail}</p>
          )}
        </>
      )}

      {/* ② ─ the same screen, transformed. The URL becomes a chip; the read
          appears beneath it. */}
      {phase.at === "read" && (
        <>
          <span className="self-start rounded-full border border-white/15 px-3 py-1 text-xs text-paper-faint">
            {url}
          </span>

          {/* The three beats, in the order §18.9.25 names them. */}
          <div className="mt-5 space-y-4">
            <p className="text-lg leading-relaxed text-paper">
              {phase.read.whatItIs}
            </p>
            {phase.read.whoItsFor && (
              <p className="leading-relaxed text-paper-dim">
                {phase.read.whoItsFor}
              </p>
            )}
            {phase.read.whatsDifferent ? (
              <p className="leading-relaxed text-paper-dim">
                {phase.read.whatsDifferent}
              </p>
            ) : (
              /**
               * ⭐ She found no differentiator, and says so.
               *
               * Live on cursor.com: `whatsDifferent` came back empty with
               * "detailed differentiation from other AI coding tools" in
               * `gaps` — she refused to invent one, which is §3407's hard rule
               * working exactly as written.
               *
               * ⚠️ But silently dropping the beat hides that. §12: honest
               * silence beats fake activity — and stating the gap is also the
               * stronger move, because it turns the missing beat into the one
               * question worth answering, right above the box that answers it.
               * What they type becomes their first rule.
               */
              <p className="leading-relaxed text-paper-dim">
                What I couldn&apos;t work out is what actually makes you
                different — and that&apos;s the thing worth posting about.
              </p>
            )}
          </div>

          {/* ⭐ "Right?" — one tap for yes, one box for a correction. What they
              type here becomes a rule she keeps forever, so it is worth more
              than any onboarding form field. */}
          <p className="mt-8 text-sm font-medium text-paper">Right?</p>
          <textarea
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            rows={2}
            placeholder={
              phase.read.whatsDifferent
                ? "Anything I got wrong?"
                : "So — what makes you different?"
            }
            className="mt-2 w-full resize-none rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-paper outline-none placeholder:text-paper-faint/60 focus:border-white/40"
          />

          <div className="mt-4">
            {isAuthenticated ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => commit(phase.read)}
                className="w-full rounded-lg bg-paper px-4 py-3 text-center text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-50"
              >
                {busy
                  ? "One second…"
                  : correction.trim()
                    ? "Got it — keep going"
                    : "Yep, that's it"}
              </button>
            ) : (
              /* Signup asked for only AFTER she's been right about their
                 company — §6.0, and the reason the pairing ask converts. */
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="w-full rounded-lg bg-paper px-4 py-3 text-center text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-50"
                >
                  {correction.trim() ? "Got it — keep going" : "Yep, that's it"}
                </button>
              </SignInButton>
            )}
          </div>
        </>
      )}

      {/* ③ ─ the last web screen before the product becomes a conversation.
          "One QR, one button, one line." No explanation of what Telegram is,
          no feature preview, no reassurance copy. */}
      {phase.at === "pair" && (
        <>
          <h1 className="text-2xl font-semibold tracking-tight text-paper">
            She&apos;ll take it from here.
          </h1>
          {phase.link ? (
            <a
              href={phase.link}
              target="_blank"
              rel="noreferrer"
              className="w-full rounded-lg bg-paper px-4 py-3 text-center text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-50 mt-6 block no-underline"
            >
              Open Telegram
            </a>
          ) : (
            <p className="mt-4 text-sm text-paper-faint">
              I couldn&apos;t make your link — refresh and I&apos;ll try again.
            </p>
          )}
        </>
      )}
    </main>
  );
}
