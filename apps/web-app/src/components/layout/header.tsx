import type { Viewer } from '@kwtech/module-auth';
import type { HeaderSlot, NavEntry } from '@kwtech/module-kit';
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
 */
export function Header({
  title,
  viewer,
  accountNav,
  roles,
  slots,
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
  /**
   * Controls contributed by the composed modules — chat's icon today, a
   * notification bell later.
   *
   * ⚠ Already FILTERED by the caller's grants (`buildHeaderSlots`), so this
   * renders whatever it is given without asking a second question. Required
   * rather than optional for the same reason `accountNav` is: an empty array
   * already means "nothing to show", and `exactOptionalPropertyTypes` makes an
   * explicit `undefined` a different thing from an absent key.
   */
  slots: readonly HeaderSlot[];
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 sm:px-6">
      <p className="truncate text-sm font-medium text-foreground">{title}</p>

      <div className="flex items-center gap-1.5">
        {/*
          LEFT of the account menu, because this cluster reads right to left:
          the account is who you are, and these are things waiting for you.

          ⚠ RENDERED, never called. Each slot carries a component reference,
          this file is a server component, and calling a client component from
          the server throws — the `ModuleRoute` 500, in a second place.

          It knows nothing about what it is drawing: no module is named here,
          which is the whole point of the contribution.
        */}
        {slots.map(({ key, Component }) => (
          <Component key={key} />
        ))}
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
