'use client';

import { cn } from '@kwtech/web-ui/react';
import { type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clampDock, type DockPosition, draggedDock } from '../view/dock-view.js';
import { ChatIcon, type ChatIconName } from './chat-icons.js';

/**
 * The floating chat window: a thread in the bottom-right corner, over whatever
 * page is open, that can be dragged anywhere, folded down to its title bar, and
 * opened out into the full chat page.
 *
 * ## Why a portal
 *
 * It is rendered by the header tool, and the header is not where it belongs in
 * the tree: an ancestor with a `transform`, a `filter` or `overflow: hidden`
 * would turn `position: fixed` into "fixed to that ancestor" and clip it. On
 * `document.body` nothing above it can do that.
 *
 * ## The position is the caller's
 *
 * Held by the header tool alongside the collapsed flag and the conversation, so
 * all three are stored together and restored together.
 */
export function ChatDock({
  title,
  subtitle,
  collapsed,
  position,
  onMove,
  onToggleCollapsed,
  onClose,
  expandHref,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  collapsed: boolean;
  position: DockPosition;
  /** Called during a drag and once at its end with `final` set, which is when to persist. */
  onMove: (position: DockPosition, final: boolean) => void;
  onToggleCollapsed: () => void;
  onClose: () => void;
  /** The full chat page, opened on this conversation. */
  expandHref: string;
  children: ReactNode;
}) {
  const windowRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; from: { x: number; y: number }; start: DockPosition } | null>(null);
  const [dragging, setDragging] = useState(false);

  const clampToViewport = useCallback((next: DockPosition): DockPosition => {
    const box = windowRef.current?.getBoundingClientRect();
    if (!box) return next;
    return clampDock(
      next,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
  }, []);

  /*
   * Re-clamped when the viewport shrinks or the window unfolds: a position that
   * fit a collapsed bar may not fit the whole window, and one that fit a wide
   * screen may be off a narrow one.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `collapsed` changes the window's size, which is what is re-measured.
  useEffect(() => {
    const settle = () => {
      const next = clampToViewport(position);
      if (next.right !== position.right || next.bottom !== position.bottom) onMove(next, true);
    };
    settle();
    window.addEventListener('resize', settle);
    return () => window.removeEventListener('resize', settle);
  }, [collapsed, position, clampToViewport, onMove]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // A press on a control in the bar is that control's, not the start of a drag.
    if ((event.target as HTMLElement).closest('button, a')) return;
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, from: { x: event.clientX, y: event.clientY }, start: position };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    onMove(clampToViewport(draggedDock(active.start, active.from, { x: event.clientX, y: event.clientY })), false);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    onMove(clampToViewport(draggedDock(active.start, active.from, { x: event.clientX, y: event.clientY })), true);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <section
      ref={windowRef}
      aria-label={`Chat with ${title}`}
      style={{ right: position.right, bottom: position.bottom }}
      className={cn(
        'fixed z-40 flex flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl',
        // Capped by the viewport, so a phone gets a window that fits rather than one that runs off it.
        'w-[min(22.5rem,calc(100vw-1rem))]',
        collapsed ? 'h-auto' : 'h-[min(32rem,calc(100dvh-2rem))]',
        dragging ? 'select-none' : 'transition-[height] duration-200 ease-out',
      )}
    >
      {/*
        THE TITLE BAR IS THE HANDLE. `touch-none` so a finger dragging it moves
        the window instead of scrolling the page underneath; the cursor says it
        can be grabbed before anyone tries.
      */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          'flex h-12 shrink-0 touch-none items-center gap-2 border-b border-border bg-muted/40 pl-3 pr-1.5',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
          collapsed && 'border-b-0',
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <ChatIcon name="message" className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          {subtitle ? <div className="truncate text-xs text-muted-foreground">{subtitle}</div> : null}
        </div>
        <BarButton
          icon={collapsed ? 'restore' : 'minimize'}
          label={collapsed ? 'Expand chat window' : 'Minimise chat window'}
          onClick={onToggleCollapsed}
        />
        <a href={expandHref} aria-label="Open in full chat" title="Open in full chat" className={BAR_BUTTON_CLASS}>
          <ChatIcon name="expand" />
        </a>
        <BarButton icon="close" label="Close chat window" onClick={onClose} />
      </div>

      {/*
        Hidden rather than unmounted when folded, so the thread keeps its place,
        its loaded history and whatever was half-typed in the composer.
      */}
      <div className={cn('flex min-h-0 flex-1 flex-col', collapsed && 'hidden')}>{children}</div>
    </section>,
    document.body,
  );
}

const BAR_BUTTON_CLASS =
  'grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function BarButton({ icon, label, onClick }: { icon: ChatIconName; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={BAR_BUTTON_CLASS}>
      <ChatIcon name={icon} />
    </button>
  );
}
