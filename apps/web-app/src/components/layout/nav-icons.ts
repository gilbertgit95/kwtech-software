import {
  Activity,
  Archive,
  Award,
  Ban,
  Banknote,
  Beaker,
  Bell,
  Blocks,
  Bookmark,
  Box,
  Boxes,
  Briefcase,
  Bug,
  Building2,
  Calendar,
  ChartColumn,
  ChartLine,
  ChartPie,
  Circle,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Clock,
  Cloud,
  Code,
  Compass,
  Contact,
  Cpu,
  CreditCard,
  Crown,
  Database,
  Eye,
  Factory,
  FileText,
  Filter,
  Flag,
  Flame,
  Folder,
  Gauge,
  Gem,
  GitBranch,
  Globe,
  GraduationCap,
  Handshake,
  HardHat,
  Headset,
  History,
  IdCard,
  Inbox,
  Info,
  KeyRound,
  Landmark,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Lock,
  type LucideIcon,
  Mail,
  Map as MapIcon,
  MapPin,
  Megaphone,
  MessageSquare,
  Microscope,
  Package,
  PenLine,
  Plug,
  Power,
  Puzzle,
  Receipt,
  RefreshCw,
  Rocket,
  Search,
  Send,
  Server,
  Settings,
  Share2,
  Shield,
  Sliders,
  Sparkles,
  Sprout,
  Star,
  Store,
  Table,
  Tag,
  Target,
  Terminal,
  ToggleLeft,
  Trash2,
  TrendingUp,
  Trophy,
  Truck,
  Unlock,
  User,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  Wand,
  Wrench,
  Zap,
} from 'lucide-react';

/**
 * The seam between an icon NAME stored as data and an actual icon component.
 *
 * THREE vocabularies share it, because they are one problem: `nav.icon` on a
 * module descriptor, `PermRole.icon` on a role row, and `PermPlan.icon` on a
 * plan row. All are strings for the same reason, so all resolve here rather
 * than growing separate maps that would drift.
 *
 * It has to be a string in the descriptor: `@kwtech/module-kit` is the contract
 * every module package implements, and making it name a `LucideIcon` would put
 * a react-only UI dependency into a package the NestJS server also imports.
 * So modules name an icon and the app owns what that name draws — which also
 * means a second frontend can draw them in its own set.
 *
 * An unknown name falls back rather than throwing. A misspelled icon should
 * cost a generic dot in the drawer, not a blank page.
 *
 * ## Adding one
 *
 * Import it, add a line, and give it a name that says what the THING IS rather
 * than what it does. `crown` and `briefcase` describe a role's standing;
 * `roles-manage` would describe a permission, and permissions are the list of
 * features a row carries — never a picture. Every name here should still make
 * sense if the feature registry changed completely tomorrow.
 *
 * Names are kebab-case and stable: they are stored in the database, so renaming
 * one silently turns every row holding it into a fallback dot.
 */
