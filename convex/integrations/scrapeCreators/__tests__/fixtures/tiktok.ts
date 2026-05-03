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
