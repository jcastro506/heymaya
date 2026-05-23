export type ContentPlatform = "reddit" | "x" | "linkedin" | "tiktok" | "instagram";

export interface DraftInput {
  platform: ContentPlatform;
  productName: string;
  channelThesis: string;
  evidenceSnippets: string[];
  targetAction: string;
}

export interface DraftQualityResult {
  passed: boolean;
  failures: string[];
  specificityScore: number;
}

const BANNED_PHRASES = [
  "game changer",
  "supercharge",
  "unlock your potential",
  "leverage social media",
  "revolutionary",
  "seamlessly",
  "boost your productivity",
  "engage with your audience",
  "post consistently",
];

export function draftPlatformPost(input: DraftInput): string {
  const evidence = input.evidenceSnippets[0] ?? input.channelThesis;
  switch (input.platform) {
    case "reddit":
      return `I built ${input.productName} after seeing this exact problem: ${evidence}\n\nNot dropping a pitch here. I am looking for 3 people dealing with this now so I can sanity-check the workflow. If that is you, what are you doing today instead?`;
    case "x":
      return `I shipped ${input.productName} for one narrow reason: ${evidence}\n\nTrying to find 5 people with this problem this week. If that is you, reply with what you use today and I will send the rough build.`;
    case "linkedin":
      return `I built ${input.productName} because ${evidence}\n\nThe goal this week is not a big launch. It is ${input.targetAction}. If you have seen this workflow break inside a team, I would like to compare notes.`;
    case "tiktok":
      return `Hook: I built ${input.productName} because ${evidence}\nShot 1: show the broken workflow.\nShot 2: screen-record the fix.\nCaption: looking for ${input.targetAction}.`;
    case "instagram":
      return `Carousel/Reel brief: I built ${input.productName} because ${evidence}\nFirst frame: name the painful workflow.\nMiddle: show the product screenshot or reused demo clip.\nCaption: looking for ${input.targetAction}.`;
  }
}

export function evaluateDraftQuality(input: {
  draft: string;
  evidenceSnippets: string[];
}): DraftQualityResult {
  const failures: string[] = [];
  const lower = input.draft.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) failures.push(`banned phrase: ${phrase}`);
  }
  if (!input.evidenceSnippets.some((snippet) => containsMeaningfulOverlap(lower, snippet))) {
    failures.push("draft is not grounded in provided evidence");
  }
  if (wordCount(input.draft) < 18) failures.push("draft is too thin");
  if (countSpecifics(input.draft) < 2) failures.push("draft lacks specifics");

  const specificityScore = Math.min(1, countSpecifics(input.draft) / 5);
  return {
    passed: failures.length === 0,
    failures,
    specificityScore,
  };
}

export function bannedPhrases(): readonly string[] {
  return BANNED_PHRASES;
}

function containsMeaningfulOverlap(draftLower: string, snippet: string): boolean {
  const words = snippet
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 5);
  return words.some((word) => draftLower.includes(word));
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function countSpecifics(value: string): number {
  let score = 0;
  if (/\d/.test(value)) score += 1;
  if (/[A-Z][A-Za-z0-9]+/.test(value)) score += 1;
  if (/\b(because|after|instead|workflow|reply|screen-record|sanity-check)\b/i.test(value)) {
    score += 1;
  }
  if (/[?:]/.test(value)) score += 1;
  if (value.length > 120) score += 1;
  return score;
}
