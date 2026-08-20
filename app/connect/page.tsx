"use client";

/**
 * ⭐ Connect — §18.9.25 ⑥.
 *
 * > *"Four cards — TikTok, Instagram, YouTube, X. Each: logo, **one-line
 * > role**, connect button. States per card: not connected · connecting ·
 * > connected · needs attention. **Instagram surfaces the Business/Creator
 * > requirement inline** the moment it's detected, not at first post."*
 *
 * ## ⚠️ The requirement is shown BEFORE the button, always
 *
 * §6.0.15: *"Before the OAuth redirect, in the connect card. A one-liner, plain
 * language… **Prevention beats diagnosis.**"*
 *
 * Not on hover, not behind a tooltip, not after a failure. The whole reason
 * this section of the spec exists is that Instagram connects cleanly and then
 * never posts — so the sentence has to be readable by someone who is about to
 * click, not discoverable by someone already debugging.
 *
 * ⚠️ And a connected-but-unpostable channel never renders as "connected".
 * `myChannels` makes that structurally impossible — it returns a `state`, and
 * `connected_cant_post` is a distinct value with the founder-facing reason
 * attached.
 *
 * ## ⭐ OAUTH RUNS IN A POPUP, AND THAT IS A CORRECTNESS FIX
 *
 * It used to be `window.location.href = authUrl` — the whole tab left for the
 * vendor and came back to `APP_URL/connect?returned=`.
 *
 * ⚠️ Which lands the founder on a SIGN-IN PAGE when `APP_URL` is not the exact
 * origin they were browsing. `/connect` is Clerk-protected, so a return trip to
 * a different host is a session-less request and Clerk bounces it. Reported
 * from a real staging run: *"the callback URL brings us back to sign on."*
 * Preview deployments make this the normal case rather than the edge one,
 * because every build has its own hostname and `APP_URL` can only name one.
 *
 * A popup keeps the founder's tab — and their session, and their place in the
 * flow — exactly where it was. The popup does the round trip, tells the opener
 * it finished, and closes itself. Nothing about the flow depends on the vendor
 * returning to the same origin the founder started on.
 *
 * ⚠️ AND THE FALLBACK MATTERS MORE THAN THE HAPPY PATH. A founder can close the
 * popup, block it, or finish in a tab the message never reaches. So the opener
 * also watches for the window closing and re-reads on focus: the message is the
 * fast path, not the only one.
 */

import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * §18.9.25: "one-line role". What the channel is FOR, in the strategy — not
 * what the company is. A founder deciding where to spend their attention needs
 * the job, not the brand.
 */
const ROLE: Record<string, string> = {
  tiktok: "reach engine",
  instagram: "reach + proof",
  youtube: "the long tail",
};

const LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

