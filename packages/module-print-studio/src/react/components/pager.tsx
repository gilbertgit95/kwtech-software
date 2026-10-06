'use client';

import { cn } from '@kwtech/web-ui/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { pagerItems } from '../view/pager.js';

/**
 * Previous, the page numbers (`pagerItems`: at most seven, with "…" for the
 * rest), and next. For the Print screen's pages and a document's sheets alike.
 */
export function Pager({
  count,
  current,
  noun,
  onChange,
}: {
  count: number;
  current: number;
  /** What is being paged, for its name: "Page", "Sheet". */
  noun: string;
  onChange: (index: number) => void;
}) {
  const button =
    'flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';
  return (
    <nav aria-label={`${noun}s`} className="flex items-center gap-0.5">
      <button
        type="button"
        aria-label={`Previous ${noun.toLowerCase()}`}
        className={cn(button, 'hover:bg-accent')}
        disabled={current <= 0}
        onClick={() => onChange(current - 1)}
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </button>
      {pagerItems(count, current).map((item) =>
        item.kind === 'gap' ? (
          <span key={item.key} aria-hidden="true" className="w-6 text-center text-xs text-muted-foreground">
            …
          </span>
        ) : (
          <button
            key={item.index}
            type="button"
            aria-label={`${noun} ${item.index + 1} of ${count}`}
            aria-current={item.index === current ? 'page' : undefined}
            className={cn(
              button,
              item.index === current ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-accent',
            )}
            onClick={() => onChange(item.index)}
          >
            {item.index + 1}
          </button>
        ),
      )}
      <button
        type="button"
        aria-label={`Next ${noun.toLowerCase()}`}
        className={cn(button, 'hover:bg-accent')}
        disabled={current >= count - 1}
        onClick={() => onChange(current + 1)}
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
    </nav>
  );
}
