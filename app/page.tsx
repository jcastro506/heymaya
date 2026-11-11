import type { Metadata } from "next";
import { LandingAnalytics } from "./analytics";
import Landing from "./landing/Landing";
import { appLink } from "@/lib/appLink";
import { platformCopy } from "./landing/platformCopy";

export function generateMetadata(): Metadata {
  const link = appLink();
  const c = platformCopy();
  const description = c.lede;
  const title = `Maya: ${c.headline.toLowerCase().replace("tiktok", "TikTok")} in your texts`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
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
