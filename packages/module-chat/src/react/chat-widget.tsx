'use client';

import { useRealtime } from '@kwtech/module-kit/react';
import { cn, useIconSet } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ChatClient, createChatClient } from './chat-client.js';
import { CHAT_EVENTS } from './realtime-documents.js';

/**
 * The chat control in the app's main header.
 *
 * ## Why it is a CLIENT component, and why it subscribes
 *
 * Because the badge has to be right BEFORE anybody opens anything. A count
 * rendered on the server is correct for exactly as long as it takes somebody
 * else to send a message, and a person looking at a "0" while a message waits
 * for them will not trust the number again. So it reads once on mount and then
 * follows the socket.
 *
 * ## What it does with an event: RE-READS, and does not count
 *
 * Every event — a message, a conversation change, the `sync` that opens every
 * connection — triggers one re-read of the conversation list. Not an increment.
 * Three reasons, and the last is the one that settles it:
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
 */

/** How long a burst of events is allowed to collect before one re-read. */
const COALESCE_MS = 250;

/** Above this the badge stops counting and starts saying "a lot". */
const BADGE_CEILING = 99;

export interface ChatWidgetProps {
  /** Overridable for tests and for an app that mounts the API elsewhere. */
  client?: ChatClient;
  /** Where the icon goes. The app owns its URLs; this is only the default. */
  href?: string;
  className?: string;
}

export function ChatWidget({ client, href = '/chat', className }: ChatWidgetProps) {
  const api = useMemo(() => client ?? createChatClient(), [client]);
  /*
   * The APP's connection, never one of this module's own. Null before mount and
   * in an app that wired no socket — in which case the badge is simply the
   * count at page load, which is a worse product and a working one.
   */
  const realtime = useRealtime();

  const [waiting, setWaiting] = useState<{ unread: number; requests: number } | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    api
      .listConversations()
      .then((conversations) => {
        if (cancelled) return;
        setWaiting({
          /*
           * ⚠ ACTIVE conversations only. An invited person cannot read the
           * messages, so counting them would promise a number the thread will
           * not show — and the server reports `unread: 0` for them anyway.
           */
          unread: conversations
            .filter((conversation) => conversation.myStatus === 'active' && !conversation.archived)
            .reduce((total, conversation) => total + conversation.unread, 0),
          /*
           * An invitation is a thing waiting for you, so it belongs in the same
           * badge rather than in a second one on the same icon — two indicators
           * on one control is how people learn to ignore both. The label spells
           * the two apart for anybody who cannot see the difference.
           */
          requests: conversations.filter((conversation) => conversation.myStatus === 'invited').length,
        });
      })
      .catch(() => {
        /*
         * ⚠ KEEPS THE LAST KNOWN COUNT rather than showing zero. The API being
         * unreachable is not the same as having nothing waiting, and a badge
         * that empties during an outage tells people their messages went away.
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

  return (
    <a
      href={href}
      aria-label={describe(waiting)}
      className={cn(
        'group relative grid size-9 place-items-center rounded-full text-muted-foreground',
        'transition-colors hover:bg-accent hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      <ChatIcon />
      {count > 0 ? (
        <span
          // `aria-hidden`: the count is already in the link's label, and a
          // screen reader announcing "3" beside "3 unread messages" reads as
          // two separate facts.
          aria-hidden
          className={cn(
            'absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1',
            'bg-primary text-[0.625rem] font-semibold leading-none text-primary-foreground',
          )}
        >
          {count > BADGE_CEILING ? `${BADGE_CEILING}+` : count}
        </span>
      ) : null}
    </a>
  );
}

/**
 * What the icon is called out loud.
 *
 * ⚠ Spells the two kinds apart, which the badge deliberately does not: one
 * number is the right control and two sentences are the right label, because a
 * reader who cannot see the icon has no other way to tell an invitation from a
 * message.
 */
function describe(waiting: { unread: number; requests: number } | null): string {
  if (!waiting) return 'Chat';
  const parts: string[] = [];
  if (waiting.unread > 0) parts.push(`${waiting.unread} unread ${waiting.unread === 1 ? 'message' : 'messages'}`);
  if (waiting.requests > 0) {
    parts.push(`${waiting.requests} ${waiting.requests === 1 ? 'invitation' : 'invitations'}`);
  }
  return parts.length > 0 ? `Chat — ${parts.join(', ')}` : 'Chat';
}

/**
 * The app's own `message` icon when it published one, and a drawn fallback when
 * it did not.
 *
 * The same arrangement every icon in this repo uses: the app names what its
 * icons DRAW and the packages only handle names. ⚠ But a missing icon set must
 * not leave an empty circle in the header — this control is the only way into
 * chat, so it degrades to a plain shape rather than to nothing, which is the
 * rule the plans grid's icon column already follows.
 */
function ChatIcon() {
  const iconSet = useIconSet();
  const Icon = useMemo(() => iconSet?.find((option) => option.name === 'message')?.Icon, [iconSet]);

  if (Icon) return <Icon className="size-[1.05rem]" />;
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-[1.05rem]">
      <title>Chat</title>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
    </svg>
  );
}
