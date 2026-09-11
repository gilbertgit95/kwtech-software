'use client';

import { cn } from '@kwtech/web-ui/react';
import { useState } from 'react';
import type { ChatDirectoryMatchView } from '../chat-client.js';
import { PersonFinder } from './person-finder.js';

/**
 * Starting a conversation.
 *
 * ⚠ A PANE, NOT A MODAL. Finding somebody is a small search that can miss, be
 * retried and collect several people before it finishes — a dialog over the
 * thread would trap focus around a task with no natural end, and at phone width
 * a modal covering a 400px screen is the screen. It takes the place of the
 * thread and gives it back the moment a conversation exists.
 *
 * ⚠ ONE PANE FOR BOTH KINDS, decided by how many people are in it rather than
 * by a toggle the reader has to understand first. One person is a direct chat;
 * two or more is a group and needs a name. That is exactly the distinction the
 * schema makes — a direct chat is a group of two with a `directKey` — so the
 * form asks the same question the data does.
 */
export function NewConversation({
  busy,
  onFind,
  onStartDirect,
  onStartGroup,
  onCancel,
}: {
  busy: boolean;
  onFind: (email: string) => Promise<ChatDirectoryMatchView | null>;
  onStartDirect: (userId: string) => void;
  onStartGroup: (title: string, userIds: readonly string[]) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<ChatDirectoryMatchView[]>([]);
  const [title, setTitle] = useState('');

  const isGroup = chosen.length > 1;
  const ready = chosen.length > 0 && (!isGroup || title.trim() !== '');

  function add(person: ChatDirectoryMatchView) {
    // Silently ignored rather than refused: adding the same address twice is a
    // slip, and an error message about it is a scolding for nothing.
    setChosen((current) => (current.some((one) => one.userId === person.userId) ? current : [...current, person]));
  }

  function start() {
    if (!ready) return;
    const [first] = chosen;
    if (!isGroup && first) {
      /*
       * ⚠ `startDirect` is IDEMPOTENT server-side: messaging somebody you have
       * messaged before re-opens the existing conversation rather than making a
       * second one. So this button is safe to press twice and needs no "you
       * already have a chat with them" check of its own.
       */
      onStartDirect(first.userId);
      return;
    }
    onStartGroup(
      title.trim(),
      chosen.map((person) => person.userId),
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium text-foreground">New conversation</h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        >
          Cancel
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
        <PersonFinder busy={busy} onFind={onFind} onFound={add} label="Who do you want to talk to?" action="Add" />

        {chosen.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">
              {isGroup ? `${chosen.length} people` : chosen[0]?.displayName}
            </h3>
            <ul className="flex flex-wrap gap-2">
              {chosen.map((person) => (
                <li
                  key={person.userId}
                  className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs"
                >
                  <span>{person.displayName}</span>
                  <button
                    type="button"
                    onClick={() => setChosen((current) => current.filter((one) => one.userId !== person.userId))}
                    aria-label={`Remove ${person.displayName}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/*
          ⚠ The name appears only once it is NEEDED — at two people — rather
          than sitting empty beside a one-to-one chat that has no name to store.
          A direct chat is named by who is in it, which is why `title` is
          nullable in the schema at all.
        */}
        {isGroup ? (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground" htmlFor="chat-group-title">
              Name this group
            </label>
            <input
              id="chat-group-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Standup"
              className={cn(
                'w-full rounded-md border border-border bg-background px-3 py-2 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            />
            {/*
              ⚠ Says the cap exists WITHOUT claiming a number: how many groups
              somebody may start comes from their role, and this package cannot
              read it. The refusal, when it comes, arrives from the server with
              the real limit in it.
            */}
            <p className="text-xs text-muted-foreground">
              How many groups you can start depends on your role. Archiving one you created frees a place.
            </p>
          </div>
        ) : null}

        <button
          type="button"
          onClick={start}
          disabled={!ready || busy}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isGroup ? 'Create group' : 'Start chat'}
        </button>
      </div>
    </div>
  );
}