export const ICONS: Record<string, LucideIcon> = {
  // ── navigation and system areas ──────────────────────────────────────────
  dashboard: LayoutDashboard,
  settings: Settings,
  shield: Shield,
  // A key for the feature registry: a feature IS a key, in both senses, and the
  // registry is the ring of them a role is assembled from.
  key: KeyRound,
  // The tenant, drawn as a building rather than as `users`. An organization is
  // not its member list — that distinction is the whole reason PermMembership
  // is a separate table — and reusing the people icon would blur it in the one
  // place a reader scans fastest.
  organization: Building2,
  // Stacked planes: a workspace is one slice of an organization, not a separate
  // building — which is what `organization` already says.
  workspace: Layers,
  // Billing, not money: the page is about which plan is in force, not about an
  // amount, so a card reads more accurately than a currency mark — which would
  // also have to pick a currency.
  billing: CreditCard,
  // A plan is a PRODUCT — a named bundle of features the platform sells — so a
  // box, not the card beside it. The card is `billing`, the screen about who is
  // on what; drawing both with it would collapse "what we sell" and "who bought
  // it" into one glyph.
  plan: Package,

  // ── people ───────────────────────────────────────────────────────────────
  // Singular is the account's own profile; plural is the administrative list of
  // everyone. Two icons because they are two ideas.
  user: User,
  users: Users,
  'user-check': UserCheck,
  'user-cog': UserCog,
  'user-plus': UserPlus,
  contact: Contact,
  'id-card': IdCard,

  // ── role badges ──────────────────────────────────────────────────────────
  // Named by what the ROLE is, not by what it may do. A role's rights are the
  // list of features it carries and nothing else, so an icon implying a
  // capability would be a second, unenforceable account of the same thing.
  crown: Crown,
  briefcase: Briefcase,
  sprout: Sprout,
  headset: Headset,
  wrench: Wrench,
  'hard-hat': HardHat,
  'graduation-cap': GraduationCap,
  handshake: Handshake,
  eye: Eye,
  pen: PenLine,

  // ── plan tiers ───────────────────────────────────────────────────────────
  // A ladder anyone can read at a glance without being told the order — which
  // is the only job a tier badge has. It carries no commercial meaning: a plan
  // is exactly the features and caps it holds.
  rocket: Rocket,
  zap: Zap,
  gem: Gem,
  star: Star,
  sparkles: Sparkles,
  flame: Flame,
  trophy: Trophy,
  award: Award,

  // ── things and places ────────────────────────────────────────────────────
  folder: Folder,
  file: FileText,
  archive: Archive,
  inbox: Inbox,
  box: Box,
  boxes: Boxes,
  store: Store,
  factory: Factory,
  landmark: Landmark,
  truck: Truck,
  // Aliased on import: a bare `Map` shadows the global, which Biome refuses —
  // and rightly, since this file is one `new Map()` away from a confusing bug.
  map: MapIcon,
  'map-pin': MapPin,
  compass: Compass,
  globe: Globe,

  // ── money ────────────────────────────────────────────────────────────────
  wallet: Wallet,
  receipt: Receipt,
  banknote: Banknote,

  // ── data and reporting ───────────────────────────────────────────────────
  database: Database,
  server: Server,
  cloud: Cloud,
  cpu: Cpu,
  'chart-bar': ChartColumn,
  'chart-pie': ChartPie,
  'chart-line': ChartLine,
  'trending-up': TrendingUp,
  activity: Activity,
  gauge: Gauge,
  target: Target,
  table: Table,
  filter: Filter,
  sliders: Sliders,

  // ── communication ────────────────────────────────────────────────────────
  mail: Mail,
  send: Send,
  message: MessageSquare,
  megaphone: Megaphone,
  bell: Bell,
  share: Share2,

  // ── time ─────────────────────────────────────────────────────────────────
  calendar: Calendar,
  clock: Clock,
  history: History,

  // ── access and state ─────────────────────────────────────────────────────
  lock: Lock,
  unlock: Unlock,
  power: Power,
  toggle: ToggleLeft,
  ban: Ban,
  check: CircleCheck,
  alert: CircleAlert,
  info: Info,
  refresh: RefreshCw,
  trash: Trash2,

  // ── engineering ──────────────────────────────────────────────────────────
  code: Code,
  terminal: Terminal,
  'git-branch': GitBranch,
  bug: Bug,
  beaker: Beaker,
  microscope: Microscope,
  puzzle: Puzzle,
  plug: Plug,
  blocks: Blocks,
  wand: Wand,
  lifebuoy: LifeBuoy,

  // ── lists and labels ─────────────────────────────────────────────────────
  clipboard: ClipboardList,
  checklist: ListChecks,
  tag: Tag,
  bookmark: Bookmark,
  flag: Flag,
  search: Search,
};

export function iconFor(name: string | undefined): LucideIcon {
  return (name ? ICONS[name] : undefined) ?? Circle;
}
