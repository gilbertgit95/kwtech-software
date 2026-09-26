'use client';

import { cn, useIconSet } from '@kwtech/web-ui/react';
import { useEffect, useState } from 'react';

/**
 * Small pieces the Apps page shares. Styled with theme tokens only, so every
 * theme and dark mode apply without this module knowing they exist.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export function buttonClass(variant: ButtonVariant = 'secondary', size: 'sm' | 'md' = 'md'): string {
  return cn(
    'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    size === 'sm' ? 'h-7 px-2 text-xs' : 'h-9 px-3 text-sm',
    variant === 'primary' && 'bg-primary text-primary-foreground hover:bg-primary/90',
    variant === 'secondary' && 'border border-border bg-background text-foreground hover:bg-muted',
    variant === 'ghost' && 'text-muted-foreground hover:bg-muted hover:text-foreground',
  );
}

export const selectClass =
  'h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

/** An app's icon from the app's icon set, or nothing — a missing name must not break a tab. */
export function AppIcon({ name, className }: { name: string | null; className?: string }) {
  const icons = useIconSet();
  const Icon = name ? icons?.find((option) => option.name === name)?.Icon : undefined;
  return Icon ? <Icon aria-hidden className={cn('size-4 shrink-0', className)} /> : null;
}

/**
 * Whether the screen is wide enough for the grid. Below it the page shows the
 * tab view (APP-HUB-PLAN §4) — six apps in a phone's width are six unusable ones.
 *
 * False on the server and on the first client render, so the markup matches;
 * the grid appears a frame later on a wide screen.
 */
export function useWideScreen(query = '(min-width: 768px)'): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return wide;
}
