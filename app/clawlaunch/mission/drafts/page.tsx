import { redirect } from "next/navigation";

/** v2 IA — Drafts became Queue (drafts + media, with approve/tweak/pass). */
export default function DraftsRedirect() {
  redirect("/clawlaunch/mission/queue");
}
