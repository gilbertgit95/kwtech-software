'use client';

/**
 * The error and success strips every tenant screen draws.
 *
 * Six copies of the same two paragraphs is how one of them ends up with the
 * wrong role, or a colour that says "fine" about a failure. `role="alert"` and
 * `role="status"` are the part that matters and the part most likely to be
 * dropped when the markup is retyped: the first interrupts a screen reader, the
 * second waits its turn, and getting them the wrong way round either shouts
 * about a rename or silences a refusal.
 */
export function OrganizationNotices({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="mb-4 rounded-md bg-[var(--status-success)] px-3 py-2 text-sm text-[var(--status-success-foreground)]"
        >
          {notice}
        </p>
      ) : null}
    </>
  );
}
