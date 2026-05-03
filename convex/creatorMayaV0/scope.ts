export const CREATOR_MAYA_V0_ROUTES = [
  "/onboarding",
  "/today",
  "/plan",
  "/posts",
  "/memory",
  "/settings",
] as const;

export const CREATOR_MAYA_V0_FORBIDDEN_IMPORT_SEGMENTS = [
  "brand-deal",
  "brandDeal",
  "business",
  "growth-agent",
  "riley_growth",
  "service-business",
] as const;

export type CreatorMayaV0Route = (typeof CREATOR_MAYA_V0_ROUTES)[number];

export function isCreatorMayaV0Route(route: string): route is CreatorMayaV0Route {
  return (CREATOR_MAYA_V0_ROUTES as ReadonlyArray<string>).includes(route);
}

export function forbiddenCreatorMayaV0Import(importPath: string): string | null {
  const normalized = importPath.toLowerCase();
  const forbidden = CREATOR_MAYA_V0_FORBIDDEN_IMPORT_SEGMENTS.find((segment) =>
    normalized.includes(segment.toLowerCase())
  );
  return forbidden ?? null;
}

export function assertCreatorMayaV0ImportAllowed(importPath: string): void {
  const forbidden = forbiddenCreatorMayaV0Import(importPath);
  if (forbidden) {
    throw new Error(
      `Creator Maya v0 must not import ${forbidden} modules: ${importPath}`
    );
  }
}
