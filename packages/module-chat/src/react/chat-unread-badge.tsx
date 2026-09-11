'use client';

import { useRealtime } from '@kwtech/module-kit/react';
import { cn } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ChatClient, createChatClient } from './chat-client.js';
import { CHAT_EVENTS } from './realtime-documents.js';
import { countWaiting } from './view/conversation-view.js';

/**
 * How much is waiting for you, drawn beside Chat in the side drawer.
 *
 * ## Why this is a component and not a number on the nav entry
 *
 * Because the count has to be right without a navigation. Everything else on a
 * nav entry is a string resolved once on the server, which is correct for
 * exactly as long as it takes somebody else to send a message — and a drawer
 * saying nothing while a message waits is a drawer people stop believing. So
 * this reads once on mount and then follows the app's socket.
 *
 * ⚠ THE APP's socket, through `useRealtime()`, never one of its own. Every
 * module subscribing for itself would mean a WebSocket per module per tab.
 *
 * ## What it does with an event: RE-READS, and does not count
 *
 * Every event — a message, a conversation change, the `sync` that opens every
 * connection — triggers one re-read. Not an increment. Three reasons, and the
 * last settles it:
 *
 *   - The server already computes unread per conversation in one grouped pass,
 *     so the whole badge is one query rather than arithmetic that can drift.
 *   - Counting locally means reimplementing `countsAsUnread` — deleted messages
 *     do not count, your own do not count, a system message does not count — in
 *     a second place, in a language the rule was not written in.
 *   - Re-reading goes back through the GUARDED query, so what lands on screen
 *     is what this reader is allowed to see. One authorization path, not two.
 *
 * ⚠ COALESCED, because a busy conversation would otherwise be one query per
 * message per open tab. A burst collapses into a single re-read a moment later,
 * which is invisible to a reader and is the difference between a badge and a
 * load generator.
 *
 * ## It renders NOTHING when nothing is waiting
 *
 * Not a zero. An empty pill beside an entry is furniture that has to be read
 * before it can be ignored, and the drawer already says the word "Chat".
 */

/** How long a burst of events is allowed to collect before one re-read. */
const COALESCE_MS = 250;

/** Above this the badge stops counting and starts saying "a lot". */
const BADGE_CEILING = 99;

export interface ChatUnreadBadgeProps {
  /** Overridable for tests and for an app that mounts the API elsewhere. */
  client?: ChatClient;
  className?: string;
}

export function ChatUnreadBadge({ client, className }: ChatUnreadBadgeProps) {
  const api = useMemo(() => client ?? createChatClient(), [client]);
  /*
   * Null before mount, and in an app that wired no socket — in which case the
   * badge is the count at page load, which is a worse product and a working
   * one.
   */
  const realtime = useRealtime();

  const [waiting, setWaiting] = useState<{ unread: number; requests: number } | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    api
      .listConversations()
      .then((conversations) => {
        if (cancelled) return;
        /*
         * ⚠ THE SAME RULE THE LIST SPLITS BY, not a second one written here.
         * `countWaiting` is what decides that an invited conversation's unread
         * count does not count — an invited person cannot read the messages, so
         * it would promise a number the thread will not show — and that an
         * archived one is not waiting for anybody. A badge with its own copy of
         * that arithmetic is a badge that eventually disagrees with the screen
         * it sits beside.
         *
         * An invitation still lands in the same NUMBER as an unread message,
         * because both are things waiting for you and two indicators on one row
         * is how people learn to ignore both. The label spells them apart.
         */
        setWaiting(countWaiting(conversations));
      })
      .catch(() => {
        /*
         * ⚠ KEEPS THE LAST KNOWN COUNT rather than dropping to zero. The API
         * being unreachable is not the same as having nothing waiting, and a
         * badge that empties during an outage tells people their messages went
         * away.
         */
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(load, [load]);

  /*
   * One timer for the whole component, cleared on unmount — a pending re-read
   * firing into an unmounted tree is a state update nobody is listening for.
   */
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!realtime) return;

    const unsubscribe = realtime.subscribe(CHAT_EVENTS, () => {
      if (pending.current) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        load();
      }, COALESCE_MS);
    });

    return () => {
      unsubscribe();
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    };
  }, [realtime, load]);

  const count = (waiting?.unread ?? 0) + (waiting?.requests ?? 0);
  if (count === 0) return null;

  return (
    <span
      className={cn(
        'grid h-4 min-w-4 shrink-0 place-items-center rounded-full px-1',
        'bg-primary text-[0.625rem] font-semibold leading-none text-primary-foreground',
        className,
      )}
    >
      {/*
       * The number is decorative; the SENTENCE is the fact.
       *
       * Not `aria-label` on the wrapper — a bare `<span>` has no role, so the
       * attribute is not supported there and a screen reader is free to ignore
       * it. Real text, visually hidden, which also lands inside the drawer's
       * link and becomes part of its accessible name: "Chat, 3 unread
       * messages". And it spells apart what the number deliberately merges.
       */}
      <span aria-hidden>{count > BADGE_CEILING ? `${BADGE_CEILING}+` : count}</span>
      <span className="sr-only">{describe(waiting)}</span>
    </span>
  );
}

function describe(waiting: { unread: number; requests: number } | null): string {
  if (!waiting) return '';
  const parts: string[] = [];
  if (waiting.unread > 0) parts.push(`${waiting.unread} unread ${waiting.unread === 1 ? 'message' : 'messages'}`);
  if (waiting.requests > 0) {
    parts.push(`${waiting.requests} chat ${waiting.requests === 1 ? 'invitation' : 'invitations'}`);
  }
  return parts.join(', ');
}
