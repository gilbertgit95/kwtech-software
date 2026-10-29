import type { ComponentType } from 'react';
import type { DefaultContribution, DefaultMomentContribution } from './defaults.js';
import type { LimitContribution } from './limits.js';
import type { ProcessContribution } from './processes.js';

/**
 * The contract a module-* package fills in and an app composes.
 *
 * react is a type-only, optional peer: `import type` erases at build time, so a
 * server app importing this package pulls in nothing.
 */

/**
 * A grantable right a module contributes to the shared registry.
 *
 * Owned here rather than in module-permissions because every module declares
 * rights, while only one module enforces them. The enforcer imports this shape
 * like everyone else.
 */
export interface FeatureContribution {
  key: string;
  /** The module key, so the role editor can group by feature area. */
  module: string;
  label: string;
  description: string;
  /** Irreversible or heavily audited. Flagged in the role editor. */
  isPrivileged?: boolean;
  /**
   * The scope a role must be at to grant this.
   *
   * Here rather than only in the enforcing module, for the reason this whole
   * interface is here: every module declares rights, and a right is not fully
   * declared without saying how far it reaches. Without it a module could name
   * a key and nothing else — leaving the LEVEL, which is what stops a workspace
   * role carrying an organization-wide power, to be invented by whoever wired
   * the module up.
   *
   * Optional because the enforcer requires it and this contract does not: a
   * consumer with no permission model at all still composes descriptors.
   * `@kwtech/module-permissions` narrows it to required in its own `FeatureSpec`.
   */
  level?: FeatureLevel;
  /**
   * Where the key is actually enforced. A key with no bindings guards nothing
   * while reading as coverage; one whose binding names a surface that has no
   * guard is worse. See the enforcing module for the full surface list — this
   * is typed loosely so a module can declare a surface this package has never
   * heard of.
   */
  bindings?: readonly { surface: string; identifier: string }[];
  /**
   * Cross-cutting labels, for grouping and filtering a long registry.
   *
   * A feature already has three groupings — its module, its level, and the
   * namespace in its key — and every one of them is a HIERARCHY: a key belongs
   * to exactly one. Tags exist for the groupings that are not hierarchical.
   * "admin" spans `features:*`, `roles:*`, `members:*` and `billing:*`, and no
   * single tree can say that without duplicating something.
   *
   * ⚠️ PRESENTATION ONLY. Nothing may grant, deny or infer access from a tag.
   * "Everyone with the admin tag" is a wildcard grant by another name, and the
   * model already rejected one of those — a role row has to describe what its
   * holder can do, and a tag is a label somebody can change. The enforcing
   * module asserts this in its tests rather than trusting it.
   */
  tags?: readonly string[];
}

/**
 * How far a right reaches. Mirrors `RoleLevel` in the enforcing module.
 *
 * Duplicated deliberately rather than imported: this package must not depend on
 * `@kwtech/module-permissions` — the dependency runs the other way — and three
 * string literals are a smaller cost than that inversion. The enforcer's own
 * type is checked against this one where it matters.
 */
export type FeatureLevel = 'app' | 'organization' | 'workspace';

/**
 * What a route's component is handed. `searchParams` is here because a real
 * route can depend on the query string — /auth/reset-password is nothing
 * without its token — and a descriptor that could not express that would push
 * every such page into hand-written app code, which is the duplication this
 * package exists to remove.
 */
export interface ModuleRouteProps {
  params?: Record<string, string>;
  searchParams?: Record<string, string | string[] | undefined>;
}

