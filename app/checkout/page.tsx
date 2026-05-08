"use client";

/**
 * Auth-gated landing-CTA → Stripe Checkout bridge.
 *
 * Flow:
 *   1. Landing-page CTA navigates here with `?tier=coach|manager&interval=monthly|annual`.
 *   2. If the user is signed in: immediately invoke `createCheckoutSession`
 *      and `window.location.assign` to the returned hosted Stripe URL.
 *   3. If signed out: middleware's `auth.protect()` already redirected to
 *      Clerk; on completion Clerk returns to this route with the same query
 *      params and we proceed as in (2).
 *
 * Why a dedicated route instead of inline-on-/creators: Clerk's redirect-back
 * mechanism (`redirect_url`) lands the user on a stable URL — `/checkout?...`
 * — that auto-triggers the action regardless of which auth flow brought them
 * here (sign-in or sign-up). Inlining the action call on `/creators` would
 * require URL-state sniffing every page render.
 *
 * The body of this page calls `useSearchParams()` which forces a CSR bailout
 * during static prerender — Next.js requires the consuming component to be
 * wrapped in <Suspense> so the static shell can render without it. The bridge
 * itself is split into `<CheckoutBridge />` and the default export wraps it.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";

type Tier = "coach" | "manager";
type Interval = "monthly" | "annual";

function isTier(s: string | null): s is Tier {
  return s === "coach" || s === "manager";
}
function isInterval(s: string | null): s is Interval {
  return s === "monthly" || s === "annual";
}

function CheckoutBridge() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, isLoaded } = useUser();
  const startCheckout = useAction(api.billing.checkout.createCheckoutSession);
  const [error, setError] = useState<string | null>(null);
  // Guard so React strict-mode double-invocation in dev doesn't fire two
  // Stripe sessions per click.
  const startedRef = useRef(false);

  const tierRaw = params.get("tier");
  const intervalRaw = params.get("interval");
  const tier: Tier | null = isTier(tierRaw) ? tierRaw : null;
  const interval: Interval | null = isInterval(intervalRaw)
    ? intervalRaw
    : null;

  useEffect(() => {
    if (!isLoaded) return;
    // If signed-out, push to sign-up and come back. Middleware's
    // `auth.protect()` would normally do this, but explicit redirect_url
    // preservation here keeps tier/interval intact across the auth hop.
    if (!user) {
      const search = new URLSearchParams();
      if (tier) search.set("tier", tier);
      if (interval) search.set("interval", interval);
      const redirectUrl = `/checkout?${search.toString()}`;
      router.replace(
        `/sign-up?redirect_url=${encodeURIComponent(redirectUrl)}`
      );
      return;
    }
    if (!tier || !interval) {
      setError(
        "Missing tier or interval in checkout URL. Pick a plan from the pricing page and try again."
      );
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const { url } = await startCheckout({ tier, interval });
        window.location.assign(url);
      } catch (e) {
        startedRef.current = false;
        const msg =
          e instanceof Error
            ? e.message.replace(/^Error:\s*/, "").split("\n")[0]
            : "Could not start checkout.";
        setError(msg);
      }
    })();
  }, [isLoaded, user, tier, interval, router, startCheckout]);

  return (
    <div className="rounded-3xl border border-[var(--hairline)] bg-ink-2 p-8 text-center max-w-md">
      {error ? (
        <>
          <h1 className="font-display text-2xl tracking-tight text-paper">
            Couldn&apos;t start checkout
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-paper-dim">
            {error}
          </p>
          <Link
            href="/creators#pricing"
            className="btn btn-primary mt-6 inline-flex"
          >
            Back to pricing
          </Link>
        </>
      ) : (
        <>
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-lime" />
          <h1 className="mt-4 font-display text-2xl tracking-tight text-paper">
            Opening Stripe Checkout…
          </h1>
          <p className="mt-2 text-sm text-paper-dim">
            {tier && interval
              ? `${tier === "coach" ? "Assistant" : "Manager"} · ${interval === "monthly" ? "monthly" : "annual"}`
              : "Preparing your plan…"}
          </p>
        </>
      )}
    </div>
  );
}

function CheckoutFallback() {
  return (
    <div className="rounded-3xl border border-[var(--hairline)] bg-ink-2 p-8 text-center max-w-md">
      <Loader2 className="mx-auto h-6 w-6 animate-spin text-lime" />
      <h1 className="mt-4 font-display text-2xl tracking-tight text-paper">
        Opening Stripe Checkout…
      </h1>
    </div>
  );
}

export default function CheckoutBridgePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16 bg-[var(--ink)]">
      <Suspense fallback={<CheckoutFallback />}>
        <CheckoutBridge />
      </Suspense>
    </main>
  );
}
