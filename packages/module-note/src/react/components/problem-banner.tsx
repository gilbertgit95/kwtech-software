'use client';

import type { NotesState } from '../use-notes.js';

/**
 * What the person must decide about the open note — shown above the page, not
 * in a dialog, so it never blocks the other apps on the Apps page.
 *
 * ⚠ EVERY CHOICE THAT WOULD LOSE TEXT HAS ONE THAT DOES NOT BESIDE IT. "Keep
 * mine as a copy" saves what is on screen as a new private note, whatever
 * happened to the original (NOTE-PLAN §9).
 */
export function ProblemBanner({ state }: { state: NotesState }) {
  const { editor } = state;
  const problem = editor.problem;
  if (!problem) return null;

  const hasText = editor.status !== 'saved';

  switch (problem.kind) {
    case 'conflict':
      return (
        <Banner tone="warning">
          <p>
            {problem.theirs.updatedByName ?? 'Somebody'} changed this note while you were editing it. Nothing is lost
            yet — choose which to keep.
          </p>
          <Actions>
            <Action onClick={() => void editor.keepMineAsCopy()} primary>
              Keep mine as a copy
            </Action>
            <Action onClick={editor.takeTheirs}>Use theirs</Action>
            {state.canWrite ? <Action onClick={() => void editor.overwriteTheirs()}>Overwrite theirs</Action> : null}
          </Actions>
        </Banner>
      );
    case 'gone':
      return (
        <Banner tone="warning">
          <p>
            This note was deleted, or it is no longer shared with you.
            {hasText ? ' What you wrote since your last save is still here.' : ''}
          </p>
          <Actions>
            {hasText && state.canWrite ? (
              <Action onClick={() => void editor.keepMineAsCopy()} primary>
                Keep mine as a copy
              </Action>
            ) : null}
            <Action onClick={editor.takeTheirs}>{hasText ? 'Discard it' : 'Close'}</Action>
          </Actions>
        </Banner>
      );
    case 'invalid':
      return (
        <Banner tone="warning">
          <p>{problem.message} Not saved until it is fixed.</p>
        </Banner>
      );
    case 'error':
      return (
        <Banner tone="error">
          <p>{problem.message}</p>
          <Actions>
            <Action onClick={editor.dismissProblem}>Dismiss</Action>
          </Actions>
        </Banner>
      );
  }
}

function Banner({ tone, children }: { tone: 'warning' | 'error'; children: React.ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={
        tone === 'error'
          ? 'mx-3 mt-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 font-sans text-sm'
          : 'mx-3 mt-1 rounded-md border border-border bg-muted px-2 py-1.5 font-sans text-sm'
      }
    >
      {children}
    </div>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>;
}

function Action({ onClick, primary, children }: { onClick: () => void; primary?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? 'rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
          : 'rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
      }
    >
      {children}
    </button>
  );
}
