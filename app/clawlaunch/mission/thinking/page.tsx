import { redirect } from "next/navigation";

/**
 * v3 IA — the live trace became Activity, and Activity was retired 2026-08-19
 * (v2 activity IS the placement ledger, already on Today). Both now land on
 * Today rather than chaining one redirect into another.
 */
export default function ThinkingRedirect() {
  redirect("/clawlaunch/mission");
}
