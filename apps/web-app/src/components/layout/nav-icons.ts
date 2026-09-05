import {
  Building2,
  Circle,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  Settings,
  Shield,
  User,
  Users,
} from 'lucide-react';

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
  // Singular — the account's own profile, as opposed to `users`, which is the
  // administrative list of everyone. Two icons because they are two ideas.
  user: User,
  users: Users,
  // A key for the feature registry: a feature IS a key, in both senses, and the
  // registry is the ring of them a role is assembled from.
  key: KeyRound,
  // The tenant, drawn as a building rather than as `users`. An organization is
  // not its member list — that distinction is the whole reason PermMembership
  // is a separate table — and reusing the people icon would blur it in the one
  // place a reader scans fastest.
  organization: Building2,
  // Billing, not money: the page is about which plan is in force, not about an
  // amount, so a card reads more accurately than a currency mark — which would
  // also have to pick a currency.
  billing: CreditCard,
};

export function iconFor(name: string | undefined): LucideIcon {
  return (name ? ICONS[name] : undefined) ?? Circle;
}