export interface ModuleRoute {
  /** App-absolute and leading-slash: '/admin/roles'. */
  path: string;
  component: ComponentType<ModuleRouteProps>;
  title: string;
  /**
   * Sends this path somewhere else instead of rendering it: a path pattern
   * whose `:params` are filled from THIS route's match —
   * `'/organizations/:organizationId/overview'` on
   * `'/organizations/:organizationId'`. Resolve it with `routeRedirect`.
   *
   * For a URL that has MOVED and must keep working: bookmarks, links in
   * e-mails, and the other packages that still build the old one. The renderer
   * redirects before any feature check, so the target's own check is the one
   * that applies.
   *
   * `component` is still required and should render what the target renders.
   * A renderer that ignores this field then shows the right page at the old
   * address rather than a blank one — degraded, not broken.
   *
   * ⚠ Such a route may not carry `nav`, and its pattern may only name params
   * its own path captures. `composeRoutes` throws on either: a drawer entry
   * that always navigates away is a link to the wrong place, and an unfilled
   * `:param` would redirect to a literal colon.
   */
  redirectTo?: string;
  /**
   * Feature key required to reach it.
   *
   * Read by the navigation filter (`composeNav`) AND by whatever renders the
   * route, so a route cannot be linked-to-but-unprotected — the usual way a
   * menu and a guard drift apart. In this workspace that renderer is the app's
   * catch-all page, which refuses before the component is called.
   *
   * It said "the app's middleware", and that was WRONG — middleware there
   * renews a session and explicitly does not decide who may see what, so half
   * the promise was never kept. A route whose component did not gate itself was
   * reachable by anyone signed in, and the descriptor said otherwise.
   *
   * NONE OF THIS IS THE SECURITY BOUNDARY. It decides what a person is shown;
   * every request is authorised again at the API, which is the only check an
   * attacker calling it directly cannot skip.
   */
  feature?: string;
  /** Omit to keep the route reachable but unlisted. */
  nav?: {
    group: string;
    order?: number;
    icon?: string;
    /**
     * A live indicator drawn beside this entry — an unread count, today.
     *
     * ## Why a COMPONENT, when every other field here is a string
     *
     * Because the number has to be right without a navigation. A count resolved
     * on the server is correct for exactly as long as it takes somebody else to
     * send a message, and a person looking at a drawer saying nothing while a
     * message waits for them stops believing the drawer. So the module
     * contributes something that can subscribe, and the shell renders it
     * without knowing what it counts.
     *
     * ⚠ A COMPONENT REFERENCE, never a render function or any other callable
     * prop. The composing layer is a SERVER component, and a function cannot
     * cross that boundary — a client component reference can, which is the same
     * rule `component` above follows and the 500 it was learned from.
     *
     * ⚠ It takes NO PROPS. The shell decides where it sits and the module
     * decides what it says; anything passed between them would be the shell
     * learning what the module is.
     *
     * Filtered by this route's own `feature`, like the entry it hangs off —
     * there is no second key and no second filter to keep in step.
     */
    badge?: ComponentType;
  };
  /**
   * Which shell the route renders inside. Defaults to 'app' — the header, the
   * side drawer and the account menu.
   *
   * 'bare' is for the pages that exist BECAUSE there is no session yet:
   * sign-in, forgot-password, reset-password. Wrapping those in a shell whose
   * whole content is "who is signed in and what may they reach" would be a
   * shell with nothing to say, and its account menu would be furniture around
   * an empty chair.
   *
   * 'fullscreen' is for a page that IS the screen — a public queue display on a
   * TV in a waiting room. No header, no theme control, no status bar: the page
   * owns every pixel and must report its own connection state, because a
   * control pinned over a TV picture is one nobody can reach with a remote,
   * and a stale screen that looks current is the failure such a page exists
   * to avoid.
   *
   * Declared per route rather than inferred from the path, because '/auth' is
   * a naming convention and this is a rendering decision — an app that renamed
   * the prefix would silently lose the distinction.
   */
  chrome?: 'app' | 'bare' | 'fullscreen';
  /**
   * How the 'app' shell lays out the page body. Defaults to 'padded': the
   * shell's gutter around a page that scrolls in the shell.
   *
   * 'fill' is for a WORKSPACE of a page — the Apps page, where several apps sit
   * side by side — that must use every pixel between the header and the drawer.
   * The shell keeps only a thin gutter and stops scrolling, so the page's
   * `h-full` is exactly the space left and its panes scroll themselves. A page
   * that asks for it and then grows taller than the screen is cut off, not
   * scrolled: only ask for it when the page manages its own overflow.
   *
   * Ignored by 'bare' and 'fullscreen', which have no shell body to lay out.
   */
  body?: 'padded' | 'fill';
}

