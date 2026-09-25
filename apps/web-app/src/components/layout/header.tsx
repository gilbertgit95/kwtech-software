import type { Viewer } from '@kwtech/module-auth';
import type { HeaderToolContribution, NavEntry } from '@kwtech/module-kit';
import type { AppRole } from '@kwtech/module-permissions';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { UserMenu } from '@/components/layout/user-menu';

/**
 * The main header: where you are on the left, who you are on the right.
 *
 * A server component. Both controls inside it are client components, and that
 * is the whole boundary — the header itself ships no JavaScript.
 *
 * The title comes from the caller rather than from `usePathname`, because the
 * name of a module route lives in its descriptor (`ModuleRoute.title`) and the
 * catch-all already has it in hand. Deriving it from the URL a second time
 * would be a second source of truth for the same string.
 *
 * ## The tools slot
 *
 * Left of the account menu, a row of module-contributed TOOLS — chat's inbox
 * today. The header draws each tool's component and knows nothing about what
 * it does; which tools appear, and in what order, is the modules' declaration
 * filtered by the viewer's grants (`buildHeaderTools`).
 */
export function Header({
  title,
  viewer,
  accountNav,
  roles,
  tools,
}: {
  title: string;
  viewer: Viewer;
  /**
   * The `Account` nav group, rendered inside the menu rather than the drawer.
   *
   * Required, not optional: the shell always has it, and `exactOptionalPropertyTypes`
   * makes an explicit `undefined` a different thing from an absent key — so an
   * optional prop here could not be forwarded to an optional prop there without
   * a cast. An empty array already means "nothing to show".
   */
  accountNav: readonly NavEntry[];
  /** The caller's app-level roles, for the badge beside their name. */
  roles: readonly AppRole[];
  /** Already filtered and ordered, from `buildHeaderTools`. Empty draws nothing. */
  tools: readonly HeaderToolContribution[];
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 sm:px-6">
      <p className="truncate text-sm font-medium text-foreground">{title}</p>

      <div className="flex items-center gap-1.5">
        {tools.length > 0 ? (
          <>
            {/*
              ⚠ RENDERED, never called: each is a client component reference
              that crossed from a module's descriptor, and a server component
              can only render one.
            */}
            <div className="flex items-center gap-0.5">
              {tools.map((tool) => (
                <tool.component key={tool.key} />
              ))}
            </div>
            <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
          </>
        ) : null}
        <UserMenu
          name={viewer.displayName ?? viewer.username}
          email={viewer.email}
          accountNav={accountNav}
          roles={roles}
        />
        {/* A hairline between the two: they are unrelated actions that would
            otherwise read as one segmented group. */}
        <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
        <ThemeToggle className="focus-visible:ring-offset-card" />
      </div>
    </header>
  );
}
