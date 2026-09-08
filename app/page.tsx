import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import { LandingAnalytics } from "./analytics";
import Landing from "./landing/Landing";

export const metadata = {
  title: "Maya — Your content person, in your corner",
  description:
    "Your content person, right in Telegram. Text Maya for ideas, planning, and honest feedback. Your dashboard is optional for everyday work. Try 7 days free, then $19/month.",
};

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "600", "800"],
  variable: "--font-bricolage",
  display: "swap",
});
const instrument = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-instrument",
  display: "swap",
});

export default function Home() {
  return (
    <div className={`${bricolage.variable} ${instrument.variable}`}>
      <LandingAnalytics />
      <Landing />
    </div>
  );
}
