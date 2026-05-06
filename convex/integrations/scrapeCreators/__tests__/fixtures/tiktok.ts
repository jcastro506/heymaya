/**
 * Fixture: ScrapeCreators TikTok responses.
 *
 * Shapes here mirror the upstream API as documented at https://docs.scrapecreators.com.
 * If the upstream changes its response shape, these fixtures need to update — and the
 * Zod parsers in `endpoints.ts` will throw at parse time, surfacing the drift loudly.
 */

export const tiktokProfileFixture = {
  user: {
    uniqueId: "fitcreator99",
    nickname: "Fit Creator",
    signature: "Daily fitness drops + meal preps. DM for collabs.",
    verified: true,
    bioLink: { link: "https://linktr.ee/fitcreator99" },
    avatarLarger: "https://p16-sign.tiktokcdn.com/avatar-large.jpg",
  },
  stats: {
    followerCount: 248311,
    followingCount: 412,
    videoCount: 487,
  },
};

export const tiktokPostsFixture = {
  aweme_list: [
    {
      id: "7341111111111111111",
      desc: "5 high-protein breakfasts that don't suck. #fitness #mealprep",
      createTime: 1714000000,
      stats: {
        diggCount: 41200,
        commentCount: 312,
        playCount: 1840000,
        shareCount: 1280,
        collectCount: 8800,
      },
      video: {
        cover: "https://p16-sign.tiktokcdn.com/cover-1.jpg",
        playAddr: "https://v16-webapp.tiktok.com/play1.mp4",
      },
    },
    {
      id: "7341111111111111112",
      desc: "Form check on Romanian deadlifts. Stop hyperextending.",
      createTime: 1713800000,
      stats: {
        diggCount: 18900,
        commentCount: 102,
        playCount: 412000,
        shareCount: 380,
        collectCount: 2100,
      },
      video: {
        cover: "https://p16-sign.tiktokcdn.com/cover-2.jpg",
        playAddr: "https://v16-webapp.tiktok.com/play2.mp4",
      },
    },
  ],
  cursor: 1713800000,
  hasMore: true,
};

export const tiktokCommentsFixture = {
  comments: [
    {
      cid: "c1",
      text: "this is so helpful, can you do one for dinners?",
      digg_count: 421,
      create_time: 1714001234,
      user: { unique_id: "lifter_lee" },
    },
    {
      cid: "c2",
      text: "the chia oats one slaps",
      digg_count: 89,
      create_time: 1714002345,
      user: { unique_id: "morning_macros" },
    },
  ],
  cursor: 50,
  has_more: 1,
};

export const tiktokTranscriptFixture = {
  transcript:
    "Five high-protein breakfasts that take five minutes. First, overnight oats with whey...",
  segments: [
    { text: "Five high-protein breakfasts", startSec: 0, endSec: 2 },
    { text: "that take five minutes.", startSec: 2, endSec: 4 },
  ],
};

/**
 * Sprint 4 — TikTok audience demographics fixture (`/v1/tiktok/user/audience`).
 * Shape mirrors the documented `audience: { ageRanges, topGeos, gender }` form.
 * The endpoint costs 26 credits/call; gating + audit lives in `runFullScrapePull`.
 */
export const tiktokAudienceFixture = {
  audience: {
    ageRanges: [
      { range: "18-24", percent: 0.41 },
      { range: "25-34", percent: 0.33 },
      { range: "35-44", percent: 0.16 },
      { range: "13-17", percent: 0.07 },
      { range: "45+", percent: 0.03 },
    ],
    topGeos: [
      { country: "US", percent: 0.62 },
      { country: "CA", percent: 0.09 },
      { country: "GB", percent: 0.07 },
      { country: "AU", percent: 0.05 },
      { country: "DE", percent: 0.04 },
    ],
    gender: { male: 0.58, female: 0.41, other: 0.01 },
  },
};

/**
 * Sprint 4 — TikTok following list fixture (`/v1/tiktok/user/following`).
 * One page; cursor present so the wrapper exposes `total` when surfaced.
 */
export const tiktokFollowingFixture = {
  users: [
    { uniqueId: "lifter_lee", nickname: "Lee Lifts" },
    { uniqueId: "morning_macros", nickname: "Morning Macros" },
    { uniqueId: "kettlebell_kate", nickname: "Kate K." },
  ],
  total: 412,
  cursor: 1714000000,
  hasMore: true,
};
