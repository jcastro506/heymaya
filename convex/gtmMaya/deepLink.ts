/**
 * Deterministic deep-link builder for one-tap execution (S4).
 *
 * The agent supplies { platform, action, target, text }; this builds the
 * correct platform link DETERMINISTICALLY (never LLM-improvised, so it can't
 * be malformed). Two tiers:
 *   - Tier 1 (pre-fill): the compose window opens with the text already in it
 *     → the user just hits Post. (X post/reply, Reddit post, HN submit, Threads.)
 *   - Tier 2 (direct): no pre-fill API exists → open the exact spot, user pastes
 *     the ready text. (Reddit comment, LinkedIn, Instagram, YouTube comment.)
 *
 * Pure function — unit-tested directly, no Convex wrappers.
 */

export type DeepLinkPlatform =
  | "x"
  | "reddit"
  | "hn"
  | "threads"
  | "linkedin"
  | "instagram"
  | "youtube";

export type DeepLinkAction = "post" | "reply";

export interface DeepLinkTarget {
  /** The thread/post/video URL to reply to or submit a link about. */
  url?: string;
  /** X tweet id (for in_reply_to). */
  tweetId?: string;
  /** Reddit subreddit (no "r/" prefix) for a submit link. */
  subreddit?: string;
  /** Title (Reddit post / HN submit). */
  title?: string;
}

export interface DeepLink {
  /** The URL to open. */
  url: string;
  /** 1 = text is pre-filled (tap → Post); 2 = open + paste the ready text. */
  tier: 1 | 2;
  /** One-line instruction for the user/UI. */
  instruction: string;
}

function enc(s: string): string {
  return encodeURIComponent(s ?? "");
}

/**
 * Build the best one-tap link for a platform+action. `text` is the ready draft
 * (used for pre-fill on Tier 1; carried for paste on Tier 2). Falls back to a
 * Tier-2 "open the target, paste" link when no pre-fill path exists.
 */
export function buildDeepLink(
  platform: DeepLinkPlatform,
  action: DeepLinkAction,
  target: DeepLinkTarget,
  text: string
): DeepLink {
  switch (platform) {
    case "x": {
      // X intent supports BOTH new posts and replies, with pre-filled text.
      const base = "https://x.com/intent/post";
      if (action === "reply" && target.tweetId) {
        return {
          url: `${base}?in_reply_to=${enc(target.tweetId)}&text=${enc(text)}`,
          tier: 1,
          instruction: "Tap → your reply is pre-filled → Post.",
        };
      }
      return {
        url: `${base}?text=${enc(text)}`,
        tier: 1,
        instruction: "Tap → your post is pre-filled → Post.",
      };
    }

    case "reddit": {
      if (action === "post" && target.subreddit) {
        // Reddit self-post submit pre-fills title + body.
        const sub = target.subreddit.replace(/^r\//, "");
        const title = target.title ? `&title=${enc(target.title)}` : "";
        return {
          url: `https://www.reddit.com/r/${enc(sub)}/submit?selftext=true${title}&text=${enc(text)}`,
          tier: 1,
          instruction: "Tap → title + body pre-filled → Post.",
        };
      }
      // Reddit comments have no pre-fill API → open the thread, paste.
      return {
        url: target.url ?? "https://www.reddit.com",
        tier: 2,
        instruction: "Tap to open the thread → paste your reply → Comment.",
      };
    }

    case "hn": {
      if (action === "post" && target.url) {
        // HN link submission pre-fills url + title.
        const t = target.title ? `&t=${enc(target.title)}` : "";
        return {
          url: `https://news.ycombinator.com/submitlink?u=${enc(target.url)}${t}`,
          tier: 1,
          instruction: "Tap → submission pre-filled → Submit.",
        };
      }
      return {
        url: target.url ?? "https://news.ycombinator.com",
        tier: 2,
        instruction: "Tap to open the item → paste your reply.",
      };
    }

    case "threads": {
      return {
        url: `https://www.threads.net/intent/post?text=${enc(text)}`,
        tier: 1,
        instruction: "Tap → pre-filled → Post.",
      };
    }

    case "linkedin":
    case "instagram":
    case "youtube": {
      // No reliable pre-fill API → open the target (or the platform), paste.
      const fallback =
        platform === "linkedin"
          ? "https://www.linkedin.com/feed/"
          : platform === "instagram"
            ? "https://www.instagram.com/"
            : "https://www.youtube.com/";
      return {
        url: target.url ?? fallback,
        tier: 2,
        instruction:
          action === "reply"
            ? "Tap to open → paste your comment → Post."
            : "Tap to open → paste your post.",
      };
    }

    default: {
      // Exhaustive guard — a new platform must be handled above.
      const _exhaustive: never = platform;
      return {
        url: target.url ?? "",
        tier: 2,
        instruction: "Open the target and paste your text.",
      };
    }
  }
}
