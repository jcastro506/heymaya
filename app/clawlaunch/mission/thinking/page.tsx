import { redirect } from "next/navigation";

/** v3 IA — the live trace became Activity (play-by-play + chat mirror). */
export default function ThinkingRedirect() {
  redirect("/clawlaunch/mission/activity");
}
