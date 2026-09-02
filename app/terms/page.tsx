import Link from "next/link";

/** Terms (plan §7 S1 legal). Short on purpose; reviewed by a person before launch. */
export default function Terms() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12 flex flex-col gap-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Terms</h1>
      <p className="opacity-60">Last updated 2 September 2026. Pilot terms.</p>

      <h2 className="font-semibold text-base">The service</h2>
      <p>Maya is an assistant that reads public posts, watches videos, reads a calendar you connect, and texts you ideas and opinions. She does not post on your behalf and never holds your platform credentials. Her opinions are opinions; she keeps score on them, and no result is promised.</p>

      <h2 className="font-semibold text-base">Your account</h2>
      <p>You must be 18 or older. You are responsible for the handles you give us being yours and for what you do with the ideas. One person, one account, one Telegram chat.</p>

      <h2 className="font-semibold text-base">Payment</h2>
      <p>Seven days free with a card on file, then $19 a month or $180 a year at the founding price while seats last, $29 or $290 after. You are charged on day seven unless you cancel first. Cancel any time from Settings; the current period runs out and there are no pro-rata refunds. Exceptions are at the founder&apos;s discretion.</p>

      <h2 className="font-semibold text-base">Fair use</h2>
      <p>The trial and the paid plan have the same budgets for how much she watches and reads each day. Using Maya to harass, impersonate or scrape people, or to feed her content you have no right to share, ends the account.</p>

      <h2 className="font-semibold text-base">Content</h2>
      <p>Ideas, hooks and shot lists she writes for you are yours. Public content she reads belongs to whoever posted it; she cites it with links and never republishes it.</p>

      <h2 className="font-semibold text-base">Availability and liability</h2>
      <p>This is a pilot. She may be down, late or wrong. We are not liable for what you post, for a platform&apos;s decisions about your account, or for lost views. Our liability is limited to what you paid in the last month.</p>

      <h2 className="font-semibold text-base">Changes and ending</h2>
      <p>We can change these terms with notice on this page and in the chat. You can leave any time from Settings, with an export first if you want it. See <Link className="underline" href="/privacy">Privacy</Link> for what is kept and what is deleted.</p>

      <p className="opacity-50"><Link className="underline" href="/">Home</Link></p>
    </main>
  );
}