export interface ServerModuleDescriptor {
  key: string;
  /** The DynamicModule returned by the module's forRoot(). Typed loosely so this package never imports Nest. */
  nestModule: unknown;
  /** Mounts the module's controllers under a prefix, via the app's RouterModule. */
  routePrefix?: string;
  features?: readonly FeatureContribution[];
  /**
   * Caps this module declares. Separate from `features` because they answer
   * different questions at different moments — a feature is checked when
   * somebody READS or acts, a limit when somebody writes one more row — and
   * merging them makes a full organization indistinguishable from an
   * unauthorised one.
   */
  limits?: readonly LimitContribution[];
  /**
   * Decisions an OPERATOR should make once rather than at every creation —
   * see `DefaultContribution`. A third kind of declaration, because it answers
   * a third question: not what may be done, nor how many, but what happens when
   * nobody said.
   */
  defaults?: readonly DefaultContribution[];
  /**
   * The HEADINGS for the moments this module's defaults happen at — see
   * `DefaultMomentContribution`.
   *
   * ⚠ Separate from `defaults` because a moment is shared: two modules may
   * have a default at one, so it is a namespace rather than a property of any
   * one declaration. Omitting it while declaring a default AT that moment means
   * the default appears under an unnamed section at the bottom of the screen —
   * visible, which is the point, but not explained.
   */
  defaultMoments?: readonly DefaultMomentContribution[];
  /**
   * Work this module does on a SCHEDULE rather than on a request — see
   * `ProcessContribution`. A fourth kind of declaration: not what may be done,
   * how many, or what happens when nobody said, but what happens when nobody
   * asked.
   *
   * ⚠ Declared here and RUN ELSEWHERE. The module never starts a timer: the app
   * hands every module's processes to the runner (`composeProcesses`), which is
   * what lets one screen list, pause and force them all.
   */
  processes?: readonly ProcessContribution[];
}

/**
 * Where a NAV GROUP sits in the drawer, contributed by whichever module owns it.
 *
 * Exists because group placement was the last thing an app still had to edit by
 * hand for every module it adopted: `composeNav` can only sort group names
 * alphabetically, so the app kept a `GROUP_ORDER` array and a new module's group
 * silently landed at the bottom until someone remembered to promote it. That is
 * exactly the per-module edit the descriptor is supposed to remove.
 *
 * A NAME, not a reference: two modules may contribute entries to one group —
 * 'Administration' is the obvious case — so the group is a shared namespace and
 * neither module owns it outright. See `composeNavGroups` for how two
 * suggestions about one group are resolved.
 */
export interface NavGroupContribution {
  /** Matches `ModuleRoute.nav.group` exactly. */
  group: string;
  /** Lower is higher up the drawer. Space them — 10, 50, 90 — so one can be inserted between. */
  order: number;
}

/**
 * A control a module puts in the app's HEADER, beside the account menu — chat's
 * inbox, and the next tool after it.
 *
 * A slot rather than a route because a tool is not a place: it is something
 * you reach for from wherever you are, and opening it must not take you away
 * from the page you were on. The drawer answers "where can I go"; the header
 * tools answer "what can I use here without leaving".
 *
 * ⚠ `component` is a COMPONENT REFERENCE that takes NO PROPS — the rule
 * `nav.badge` follows, for the same reason: the composing layer is a server
 * component and a function cannot cross into the client. The component draws
 * its own trigger button and whatever that opens.
 */
export interface HeaderToolContribution {
  /** Unique across the app. Composition throws on a duplicate, like a route path. */
  key: string;
  /** What the tool is called — for the app's own use (a tooltip, a settings list). */
  label: string;
  /** Lower sits further LEFT, i.e. further from the account menu. Space them — 10, 20. */
  order?: number;
  /**
   * The key that lists it, filtered with the viewer's APP-level grants — the
   * header belongs to no organization or workspace. Omit only for a tool that
   * every signed-in person may use.
   */
  feature?: string;
  component: ComponentType;
}

/**
 * What a sub-app's component is handed when it runs inside the Apps page.
 *
 * The workspace only, as plain strings: an app always lives under a workspace
 * (PLAN §13, 2026-09-25), and anything else it needs it reads itself, as its
 * own full page does.
 */
export interface AppProps {
  organizationId: string;
  workspaceId: string;
}

/**
 * A SUB-APP — the queue, and every app after it — offered on a workspace's Apps
 * page, where several run side by side in tabs or in a grid.
 *
 * Declared by the module that owns the app and collected by `composeApps`, so a
 * new sub-app never edits the page that hosts it. The hosting module receives
 * the composed list from the app; it never imports a sub-app (PLAN §9 rule 5).
 *
 * ⚠ `component` MUST WORK IN A BOX OF ANY SIZE AND MUST NOT NAVIGATE. It shares
 * the page with other apps, so it lays out by its container's width (container
 * queries, not viewport breakpoints) and moves between its own screens in place.
 * A link to another URL takes the person off the page and closes every app on it.
 */
