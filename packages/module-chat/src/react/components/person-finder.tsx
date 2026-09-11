'use client';

import { cn } from '@kwtech/web-ui/react';
import { type FormEvent, useState } from 'react';
import type { ChatDirectoryMatchView } from '../chat-client.js';

/**
 * Finding somebody by their email address — the only way to reach a person in
 * this product who is not already in a conversation with you.
 *
 * ⚠ EXACT MATCH, ONE ADDRESS AT A TIME, and that is a security decision rather
 * than a lazy search box. A prefix or substring search over the user table is a
 * customer-list harvester for anybody holding `chat:directory`. This asks one
 * question — "does THIS address have an account" — which is the least it can do
 * and still let somebody start a conversation.
 *
 * ⚠ A MISS AND A BLOCK ARE THE SAME ANSWER, decided server-side and repeated
 * here in the wording: "No account with that address." A distinct "you have
 * been blocked" is a notification to the blocked person that tells them exactly
 * what they wanted to know.
 */
export function PersonFinder({
  onFind,
  onFound,
  busy,
  label = 'Email address',
  action = 'Find',
}: {
  onFind: (email: string) => Promise<ChatDirectoryMatchView | null>;
  onFound: (person: ChatDirectoryMatchView) => void;
  busy?: boolean;
  label?: string;
  action?: string;
}) {
  const [email, setEmail] = useState('');
  const [searching, setSearching] = useState(false);
  const [missed, setMissed] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) return;

    setSearching(true);
    setMissed(false);
    const person = await onFind(address);
    setSearching(false);

    if (!person) {
      setMissed(true);
      return;
    }
    // Cleared on a HIT only: a typo stays on screen to be corrected, which is
    // the one case somebody wants the text back.
    setEmail('');
    onFound(person);
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm font-medium text-foreground" htmlFor="chat-person-email">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id="chat-person-email"
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setMissed(false);
          }}
          placeholder="someone@example.com"
          className={cn(
            'min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        />
        <button
          type="submit"
          disabled={searching || busy || email.trim() === ''}
          className={cn(
            'shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground',
            'disabled:opacity-50',
          )}
        >
          {searching ? 'Looking…' : action}
        </button>
      </div>
      {missed ? (
        <p className="text-sm text-muted-foreground">
          No account with that address. Check the spelling, or ask them to sign up first.
        </p>
      ) : null}
    </form>
  );
}
