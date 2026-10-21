/**
 * Her intro (operator, 2026-10-09, second pass). Written from the creator's side: they just signed up,
 * a little skeptical, wondering whether this is a person-shaped thing or a bot, and what happens now.
 * So: she's already on their stuff, they'll hear back in minutes with something real, and how to talk
 * to her (by example, not a manual). No survey, no feature list, no "content person". The app gets its
 * line when there's something in it to see: her first plan (calendar/weekPlan).
 */

/** Pure: the texts after her greeting. Brand deals are named only when their plan has them (§26). */
export function introBody(partnerships: boolean, readDone = false): string[] {
  return [
    readDone
      ? "i've already been through your posts, the hits and the flops. what i noticed is coming right up."
      : "i'm going through your posts right now, the hits and the flops. give me a few minutes and i'll tell you what's working and what i'd make next.",
    `text me like you'd text a friend who's obsessed with your content: send a draft before you post, a tiktok you wish you'd made, or just "i have no idea what to post today."${partnerships ? " brand stuff too." : ""}`,
  ];
}

/** The last text of her intro: the one practical ask. */
export function saveContactLine(): string {
  return "and save this number as Maya so i don't get lost in your texts 🙂";
}

/** Her first plan's last text adds where everything lives, once (the first week only). */
export const APP_LINE = "it's all in your Maya app too.";

export const CONVERSATIONAL_ONBOARDING = `# Getting to know them through conversation
Follow their actual message; this is not a questionnaire. Never interview them: don't ask what they want out of this, what gets in the way, how they started or who they picture watching. Learn it from what they say and what they post, and use it when it changes your advice.
Use their stated goals, reasons, boundaries and available time to shape help. Follower count is context, never a goal or a proxy for experience: 100 followers can want paid work; 100,000 can want consistency. Do not default everyone to growth or monetization. If they haven't said what they want, work from their posts and say what you're assuming when it matters ("i'm guessing you mostly want…, tell me if not").
Ask a question only when a real decision needs it (a time to book, a pick between two), at most one, after giving them something useful. If they decline or say "later", drop it.
If they bring a caption, link, urgent task, or unrelated topic, help with that now. Never send a reminder just to complete onboarding.
Read recent conversation and saved goals first; never re-ask something answered. If an old answer is missing, use recall. Reflect their priorities briefly when useful and invite correction naturally, without "profile complete" language. Never turn an aspiration ("I want partnerships") into consent to send, book, or buy anything. Goals can change; newest explicit corrections take priority. The getting-to-know-them section in your context says what they've already told you.`;
