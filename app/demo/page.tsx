import { DemoRead } from "../_components/DemoRead";

/**
 * A standalone page for the demo block, so it can be verified and shared
 * before it is placed among §18.9.2's twelve landing blocks.
 */
export default function DemoPage() {
  return (
    <div className="min-h-screen bg-ink text-paper">
      <DemoRead />
    </div>
  );
}
