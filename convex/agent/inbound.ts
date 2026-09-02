/**
 * Inbound classification (plan §15.3), code first. Commands are matched by code and
 * never reach a model. Links are parsed by code to platform, post id and handle, and
 * "their own" is decided by comparing the handle to the creator's. Files route by
 * MIME. What is left is text, and text goes to `converse`. The only judgment call in
 * the plan (`calendar_answer` vs `text`) is left to `converse` itself for now.
 */

export type CommandName = "stop" | "resume" | "forget" | "person" | "delete";

export type Route =
  | { route: "command"; command: CommandName }
  | { route: "link"; own: boolean; link: ParsedLink }
  | { route: "file"; media: "video" | "image" | "audio" | "other" }
  | { route: "profile"; platform: "tiktok" | "instagram"; handle: string }
  | { route: "text" };

export interface ParsedLink { platform: "tiktok" | "instagram"; url: string; handle: string | null; postId: string | null }

const COMMANDS: Array<{ command: CommandName; re: RegExp }> = [
  { command: "stop", re: /^\s*(stop|pause|too much|enough|shut up|be quiet|mute)\s*[.!]*\s*$/i },
  { command: "resume", re: /^\s*(resume|unpause|i'?m back|start again|come back|unmute)\s*[.!]*\s*$/i },
  { command: "forget", re: /^\s*(forget (that|it|this)|never mind that|scratch that)\s*[.!]*\s*$/i },
  { command: "person", re: /\b(talk to a (real )?(person|human)|real person|human please|is this a bot)\b/i },
  { command: "delete", re: /^\s*(delete my account|delete everything|cancel my account)\s*[.!]*\s*$/i },
];

const TIKTOK_RE = /https?:\/\/(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\/(?:@([\w.-]+)\/video\/(\d+)|t\/[\w-]+|[\w-]+)\/?/i;
const IG_RE = /https?:\/\/(?:www\.)?instagram\.com\/(?:([\w.]+)\/)?(?:p|reel|reels|tv)\/([\w-]+)/i;

export function parseLink(text: string): ParsedLink | null {
  const tt = text.match(TIKTOK_RE);
  if (tt) return { platform: "tiktok", url: tt[0].replace(/[).,]+$/, ""), handle: tt[1]?.toLowerCase() ?? null, postId: tt[2] ?? null };
  const ig = text.match(IG_RE);
  if (ig) return { platform: "instagram", url: ig[0].replace(/[).,]+$/, ""), handle: ig[1]?.toLowerCase() ?? null, postId: ig[2] ?? null };
  return null;
}

export function classifyInbound(input: { text: string; kind: string; mime?: string | null; handles: { tiktok?: string; instagram?: string } }): Route {
  if (input.kind === "file") {
    const m = (input.mime ?? "").toLowerCase();
    if (m.startsWith("video/")) return { route: "file", media: "video" };
    if (m.startsWith("image/")) return { route: "file", media: "image" };
    if (m.startsWith("audio/") || m.includes("ogg") || m.includes("opus")) return { route: "file", media: "audio" };
    return { route: "file", media: "other" };
  }
  for (const c of COMMANDS) if (c.re.test(input.text)) return { route: "command", command: c.command };
  const profile = parseProfileAsk(input.text, input.handles);
  if (profile) return { route: "profile", ...profile };
  const link = parseLink(input.text);
  if (link) {
    const mine = (link.platform === "tiktok" ? input.handles.tiktok : input.handles.instagram)?.toLowerCase().replace(/^@/, "");
    return { route: "link", own: Boolean(link.handle && mine && link.handle === mine), link };
  }
  return { route: "text" };
}

/** "Will this go viral", "thoughts?", "rate this": an opinion is being asked for, not a chat. */
export function asksForOpinion(text: string): boolean {
  return /\b(go viral|viral\??|thoughts\??|rate (this|it)|what do you think|feedback|honest opinion|should i post|does this work|is this good)\b/i.test(text);
}

const PROFILE_ASK_RE = /\b(why is|why's|how is|how's|what is|what's|whats|hows|whys)\b[^@]{0,40}@([a-z0-9_.]{2,30})\b[^.?!]{0,60}\b(growing|blowing up|working|doing|popping|winning|different|doing so well)\b|@([a-z0-9_.]{2,30})\b[^.?!]{0,40}\b(why (is|are) (they|she|he)|what (are|is) (they|she|he) doing|how (are|is) (they|she|he) growing)\b/i;

/** "why is @x growing", "what's @x doing that works": an account, and a question about it. Never their own handle. */
export function parseProfileAsk(text: string, handles: { tiktok?: string; instagram?: string }): { platform: "tiktok" | "instagram"; handle: string } | null {
  if (/https?:\/\//.test(text)) return null;
  const m = text.match(PROFILE_ASK_RE);
  const handle = (m?.[2] ?? m?.[4])?.toLowerCase();
  if (!handle) return null;
  const mine = [handles.tiktok, handles.instagram].filter(Boolean).map((h) => h!.toLowerCase().replace(/^@/, ""));
  if (mine.includes(handle)) return null;
  const platform: "tiktok" | "instagram" = /\b(ig|insta|instagram|reels?)\b/i.test(text) ? "instagram" : "tiktok";
  return { platform, handle };
}
