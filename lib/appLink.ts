/**
 * Where "Get the app" goes (W1). One answer for the landing, `/join` and the smart app banner:
 * the App Store once the listing is live, the TestFlight beta before that, and the web sign-up
 * only while neither exists. Pure: reads the env it is given.
 */

export type AppLink =
  | { kind: "store"; url: string; appId: string | null }
  | { kind: "beta"; url: string }
  | { kind: "none" };

type Env = Record<string, string | undefined>;

const clean = (s: string | undefined) => (s && /^https:\/\//.test(s.trim()) ? s.trim() : null);

export function appLink(env: Env = process.env): AppLink {
  const store = clean(env.NEXT_PUBLIC_APP_STORE_URL);
  if (store) {
    const appId = env.NEXT_PUBLIC_APP_STORE_ID?.trim().replace(/^id/, "") || store.match(/\/id(\d+)/)?.[1] || null;
    return { kind: "store", url: store, appId: appId && /^\d+$/.test(appId) ? appId : null };
  }
  const beta = clean(env.NEXT_PUBLIC_TESTFLIGHT_URL);
  if (beta) return { kind: "beta", url: beta };
  return { kind: "none" };
}

/** App Store Connect's campaign token: letters, digits, dash and underscore, at most 40. */
export function campaignToken(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return t || null;
}

/**
 * Where `/join` sends a visitor. The store link carries Apple's campaign token (`ct`) and the
 * provider token (`pt`) when set, so App Store Connect counts installs per campaign.
 */
export function joinDestination(link: AppLink, campaign: string | null, env: Env = process.env): string {
  if (link.kind === "beta") return link.url;
  if (link.kind === "none") return "/sign-up";
  const url = new URL(link.url);
  if (campaign) url.searchParams.set("ct", campaign);
  const pt = env.NEXT_PUBLIC_APP_STORE_PROVIDER_TOKEN?.trim();
  if (pt && /^\d+$/.test(pt)) url.searchParams.set("pt", pt);
  return url.toString();
}

/** What the button says. */
export function ctaLabel(link: AppLink): string {
  return link.kind === "store" ? "Download on the App Store" : link.kind === "beta" ? "Join the iPhone beta" : "Get early access";
}
