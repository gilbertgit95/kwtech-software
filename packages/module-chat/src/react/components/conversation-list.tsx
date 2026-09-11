'use client';

import { cn } from '@kwtech/web-ui/react';
import type { ChatConversationView } from '../chat-client.js';
import { conversationTitle, otherParticipants, splitConversations } from '../view/conversation-view.js';

/**
 * The left column: what is waiting for an answer, then what you can open.
 *
 * ⚠ TWO SECTIONS, NOT ONE SORTED LIST — see `splitConversations`. An invitation
 * is a question addressed to you, and you cannot read a word of it until you
 * answer, so a row that opened onto nothing would behave differently from every
 * row around it.
 */
export function ConversationList({
  conversations,
  selectedId,
  onOpen,
  onRespond,
  onStartNew,
  starting,
  busy,
}: {
  conversations: ChatConversationView[] | null;
  selectedId: string | null;
  onOpen: (conversationId: string) => void;
  onRespond: (conversationId: string, accept: boolean) => void;
  onStartNew: () => void;
  /** Whether the "new conversation" pane is the thing on screen. */
  starting: boolean;
  busy: boolean;
}) {
  const { active, requests } = splitConversations(conversations ?? []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col border-border sm:w-72 sm:border-r">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium text-foreground">Conversations</h2>
        <button
          type="button"
          onClick={onStartNew}
          disabled={busy}
          aria-pressed={starting}
          className={cn(
            'rounded-md px-2 py-1 text-sm font-medium',
            starting ? 'bg-accent text-accent-foreground' : 'text-primary hover:bg-accent/60',
            'disabled:opacity-50',
          )}
        >
          New
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {conversations === null ? <p className="px-1 py-2 text-sm text-muted-foreground">Loading…</p> : null}

        {requests.length > 0 ? (
          <section className="mb-3">
            {/*
              ⚠ NAMED, not merely separated by a rule. "Requests" is what tells
              somebody why these rows have two buttons instead of being
              clickable, and why they show no preview — §12.51 records what
              showing one would cost.
            */}
            <h3 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Requests</h3>
            <ul className="space-y-1">
              {requests.map((conversation) => (
                <li key={conversation.id} className="rounded-lg border border-border px-2 py-2">
                  <p className="truncate text-sm font-medium text-foreground">{conversationTitle(conversation)}</p>
                  <p className="truncate text-xs text-muted-foreground">{invitedBy(conversation)}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onRespond(conversation.id, true)}
                      disabled={busy}
                      className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => onRespond(conversation.id, false)}
                      disabled={busy}
                      className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <ul className="space-y-1">
          {active.map((conversation) => {
            const selected = conversation.id === selectedId;
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onOpen(conversation.id)}
                  aria-current={selected ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                    selected
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">{conversationTitle(conversation)}</span>
                    {!conversation.isDirect ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {otherParticipants(conversation).join(', ') || 'Only you'}
                      </span>
                    ) : null}
                  </span>
                  {conversation.unread > 0 ? (
                    <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-primary px-1 text-[0.625rem] font-semibold leading-none text-primary-foreground">
                      <span aria-hidden>{conversation.unread > 99 ? '99+' : conversation.unread}</span>
                      <span className="sr-only">{conversation.unread} unread</span>
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        {conversations !== null && active.length === 0 && requests.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">
            No conversations yet. “New” starts one with anybody whose email address you know.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Who is asking, on a request row.
 *
 * ⚠ It says the CONVERSATION's shape rather than naming the inviter, because
 * the invitation does not carry one: `invitedById` is on the participant row
 * and the list does not serve it. Naming somebody who is merely present would
 * be a guess, and a wrong guess about who invited you into a group is worse
 * than not saying.
 */
function invitedBy(conversation: ChatConversationView): string {
  const others = otherParticipants(conversation);
  if (conversation.isDirect) return 'Wants to start a conversation';
  return others.length > 0 ? `Group with ${others.join(', ')}` : 'Group invitation';
}
