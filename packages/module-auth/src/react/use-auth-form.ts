'use client';

import { type FormEvent, useCallback, useState } from 'react';

/**
 * The submit/pending/error cycle all three pages share.
 *
 * Extracted because the interesting part is the same every time and getting it
 * subtly different per form is how a double-submit ships: `pending` is set
 * before the await and cleared in a finally, so a slow network cannot produce
 * two sign-ins from one click.
 */
export interface AuthFormState {
  pending: boolean;
  error: string | null;
  done: boolean;
}

export function useAuthForm(submit: (form: FormData) => Promise<void>) {
  const [state, setState] = useState<AuthFormState>({ pending: false, error: null, done: false });

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      // Guarding on the current value rather than disabling the button alone:
      // the button can be re-enabled by an extension, Enter can outrun a
      // re-render, and the cost of a duplicate sign-in is a duplicate session.
      if (state.pending) return;

      const form = new FormData(event.currentTarget);
      setState({ pending: true, error: null, done: false });
      try {
        await submit(form);
        setState({ pending: false, error: null, done: true });
      } catch (error) {
        setState({
          pending: false,
          // Whatever the server said, and nothing invented locally: the server
          // is deliberately vague on this path and a "helpful" client-side
          // guess would undo that.
          error: error instanceof Error ? error.message : 'Something went wrong. Please try again.',
          done: false,
        });
      }
    },
    [state.pending, submit],
  );

  return { ...state, onSubmit };
}
