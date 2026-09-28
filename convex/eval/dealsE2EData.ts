/**
 * K1: the end-to-end deals sim's personas (eval/dealsE2E.ts), so one world doesn't fit all. Sam (running,
 * sponsorship) reuses the deals world's market; Priya (skincare, UGC first) and Leo (home cooking,
 * gifting and affiliate) bring their own fictional brands, lane accounts and posts. Pure data. Every
 * handle is `evale2e_`-prefixed and every domain invented: the fakes answer before anything leaves.
 */
import type { WorldBrand } from "./dealsWorldData";

export interface PersonaPost { postId: string; daysAgo: number; views: number; likes: number; caption: string }
export interface Persona {
  key: "sam" | "priya" | "leo";
  name: string;
  handle: string;
  platform: "tiktok" | "instagram";
  niche: string;
  followers: number;
  posts: PersonaPost[];
  watched: Array<{ platform: "tiktok" | "instagram"; handle: string }>;
  lanePosts: Array<{ platform: "tiktok" | "instagram"; author: string; postId: string; daysAgo: number; views: number; paid: boolean; mentions: string[] }>;
  /** The brand the story is about: its world key and the handle its lane posts tag. */
  brandKey: string;
  brandHandle: string;
  /** What she should end up drafting for it. */
  expectRoute: "email" | "application";
  /** What they say, in their words, at each beat. */
  script: { goal: string; yes: string; ready: string; retry: string };
}

export const E2E_BRANDS: WorldBrand[] = [
  {
    key: "dewdrop", name: "Dewdrop Skincare", domain: "dewdropskin.com",
    role: "A skincare brand paying UGC creators per video for its ads, with an application form (Priya's story).",
    keywords: ["dewdrop", "skincare", "skin", "serum", "ugc", "beauty", "creator", "apply"],
    pages: [
      { url: "https://dewdropskin.com/creators", title: "Dewdrop Skincare UGC creators", snippet: "Dewdrop pays UGC creators per video for our ads and product pages. Apply at dewdropskin.com/ugc-apply.", content: "Dewdrop Skincare UGC creators. We pay creators per video for content we run as ads and on our product pages. We care about clear, honest skincare videos more than follower counts. Apply at https://dewdropskin.com/ugc-apply" },
      { url: "https://dewdropskin.com/ugc-apply", title: "Apply: Dewdrop UGC", snippet: "Application: name, Instagram handle, portfolio link, skin type, rate per video, terms.", content: "Apply to create UGC for Dewdrop. Application questions:\n1. Full name (required)\n2. Instagram handle (required)\n3. Portfolio link (required)\n4. Your skin type (required)\n5. Rate per video in USD (optional)\n6. I agree to the Dewdrop creator terms (required)\nWe reply within two weeks." },
    ],
  },
  {
    key: "panforge", name: "Panforge Cookware", domain: "panforge.com",
    role: "A cookware brand with a gifting and affiliate program and a published partnerships email (Leo's story).",
    keywords: ["panforge", "cookware", "pan", "pans", "cast", "iron", "kitchen", "cooking", "gifting", "affiliate", "creator"],
    email: "partners@panforge.com",
    pages: [
      { url: "https://panforge.com/creators", title: "Panforge creator program", snippet: "Panforge gifts cookware to home cooks who make videos and runs an affiliate program. Email partners@panforge.com.", content: "Panforge creator program. We send our cast iron and carbon steel pans to home cooks who make cooking videos, and we run an affiliate program with a personal code and commission on sales. Creators of any size can pitch us: email partners@panforge.com with your handle, a video you're proud of, and what you'd cook first." },
    ],
  },
];

const ig = (id: string) => `evale2e_${id}`;

