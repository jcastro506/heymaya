import ClawLaunchLandingPage, {
  metadata as clawLaunchMetadata,
} from "./clawlaunch/page";

/**
 * Home (`/`). ClawLaunch is the public surface for the Vercel
 * `clawlaunch.io` project.
 *
 * The legacy creator Maya landing remains available at `/creators`; this root
 * route now points to the GTM agent for builders.
 */
export const metadata = clawLaunchMetadata;

export default function Home() {
  return <ClawLaunchLandingPage />;
}