export interface AppContribution {
  /** Unique across the app; composition throws on a duplicate. Saved in layouts, so never rename one. */
  key: string;
  label: string;
  /** One line, for the app picker. */
  description?: string;
  /** A name from the app's icon set, as `nav.icon` is. */
  icon?: string;
  /**
   * The WORKSPACE-level key that offers the app. REQUIRED, unlike a route's:
   * the page lists only apps the viewer holds, and an app nobody gated would be
   * offered to every member of every workspace. The app's own API still
   * authorises every request — hiding it is the affordance, not the check.
   */
  feature: string;
  /** Where it sits before anybody reorders. Lower is first; space them — 10, 20. */
  order?: number;
  component: ComponentType<AppProps>;
}

/**
 * A SCREEN on the phone layout: one app of a workspace, launched from the Apps
 * tab (or pinned to Home) and shown full screen (issue #22).
 *
 * Opt-in, and deliberately separate from `AppContribution`. A phone gets only
 * what was chosen for it, never every sub-app squeezed onto a small screen, so
 * a module that declares no screen is simply not on phones. The screen may
 * reuse the module's own components (the point of sale's till, without its
 * section bar); it is a smaller selection, not a second copy of the feature.
 *
 * ⚠ The same two rules as a sub-app: it MUST NOT NAVIGATE — the person moves
 * between tabs, and a link away unmounts every screen they had open — and its
 * `feature` is REQUIRED and workspace level. The screen's own API still
 * authorises every request; hiding the tab is the affordance, not the check.
 */
export interface MobileScreenContribution {
  /** Unique across the app; composition throws on a duplicate. Kept in the address (`?screen=`), so never rename one. */
  key: string;
  /** The tile's label, and the title while it is open. Short: a tile is a third of a phone's width. */
  label: string;
  /** A name from the app's icon set, as `nav.icon` is. */
  icon?: string;
  /** The WORKSPACE-level key that offers the screen. See `AppContribution.feature`. */
  feature: string;
  /** Where its tile sits in the Apps launcher. Lower is first; space them — 10, 20. */
  order?: number;
  /**
   * The screen's own sections — Sell, Orders, Customers — drawn by the frame
   * as a strip under the top bar, in this order. The component reads the open
   * one with `useMobileSection()` from `@kwtech/module-kit/react`. Omit for a
   * screen with one view.
   */
  sections?: readonly MobileSectionContribution[];
  component: ComponentType<AppProps>;
}

/**
 * One section of a phone screen, as a chip in the strip under the top bar.
 *
 * `feature` hides it from somebody without the key — a cashier has no Items —
 * as the desktop app hides its own sections. Omit it for a section everybody
 * who holds the screen may open. Hiding is the affordance; the API refuses
 * anyway.
 */
export interface MobileSectionContribution {
  /** Unique within its screen; composition throws on a duplicate. Kept in the address (`?section=`). */
  key: string;
  label: string;
  feature?: string;
}

/**
 * What a module offers the phone layout, exported from its `/mobile` subpath.
 *
 * Much smaller than `WebModuleDescriptor` on purpose: no routes, no drawer, no
 * header tools. The phone layout is for the people who work in a workspace
 * (a seller at the till), not for administering it, and an app composing this
 * list imports none of the modules' desktop pages — which is what keeps the
 * phone's download small.
 */
export interface MobileModuleDescriptor {
  key: string;
  screens?: readonly MobileScreenContribution[];
  /** Administration pages for the phone's Manage tab — see `MobileManageContribution`. */
  manage?: readonly MobileManageContribution[];
  /** Destinations of the phone's bottom bar — Chat, Inbox — see `MobileTabContribution`. */
  tabs?: readonly MobileTabContribution[];
}

/**
 * A DESTINATION on the phone's bottom bar, beside Home, Apps and Manage
 * (issue #22): Chat, the notification Inbox — things that belong to the
 * PERSON, wherever they are, rather than to the workspace that is open.
 *
 * The phone's version of a header tool, and gated the same way: `feature` is
 * filtered with the viewer's APP-level grants, because a person's chat is not
 * a fact about the workspace they happen to be in. Omit it only for a tab
 * every signed-in person may use.
 *
 * ⚠ The bar holds five destinations at most, Home, Apps and Manage among
 * them, so this is for the few things somebody returns to all day — never a
 * way onto the bar for an app.
 *
 * Both components are COMPONENT REFERENCES THAT TAKE NO PROPS, for the reason
 * `HeaderToolContribution.component` is: they cross from a server page.
 */
