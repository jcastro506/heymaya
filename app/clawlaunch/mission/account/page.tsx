import { redirect } from "next/navigation";

/** v3 IA — Account became Settings (the gear, top-right). */
export default function AccountRedirect() {
  redirect("/clawlaunch/mission/settings");
}
