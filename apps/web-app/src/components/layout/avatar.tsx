import { cn } from '@kwtech/web-ui/react';

/**
 * Initials, not a generic person glyph. An avatar's job in a header is to be
 * recognisable at a glance, and every user sharing one silhouette defeats
 * that — two letters do it with no image to upload, store or serve.
 *
 * In a file of its own so the phone layout's account button draws the same
 * avatar without importing the desktop account menu and its dropdown.
 */
export function initialsOf(name: string | null, email: string): string {
  const source = name?.trim() || email.split('@')[0]?.replace(/[._-]+/g, ' ') || '';
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();

  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

export function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/70',
        'font-semibold leading-none tracking-tight text-primary-foreground',
        className,
      )}
    >
      {initials}
    </span>
  );
}
