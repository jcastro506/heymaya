import { redirect } from "next/navigation";

/** v3 IA — the schedule lives in Today ("Maya's working"). */
export default function PlanRedirect() {
  redirect("/clawlaunch/mission");
}
