import Link from "next/link";
import { LandingAnalytics } from "./analytics";
import { CtaLink } from "./cta";

/**
 * The landing page (plan §7 S1): the product shown, not described. A real scout
 * message on a phone, three beats, one price, what she can't do, a short FAQ, one
 * CTA. The copy rules in §7 hold: no vendor names, no "AI", direct and a little cheeky.
 */

const SCOUT_MESSAGE = `@runwithcarly just posted a talking-head that's at 6× her normal after 9 hours. it's the "things i wish i knew before my first marathon" list, but she cuts to the shoe rack at every point.

you've done the list format twice this year and both beat your normal, so this is yours to take.

your version: open on the shoe rack, not your face. "5 things nobody tells you about mile 20." keep it under 30s, your usual pace.

want the shot list?`;

export default function Home() {
  return (
    <main className="min-h-dvh">
      <LandingAnalytics />
      <section className="max-w-5xl mx-auto px-6 pt-14 pb-10 grid md:grid-cols-2 gap-10 items-center">
        <div className="flex flex-col gap-5">
          <h1 className="text-4xl md:text-5xl font-semibold leading-[1.05] tracking-tight">She watches the accounts you wish you were. Then she texts you.</h1>
          <p className="text-lg opacity-75 max-w-md">Maya is a creator&apos;s assistant for TikTok and Instagram. She watches your posts, the ones you admire, and your lane every day, knows your calendar, and gives you a straight opinion on anything you send her.</p>
          <div className="flex gap-3">
            <CtaLink className="btn" href="/sign-up" where="hero">Start the 7-day trial</CtaLink>
            <Link className="btn-secondary" href="/sign-in">Sign in</Link>
          </div>
          <p className="text-xs opacity-50">$19 a month while founding seats last. Card required, charged on day seven, cancel in one tap.</p>
        </div>
        <div className="mx-auto w-[300px] rounded-[2.2rem] border border-white/15 bg-black p-3 shadow-2xl">
          <div className="rounded-[1.7rem] bg-neutral-950 px-3 pt-6 pb-4 min-h-[540px] flex flex-col gap-3">
            <div className="text-center text-[11px] opacity-40">Maya · today 8:14 AM</div>
            <div className="self-start max-w-[92%] rounded-2xl rounded-bl-sm bg-neutral-800 px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap">{SCOUT_MESSAGE}</div>
            <div className="flex gap-2 text-[11px]">
              <span className="rounded-full border border-white/20 px-2 py-1">shot list</span>
              <span className="rounded-full border border-white/20 px-2 py-1">not me</span>
              <span className="rounded-full border border-white/20 px-2 py-1">save</span>
            </div>
            <div className="self-end max-w-[80%] rounded-2xl rounded-br-sm bg-emerald-500 text-black px-3 py-2 text-[13px]">shot list. and block thursday 3pm for it</div>
            <div className="self-start max-w-[92%] rounded-2xl rounded-bl-sm bg-neutral-800 px-3 py-2 text-[13px]">blocked thu 3:00 PM, it&apos;s on your calendar. shot list coming.</div>
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-12 grid md:grid-cols-3 gap-8">
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold text-lg">She watches the ones you wish you were.</h2>
          <p className="opacity-75">Name the accounts you admire. She samples them every few hours and only texts when one of their posts is running well above its own normal, with the link, the reason, and your version.</p>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold text-lg">She knows your calendar.</h2>
          <p className="opacity-75">Connect Google Calendar and she finds the ideas in your life, proposes one filming block before the thing, and puts it on the calendar when you say yes. She keeps titles and times, never details, and skips anything private.</p>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold text-lg">She tells you why it worked.</h2>
          <p className="opacity-75">Send her a draft or a link and she gives a read with three fixes and a confidence in words, then goes on the record. Sunday she tells you what happened this week and what to try next.</p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-12 grid md:grid-cols-2 gap-10">
        <div className="border border-white/15 rounded-2xl p-6 flex flex-col gap-3">
          <div className="text-xs uppercase tracking-wide opacity-50">One plan</div>
          <div className="text-4xl font-semibold">$19<span className="text-base font-normal opacity-60"> / month</span></div>
          <p className="opacity-75">or $180 a year. Founding price for the first hundred, locked while you stay. $29 after.</p>
          <ul className="opacity-75 flex flex-col gap-1 text-sm">
            <li>Seven days free, card required, charged on day seven.</li>
            <li>Every idea comes with the evidence and a link.</li>
            <li>Cancel from Settings, one tap. No questions.</li>
          </ul>
          <CtaLink className="btn mt-2 self-start" href="/sign-up" where="pricing">Start the trial</CtaLink>
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold text-lg">What she can&apos;t do</h2>
          <ul className="opacity-75 flex flex-col gap-2">
            <li>She is not an editor. She writes the hook and the shot list; you make the video.</li>
            <li>She does not post for you. Your account stays yours; she never holds your password.</li>
            <li>She can&apos;t see TikTok watch time. Nobody outside the app can. She works from public numbers and says so.</li>
            <li>She won&apos;t promise a post will do well. She gives a confidence in words and keeps score.</li>
          </ul>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-12 flex flex-col gap-6">
        <h2 className="font-semibold text-lg">Questions</h2>
        <div><h3 className="font-medium">Where does she text me?</h3><p className="opacity-75">Telegram, for now. You open a chat with her once and that&apos;s the whole app. The website is where your settings and your results live.</p></div>
        <div><h3 className="font-medium">How much does she text?</h3><p className="opacity-75">At most three times a day, never in your quiet hours, and only when there is something worth your time. Most days it&apos;s one.</p></div>
        <div><h3 className="font-medium">Does she get to know me?</h3><p className="opacity-75">Yes. She reads every post you have made, learns what you take and what you pass on, and remembers what you tell her. All of it is in Settings, in plain words, and you can correct her.</p></div>
        <div><h3 className="font-medium">What happens to my data if I leave?</h3><p className="opacity-75">You can download everything, then delete everything, from Settings. Deletion is one procedure and it is total. <Link className="underline" href="/privacy">The details.</Link></p></div>
      </section>

      <footer className="max-w-5xl mx-auto px-6 py-10 text-xs opacity-50 flex gap-4">
        <span>Maya</span>
        <Link className="underline" href="/privacy">Privacy</Link>
        <Link className="underline" href="/terms">Terms</Link>
        <span>18+ only</span>
      </footer>
    </main>
  );
}