export interface MobileTabContribution {
  /** Unique across the app; composition throws on a duplicate. Kept in the address (`?tab=`). */
  key: string;
  /** The tab's label: one short word. */
  label: string;
  /** A name from the app's icon set, as `nav.icon` is. */
  icon?: string;
  /** An APP-level key. See above. */
  feature?: string;
  /** Left to right after Apps, before Manage. Space them — 10, 20. */
  order?: number;
  /**
   * The destination, full screen between the bars. Mounted the first time the
   * tab is opened and kept, so a half-written message survives a trip to Home.
   * It must not navigate.
   */
  component: ComponentType;
  /**
   * Drawn on the tab's icon, always mounted — the live unread count. Renders
   * nothing when there is nothing to count. Also the place for whatever must
   * run on every screen for this tab (the notification toasts).
   */
  badge?: ComponentType;
}

/**
 * Which level an administration page changes, and so which grants decide it
 * and which group of the Manage tab it sits in: the workspace that is open,
 * its organization, or the whole platform (`app`, super admins).
 */
export type MobileManageLevel = 'workspace' | 'organization' | 'app';

/** What a Manage page is handed: the place that is open. Null where its level has none. */
export interface MobileManageProps {
  organizationId: string | null;
  workspaceId: string | null;
}

/**
 * An ADMINISTRATION page on the phone's Manage tab (issue #22): members,
 * settings, roles — grouped by `level` and opened full screen with
 * "‹ Manage" to leave.
 *
 * Separate from `MobileScreenContribution` because it answers to a different
 * reader and different grants. An app is for the people who work in a
 * workspace; a Manage page is for the people who run it, and is filtered at
 * ITS level — an organization page by the viewer's grants in the
 * organization, cut down to what its plan includes; a platform page by their
 * app-level grants — the same readings the desktop drawer filters with.
 *
 * ⚠ `feature` is REQUIRED, and must be a key OF `level`: a workspace key on an
 * organization page would be checked against grants that never hold it, and
 * the page would show to nobody. The Manage tab itself appears only when at
 * least one page passes. The page's API authorises every request anyway.
 */
export interface MobileManageContribution {
  /** Unique across the app; composition throws on a duplicate. Kept in the address, so never rename one. */
  key: string;
  label: string;
  /** A name from the app's icon set, as `nav.icon` is. */
  icon?: string;
  level: MobileManageLevel;
  feature: string;
  /** Where it sits within its level's group. Lower is first; space them — 10, 20. */
  order?: number;
  component: ComponentType<MobileManageProps>;
}

export interface WebModuleDescriptor {
  key: string;
  routes?: readonly ModuleRoute[];
  /** Sub-apps for the workspace's Apps page — see `AppContribution`. */
  apps?: readonly AppContribution[];
  /**
   * Controls for the app header. An app that has no header slot ignores them;
   * a module that wants to be reachable there AND in the drawer declares both,
   * which is the module's call to make and usually the wrong one.
   */
  headerTools?: readonly HeaderToolContribution[];
  /**
   * Where this module's nav groups belong, so adopting it stays a one-line edit.
   *
   * Optional: a module that contributes to a group someone else placed — or that
   * does not care — simply omits it and the group sorts after every declared one.
   */
  navGroups?: readonly NavGroupContribution[];
  /** Mounted around the app tree — a module's own React context, if it needs one. */
  Provider?: ComponentType<{ children: React.ReactNode }>;
  features?: readonly FeatureContribution[];
  /** Caps this module declares — see `ServerModuleDescriptor.limits`. */
  limits?: readonly LimitContribution[];
  /** Defaults this module declares — see `ServerModuleDescriptor.defaults`. */
  defaults?: readonly DefaultContribution[];
  /** Moment headings this module contributes — see `ServerModuleDescriptor.defaultMoments`. */
  defaultMoments?: readonly DefaultMomentContribution[];
}

export interface NavEntry {
  group: string;
  order: number;
  label: string;
  href: string;
  icon?: string;
  feature?: string;
  /**
   * The route's `nav.badge`, carried through composition.
   *
   * ⚠ Capitalised because it is rendered — `<entry.Badge />` — and a lowercase
   * name reads as data at every call site that draws it.
   */
  Badge?: ComponentType;
}
