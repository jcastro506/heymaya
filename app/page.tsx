import Link from "next/link";

/** Landing placeholder. The real page is S1 (plan §7): a real scout message on a phone, three beats, one price. */
export default function Home() {
  return (
    <main className="min-h-dvh max-w-md mx-auto p-6 flex flex-col gap-6 justify-center">
      <h1 className="text-3xl font-semibold leading-tight">She watches the accounts you wish you were, and texts you when something is worth your time.</h1>
      <p className="opacity-70">Maya is a creator&apos;s assistant for TikTok and Instagram. She reads your posts, watches your lane every day, knows your calendar, and gives you a straight opinion on anything you send her.</p>
      <div className="flex gap-3">
        <Link className="btn" href="/sign-up">Get started</Link>
        <Link className="btn-secondary" href="/sign-in">Sign in</Link>
      </div>
      <p className="text-xs opacity-50">Not an editor. Not a scheduler. She can&apos;t see TikTok watch time, and she will say so.</p>
    </main>
  );
}
