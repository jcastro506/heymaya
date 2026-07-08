import { redirect } from "next/navigation";

/** v2 IA — Plan folded into Today ("On deck today" + "Rest of the week"). */
export default function PlanRedirect() {
  redirect("/clawlaunch/mission");
}
