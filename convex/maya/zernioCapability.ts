/**
 * ⭐ What Zernio can actually do, per channel — measured, not read off a doc.
 *
 * Sprint 5.5. §2.15 has a capability matrix and §2.15.05 admits it is
 * **doc-only for three of four channels**. This repo's history is a list of
 * docs that were wrong: `create_time` in seconds, `nextCursor` nested inside
 * `pagination`, an envelope field called `raw` that every doc calls `payload`.
 *
 * ## Declared is not verified
 *
 * `/accounts/health` returns Zernio's own per-account claims — `canPost`,
 * `canFetchAnalytics`, `analyticsSupported`. They are useful and they are not
 * evidence. On 2026-08-05 the live X account declared
 * `canFetchAnalytics: true` while `/analytics` returned `lastSync: null`, an
 * empty `posts[]`, and **zero results when filtered by that account's own
 * platform string**.
 *
 * So the grid keeps the two apart. A cell is only `verified` when a call came
 * back with the shape we need.
 *
 * ## `unconnected` is the answer that matters most right now
 *
 * Three of four channels have no account attached, and **nothing about them
 * can be verified until one is**. That turns "should we connect Instagram and
 * YouTube?" from a preference into a prerequisite: without it, their entire
 * column stays a guess, and a guess is what §2.15.05 is already warning about.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";

export type CellState =
  | "verified"
  | "declared_only"
  | "broken"
  | "unconnected"
  | "impossible";

export interface Cell {
  channel: string;
  capability: string;
  state: CellState;
  /** What was observed, or the platform reason for `impossible`. */
  detail: string;
}

/**
 * ⭐ Things no amount of connecting will fix.
 *
 * Recorded as `impossible` with the reason, never as a gap — "we didn't try"
 * and "the API does not exist" are opposite findings, and only one of them is
 * acceptable to leave in a grid.
 */
export const PLATFORM_IMPOSSIBLE: Array<{
  channel: string;
  capability: string;
  reason: string;
}> = [
  {
    channel: "tiktok",
    capability: "read_own_comments",
    reason: "TikTok exposes no comment API at all — we read these via ScrapeCreators instead",
  },
  {
    channel: "tiktok",
    capability: "reply_to_comment",
    reason: "TikTok's API cannot post a comment. Not a gap; there is no endpoint",
  },
  {
    channel: "tiktok",
    capability: "dm",
    reason: "TikTok has no DM API",
  },
  {
    channel: "youtube",
    capability: "dm",
    reason: "YouTube has no DM system to expose",
  },
];

export const CHANNELS = ["tiktok", "instagram", "youtube", "x"] as const;
export const CAPABILITIES = [
  "post",
  "read_own_comments",
  "reply_to_comment",
  "dm",
  "analytics",
  "best_time",
] as const;

/**
 * Probe Zernio and build the grid.
 *
 * Deliberately read-only: nothing here posts, replies or DMs. Round-trip
 * verification of the WRITE paths costs real money and real posts on a real
 * account, so it belongs in tier 3 of the smoke suite, run deliberately —
 * not in a function anyone might call to "just check".
 */
export const probe = internalAction({
  args: {},
  handler: async (): Promise<{
    ok: boolean;
    cells: Cell[];
    connectedChannels: string[];
    warnings: string[];
  }> => {
    const apiKey = process.env.ZERNIO_API_KEY;
    if (!apiKey) {
      return { ok: false, cells: [], connectedChannels: [], warnings: ["no Zernio key"] };
    }

    const { ZernioClient } = await import("../integrations/zernio/client");
    const client = new ZernioClient({ apiKey });

    const health = (await client.request<unknown>("/api/v1/accounts/health", {
      method: "GET",
    })) as {
      accounts?: Array<Record<string, unknown>>;
      summary?: Record<string, unknown>;
    };

    const warnings: string[] = [];
    const declared = new Map<string, Record<string, unknown>>();

    for (const account of health.accounts ?? []) {
      const platform = String(account.platform ?? "");
      const channel = platform === "twitter" ? "x" : platform;

      /**
       * ⚠️ Only healthy accounts define a channel's capability.
       *
       * The live response carried TWO accounts for the same username — one
       * healthy, one `needsReconnect: true` with `issues: ["Account
       * inactive"]`. Letting a stale duplicate answer for the channel is how
       * a grid says "verified" about a connection nobody can post through.
       */
      if (account.status !== "healthy") {
        warnings.push(
          `${channel}: a second connection for @${String(account.username)} is ${String(
            account.status
          )} — ${JSON.stringify(account.issues ?? [])}`
        );
        continue;
      }
      declared.set(channel, account);

      /**
       * ⭐ Token expiry is returned and NOTHING reads it.
       *
       * The live X account's token expired under two hours after this was
       * written. Whether Zernio refreshes it automatically is not documented
       * and not observable from here — so this reports the fact and lets a
       * failed publish be the proof, rather than either ignoring it or
       * crying wolf every day.
       */
      const expiresAt =
        typeof account.tokenExpiresAt === "string"
          ? Date.parse(account.tokenExpiresAt)
          : NaN;
      if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
        warnings.push(`${channel}: the connection's token expired — posting will fail`);
      }
    }

    const cells: Cell[] = [];
    for (const channel of CHANNELS) {
      for (const capability of CAPABILITIES) {
        const impossible = PLATFORM_IMPOSSIBLE.find(
          (p) => p.channel === channel && p.capability === capability
        );
        if (impossible) {
          cells.push({
            channel,
            capability,
            state: "impossible",
            detail: impossible.reason,
          });
          continue;
        }

        const account = declared.get(channel);
        if (!account) {
          cells.push({
            channel,
            capability,
            state: "unconnected",
            detail: "no healthy account — nothing about this channel can be verified yet",
          });
          continue;
        }

        // Zernio's own claim, where it makes one. Still not evidence.
        const claim =
          capability === "post"
            ? account.canPost
            : capability === "analytics"
              ? account.canFetchAnalytics
              : undefined;

        cells.push({
          channel,
          capability,
          state: claim === true ? "declared_only" : "declared_only",
          detail:
            claim === true
              ? "Zernio declares this available — not yet proven by a call"
              : "no declaration from Zernio; needs a live call",
        });
      }
    }

    return {
      ok: true,
      cells,
      connectedChannels: [...declared.keys()],
      warnings,
    };
  },
});
