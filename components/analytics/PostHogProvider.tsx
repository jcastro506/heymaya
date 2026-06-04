"use client";

/**
 * PostHog client provider — Wave 3 of the data-collection sprint.
 *
 * Before this, the PostHog project (HeyMaya / 268362) was connected but
 * received ZERO product data — `ingested_event: false`. This wires the
 * browser SDK so we get pageviews, sessions, retention cohorts, and the
 * onboarding funnel for free.
 *
 * Identity: we `identify()` against the Clerk user id (see
 * PostHogIdentify below) so events attribute to a real account and
 * cross-device sessions stitch together. We never send PII beyond the
 * email Clerk already holds.
 *
 * No-op safety: if NEXT_PUBLIC_POSTHOG_KEY is unset (e.g. local dev without
 * analytics), the SDK never initializes and every track() call is a no-op —
 * nothing breaks.
 */

import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let initialized = false;

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  if (!POSTHOG_KEY) return; // analytics disabled — every call is a no-op
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    // We capture pageviews ourselves on App Router navigation (below) so we
    // get virtual-route changes, not just hard loads.
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    persistence: "localStorage+cookie",
  });
  initialized = true;
}

/** Captures a $pageview on every App Router navigation. */
function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!POSTHOG_KEY || !initialized) return;
    const search = searchParams?.toString();
    const url = search ? `${pathname}?${search}` : pathname;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

/** Ties the anonymous PostHog session to the signed-in Clerk user. */
function PostHogIdentify() {
  const { isSignedIn, user } = useUser();

  useEffect(() => {
    if (!POSTHOG_KEY || !initialized) return;
    if (isSignedIn && user) {
      posthog.identify(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        name: user.fullName ?? undefined,
      });
    } else if (isSignedIn === false) {
      // Signed out — drop the identity so the next session is clean.
      posthog.reset();
    }
  }, [isSignedIn, user]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  ensureInit();
  if (!POSTHOG_KEY) {
    // Analytics disabled — render children without the provider wrapper.
    return <>{children}</>;
  }
  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
      <PostHogIdentify />
      {children}
    </PHProvider>
  );
}
