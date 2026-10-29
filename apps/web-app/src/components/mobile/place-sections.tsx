'use client';

import { cn } from '@kwtech/web-ui/react';
import { Building2, Check, ChevronRight, Layers, LoaderCircle } from 'lucide-react';
import Link, { useLinkStatus } from 'next/link';
import type { ReactNode } from 'react';

/**
 * The two levels a person moves between on a phone, drawn so they cannot be
 * mistaken for one another (issue #22): a WORKSPACE is where they work, inside
 * an ORGANIZATION, the company it belongs to.
 *
 * One list of rows with a heading each read as one list (reported by the
 * operator, 2026-10-29). Each level is now its own card on its own VIEW — its
 * own icon, a title that names the level, a line saying what it holds — and
 * never shares the screen with the other: choosing an organization slides on
 * to its workspaces. The current place is marked "Current", so the reader sees
 * where they are before choosing where to go.
 *
 * Shared by the switcher sheet and the picker page, so the two draw exactly
 * the same thing. A row that goes somewhere is a `next/link`: the next page
 * arrives without a full reload, and the tapped row shows a spinner until it
 * does — a tap that seems to do nothing for a second is a tap people repeat.
 */
export type PlaceLevel = 'workspace' | 'organization';

const LEVEL_ICON: Record<PlaceLevel, typeof Layers> = { workspace: Layers, organization: Building2 };

export function PlaceSection({
  level,
  title,
  caption,
  children,
}: {
  level: PlaceLevel;
  title: string;
  /** What the list holds, in a sentence: "In Kwtech Group", "Choose one to see its workspaces". */
  caption: string;
  children: ReactNode;
}) {
  const Icon = LEVEL_ICON[level];
  return (
    <section
      aria-label={title}
      className="animate-in fade-in slide-in-from-bottom-2 overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm duration-300 motion-reduce:animate-none"
    >
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <span
          aria-hidden
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-xl',
            level === 'workspace'
              ? 'bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-sm'
              : 'bg-muted text-foreground',
          )}
        >
          <Icon className="size-[1.125rem]" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{caption}</p>
        </div>
      </header>
      <ul className="space-y-1 px-2 pb-2">{children}</ul>
    </section>
  );
}

export function PlaceRow({
  level,
  href,
  onClick,
  name,
  detail,
  current = false,
}: {
  level: PlaceLevel;
  /** A link to the place. Or `onClick`, for a row that moves the switcher on instead (an organization). */
  href?: string;
  onClick?: () => void;
  name: string;
  /** The viewer's role there. */
  detail?: string | null;
  current?: boolean;
}) {
  const Icon = LEVEL_ICON[level];
  const className = cn(
    'flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all active:scale-[0.99] active:bg-accent',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    current ? 'bg-primary/8 ring-1 ring-primary/20 ring-inset' : 'hover:bg-accent/60',
  );
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-2xl text-base font-semibold',
          current ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground',
        )}
      >
        {current ? <Check className="size-5" /> : <Icon className="size-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-medium text-card-foreground">{name}</span>
        {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      {current ? (
        <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[0.6875rem] font-semibold text-primary-foreground">
          Current
        </span>
      ) : null}
      {/* A row that leads somewhere further says so, the current one included: an organization opens its workspaces. */}
      {onClick ? <Chevron /> : null}
      {!onClick && !current ? <LinkPending /> : null}
    </>
  );

  return (
    <li>
      {onClick ? (
        <button type="button" onClick={onClick} aria-current={current ? 'true' : undefined} className={className}>
          {body}
        </button>
      ) : (
        <Link href={href ?? '/'} aria-current={current ? 'page' : undefined} className={className}>
          {body}
        </Link>
      )}
    </li>
  );
}

function Chevron() {
  return <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
}

/** The chevron, or a spinner while this row's link is loading. `useLinkStatus` reads the nearest `Link`. */
function LinkPending() {
  const { pending } = useLinkStatus();
  return pending ? (
    <LoaderCircle role="status" aria-label="Opening…" className="size-4 shrink-0 animate-spin text-primary" />
  ) : (
    <Chevron />
  );
}