export default function ConnectPage() {
  const data = useQuery(api.maya.channels.myChannels, {});
  const startConnect = useAction(api.maya.connect.startConnect);
  const refresh = useAction(api.maya.connect.refreshMyChannels);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * ⭐ IF THIS PAGE IS ITSELF THE POPUP, ITS JOB IS TO TELL THE OPENER AND GO.
   *
   * The vendor returns to `/connect?returned=<channel>`. When that render has
   * an opener, we are the popup: hand the news back and close. The opener owns
   * the refresh, because it owns the screen the founder is looking at.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const returned = new URLSearchParams(window.location.search).get("returned");
    if (!returned) return;

    if (window.opener && window.opener !== window) {
      try {
        window.opener.postMessage({ source: "maya-connect", channel: returned }, window.location.origin);
      } catch {
        // Opener gone or cross-origin — the opener's close-watcher covers it.
      }
      window.close();
      return;
    }

    // Not a popup (blocked, or opened in a tab). Behave as before.
    void refresh({}).finally(() => {
      window.history.replaceState({}, "", "/connect");
    });
  }, [refresh]);

  /**
   * The opener side: the message is the fast path, the close-watcher and a
   * focus re-read are what make it reliable.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const d = event.data as { source?: string } | null;
      if (d?.source !== "maya-connect") return;
      setBusy(null);
      void refresh({});
    }
    function onFocus() {
      void refresh({});
    }
    window.addEventListener("message", onMessage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // ⚠️ One change with convex/maya/connect.ts's CHANNEL validator — this
  // literal union is what a public action is called with, so narrowing one
  // side alone is a runtime rejection the type checker cannot see.
  async function connect(channel: "tiktok" | "instagram" | "youtube") {
    setBusy(channel);
    setError(null);
    try {
      const res = await startConnect({ channel });
      if (!res.ok || !res.authUrl) {
        setError(res.error ?? "I couldn't start that connection.");
        setBusy(null);
        return;
      }

      const popup = window.open(
        res.authUrl,
        "maya-connect",
        "width=600,height=780,menubar=no,toolbar=no"
      );

      /**
       * ⚠️ A BLOCKED POPUP MUST NOT DEAD-END. Falling back to the full-page
       * redirect keeps the old behaviour available rather than leaving a
       * button that silently does nothing.
       */
      if (!popup) {
        window.location.href = res.authUrl;
        return;
      }

      const watch = window.setInterval(() => {
        if (!popup.closed) return;
        window.clearInterval(watch);
        setBusy(null);
        void refresh({});
      }, 700);
    } catch {
      setError("I couldn't start that connection — try again?");
      setBusy(null);
    }
  }

  const channels = (data?.ok ? (data.channels ?? []) : [])
    /**
     * ⚠️ Filtered, not just unlabelled. `myChannels` still returns X — the
     * schema and live rows keep it until video is publishing — so without this
     * the card renders with an undefined label and a button that calls a public
     * action the server now rejects. Dropping the OFFER has to drop the CARD.
     */
    .filter(
      // A type PREDICATE, not a plain filter — otherwise the compiler still
      // believes `c.channel` can be "x" at the call site below and the
      // guarantee lives only in a comment.
      (c): c is typeof c & { channel: "tiktok" | "instagram" | "youtube" } =>
        c.channel !== "x"
    );

  const connectedCount = channels.filter((c) => c.state === "connected").length;

  if (data === undefined) return null;

  if (!data.ok) {
    return (
      <div className="min-h-screen w-full bg-[#fbfaf6] text-[#0a0a0a]">
        <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-16">
          <p className="text-sm text-[#0a0a0a]/60">Sign in first.</p>
        </main>
      </div>
    );
  }

  return (
    /**
     * ⚠️ Cream, matching the on-ramp. This screen is the step immediately after
     * `/start` and shipped on the dark palette, so the founder crossed a hard
     * visual seam mid-flow and it read as a different product.
     */
    <div className="min-h-screen w-full bg-[#fbfaf6] text-[#0a0a0a]">
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-16">
        <h1 className="font-display italic text-[clamp(1.9rem,5vw,2.6rem)] leading-[1.1] tracking-[-0.015em]">
          Where should she post?
        </h1>
        {/* One tier — nothing is gated, so nothing is presented as locked. */}
        <p className="mt-4 text-[15px] leading-relaxed text-[#0a0a0a]/70">
          Connect any of these. You can add the rest later.
        </p>

        {error && <p className="mt-4 text-sm text-rose-700">{error}</p>}

        <div className="mt-8 space-y-3">
          {channels.map((c) => {
            const connected = c.state === "connected";
            const cantPost = c.state === "connected_cant_post";

            return (
              <div
                key={c.channel}
                className={`rounded-xl border p-4 transition-colors ${
                  connected
                    ? "border-[#0a0a0a]/25 bg-[#0a0a0a]/[0.04]"
                    : "border-[#0a0a0a]/15"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-[#0a0a0a]">
                      {LABEL[c.channel]}
                      {c.handle && (
                        <span className="ml-2 text-xs text-[#0a0a0a]/55">
                          @{c.handle}
                        </span>
                      )}
                    </p>
                    {/* ⭐ The one-line role. Kept at readable contrast — it is
                        the sentence that tells them why this channel is worth
                        their attention, not decoration. */}
                    <p className="mt-1 text-[13px] text-[#0a0a0a]/65">
                      {ROLE[c.channel]}
                    </p>
                  </div>

                  {/* ⚠️ Never the word "connected" for a channel that can't
                      publish — the state carries that distinction, so the
                      button label cannot drift from the truth. */}
                  {connected ? (
                    <span className="shrink-0 rounded-full bg-[#0a0a0a] px-3 py-1.5 text-[11px] font-medium text-[#fbfaf6]">
                      ✓ connected
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === c.channel}
                      onClick={() => connect(c.channel)}
                      className="shrink-0 rounded-full bg-[#0a0a0a] px-4 py-2 text-[13px] font-medium text-[#fbfaf6] transition-opacity hover:opacity-85 disabled:opacity-45"
                    >
                      {busy === c.channel
                        ? "waiting…"
                        : cantPost
                          ? "Reconnect"
                          : "Connect"}
                    </button>
                  )}
                </div>

                {/* ⭐ The requirement, BEFORE they click. Prevention beats
                    diagnosis (§6.0.15) — this is the sentence that stops an
                    Instagram connecting cleanly and never posting. */}
                {!connected &&
                  c.notices.map((notice) => (
                    <p
                      key={notice}
                      className="mt-2 text-[13px] leading-relaxed text-[#0a0a0a]/60"
                    >
                      {notice}
                    </p>
                  ))}

                {/* Detected after the fact — stated as the fix, not the scope. */}
                {cantPost && c.reason && (
                  <p className="mt-2 rounded-lg border border-amber-600/35 bg-amber-500/10 px-2.5 py-2 text-[13px] leading-relaxed text-amber-900">
                    {c.reason}
                  </p>
                )}

                {/* A permanent limit stays visible once connected — it never
                    stops being true, and it is the thing founders forget. */}
                {connected && c.permanentLimit && (
                  <p className="mt-2 text-[13px] leading-relaxed text-[#0a0a0a]/60">
                    {c.permanentLimit}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/**
          * ⭐ THE WAY OUT. Connecting a channel used to leave the founder on
          * this screen with nothing to press — the flow simply stopped, and the
          * only exit was the URL bar.
          *
          * One connection is enough to go: she can post, and the rest can be
          * added later. Before that, the button is absent rather than disabled
          * — a greyed-out button invites clicking and explains nothing, while
          * the line below says what is missing.
          */}
        {connectedCount > 0 ? (
          <a
            href="/clawlaunch/mission"
            className="mt-8 block w-full rounded-full bg-[#0a0a0a] px-4 py-3.5 text-center text-[15px] text-[#fbfaf6] no-underline transition-opacity hover:opacity-85"
          >
            {connectedCount === 1
              ? "That's enough to start"
              : `Done — ${connectedCount} connected`}
          </a>
        ) : (
          <p className="mt-8 text-center text-[13px] text-[#0a0a0a]/45">
            Connect at least one and she can start posting.
          </p>
        )}
      </main>
    </div>
  );
}
