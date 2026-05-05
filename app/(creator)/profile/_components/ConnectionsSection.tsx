/**
 * Connections section — Gmail, Google Calendar, and the social handle Maya
 * watches (TikTok / Instagram / YouTube etc.).
 *
 * The two surfaces look the same to the eye: a row per connection with a
 * status pill + a button. Under the hood:
 *
 *   - Gmail / Calendar are real Composio OAuth flows. Connect button calls
 *     api.integrations.composio.oauth.startOAuth and redirects the browser
 *     to the provider. The OAuth callback is handled by the parent page.
 *     Disconnect calls api.profile.disconnectProvider.
 *
 *   - The social handle is captured at onboarding and is read-only here.
 *     We render it as an info row so the page reads as a single connections
 *     surface rather than scattering the same idea across two sections.
 *
 * Stripe is NOT shown — it's a billing read-source, the operator already sees
 * subscription state at the top of the page, and surfacing it as a separate
 * "connection" reads as duplicated infrastructure to a creator.
 *
 * Apollo / Hunter are intentionally hidden too — they're outbound discovery
 * services, not "your connected accounts" — they should be exposed inside the
 * brand-outreach flow when it ships, not on the profile page. This is a UI
 * call only; the server still gates them.
 */

"use client";

import { useMemo, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { Calendar, Loader2, Mail, Music2 } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

type ProfileSummary = NonNullable<
  FunctionReturnType<typeof api.profile.getProfileSummary>
>;

type ComposioProvider = "gmail" | "calendar";

const COMPOSIO_META: Record<
  ComposioProvider,
  { label: string; icon: typeof Mail; sub: string }
> = {
  gmail: {
    label: "Gmail",
    icon: Mail,
    sub: "She reads brand emails and drafts the reply in your voice.",
  },
  calendar: {
    label: "Google Calendar",
    icon: Calendar,
    sub: "She plans content arcs around what's already on your week.",
  },
};

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X / Twitter",
  threads: "Threads",
  reddit: "Reddit",
  pinterest: "Pinterest",
};

const PLATFORM_ICON_DEFAULT = Music2;

export function ConnectionsSection({ summary }: { summary: ProfileSummary }) {
  const startOAuth = useAction(
    api.integrations.composio.oauth.startOAuth
  );
  const disconnect = useMutation(api.profile.disconnectProvider);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const accountByProvider = useMemo(
    () => new Map(summary.accounts.map((a) => [a.provider, a])),
    [summary.accounts]
  );

  const onConnect = async (provider: ComposioProvider) => {
    setErr(null);
    setBusy(provider);
    try {
      const redirectUri = `${window.location.origin}/profile?oauth=callback&provider=${provider}`;
      const { redirectUrl } = await startOAuth({ provider, redirectUri });
      window.location.assign(redirectUrl);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Could not start the connection.";
      setErr(raw.replace(/\[CONVEX[^\]]*\]\s*/g, "").trim());
      setBusy(null);
    }
  };

  const onDisconnect = async (provider: ComposioProvider) => {
    setErr(null);
    setBusy(provider);
    try {
      await disconnect({ provider });
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Could not disconnect.";
      setErr(raw.replace(/\[CONVEX[^\]]*\]\s*/g, "").trim());
    } finally {
      setBusy(null);
    }
  };

  const composioProviders: ComposioProvider[] = ["gmail", "calendar"];
  const primaryHandle = summary.handles[0] ?? null;

  return (
    <section className="border-t border-[var(--hairline)] px-5 pt-10 sm:px-8 sm:pt-12">
      <div className="mx-auto max-w-2xl">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
          Connections
        </span>
        <h2 className="mt-4 font-display text-3xl tracking-tight text-paper sm:text-4xl">
          What she can see.{" "}
          <span className="italic text-paper-dim">
            Disconnect anytime — she keeps the audit trail.
          </span>
        </h2>

        <ul className="mt-7 divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
          {/* Social — read-only row reflecting handle from onboarding */}
          {primaryHandle && (
            <SocialRow
              platform={primaryHandle.platform}
              handle={primaryHandle.handle}
              followerCount={primaryHandle.followerCount ?? null}
            />
          )}

          {/* Composio providers — Connect / Reconnect / Disconnect */}
          {composioProviders.map((p) => {
            const meta = COMPOSIO_META[p];
            const Icon = meta.icon;
            const acc = accountByProvider.get(p);
            const isActive = acc && acc.scopeStatus === "active";
            const isRevoked = acc && acc.scopeStatus === "revoked";
            const isBusy = busy === p;

            return (
              <li
                key={p}
                className="grid grid-cols-1 gap-3 py-5 sm:grid-cols-[160px_1fr] sm:items-start sm:gap-6"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--hairline-strong)] text-paper-dim">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <span className="block font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
                      {meta.label}
                    </span>
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      tone={
                        isActive
                          ? "active"
                          : isRevoked
                            ? "warn"
                            : "idle"
                      }
                    >
                      {isActive
                        ? "Connected"
                        : isRevoked
                          ? "Needs reconnect"
                          : "Not connected"}
                    </StatusPill>
                    {isActive && acc != null && (
                      <span className="font-mono text-[11px] text-paper-faint">
                        since {shortDate(acc.connectedAt)}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-paper-dim">{meta.sub}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {isActive ? (
                      <button
                        type="button"
                        onClick={() => void onDisconnect(p)}
                        disabled={isBusy}
                        className="inline-flex min-h-11 items-center gap-2 text-sm text-paper-faint underline-offset-4 transition-colors hover:text-paper hover:underline disabled:opacity-50"
                      >
                        {isBusy ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Disconnecting
                          </>
                        ) : (
                          <>Disconnect</>
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void onConnect(p)}
                        disabled={isBusy}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--hairline-strong)] bg-ink-2 px-4 text-sm text-paper transition-colors hover:border-paper-dim disabled:opacity-50"
                      >
                        {isBusy ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Opening
                          </>
                        ) : isRevoked ? (
                          <>Reconnect</>
                        ) : (
                          <>Connect {meta.label}</>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {err && <p className="mt-4 text-sm text-rose">{err}</p>}
      </div>
    </section>
  );
}

function SocialRow({
  platform,
  handle,
  followerCount,
}: {
  platform: string;
  handle: string;
  followerCount: number | null;
}) {
  const label = PLATFORM_LABEL[platform] ?? platform;
  const Icon = PLATFORM_ICON_DEFAULT;
  return (
    <li className="grid grid-cols-1 gap-3 py-5 sm:grid-cols-[160px_1fr] sm:items-start sm:gap-6">
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--hairline-strong)] text-paper-dim">
          <Icon className="h-4 w-4" />
        </span>
        <span className="block font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
          {label}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="active">Linked</StatusPill>
          <span className="text-base text-paper">@{handle}</span>
          {followerCount != null && (
            <span className="font-mono text-[11px] text-paper-faint">
              {formatFollowers(followerCount)} followers
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-paper-dim">
          The account she watches. Locked here to keep her voice baseline
          intact.
        </p>
      </div>
    </li>
  );
}

function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "active" | "warn" | "idle";
}) {
  const styles =
    tone === "active"
      ? "border-lime/60 bg-lime/10 text-lime"
      : tone === "warn"
        ? "border-amber-400/60 bg-amber-400/10 text-amber-200"
        : "border-[var(--hairline-strong)] text-paper-faint";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${styles}`}
    >
      {children}
    </span>
  );
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function shortDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
