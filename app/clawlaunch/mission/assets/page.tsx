import { redirect } from "next/navigation";

/** v2 IA — Assets folded into Queue as the Media view. */
export default function AssetsRedirect() {
  redirect("/clawlaunch/mission/queue?view=media");
}
