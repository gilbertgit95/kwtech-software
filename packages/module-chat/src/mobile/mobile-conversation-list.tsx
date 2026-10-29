'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { cn, LIST_ITEM, LIST_KEYS } from '@kwtech/web-ui/react';
import { AVAILABILITY_ORDER } from '../domain/availability.js';
import { CHAT_FEATURE } from '../feature-keys.js';
import type { ChatConversationView, ChatMyAvailabilityView, ChatPresenceView } from '../react/chat-client.js';
import {
  AVAILABILITY_DURATIONS,
  AVAILABILITY_LABELS,
  availabilityClock,
} from '../react/components/availability-picker.js';
import { invitedBy, previewOf } from '../react/components/conversation-list.js';
import { PresenceDot } from '../react/components/presence-dot.js';
import { conversationTitle, otherParticipants, splitConversations } from '../react/view/conversation-view.js';

/**
 * The conversation list on the phone's Chat tab (issue #22), laid out for a
 * phone — the desktop's narrow side column was what looked off there
 * (reported by the operator, 2026-10-29).
 *
 * The same data and the same rules as `ConversationList`:
 *
 *   - "New" only for somebody holding `chat:start` — a role may read chats it
 *     may not open (hiding is the affordance; the API refuses anyway);
 *   - invitations apart, as Requests, with Accept and Decline, and the ONE
 *     first message the API sends for them (§12.51);
 *   - an active conversation shows no message text: the API sends none for
 *     it, because its thread is read directly. A row is who, when, and how
 *     many unread.
 *
 * Laid out as a phone list: a heading with a round New button, availability
 * as a pill that opens the phone's own picker, and rows with an avatar, the
 * presence dot on it, the last activity's time and the unread count.
 */
