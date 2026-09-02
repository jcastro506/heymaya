/**
 * Lookup playbooks (plan §13.11, and Josh's rule that the skills be comprehensive
 * about the catalogue). Each judgment skill carries the questions it should answer
 * with tools before it speaks, which tool answers each, and when NOT to look. These
 * are appended to the skill text, so they are versioned with it and every turn sees
 * them. The budget is enforced by code; this is the judgment about spending it.
 */

export const LOOKUPS = {
  scout: `
Before you judge a candidate that might be notable, answer these with tools (skip a candidate that is obviously not, and don't look anything up for it):
1. Is it the account or the sound? post_info gives the sound id; if there is one, sound_videos tells you whether the sound is rising and who else used it. A rising sound with many users is a wave; a breakout on an original sound is the account.
2. Is it above THEIR normal, or just a big account? account_posts on the author (1 credit, the whole feed with stats), then compare the candidate's views to the MEDIAN, never the mean, so one viral post doesn't distort it. Under ten posts, call the baseline low-confidence and say so. 5× and up is huge, 2–5× strong, 1.5–2× mild; below that it is not a breakout whatever the raw number.
   post_info costs 10 credits when the vendor finds the media: use it for the sound id or a link they sent, not for numbers the feed already carries.
3. What are people reacting to? post_comments, only when it would change the version you write. Read them in buckets: questions, objections, confusion, praise, a bit that landed, buying intent; keep the exact wording, it is the audience's language. 1 credit on TikTok, 15 on Instagram, so on Instagram only when it decides the pick.
4. Is this shape a wave this week? search_keyword with the shape's plainest keyword; three or more accounts doing it this week means "get in now or skip", one account means "their thing". Trends are region-specific: the trending feeds are for the creator's country, and one post is never a trend.
5. Is it theirs to take? own_rhymes with the topic or format; if they have done it and it beat their normal, say so with the number; if they have done it and it fell flat, say that too.
6. Does something in their life fit it? calendar_upcoming, once, when the idea could ride an event.
Spend on at most two candidates. If the budget is gone, answer with what you have and say what you could not check.`,

  opinion: `
For a link, before the read:
1. post_info for the real numbers, the sound id and the author. Never guess a count.
2. If there is a sound id and the sound could be the reason, sound_videos. Say "the sound, not you" when it is.
3. account_posts on the author to know whether this is their normal; a read against a fluke is worthless.
4. post_comments only when the reaction changes a fix (people asking the same question is a fix; "fire" fifty times is not).
5. own_rhymes for their own history with this structure; cite their multiple when they have one.
For a draft file there is nothing to look up except own_rhymes; the card and their history are the evidence.`,

  explainPost: `
Before explaining their own post:
1. own_rhymes for what they did last time with this structure, and how it did.
2. search_keyword for the post's plainest keyword this week: if the lane's top post on it is theirs, say so; if someone else's did five times better, that is the thing to name.
3. post_comments on their own post if the comments carry the reason (a question, a correction, a bit that landed).
No more than three lookups; under 48 hours old the numbers are too fresh, say when you will know, and look nothing up.`,

  profile: `
Before answering why an account is growing:
1. account_posts (you already have a page) and profile: size, cadence, the normal, the outliers.
2. post_transcript on the top two outliers if you don't already have them; the words are the format. Segment each: hook, setup, the claim, the evidence, the payoff, the ask. Repeated hook formulas across outliers are the lesson.
3. sound_info on the biggest outlier's sound if it has one: growth on a borrowed sound is a different lesson from growth on a premise.
4. search_keyword for their plainest topic: are they the lane's top, or riding a wave?
5. own_rhymes to decide what of it is this creator's to take. Four lookups at most.`,

  review: `
You have the week's numbers and cards. One lookup is worth it, at most two: for the post you cannot explain (the one furthest from their normal, up or down), search_keyword for its plainest keyword to see whether the lane moved that week, or own_rhymes to see whether they have done it before. Everything else in the review comes from what you were given.`,
} as const;

export type LookupSkill = keyof typeof LOOKUPS;
