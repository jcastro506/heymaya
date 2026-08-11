import { PlanScreen } from "./PlanScreen";

/**
 * ⭐ §16.75 — the Plan screen, restored.
 *
 * It was cut when Mission Control went to six screens, and the spec says
 * plainly that was wrong: *"the strategy is the most interesting thing she
 * produces, and it's invisible."* This route previously redirected to Today.
 */
export default function PlanPage() {
  return <PlanScreen />;
}
