import type { Metadata } from "next";
import { LandingAnalytics } from "./analytics";
import Landing from "./landing/Landing";
import { appLink } from "@/lib/appLink";

const description =
  "Maya watches your lane on TikTok and Instagram, reads your own numbers, and texts you the idea worth making. Everything she finds lives in the iPhone app.";

export function generateMetadata(): Metadata {
  const link = appLink();
  return {
    title: "Maya: she texts you the idea worth making",
    description,
    openGraph: { title: "Maya: she texts you the idea worth making", description, type: "website" },
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
