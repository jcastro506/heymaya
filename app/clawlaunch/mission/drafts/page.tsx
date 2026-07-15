import { redirect } from "next/navigation";

/** v3 IA — draft decisions live in Today's "Needs you" tray. */
export default function DraftsRedirect() {
  redirect("/clawlaunch/mission");
}
