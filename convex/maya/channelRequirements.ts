/**
 * ⭐ Say what the account has to BE, before they connect it (§6.0.15).
 *
 * > *"Some platforms accept a connection that can never post. The connection
 * > succeeds, the account appears in every listing, health looks fine — and the
 * > first evidence of a problem is a publish failing weeks later, **which reads
 * > as our bug rather than an account setting**."*
 *
 * §6.0.15 requires this said in **three** places, because they fail differently:
 *
 * 1. **Before the OAuth redirect**, in the connect card — *"prevention beats
 *    diagnosis."* That is what this module is for.
 * 2. **After connect, as a verified fact** — `channels.readAccount` reads the
 *    granted publish scope rather than assuming OAuth success meant yes.
 * 3. **In Mission Control**, where a connected-but-unpostable channel must
 *    never render as simply "connected".
 *
 * ## Why a lookup and not `if (channel === "instagram")`
 *
 * CLAUDE.md: *"Platform expertise lives in `.md` files, **never** in
 * `if (channel === …)` branches."* These are structural facts about what an
 * account must be, not creative judgment, so they live as data keyed by
 * channel — the same shape as `CHANNEL_LIMITS` and `WRITE_PERMISSION`. No
 * caller branches; every caller looks up.
 *
 * ⚠️ Two of these are not requirements at all but **permanent limits**, and
 * they belong here for the same reason: §2.3.1 says a ceiling *"must be stated
 * plainly to the customer at onboarding — never let them discover it when a
 * comment goes unanswered for a week."*
 */

/** The four channels, as the product names them. */
export type Channel = "tiktok" | "instagram" | "youtube" | "x";

export interface ChannelRequirement {
  /**
   * Shown in the connect card BEFORE the redirect. Plain language, and it names
   * the fix rather than the constraint — the founder can act on "switch it in
   * Instagram's settings", not on "the Graph API doesn't serve personal
   * accounts".
   */
  beforeConnect?: string;
  /**
   * A permanent limit of the platform, said up front. Not a warning about
   * their setup — nothing they do changes it.
   *
   * ⚠️ TikTok is the one that burns trust if unsaid: there is no comment API
   * at all, so she can never answer anyone there. A founder who discovers that
   * when a comment sits unanswered concludes she is broken.
   */
  permanentLimit?: string;
}

export const CHANNEL_REQUIREMENTS: Record<Channel, ChannelRequirement> = {
  instagram: {
    // §6.0.15: "Instagram-must-be-Business is the load-bearing case: it
    // connects cleanly and then never posts."
    beforeConnect:
      "Instagram needs to be a Business or Creator account — it takes about two minutes to switch in Instagram's settings.",
  },
  x: {
    // The grant must include `tweet.write`, which is a checkbox on X's consent
    // screen people routinely clear.
    beforeConnect:
      "When X asks, leave the posting permission ticked — without it she can read but never post.",
  },
  tiktok: {
    /**
     * ⚠️ Stated at connect, not when a comment goes unanswered. TikTok exposes
     * NO comment or DM API — this is not a gap we intend to close.
     */
    permanentLimit:
      "TikTok doesn't let anyone read comments through their API, so she can post there but never reply. Everything else works normally.",
  },
  youtube: {
    permanentLimit:
      "YouTube's numbers arrive two to three days late — that's their reporting, not a delay on our side.",
  },
};

/**
 * Everything worth saying about a channel before they connect it, in order.
 *
 * One function so the connect card, the on-ramp, and any future surface all
 * say the same sentences. A second place that phrases the Instagram rule
 * differently is a second place that can drift out of date.
 */
export function noticesFor(channel: Channel): string[] {
  const req = CHANNEL_REQUIREMENTS[channel];
  return [req.beforeConnect, req.permanentLimit].filter(
    (line): line is string => Boolean(line),
  );
}
