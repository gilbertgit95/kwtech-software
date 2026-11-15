'use client';

import { cn } from '@kwtech/web-ui/react';

export type FileButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** The app's buttons, one function over a union (no CVA). */
export function buttonClass(variant: FileButtonVariant, className?: string): string {
  return cn(
    'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    variant === 'primary' && 'bg-primary text-primary-foreground hover:bg-primary/90',
    variant === 'secondary' && 'border border-border bg-card hover:bg-accent',
    variant === 'ghost' && 'text-muted-foreground hover:bg-accent hover:text-foreground',
    variant === 'danger' && 'text-destructive hover:bg-destructive/10',
    className,
  );
}
