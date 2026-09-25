'use client';

import { cn } from '@kwtech/web-ui/react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toastDurationMs, toastPoliteness } from '../../domain/toast.js';
import { isNotificationSeverity } from '../../types.js';
import { severityLook } from '../view/severity-view.js';
import { newestToast, type ToastItem, type ToastQueue } from '../view/toast-queue.js';
import { NotificationIcon } from './notification-icons.js';

export interface ToastStackProps {
  queue: ToastQueue;
  onDismiss: (id: string) => void;
  /** A toast was clicked through to its link. */
  onOpen: (id: string) => void;
}

/**
 * The toasts: small pills at the TOP CENTRE, just under the header, portalled
 * to `<body>`.
 *
 * ⚠ Built to inform without blocking (the operator's decision, 2026-09-25): one
 * line each, a few seconds each, at most two on screen. Reading happens in the
 * inbox; the pill only says something arrived. Top centre also keeps clear of
 * chat's floating window in the bottom-right — a layout choice, not a
 * dependency.
 *
 * ⚠ The two live regions are ALWAYS in the DOM, empty or not. A live region
 * that is created together with its first message is not announced by several
 * screen readers — they only speak CHANGES to a region they already know.
 */
export function ToastStack({ queue, onDismiss, onOpen }: ToastStackProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // What the screen reader hears: the newest toast, in the region its severity picks.
  const newest = newestToast(queue);
  const [spoken, setSpoken] = useState<{ polite: string; assertive: string }>({ polite: '', assertive: '' });
  const lastSpoken = useRef('');
  useEffect(() => {
    if (!newest) return;
    const key = `${newest.id}:${newest.version}`;
    if (key === lastSpoken.current) return;
    lastSpoken.current = key;
    const text = `${severityLook(newest.severity).label}: ${newest.title}`;
    const politeness = toastPoliteness(isNotificationSeverity(newest.severity) ? newest.severity : 'info');
    setSpoken(politeness === 'assertive' ? { polite: '', assertive: text } : { polite: text, assertive: '' });
  }, [newest]);

  // Escape dismisses the newest toast — unless focus is in a field, where
  // Escape already means something to whatever the person is typing in.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !newest) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      onDismiss(newest.id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [newest, onDismiss]);

  if (!mounted) return null;
  return createPortal(
    <>
      <div className="sr-only" aria-live="polite" aria-atomic>
        {spoken.polite}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic>
        {spoken.assertive}
      </div>
      <section
        aria-label="New notifications"
        className="pointer-events-none fixed left-1/2 top-16 z-[60] flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 flex-col items-center gap-1.5"
      >
        {queue.visible.map((toast) => (
          // ⚠ The VERSION is in the key: a replaced toast (a group that grew)
          // remounts, which restarts its clock — it is news again.
          <Toast key={`${toast.id}:${toast.version}`} toast={toast} onDismiss={onDismiss} onOpen={onOpen} />
        ))}
        {queue.waiting.length > 0 ? (
          <p className="rounded-full bg-popover/90 px-2.5 py-0.5 text-[0.6875rem] text-muted-foreground shadow">
            +{queue.waiting.length} more
          </p>
        ) : null}
      </section>
    </>,
    document.body,
  );
}

function Toast({
  toast,
  onDismiss,
  onOpen,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const duration = toastDurationMs(isNotificationSeverity(toast.severity) ? toast.severity : 'info');
  const [paused, setPaused] = useState(false);
  const [entered, setEntered] = useState(false);

  // Slides in from just above: noticed, without a jump.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  /*
   * ⚠ Hovering or focusing PAUSES the clock, and leaving restarts it in full,
   * so somebody who does stop to read it is not cut off mid-sentence. A new
   * version remounts the toast (see the key), which restarts it too.
   */
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => onDismiss(toast.id), duration);
    return () => clearTimeout(timer);
  }, [duration, paused, toast.id, onDismiss]);

  const follow = () => {
    if (!toast.href) return;
    onOpen(toast.id);
    if (toast.hrefTarget === 'blank') {
      window.open(toast.href, '_blank', 'noopener,noreferrer');
      return;
    }
    window.location.assign(toast.href);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only PAUSE the timer; every action is a real button inside.
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        'pointer-events-auto max-w-full transition-all duration-200 ease-out',
        entered ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0',
      )}
    >
      <ToastCard toast={toast} onFollow={follow} onDismiss={() => onDismiss(toast.id)} />
    </div>
  );
}

export interface ToastCardProps {
  toast: Pick<ToastItem, 'severity' | 'title' | 'body' | 'sourceLabel' | 'contextLabel' | 'href'>;
  /** Absent draws the title as text — the admin preview, where nothing should navigate. */
  onFollow?: () => void;
  /** Absent hides the close button. */
  onDismiss?: () => void;
}

/**
 * How a toast LOOKS, with no timer and no portal — used by the live stack and
 * by the compose screen's preview, so the preview can never drift from what
 * people actually see.
 *
 * ONE LINE: the type's icon, the title, where it came from. The details are
 * not in the pill — they are in the inbox, and on hover here as a tooltip —
 * because a pill that grows with its text is a pill that covers the page.
 */
export function ToastCard({ toast, onFollow, onDismiss }: ToastCardProps) {
  const look = severityLook(toast.severity);
  const source = [toast.sourceLabel, toast.contextLabel].filter(Boolean).join(' · ');
  const tooltip = [toast.title, toast.body, source].filter(Boolean).join('\n');
  return (
    <div
      title={tooltip}
      className="flex h-9 max-w-full items-center gap-2 rounded-full border border-border bg-popover py-1 pl-1.5 pr-1.5 text-popover-foreground shadow-lg"
    >
      <span className={cn('grid size-6 shrink-0 place-items-center rounded-full', look.chip)}>
        <NotificationIcon name={look.icon} className="size-3.5" />
      </span>
      {toast.href && onFollow ? (
        <button
          type="button"
          onClick={onFollow}
          className="min-w-0 truncate text-left text-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {toast.title}
        </button>
      ) : (
        <p className="min-w-0 truncate text-sm font-medium">{toast.title}</p>
      )}
      {source ? (
        <span className="hidden max-w-[9rem] shrink-0 truncate text-xs text-muted-foreground sm:block">{source}</span>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Dismiss "${toast.title}"`}
          className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <NotificationIcon name="close" className="size-3" />
        </button>
      ) : (
        <span aria-hidden className="w-1" />
      )}
    </div>
  );
}
