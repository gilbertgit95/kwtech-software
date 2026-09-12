'use client';

import { cn } from '@kwtech/web-ui/react';
import { useEffect, useRef, useState } from 'react';
import type { ChatConversationView, ChatDirectoryMatchView, ChatPresenceView } from '../chat-client.js';
import { chatSettingsHref as settingsHref } from '../module.js';
import { conversationTitle, otherParticipants } from '../view/conversation-view.js';
import { isPending, type ThreadMessage } from '../view/message-view.js';
import { MessageComposer } from './message-composer.js';
import { PersonFinder } from './person-finder.js';
import { PresenceDot } from './presence-dot.js';

/**
 * The right column: one conversation, its people, and what was said in it.
 */
export function MessageThread({
  conversation,
  messages,
  olderCursor,
  busy,
  onSend,
  onLoadOlder,
  onDelete,
  onInvite,
  onLeave,
  onFind,
  presence,
  typing,
  onTyping,
}: {
  conversation: ChatConversationView;
  messages: ThreadMessage[] | null;
  olderCursor: string | null;
  busy: boolean;
  onSend: (body: string) => void;
  onLoadOlder: () => void;
  onDelete: (messageId: string) => void;
  onInvite: (userId: string) => void;
  onLeave: () => void;
  onFind: (email: string) => Promise<ChatDirectoryMatchView | null>;
  presence: ReadonlyMap<string, ChatPresenceView>;
  /** Who is writing here right now. Already pruned of stale signals. */
  typing: readonly string[];
  onTyping: () => void;
}) {
  const [inviting, setInviting] = useState(false);
  const names = new Map(conversation.participants.map((participant) => [participant.userId, participant.displayName]));
  const others = conversation.participants.filter((one) => one.userId !== conversation.myUserId);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
            {conversation.isDirect ? <PresenceDot presence={presence.get(others[0]?.userId ?? '')} /> : null}
            {conversationTitle(conversation)}
          </h2>
          {/*
            ⚠ THE GROUP'S DOTS GO HERE, one per name, rather than on the row in
            the list — "who is online" in a group of nine is a row of dots on a
            list row that says nothing and takes the space the name needs. Here
            each dot is attached to the person it describes.
          */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 truncate text-xs text-muted-foreground">
            {others.length === 0 ? 'Only you' : null}
            {conversation.isDirect
              ? null
              : others.map((one) => (
                  <span key={one.userId} className="flex items-center gap-1">
                    <PresenceDot presence={presence.get(one.userId)} />
                    {one.displayName}
                  </span>
                ))}
            {conversation.isDirect ? otherParticipants(conversation).join(', ') : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/*
            ⚠ NO INVITE ON A DIRECT CHAT. Two people are what its `directKey`
            means, and adding a third would leave a conversation whose unique
            key no longer describes who is in it. The server refuses it too —
            this is the affordance agreeing with the rule rather than a second
            copy of it.
          */}
          {!conversation.isDirect ? (
            <button
              type="button"
              onClick={() => setInviting((open) => !open)}
              aria-expanded={inviting}
              className="rounded-md px-2 py-1 text-sm text-primary hover:bg-accent/60"
            >
              Add someone
            </button>
          ) : null}
          {/*
            ⚠ A LINK, NOT A FORM. Renaming arrived here as an inline strip and
            adding people as another; a third for roles and a fourth for
            archiving would have made this a settings screen wearing a thread as
            a hat — with every one of them pushing the newest message down the
            moment somebody opened it.
            
            ⚠ GROUPS ONLY, and not because of a permission: a direct chat has no
            settings at all. It is named by who is in it, cannot take a third
            person, and is not one person's to archive on the other's behalf.
          */}
          {!conversation.isDirect ? (
            <a
              href={settingsHref(conversation.id)}
              className="rounded-md px-2 py-1 text-sm text-primary hover:bg-accent/60"
            >
              Settings
            </a>
          ) : null}
          {/*
            ⚠ LEAVING IS OFFERED ON A GROUP ONLY, and not because of a
            permission: a direct chat cannot be left at all. Its `directKey` is
            unique, so a left participant would make `startDirect` find a row
            they are no longer in — the trap §12 records. Hiding a message
            thread is a different act and is not built yet.
          */}
          {!conversation.isDirect ? (
            <button
              type="button"
              onClick={onLeave}
              disabled={busy}
              className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:opacity-50"
            >
              Leave
            </button>
          ) : null}
        </div>
      </header>

      {inviting ? (
        <div className="border-b border-border bg-card px-4 py-3">
          <PersonFinder
            label="Add somebody by email"
            action="Add"
            busy={busy}
            onFind={onFind}
            onFound={(person) => {
              onInvite(person.userId);
              setInviting(false);
            }}
          />
        </div>
      ) : null}

      <MessageList
        messages={messages}
        viewerId={conversation.myUserId}
        names={names}
        olderCursor={olderCursor}
        onLoadOlder={onLoadOlder}
        onDelete={onDelete}
      />

      {/*
        ⚠ ABOVE the composer and OUTSIDE the scrolling list, so it cannot push
        the newest message out of view as it appears and disappears — which is
        what a typing line inside the thread does, every few seconds, while
        somebody is trying to read.

        It occupies no height when nobody is writing: a permanently reserved
        line is a permanent gap.
      */}
      {typing.length > 0 ? (
        <p aria-live="polite" className="px-4 pb-1 text-xs italic text-muted-foreground">
          {describeTyping(typing, names)}
        </p>
      ) : null}

      <MessageComposer onSend={onSend} onTyping={onTyping} disabled={busy} />
    </div>
  );
}

