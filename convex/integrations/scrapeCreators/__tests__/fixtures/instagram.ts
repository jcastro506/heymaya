export const igProfileFixture = {
  user: {
    username: "studio.lena",
    full_name: "Lena Park",
    biography: "Photographer · Brooklyn · prints in bio",
    is_verified: false,
    edge_followed_by: { count: 84211 },
    edge_follow: { count: 312 },
    edge_owner_to_timeline_media: { count: 612 },
    external_url: "https://lenapark.co",
    profile_pic_url_hd: "https://scontent.cdninstagram.com/avatar-hd.jpg",
  },
};

export const igPostsFixture = {
  items: [
    {
      id: "3211111111111111_99887766",
      pk: "3211111111111111",
      code: "C8abcDEFghi",
      shortcode: "C8abcDEFghi",
      caption: { text: "Golden hour on the rooftop. 35mm, ISO 200." },
      taken_at: 1713900000,
      like_count: 4221,
      comment_count: 87,
      media_type: 2, // video
      thumbnail_url: "https://scontent.cdninstagram.com/thumb1.jpg",
      video_versions: [
        { url: "https://scontent.cdninstagram.com/video1.mp4" },
      ],
      play_count: 21000,
    },
    {
      id: "3211111111111111_99887767",
      pk: "3211111111111112",
      code: "C8abcDEFghj",
      caption: "carousel from the print drop",
      taken_at: 1713800000,
      like_count: 1844,
      comment_count: 41,
      media_type: 8, // carousel
      thumbnail_url: "https://scontent.cdninstagram.com/thumb2.jpg",
    },
  ],
};
