'use client';

import { AlertTriangle, CheckCircle2, ChevronUp, CircleAlert, Info, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from './utils.js';

/**
 * The application's status strip: one line, pinned to the bottom, saying the
 * most important true thing right now.
 *
 * ## Presentation only
 *
 * It takes a list and renders it. It does not know where messages come from,
 * does not subscribe to anything, and holds no state but "is the overflow list
 * open" — so it can be rendered in a story, a test or a second app with a
 * literal array.
 *
 * The channel that feeds it is `@kwtech/module-kit/react`, and this package
 * deliberately does NOT import it. web-ui is not a module and has no business
 * in the module contract; the two types are structurally identical instead, and
 * the app that wires them together is where a mismatch would fail to compile.
 * That is the same arrangement as apps/web-server's satisfies-modules.ts: the
 * assertion lives at the seam, not inside either side.
 *
 * ## Why a strip and not a toast
 *
 * A toast is for something that HAPPENED; this is for something that IS. "The
 * server is unreachable" has no moment — it is a condition, and a notification
 * that slides away takes the answer with it, leaving someone to wonder why
 * nothing saves. A strip that stays is the honest shape for state.
 */

/**
 * The message shape, declared structurally rather than imported.
 *
 * `level` is the same four-value union as module-kit's `StatusLevel`, so a
 * `StatusMessage[]` from the channel assigns to this without a cast, and adding
 * a fifth level there breaks the app's compile rather than rendering unstyled
 * here.
 */
export interface StatusBarMessage {
  id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  text: string;
  action?: { label: string; run: () => void } | undefined;
  /**
   * Whether this one may be closed. Defaults to true when `onDismiss` is given.
   *
   * Per message rather than per bar, because the two kinds of thing here differ:
   * news can be dismissed, a CONDITION cannot. Letting someone close "cannot
   * reach the server" would hide a fact that is still true, and — since the
   * publisher only republishes when the state CHANGES — it would stay hidden
   * for the whole outage.
   */
  dismissible?: boolean | undefined;
}

/**
 * Colour, icon and screen-reader label per level, as one table.
 *
 * Kept together because they are one decision: the icon exists so the level
 * survives for anyone who cannot use the colour, and splitting them across
 * three lookups is how an added level ends up coloured but not iconed.
 */
const LEVELS = {
  info: { icon: Info, surface: 'bg-status-info text-status-info-foreground', label: 'Information' },
  success: { icon: CheckCircle2, surface: 'bg-status-success text-status-success-foreground', label: 'Success' },
  warning: { icon: AlertTriangle, surface: 'bg-status-warning text-status-warning-foreground', label: 'Warning' },
  error: { icon: CircleAlert, surface: 'bg-status-error text-status-error-foreground', label: 'Error' },
} as const;

export interface StatusBarProps {
  /**
   * Severity-ordered — the caller sorts, because the caller's channel already
   * does. The first is the headline; the rest go behind the counter.
   */
  messages: readonly StatusBarMessage[];
  /** Omitted, nothing is dismissible. Supplied, every message that allows it gets a close button. */
  onDismiss?: (id: string) => void;
  /**
   * `| undefined` explicitly, because `exactOptionalPropertyTypes` is on across
   * this workspace: without it a caller cannot forward its own optional
   * className, which is the normal way a wrapper passes one through.
   */
  className?: string | undefined;
}

export function StatusBar({ messages, onDismiss, className }: StatusBarProps) {
  const [expanded, setExpanded] = useState(false);

  const primary = messages[0];
  const rest = messages.slice(1);

  /*
   * Nothing to say means NO BAR, not an empty one.
   *
   * A permanent empty strip is a permanent strip of wasted screen, and worse,
   * it trains the eye to skip the region — so the day it does say something,
   * nobody looks. Its absence is what makes its presence mean anything.
   */
  if (!primary) return null;

  const level = LEVELS[primary.level];
  const Icon = level.icon;

  return (
    /*
     * `role="status"` with `aria-live="polite"`: announced when it changes, at
     * the next pause rather than by interrupting. Not `role="alert"` — that is
     * assertive and cuts across whatever is being read, which is right for a
     * failed submission and wrong for a bar that also says "reconnected".
     *
     * The live region is the OUTER element and is always rendered when there is
     * any message, so a level change is an update to an existing region rather
     * than a new region appearing — screen readers announce the first reliably
     * and the second inconsistently.
     */
    <div
      role="status"
      aria-live="polite"
      className={cn('border-t border-border text-sm transition-colors', level.surface, className)}
    >
      {expanded && rest.length > 0 ? (
        <ul className="divide-y divide-border/60 border-b border-border/60">
          {rest.map((message) => {
            const other = LEVELS[message.level];
            const OtherIcon = other.icon;
            return (
              <li key={message.id} className={cn('flex items-center gap-2.5 px-4 py-2 sm:px-6', other.surface)}>
                <OtherIcon aria-hidden className="size-4 shrink-0 opacity-90" />
                <span className="sr-only">{other.label}: </span>
                <span className="min-w-0 flex-1 truncate">{message.text}</span>
                {message.action ? <ActionButton action={message.action} /> : null}
                {onDismiss && message.dismissible !== false ? (
                  <DismissButton onDismiss={() => onDismiss(message.id)} />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="flex items-center gap-2.5 px-4 py-2 sm:px-6">
        <Icon aria-hidden className="size-4 shrink-0 opacity-90" />
        {/* The level in words, for anyone the colour and the icon do not reach. */}
        <span className="sr-only">{level.label}: </span>
        <span className="min-w-0 flex-1 truncate">{primary.text}</span>

        {primary.action ? <ActionButton action={primary.action} /> : null}

        {rest.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
              'transition-opacity hover:opacity-80',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1',
            )}
          >
            {/* The count is of the HIDDEN ones, so it matches what expanding reveals. */}
            {rest.length} more
            <ChevronUp aria-hidden className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        ) : null}

        {onDismiss && primary.dismissible !== false ? <DismissButton onDismiss={() => onDismiss(primary.id)} /> : null}
      </div>
    </div>
  );
}

function ActionButton({ action }: { action: { label: string; run: () => void } }) {
  return (
    <button
      type="button"
      onClick={action.run}
      className={cn(
        'shrink-0 rounded-md border border-current/30 px-2 py-0.5 text-xs font-medium',
        'transition-opacity hover:opacity-80',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1',
      )}
    >
      {action.label}
    </button>
  );
}

function DismissButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      // The visible target is 16px; the padding makes the HIT target reach the
      // 24px this strip has room for. An icon-only control with no label is
      // unusable with a screen reader, hence the aria-label rather than a title.
      aria-label="Dismiss"
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-md',
        'transition-opacity opacity-70 hover:opacity-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1',
      )}
    >
      <X aria-hidden className="size-3.5" />
    </button>
  );
}
