import { Circle, LayoutDashboard, type LucideIcon, Settings, Shield, Users } from 'lucide-react';

/**
 * The seam between a module's `nav.icon` string and an actual icon component.
 *
 * It has to be a string in the descriptor: `@kwtech/module-kit` is the contract
 * every module package implements, and making it name a `LucideIcon` would put
 * a react-only UI dependency into a package the NestJS server also imports.
 * So modules name an icon and the app owns what that name draws — which also
 * means a second frontend can draw them in its own set.
 *
 * An unknown name falls back rather than throwing. A misspelled icon should
 * cost a generic dot in the drawer, not a blank page.
 */
const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  settings: Settings,
  shield: Shield,
  users: Users,
};

export function iconFor(name: string | undefined): LucideIcon {
  return (name ? ICONS[name] : undefined) ?? Circle;
}
