import { cn } from '@kwtech/web-ui/react';

/**
 * The page's button and input looks, on theme tokens only.
 *
 * Copied structurally from `module-print-studio`'s `controls.tsx`: a module may
 * not import a module (PLAN §9), and `web-ui` has no button of its own yet. It
 * moves there when a decision says so, not on speculation.
 */
export function buttonClass(
  variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'secondary',
  size: 'sm' | 'md' = 'md',
): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-10 px-4 text-sm',
    variant === 'primary' && 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
    variant === 'secondary' && 'border border-border bg-card shadow-xs hover:bg-accent hover:text-accent-foreground',
    variant === 'ghost' && 'hover:bg-accent hover:text-accent-foreground',
    variant === 'danger' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  );
}

export const INPUT_CLASS =
  'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