function MessageList({
  messages,
  viewerId,
  names,
  olderCursor,
  onLoadOlder,
  onDelete,
}: {
  messages: ThreadMessage[] | null;
  viewerId: string;
  names: ReadonlyMap<string, string>;
  olderCursor: string | null;
  onLoadOlder: () => void;
  onDelete: (messageId: string) => void;
}) {
  const bottom = useRef<HTMLDivElement | null>(null);
  const newest = messages?.at(-1)?.id;

  /*
   * ⚠ SCROLLS ON THE NEWEST MESSAGE CHANGING, not on every render.
   *
   * Keyed on the last id so that loading OLDER history — which prepends, and
   * leaves the newest message exactly where it was — does not yank the reader
   * back to the bottom of a thread they just scrolled up through.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id is the signal; the ref is stable.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [newest]);

  if (messages === null) {
    return <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
      {olderCursor ? (
        <div className="mb-3 text-center">
          <button
            type="button"
            onClick={onLoadOlder}
            className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Load earlier messages
          </button>
        </div>
      ) : null}

      {messages.length === 0 ? <p className="text-sm text-muted-foreground">No messages yet. Say something.</p> : null}

      <ul className="space-y-2">
        {messages.map((message) => {
          const mine = message.authorId === viewerId;
          return (
            <li key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[80%] rounded-lg px-3 py-2 text-sm', bubble(message, mine))}>
                {!mine && message.kind === 'user' ? (
                  <p className="mb-0.5 text-xs font-medium text-muted-foreground">
                    {names.get(message.authorId ?? '') ?? 'Someone'}
                  </p>
                ) : null}

                {message.deleted ? (
                  /*
                   * ⚠ A TOMBSTONE, never a removed row. The body is gone — the
                   * server never serves it — and the position stays, because
                   * deleting a row under somebody who is reading shifts
                   * everything below it.
                   */
                  <p className="italic text-muted-foreground">Message deleted</p>
                ) : (
                  // `whitespace-pre-wrap`: people write messages with line
                  // breaks in them, and collapsing those turns a list into a
                  // paragraph. `break-words` stops one long URL widening the
                  // whole column.
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                )}

                <div className="mt-0.5 flex items-center justify-end gap-2 text-[0.625rem] text-muted-foreground">
                  <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
                  {message.editedAt ? <span>edited</span> : null}
                  {/*
                    ⚠ A pending message says so rather than looking sent. The
                    difference between "on its way" and "delivered" is the whole
                    question somebody asks when a network is slow.
                  */}
                  {isPending(message) ? <span>sending…</span> : null}
                  {mine && !message.deleted && !isPending(message) ? (
                    <button
                      type="button"
                      onClick={() => onDelete(message.id)}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div ref={bottom} />
    </div>
  );
}

/**
 * "Ada is typing…", and the plural that stops it being a list of names.
 *
 * Three or more become a count: a thread with eight people writing would
 * otherwise put a paragraph of names where a line belongs, and nobody reads the
 * eighth name.
 */
function describeTyping(typing: readonly string[], names: ReadonlyMap<string, string>): string {
  const people = typing.map((userId) => names.get(userId) ?? 'Someone');
  if (people.length === 1) return `${people[0]} is typing…`;
  if (people.length === 2) return `${people[0]} and ${people[1]} are typing…`;
  return `${people.length} people are typing…`;
}

function bubble(message: ThreadMessage, mine: boolean): string {
  if (message.kind === 'system') return 'bg-muted text-muted-foreground';
  if (isPending(message)) return 'bg-primary/70 text-primary-foreground';
  return mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground';
}

/**
 * The time of day, in the reader's own locale.
 *
 * Not a relative "3 minutes ago": that needs a ticking timer per message to
 * stay true, and a thread full of them re-renders every minute forever. The
 * full timestamp is on the `<time>` element for anybody who hovers.
 */
function clock(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