export function MobileConversationList({
  conversations,
  onOpen,
  onRespond,
  onStartNew,
  busy,
  presence,
  myAvailability,
  onAvailabilityChange,
}: {
  conversations: ChatConversationView[] | null;
  onOpen: (conversationId: string) => void;
  onRespond: (conversationId: string, accept: boolean) => void;
  onStartNew: () => void;
  busy: boolean;
  presence: ReadonlyMap<string, ChatPresenceView>;
  myAvailability: ChatMyAvailabilityView | null;
  onAvailabilityChange: (availability: string, forMinutes: number | null) => void;
}) {
  const { active, requests } = splitConversations(conversations ?? []);
  const canStart = useHoldsFeature(CHAT_FEATURE.start);
  const now = new Date();

  const dotFor = (conversation: ChatConversationView) =>
    conversation.isDirect
      ? presence.get(conversation.participants.find((one) => one.userId !== conversation.myUserId)?.userId ?? '')
      : undefined;

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 pt-5 pb-10">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground">Chats</h1>
          <AvailabilityPills mine={myAvailability} busy={busy} onChange={onAvailabilityChange} />
        </div>
        {canStart ? (
          <button
            type="button"
            onClick={onStartNew}
            disabled={busy}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-transform active:scale-[0.97] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              className="size-4"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            New
          </button>
        ) : null}
      </header>

      {conversations === null ? (
        <ul aria-label="Loading" className="space-y-2">
          {[0, 1, 2].map((key) => (
            <li key={key} className="flex items-center gap-3 rounded-2xl p-3">
              <span className="size-11 shrink-0 animate-pulse rounded-full bg-muted" />
              <span className="flex-1 space-y-2">
                <span className="block h-3.5 w-1/2 animate-pulse rounded bg-muted" />
                <span className="block h-3 w-1/3 animate-pulse rounded bg-muted" />
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {requests.length > 0 ? (
        <section aria-labelledby="chat-requests">
          {/* Named, so it is clear why these rows have two buttons instead of opening. */}
          <h2
            id="chat-requests"
            className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Requests
          </h2>
          <ul className="space-y-2">
            {requests.map((conversation) => (
              <li key={conversation.id} className="rounded-2xl border border-primary/25 bg-card p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <Avatar conversation={conversation} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9375rem] font-semibold text-card-foreground">
                      {conversationTitle(conversation)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{invitedBy(conversation)}</p>
                  </div>
                </div>
                {/* The first thing said — §12.51: one message, never the thread. */}
                {previewOf(conversation) ? (
                  <p className="mt-3 line-clamp-2 rounded-xl bg-muted px-3 py-2 text-sm italic text-muted-foreground">
                    {previewOf(conversation)}
                  </p>
                ) : null}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onRespond(conversation.id, false)}
                    disabled={busy}
                    className="min-h-10 rounded-full bg-muted text-sm font-medium text-foreground active:bg-accent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => onRespond(conversation.id, true)}
                    disabled={busy}
                    className="min-h-10 rounded-full bg-primary text-sm font-medium text-primary-foreground shadow-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Accept
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {active.length > 0 ? (
        <section aria-label="Conversations">
          {requests.length > 0 ? (
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Conversations
            </h2>
          ) : null}
          {/* ↑ ↓ between conversations, Enter opens the one in focus — the list keys every pick-one list uses. */}
          <ul
            className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm"
            {...LIST_KEYS}
          >
            {active.map((conversation) => {
              const unread = conversation.unread > 0;
              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    {...LIST_ITEM}
                    onClick={() => onOpen(conversation.id)}
                    className="flex min-h-[4.5rem] w-full items-center gap-3 px-3 py-2.5 text-left transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="relative shrink-0">
                      <Avatar conversation={conversation} />
                      {/* Presence on the avatar, as a phone's messenger shows it. A group's dots are inside it. */}
                      <PresenceDot
                        presence={dotFor(conversation)}
                        className="absolute -right-0.5 -bottom-0.5 size-3.5 border-2 border-card"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            'truncate text-[0.9375rem] text-card-foreground',
                            unread ? 'font-semibold' : 'font-medium',
                          )}
                        >
                          {conversationTitle(conversation)}
                        </span>
                        {conversation.lastMessageAt ? (
                          <time
                            dateTime={conversation.lastMessageAt}
                            className={cn(
                              'shrink-0 text-xs',
                              unread ? 'font-medium text-primary' : 'text-muted-foreground',
                            )}
                          >
                            {shortTime(conversation.lastMessageAt, now)}
                          </time>
                        ) : null}
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-muted-foreground">
                          {conversation.isDirect
                            ? 'Direct message'
                            : otherParticipants(conversation).join(', ') || 'Only you'}
                        </span>
                        {unread ? (
                          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[0.6875rem] font-semibold leading-none text-primary-foreground">
                            <span aria-hidden>{conversation.unread > 99 ? '99+' : conversation.unread}</span>
                            <span className="sr-only">{conversation.unread} unread</span>
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {conversations !== null && active.length === 0 && requests.length === 0 ? (
        <div className="flex flex-col items-center rounded-3xl border border-border/70 bg-card px-6 py-12 text-center shadow-sm">
          <h2 className="text-base font-semibold text-foreground">No conversations yet</h2>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            {canStart
              ? 'Tap New to start one with anybody whose email address you know.'
              : 'When somebody starts a conversation with you, it appears here.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Your availability, as pills under the heading. NATIVE selects underneath on
 * purpose: on a phone they open the phone's own picker, which is larger and
 * easier than any menu drawn here. Nothing until the server has said what the
 * current state is — as the desktop picker, and for its reason.
 */
function AvailabilityPills({
  mine,
  busy,
  onChange,
}: {
  mine: ChatMyAvailabilityView | null;
  busy: boolean;
  onChange: (availability: string, forMinutes: number | null) => void;
}) {
  if (!mine) return null;
  const timed = mine.clearAt !== null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="relative inline-flex">
        <span className="sr-only">Your availability</span>
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 left-3 size-2.5 -translate-y-1/2 rounded-full',
            availabilityTone(mine.availability),
          )}
        />
        <select
          value={mine.availability}
          disabled={busy}
          onChange={(event) => onChange(event.target.value, null)}
          className="min-h-9 appearance-none rounded-full bg-muted py-0 pr-8 pl-7 text-sm font-medium text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {AVAILABILITY_ORDER.map((value) => (
            <option key={value} value={value}>
              {AVAILABILITY_LABELS[value] ?? value}
            </option>
          ))}
        </select>
        <Chevron />
      </label>

      {/* A timer only once there is something to time — "available for 30 minutes" is not a thing anybody means. */}
      {mine.availability !== 'available' ? (
        <label className="relative inline-flex">
          <span className="sr-only">How long</span>
          <select
            value={timed ? 'timed' : ''}
            disabled={busy}
            onChange={(event) => onChange(mine.availability, Number(event.target.value) || null)}
            className="min-h-9 appearance-none rounded-full bg-muted py-0 pr-8 pl-3.5 text-sm text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {timed ? <option value="timed">{`Until ${availabilityClock(mine.clearAt)}`}</option> : null}
            {AVAILABILITY_DURATIONS.map((option) => (
              <option key={option.label} value={option.minutes ?? ''}>
                {option.label}
              </option>
            ))}
          </select>
          <Chevron />
        </label>
      ) : null}
    </div>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Initials on a round tile for a person, a rounded square for a group — told apart before the name is read. */
function Avatar({ conversation }: { conversation: ChatConversationView }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-11 place-items-center bg-gradient-to-br from-primary/80 to-primary/60 text-sm font-semibold text-primary-foreground',
        conversation.isDirect ? 'rounded-full' : 'rounded-2xl',
      )}
    >
      {initials(conversationTitle(conversation))}
    </span>
  );
}

function initials(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

/**
 * "3:22 PM" today, "Yesterday", "Oct 10" before that. In the viewer's own
 * zone: chat is a personal screen, not a workspace's (the time-zone rule).
 */
function shortTime(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(at, now)) return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(at, yesterday)) return 'Yesterday';
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The dot on the availability pill, in theme tokens. The status `-foreground`
 * shades: the plain ones are the pale fills of a status banner, and a dot in
 * them all but disappears.
 */
function availabilityTone(availability: string): string {
  switch (availability) {
    case 'available':
      return 'bg-status-success-foreground';
    case 'away':
      return 'bg-status-warning-foreground';
    case 'invisible':
      return 'bg-muted-foreground/50';
    default:
      // busy, do not disturb
      return 'bg-destructive';
  }
}
