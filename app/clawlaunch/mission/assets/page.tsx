import { redirect } from "next/navigation";

/** v3 IA — Maya-made media lives under Results ("Media Maya made"). */
export default function AssetsRedirect() {
  redirect("/clawlaunch/mission/results");
}
