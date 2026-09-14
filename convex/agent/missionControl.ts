export const MISSION_CONTROL_TABS = ["today", "ideas", "lane", "results", "plan", "settings"] as const;
export type MissionControlTab = (typeof MISSION_CONTROL_TABS)[number];

export function missionControlTabFromText(text: string): MissionControlTab {
  const value = text.toLowerCase();
  if (/\bideas?\b|swipe file/.test(value)) return "ideas";
  if (/\bresults?\b|analytics|numbers|performance/.test(value)) return "results";
  if (/\bplans?\b|calendar|schedule|week/.test(value)) return "plan";
  if (/\blane\b|niche|inspiration|watching/.test(value)) return "lane";
  if (/\bsettings?\b|account|connect/.test(value)) return "settings";
  return "today";
}

/**
 * The URL carries no tenant id or auth token. Clerk's session resolves the creator,
 * and an expired session returns to this exact protected path after sign-in.
 */
export function missionControlUrl(appUrl: string | undefined, tab: MissionControlTab): string {
  const base = (appUrl?.trim() || "https://hey-maya.ai").replace(/\/+$/, "");
  return `${base}/app/${tab}`;
}
