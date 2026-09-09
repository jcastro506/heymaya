import { notFound } from "next/navigation";
import Link from "next/link";
import { OnboardShell } from "../onboarding/Shell";

/**
 * Dev only: the onboarding screens with no account behind them, so the room can be looked at
 * without a session (the real screens sit behind Clerk). 404 in production.
 */
export default function OnboardingPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <OnboardShell where="step 5 of 5">
      <section>
        <h2>Your handles</h2>
        <p className="muted small">Public is enough to start. She reads your posts the moment you save.</p>
        <label>TikTok<input className="input" placeholder="@handle" defaultValue="@vanessaalopezz" readOnly /></label>
        <label>Instagram<input className="input" placeholder="@handle" readOnly /></label>
        <div className="tiny muted flex items-center gap-2"><span className="avatar" style={{ background: "#e4dfea" }} />tiktok:vanessaalopezz · Vanessa · 12,400 followers</div>
        <button className="btn">this is me</button>
      </section>
      <section>
        <h2>Who do you wish you were?</h2>
        <p className="muted small">Three to ten accounts in your lane. She watches them every day.</p>
        <div className="flex flex-wrap gap-2"><button className="chip">@andi.renay · 41k</button><button className="chip">@runwithcarly · 88k</button><button className="chip">@aliabdaal · 1.2m</button></div>
        <ul className="flex flex-col gap-2"><li className="row"><span>@andi.renay <span className="muted">· tiktok</span></span><button className="link">remove</button></li></ul>
        <button className="btn" disabled>2 more</button>
      </section>
      <section>
        <h2>Almost there</h2>
        <label>Your number<input className="input" type="tel" placeholder="+1 555 123 4567" readOnly /></label>
        <p className="tiny muted">Maya texts you here, iMessage or SMS. Reply STOP any time.</p>
        <p className="muted small">Your first message lands in about 8 minutes, as a text.</p>
        <Link className="btn" href="#">Text Maya</Link>
        <button className="link">Prefer Telegram?</button>
        <p className="err">that doesn&apos;t look like a phone number (try +1 555 123 4567)</p>
      </section>
      <section>
        <h2>Text Maya</h2>
        <p className="muted small">One text pairs you. Tap the button, send the message it opens, and she&apos;s yours.</p>
        <a className="btn" href="#">Text Maya</a>
        <p className="tiny muted">Or text <b>START 3f9a…</b> to <b>+1 (555) 000-9999</b> from your number.</p>
        <div className="panel"><p className="small">Looks like Telegram isn&apos;t installed yet. It&apos;s free.</p><a className="btn-secondary" href="#">Get Telegram, it&apos;s free</a></div>
      </section>
    </OnboardShell>
  );
}
