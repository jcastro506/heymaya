/**
 * The pre-signup demo's guards.
 *
 * This is an unauthenticated endpoint that fetches arbitrary URLs on our
 * infrastructure and spends money doing it. The guards are the feature; the
 * read is the easy part.
 */

import { describe, expect, it } from "vitest";
import {
  GLOBAL_DAILY_READS,
  IP_DAILY_LIMIT,
  isPubliclyRoutable,
  keyFor,
  normaliseUrl,
} from "../demo";

describe("isPubliclyRoutable", () => {
  it("allows an ordinary public site", () => {
    expect(isPubliclyRoutable("https://stripe.com").ok).toBe(true);
    expect(isPubliclyRoutable("http://example.co.uk/pricing").ok).toBe(true);
  });

  /**
   * ⭐ The one that matters most: `169.254.169.254` is the cloud metadata
   * address. An unauthenticated fetcher without this guard is an SSRF proxy.
   */
  it("blocks loopback, private ranges and cloud metadata", () => {
    for (const url of [
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1",
      "http://192.168.1.1",
      "http://172.16.5.4",
      "http://[::1]/",
    ]) {
      expect(isPubliclyRoutable(url).ok, `should block ${url}`).toBe(false);
    }
  });

  it("blocks internal-only hostnames", () => {
    for (const url of [
      "http://db.internal",
      "http://printer.local",
      "http://wiki.corp",
      "http://app.localhost",
    ]) {
      expect(isPubliclyRoutable(url).ok, `should block ${url}`).toBe(false);
    }
  });

  it("blocks every scheme that isn't http or https", () => {
    for (const url of ["file:///etc/passwd", "gopher://x", "ftp://host/f"]) {
      expect(isPubliclyRoutable(url).ok, `should block ${url}`).toBe(false);
    }
  });

  it("says nothing about our infrastructure when it refuses", () => {
    // A visitor gets "not reachable from the internet", not a hint about what
    // is on the other side of the guard.
    const reason = isPubliclyRoutable("http://10.0.0.1").reason ?? "";
    expect(reason).not.toMatch(/internal|private|metadata|convex/i);
  });
});

describe("normaliseUrl", () => {
  it("collapses the forms of the same address to one cache key", () => {
    const forms = [
      "stripe.com",
      "https://stripe.com",
      "https://www.stripe.com/",
      "https://stripe.com/?utm_source=x",
      "https://stripe.com#pricing",
    ].map(normaliseUrl);
    expect(new Set(forms).size).toBe(1);
  });

  /**
   * ⚠️ The bug this exists to prevent, found live: testing only for
   * `https?://` meant any other scheme got `https://` glued in front, so
   * `file:///etc/passwd` became `https://file///etc/passwd` — a nonsense
   * address we then tried to FETCH, rather than one the guard would reject.
   */
  it("never invents a scheme for a URL that already has one", () => {
    expect(normaliseUrl("file:///etc/passwd")).toBe("file:///etc/passwd");
    expect(normaliseUrl("javascript:alert(1)")).toBe("javascript:alert(1)");
    // …and the guard then rejects them, which is the point.
    expect(isPubliclyRoutable(normaliseUrl("file:///etc/passwd")).ok).toBe(false);
  });

  it("keeps distinct paths distinct", () => {
    // Two products on one host must not share a read.
    expect(normaliseUrl("acme.com/one")).not.toBe(normaliseUrl("acme.com/two"));
  });
});

describe("keyFor", () => {
  it("is stable and discriminating", () => {
    expect(keyFor("https://a.com")).toBe(keyFor("https://a.com"));
    expect(keyFor("https://a.com")).not.toBe(keyFor("https://b.com"));
  });

  it("does not carry the input back", () => {
    // IP keys are hashed by the caller; the stored fingerprint must not be a
    // readable address.
    expect(keyFor("203.0.113.7")).not.toContain("203");
  });
});

describe("the budgets", () => {
  it("caps an IP low enough to be a demo, not a scraper", () => {
    expect(IP_DAILY_LIMIT).toBeGreaterThan(1);
    expect(IP_DAILY_LIMIT).toBeLessThanOrEqual(10);
  });

  /**
   * ⭐ A global ceiling as well as a per-IP one. Per-IP alone is defeated by
   * using more IPs, and what's being protected is one shared bill.
   */
  it("has a global ceiling far above one visitor's share", () => {
    expect(GLOBAL_DAILY_READS).toBeGreaterThan(IP_DAILY_LIMIT * 10);
  });
});
