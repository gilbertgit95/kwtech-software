import type { AppRole } from '@kwtech/module-permissions';
import { cn } from '@kwtech/web-ui/react';
import { iconFor } from '@/components/layout/nav-icons';

/**
 * Who someone is on the platform: the role's icon beside their name, and
 * nothing else — no label, no pill, no colour of its own.
 *
 * APP-level roles only, which is decided upstream on the permission context —
 * an organization role is true only inside one organization, and a badge in the
 * page furniture is the last thing anyone re-reads after switching.
 *
 * ## The name is carried, not drawn
 *
 * The name is still the only thing that says what the picture MEANS, so it is
 * attached rather than dropped: `role="img"` plus `aria-label` gives the icon an
 * accessible name, and `title` surfaces the same string on hover. Both are
 * invisible until asked for. Dropping it outright would leave a screen-reader
 * user with an unlabelled graphic and everyone else with a glyph they can only
 * guess at — a crown reads as rank, but a briefcase and a sprout do not
 * announce themselves.
 *
 * ## No colour of its own, deliberately
 *
 * A crown could be gold and a sprout green. It is not done, because a role's
 * rights are the list of features it carries and nothing else: styling one
 * badge as more important would be a second account of authority that no check
 * reads and nothing keeps true. The icon distinguishes the roles; the styling
 * must not imply a rank the data does not carry.
 */
export function RoleBadge({ role, className }: { role: AppRole; className?: string }) {
  // `?? undefined` because `iconFor` takes an optional name and the column is
  // nullable — two spellings of absent, and the seam is the place to collapse
  // them rather than every caller.
  const Icon = iconFor(role.icon ?? undefined);

  return (
    <Icon role="img" aria-label={role.label} className={cn('size-4 shrink-0 text-muted-foreground', className)}>
      {/*
        The same string twice, and both earn their place: `aria-label` is what a
        screen reader announces, `<title>` inside the SVG is what a mouse gets on
        hover. Neither substitutes for the other.
      */}
      <title>{role.label}</title>
    </Icon>
  );
}
