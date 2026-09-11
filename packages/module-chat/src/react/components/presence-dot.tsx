'use client';

import { cn } from '@kwtech/web-ui/react';
import type { ChatPresenceView } from '../chat-client.js';

/**
 * Whether somebody is here, and what they said they are doing.
 *
 * ⚠ NOTHING IS DRAWN FOR SOMEBODY WE KNOW NOTHING ABOUT, and that is not the
 * same as drawing "offline". An absent entry means the server declined to
 * answer — they are not somebody this viewer shares an active conversation
 * with — and a grey dot would assert they are away, which the server never
 * said. A missing dot asserts nothing.
 *
 * ⚠ A dot that says "away" is never how an INVISIBLE person appears. That was
 * decided at the publish boundary: they arrive as offline, indistinguishable
 * from somebody who genuinely is. Nothing here can tell the difference, which
 * is the point.
 */
export function PresenceDot({ presence, className }: { presence?: ChatPresenceView | undefined; className?: string }) {
  if (!presence) return null;

  const label = describe(presence);
  return (
    <span
      className={cn('inline-grid size-2 shrink-0 place-items-center rounded-full', colour(presence), className)}
      // The colour is the whole content, so the name has to be text: a dot with
      // no accessible name is decoration that happens to carry the only
      // information in the row.
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

function colour(presence: ChatPresenceView): string {
  if (!presence.online) return 'bg-muted-foreground/40';
  switch (presence.availability) {
    case 'busy':
      return 'bg-destructive';
    case 'dnd':
      return 'bg-destructive';
    case 'away':
      return 'bg-amber-500';
    default:
      return 'bg-emerald-500';
  }
}

function describe(presence: ChatPresenceView): string {
  if (!presence.online) return 'Offline';
  switch (presence.availability) {
    case 'busy':
      return 'Busy';
    case 'dnd':
      return 'Do not disturb';
    case 'away':
      return 'Away';
    default:
      return 'Online';
  }
}
