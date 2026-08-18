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
   * Coming back from OAuth. The vendor redirects here with `?returned=`, and
   * the account list is re-read then — `syncChannels` is the single source of
   * truth, so the return trip only has to trigger it rather than carry state.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("returned")) return;
    void refresh({}).finally(() => {
      // Drop the query string so a refresh doesn't re-sync forever.
      window.history.replaceState({}, "", "/connect");
    });
  }, [refresh]);

  // ⚠️ One change with convex/maya/connect.ts's CHANNEL validator — this
  // literal union is what a public action is called with, so narrowing one
  // side alone is a runtime rejection the type checker cannot see.
  async function connect(channel: "tiktok" | "instagram" | "youtube") {
    setBusy(channel);
    setError(null);
    try {
      const res = await startConnect({ channel });
      if (res.ok && res.authUrl) window.location.href = res.authUrl;
      else setError(res.error ?? "I couldn't start that connection.");
    } catch {
      setError("I couldn't start that connection — try again?");
    } finally {
      setBusy(null);
    }
  }

  if (data === undefined) return null;
  if (!data.ok) {
    return (
      <main className="mx-auto w-full max-w-xl px-5 py-16">
        <p className="text-sm text-paper-faint">Sign in first.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl px-5 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-paper">
        Where should she post?
      </h1>
      {/* One tier — nothing is gated, so nothing is presented as locked. */}
      <p className="mt-1 text-sm text-paper-faint">
        Connect any of these. You can add the rest later.
      </p>

      {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

      <div className="mt-6 space-y-3">
        {/**
          * ⚠️ Filtered, not just unlabelled. `myChannels` still returns X —
          * the schema and live rows keep it until video is publishing — so
          * without this the card renders with an undefined label and a button
          * that calls a public action the server now rejects. Dropping the
          * OFFER has to drop the CARD.
          */}
        {(data.channels ?? [])
          .filter(
            // A type PREDICATE, not a plain filter — otherwise the compiler
            // still believes `c.channel` can be "x" at the call site below and
            // the guarantee lives only in a comment.
            (c): c is typeof c & { channel: "tiktok" | "instagram" | "youtube" } =>
              c.channel !== "x"
          )
          .map((c) => {
          const connected = c.state === "connected";
          const cantPost = c.state === "connected_cant_post";

          return (
            <div
              key={c.channel}
              className="rounded-lg border border-white/12 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-paper">
                    {LABEL[c.channel]}
                    {c.handle && (
                      <span className="ml-2 text-xs text-paper-faint">
                        @{c.handle}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-paper-faint">
                    {ROLE[c.channel]}
                  </p>
                </div>

                {/* ⚠️ Never the word "connected" for a channel that can't
                    publish — the state carries that distinction, so the button
                    label cannot drift from the truth. */}
                {connected ? (
                  <span className="shrink-0 text-xs text-emerald-300">
                    connected
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy === c.channel}
                    onClick={() => connect(c.channel)}
                    className="shrink-0 rounded-lg bg-paper px-3 py-1.5 text-xs font-semibold text-black transition hover:opacity-90 disabled:opacity-50"
                  >
                    {busy === c.channel
                      ? "…"
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
                    className="mt-2 text-xs leading-relaxed text-paper-faint"
                  >
                    {notice}
                  </p>
                ))}

              {/* Detected after the fact — stated as the fix, not the scope. */}
              {cantPost && c.reason && (
                <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs leading-relaxed text-amber-200">
                  {c.reason}
                </p>
              )}

              {/* A permanent limit stays visible once connected — it never
                  stops being true, and it is the thing founders forget. */}
              {connected && c.permanentLimit && (
                <p className="mt-2 text-xs leading-relaxed text-paper-faint">
                  {c.permanentLimit}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
