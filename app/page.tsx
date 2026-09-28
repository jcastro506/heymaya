import type { Metadata } from "next";
import { LandingAnalytics } from "./analytics";
import Landing from "./landing/Landing";
import { appLink } from "@/lib/appLink";

const description =
  "Maya is a TikTok and Instagram expert who watches your niche, turns what's working into ideas, plans your shoots, writes your captions, reads your numbers, and finds you brand deals. All over text.";

export function generateMetadata(): Metadata {
  const link = appLink();
  return {
    title: "Maya: your whole content team, in one text thread",
    description,
    openGraph: { title: "Maya: your whole content team, in one text thread", description, type: "website" },
    // The smart app banner on iPhone Safari, once the App Store listing exists.
    ...(link.kind === "store" && link.appId ? { itunes: { appId: link.appId } } : {}),
  };
}

export default function Home() {
  return (
    <>
      <LandingAnalytics />
      <Landing />
    </>
  );
}
