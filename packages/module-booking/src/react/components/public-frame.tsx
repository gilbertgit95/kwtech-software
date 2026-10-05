'use client';

import { CalendarCheck } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The frame of a CUSTOMER's page: the shop's name, its note, and one column
 * that reads on a phone — most people open a booking link on one.
 *
 * It is drawn with no app shell around it (the route's chrome is
 * `fullscreen`): a visitor is not signed in, and a drawer of things they
 * cannot open would be noise. `@container`, so the pieces inside lay out by
 * this column and not by the window.
 */
export function PublicFrame({
  title,
  note,
  children,
}: {
  /** The shop's name as it wrote it. Null while it is not known: loading, or no such page. */
  title: string | null;
  note?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-muted/40 px-4 py-6 text-foreground sm:py-10">
      <main className="@container mx-auto flex w-full max-w-xl flex-col gap-4">
        <header className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <CalendarCheck aria-hidden="true" className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-xl font-semibold tracking-tight">{title ?? 'Booking'}</h1>
            {note ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{note}</p> : null}
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

/** One step, or one answer, on a customer's page. */
export function PublicCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
      {title ? <h2 className="text-base font-semibold tracking-tight">{title}</h2> : null}
      {children}
    </section>
  );
}