export const PERSONAS: Persona[] = [
  {
    key: "sam", name: "Sam", handle: "evaldeals_sam", platform: "tiktok", niche: "Running and a marathon training series", followers: 3_400,
    posts: [], // Sam's posts are the deals world's (dealsWorldData OWN_POSTS)
    watched: [], lanePosts: [], // and so are the lane's
    brandKey: "northline", brandHandle: "northlinerunning", expectRoute: "email",
    script: { goal: "i want paid running partnerships, US only", yes: "yes, look into northline running for me", ready: "ok, get the pitch to northline ready. short, mention my marathon block series", retry: "draft it please" },
  },
  {
    key: "priya", name: "Priya", handle: ig("priyaglow"), platform: "instagram", niche: "Honest skincare for sensitive skin", followers: 6_400,
    posts: [
      { postId: ig("pr1"), daysAgo: 4, views: 8_900, likes: 610, caption: "my 3-step routine for a flare-up week" },
      { postId: ig("pr2"), daysAgo: 8, views: 31_000, likes: 2_700, caption: "i tried the viral serum for 30 days. honest review" },
      { postId: ig("pr3"), daysAgo: 12, views: 6_200, likes: 400, caption: "sunscreen that doesn't sting" },
      { postId: ig("pr4"), daysAgo: 17, views: 7_400, likes: 520, caption: "what i'd buy with $50 at the drugstore" },
      { postId: ig("pr5"), daysAgo: 23, views: 5_800, likes: 380, caption: "barrier repair, explained in 30 seconds" },
      { postId: ig("pr6"), daysAgo: 30, views: 12_100, likes: 950, caption: "my skin, no filter, day 1 vs day 60" },
    ],
    watched: [{ platform: "instagram", handle: ig("glowjen") }, { platform: "instagram", handle: ig("skinbyana") }],
    lanePosts: [
      { platform: "instagram", author: ig("glowjen"), postId: ig("lp1"), daysAgo: 5, views: 22_000, paid: true, mentions: ["evale2e_dewdrop"] },
      { platform: "instagram", author: ig("skinbyana"), postId: ig("lp2"), daysAgo: 9, views: 14_500, paid: true, mentions: ["evale2e_dewdrop"] },
      { platform: "instagram", author: ig("skinbyana"), postId: ig("lp3"), daysAgo: 3, views: 9_000, paid: false, mentions: ["evale2e_someserum"] },
    ],
    brandKey: "dewdrop", brandHandle: "evale2e_dewdrop", expectRoute: "application",
    script: { goal: "i'd love to do UGC, paid, and gifted stuff is fine too", yes: "ooh yes, look into dewdrop for me", ready: "ok help me apply to dewdrop", retry: "can you prep my answers for their form?" },
  },
  {
    key: "leo", name: "Leo", handle: ig("leocooks"), platform: "tiktok", niche: "Weeknight home cooking on a budget", followers: 12_300,
    posts: [
      { postId: ig("lo1"), daysAgo: 2, views: 18_400, likes: 1_500, caption: "the 15 minute garlic noodle i make every tuesday" },
      { postId: ig("lo2"), daysAgo: 6, views: 64_000, likes: 5_900, caption: "seasoning a thrifted cast iron pan, start to finish" },
      { postId: ig("lo3"), daysAgo: 10, views: 11_200, likes: 820, caption: "$20 dinner for four" },
      { postId: ig("lo4"), daysAgo: 15, views: 9_700, likes: 700, caption: "crispy rice, three ways" },
      { postId: ig("lo5"), daysAgo: 21, views: 14_900, likes: 1_200, caption: "why your stir fry is soggy" },
      { postId: ig("lo6"), daysAgo: 28, views: 8_800, likes: 610, caption: "one pan chicken thighs" },
    ],
    watched: [{ platform: "tiktok", handle: ig("chefmarta") }, { platform: "tiktok", handle: ig("pantrydan") }],
    lanePosts: [
      { platform: "tiktok", author: ig("chefmarta"), postId: ig("lp4"), daysAgo: 4, views: 88_000, paid: true, mentions: ["evale2e_panforge"] },
      { platform: "tiktok", author: ig("pantrydan"), postId: ig("lp5"), daysAgo: 11, views: 31_000, paid: true, mentions: ["evale2e_panforge"] },
    ],
    brandKey: "panforge", brandHandle: "evale2e_panforge", expectRoute: "email",
    script: { goal: "gifted cookware and affiliate stuff would be great, i'm not picky yet", yes: "yes! look into panforge for me", ready: "ok get a pitch to panforge ready", retry: "draft it please" },
  },
];

export const personaByKey = (k: string): Persona => {
  const p = PERSONAS.find((x) => x.key === k);
  if (!p) throw new Error(`no persona ${k}`);
  return p;
};

/** Pure: the public URL of a persona's seeded post. */
export function personaPostUrl(p: Pick<Persona, "handle" | "platform">, postId: string): string {
  return p.platform === "tiktok" ? `https://www.tiktok.com/@${p.handle}/video/${postId.replace(/\D/g, "").padStart(19, "8")}` : `https://www.instagram.com/reel/${postId}/`;
}
