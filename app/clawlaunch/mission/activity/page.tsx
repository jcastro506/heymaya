import { redirect } from "next/navigation";

/**
 * ⚠️ ACTIVITY WAS DELETED, NOT MIGRATED (2026-08-19).
 *
 * v2's activity IS the placement ledger — `archive.myActivity` — and that is
 * already Today's ticker and the Videos screen. A separate "what she did" feed
 * is the activity theatre §12 rules out: it can report a busy day on which
 * nothing shipped, which is precisely the impression this product must never
 * give.
 *
 * The screen's other half was `getMyMayaMessages`, a mirror of the Telegram
 * conversation. That is a second, worse place to read a chat the founder
 * already has on their phone — and §2.1 says the dashboard is receipts, not a
 * workbench. It had no v2 equivalent and does not need one.
 *
 * A redirect rather than a 404: the tab existed, and anyone with it bookmarked
 * should land on the screen that replaced it.
 */
export default function ActivityRedirect() {
  redirect("/clawlaunch/mission");
}
