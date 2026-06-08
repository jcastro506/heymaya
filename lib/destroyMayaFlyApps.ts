import { FlyClient, FlyError } from "@/convex/lib/flyClient";

/**
 * Destroy a set of Fly apps (the per-user OpenClaw machines) during account
 * deletion. Shared by the in-app delete route (`/api/account/delete`) and the
 * Clerk `user.deleted` webhook backstop (`/api/clerk/webhook`).
 *
 * Why this matters (S7): inbound Telegram hits the Fly machine DIRECTLY, so a
 * Convex flag alone never silences Maya — the machine has to be destroyed.
 * The account-deletion cascade collects the Fly app ids (creator/business/
 * growth `*FlyAppId` + GTM `gtmAgents.openClawFlyAppId`); this tears them down.
 *
 * Never throws — a 404 (already gone) is success; other errors are collected
 * so the caller can report partial cleanup without failing the whole delete.
 */
export async function destroyMayaFlyApps(
  flyAppIds: readonly string[]
): Promise<{
  attempted: number;
  destroyed: number;
  skipped: number;
  errors: Array<{ appId: string; message: string }>;
}> {
  const uniqueAppIds = [...new Set(flyAppIds.filter(Boolean))];
  if (uniqueAppIds.length === 0) {
    return { attempted: 0, destroyed: 0, skipped: 0, errors: [] };
  }
  if (!process.env.FLY_API_TOKEN) {
    return {
      attempted: 0,
      destroyed: 0,
      skipped: uniqueAppIds.length,
      errors: uniqueAppIds.map((appId) => ({
        appId,
        message: "FLY_API_TOKEN is not configured.",
      })),
    };
  }

  const fly = new FlyClient();
  const errors: Array<{ appId: string; message: string }> = [];
  let destroyed = 0;
  for (const appId of uniqueAppIds) {
    try {
      await fly.destroyApp(appId);
      destroyed += 1;
    } catch (error) {
      if (error instanceof FlyError && error.status === 404) {
        continue;
      }
      errors.push({
        appId,
        message: error instanceof Error ? error.message : "Fly cleanup failed.",
      });
    }
  }
  return { attempted: uniqueAppIds.length, destroyed, skipped: 0, errors };
}
