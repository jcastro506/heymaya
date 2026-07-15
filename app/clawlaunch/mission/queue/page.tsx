import { redirect } from "next/navigation";

/** v3 IA — draft decisions live in Today's "Needs you" tray. */
export default function QueueRedirect() {
  redirect("/clawlaunch/mission");
}
