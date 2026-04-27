/**
 * Source-of-truth nav config for the service-business HQ.
 *
 * Lives in a tsx-free module so:
 *   - Tests can import the NAV array without pulling in client React +
 *     Next.js navigation hooks.
 *   - Sibling-file-scan tests have a clean, single import path.
 *
 * The layout component (`./layout.tsx`) re-imports + renders this. Keep the
 * order in sync with the spec: Today → Growth → Jobs → Reviews → Posts →
 * Customers → Profile (Profile mobileHidden after Wave C.7).
 */

import {
  Camera,
  Hammer,
  LayoutDashboard,
  Star,
  TrendingUp,
  UserCircle,
  Users,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, omitted from the mobile bottom nav. Used to keep the bar at
   * 6 cells after Wave C.7 added Growth — Profile collapses off mobile and
   * is reachable via the desktop/tablet side nav.
   */
  mobileHidden?: boolean;
}

export const NAV: ReadonlyArray<NavItem> = [
  { href: "/biz/today", label: "Today", short: "Today", icon: LayoutDashboard },
  // Wave C.7 — Growth is NAV[1], between Today and Jobs. Spec § 12.
  { href: "/biz/growth", label: "Growth", short: "Growth", icon: TrendingUp },
  { href: "/biz/jobs", label: "Jobs", short: "Jobs", icon: Hammer },
  { href: "/biz/reviews", label: "Reviews", short: "Reviews", icon: Star },
  { href: "/biz/posts", label: "Posts", short: "Posts", icon: Camera },
  { href: "/biz/customers", label: "Customers", short: "People", icon: Users },
  {
    href: "/biz/profile",
    label: "Profile",
    short: "You",
    icon: UserCircle,
    mobileHidden: true,
  },
];
