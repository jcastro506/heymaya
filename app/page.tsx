import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import { LandingAnalytics } from "./analytics";
import Landing from "./landing/Landing";

/**
 * The landing page (plan §7 S1, rebuilt 2026-09-07): white ground, black type, one colour
 * that is hers, and every section the thing she does shown as working UI. The copy rules
 * in §7 hold: no vendor names, no "AI", direct and a little cheeky.
 */

const bricolage = Bricolage_Grotesque({ subsets: ["latin"], weight: ["400", "600", "800"], variable: "--font-bricolage", display: "swap" });
const instrument = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-instrument", display: "swap" });

export default function Home() {
  return (
    <div className={`${bricolage.variable} ${instrument.variable}`}>
      <LandingAnalytics />
      <Landing />
    </div>
  );
}
