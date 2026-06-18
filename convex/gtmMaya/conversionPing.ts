/**
 * Phase-1 ① — event-driven conversion ping (pure text composer).
 *
 * When a conversion lands, Maya pings the founder on Telegram the moment it's
 * recorded — instead of only surfacing it in the 8pm recap. This is the
 * product's "proves customers" moat made real-time.
 *
 * This module holds ONLY the pure text composer so it's unit-testable without
 * the DB. The internalAction that loads the agent, resolves the bot, and sends
 * lives in attribution.ts (next to recordConversion).
 *
 * Grounded-or-silent: we only name the channel/post when the wrap token
 * actually resolved to a platform. If it didn't, the ping stays generic — we
 * never fabricate "from your Reddit reply" when we can't tie it to a wrap.
 */

export type ConversionKind =
  | "signup"
  | "demo"
  | "feedback"
  | "revenue"
  | "activated";

export interface ComposeConversionPingInput {
  kind: ConversionKind;
  /** How many of THIS conversion event landed (the conversion row's count). */
  count: number;
  /** Total of THIS kind today (incl. the one that just landed). Used for the
   *  "that's N today" tail. Omit/≤0 to skip the tail. */
  totalToday?: number;
  /** Grounded channel/platform from the resolved wrap (e.g. "reddit"). Null /
   *  undefined when the wrap didn't resolve — keeps the ping generic. */
  channel?: string | null;
  /** The wrapped redirect link (e.g. https://…/r/<token>). Only appended when
   *  we also have a grounded channel — a bare link with no channel is noise. */
  link?: string | null;
}

/** Human label for a conversion event (singular vs plural by count). */
function kindPhrase(kind: ConversionKind, count: number): string {
  const plural = count > 1;
  switch (kind) {
    case "signup":
      return plural ? `${count} signups` : "a signup";
    case "demo":
      return plural ? `${count} demo requests` : "a demo request";
    case "feedback":
      return plural ? `${count} pieces of feedback` : "a piece of feedback";
    case "revenue":
      return plural ? `${count} sales` : "a sale";
    case "activated":
      // A returning / value-reached user — proof a signup STUCK.
      return plural ? `${count} users came back` : "a user came back";
  }
}

/** Pretty channel name for the grounded source phrase. */
function channelLabel(channel: string): string {
  const c = channel.trim().toLowerCase();
  const map: Record<string, string> = {
    reddit: "Reddit",
    x: "X",
    twitter: "X",
    linkedin: "LinkedIn",
    instagram: "Instagram",
    ig: "Instagram",
    tiktok: "TikTok",
    youtube: "YouTube",
    hackernews: "Hacker News",
    hn: "Hacker News",
  };
  return map[c] ?? channel.trim();
}

/**
 * Compose the short, grounded, anti-sycophantic conversion ping.
 *
 * Grounded form  : `🎉 a signup just came in — from your Reddit post 👉 <link>. That's 3 today.`
 * Generic form   : `🎉 a signup just came in. That's 3 today.`
 *
 * No hype, no "amazing", no exclamation pile-ups — one emoji, plain report.
 */
export function composeConversionPing(input: ComposeConversionPingInput): string {
  const count = Number.isFinite(input.count) && input.count > 0 ? input.count : 1;
  const event = kindPhrase(input.kind, count);

  // "came in" reads odd for feedback/activated; keep a verb per kind.
  const verb =
    input.kind === "feedback"
      ? "just landed"
      : input.kind === "activated"
        ? "" // kindPhrase already carries the verb ("a user came back")
        : "just came in";

  const head =
    verb === "" ? `🎉 ${event}` : `🎉 ${event} ${verb}`;

  // Grounded channel/post clause — only when BOTH channel and link resolved.
  const hasChannel =
    typeof input.channel === "string" && input.channel.trim() !== "";
  const hasLink = typeof input.link === "string" && input.link!.trim() !== "";
  let source = "";
  if (hasChannel) {
    source = ` — from your ${channelLabel(input.channel!)} post`;
    if (hasLink) source += ` 👉 ${input.link!.trim()}`;
  }

  // "That's N today" tail — only with a real total > the just-landed count is
  // meaningful, but we surface it whenever totalToday is a positive number so
  // the founder sees the running day count.
  let tail = "";
  if (
    typeof input.totalToday === "number" &&
    Number.isFinite(input.totalToday) &&
    input.totalToday > 0
  ) {
    tail = ` That's ${input.totalToday} today.`;
  }

  return `${head}${source}.${tail}`;
}
