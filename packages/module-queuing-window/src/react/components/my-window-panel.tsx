'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { ConfirmDialog } from '@kwtech/web-ui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { QUEUE_FEATURE } from '../../feature-keys.js';
import type { QueueConsoleState } from '../use-queue-console.js';
import { activeWindows, isTypingTarget, linesServedBy, seatAt, servingAt, spaceLine } from '../view/console-view.js';
import { buttonClass, inputClass, Section } from './ui.js';

/**
 * My window: the part of the console touched three hundred times a day.
 *
 * Call next is the largest thing on the page, and Space presses it — counter
 * staff should not have to find the mouse between customers.
 */
export function MyWindowPanel({ state }: { state: QueueConsoleState }) {
  const { view, busy, run, client, scope } = state;
  const canServe = useHoldsFeature(QUEUE_FEATURE.serve);
  const canAssign = useHoldsFeature(QUEUE_FEATURE.assignWindows);

  const window = view?.myWindowId ? (view.windows.find((one) => one.id === view.myWindowId) ?? null) : null;
  const lines = useMemo(() => (view && window ? linesServedBy(window, view.lines) : []), [view, window]);
  const current = view && window ? servingAt(view, window.id) : null;
  const running = view?.session != null;
  const canCall = Boolean(canServe && running && window);

  const callNext = (lineId: string) => run(() => client.callNext(scope, lineId, globalThis.crypto.randomUUID()));

  // Space calls next — see `spaceLine` for which line, and `isTypingTarget` for when not.
  const shortcut = canCall ? spaceLine(lines, current) : null;
  // The listener reads everything through this ref, so it is installed once and never sees a stale callNext.
  const shortcutRef = useRef({ lineId: null as string | null, busy, callNext });
  shortcutRef.current = { lineId: shortcut?.id ?? null, busy, callNext };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { lineId, busy: pending, callNext: call } = shortcutRef.current;
      if (event.code !== 'Space' || event.repeat || !lineId || pending || isTypingTarget(event.target)) return;
      event.preventDefault();
      void call(lineId);
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, []);

  if (!view) return null;

  if (!window) {
    return (
      <Section title="My window" description="You are not assigned a window.">
        {canAssign ? (
          <AssignMyself state={state} />
        ) : (
          <p className="text-sm text-muted-foreground">Ask whoever assigns windows here to give you one.</p>
        )}
      </Section>
    );
  }

  return (
    <Section
      title={window.name}
      description={running ? 'Your window.' : 'Your window. Queuing has not started, so nothing can be called yet.'}
      actions={
        <button
          type="button"
          className={buttonClass('ghost')}
          disabled={busy}
          onClick={() => run(() => client.releaseMySeat(scope))}
        >
          Leave this window
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-6">
        <div className="min-w-40">
          <p className="text-sm text-muted-foreground">Now serving</p>
          <p className="font-mono text-5xl font-semibold text-foreground">{current?.label ?? '—'}</p>
          {current && current.recallCount > 0 ? (
            <p className="text-xs text-muted-foreground">Recalled {current.recallCount}×</p>
          ) : null}
        </div>

        {canServe ? (
          <div className="flex flex-wrap gap-3">
            {lines.map((line) => (
              <button
                key={line.id}
                type="button"
                className={buttonClass('primary', 'lg')}
                disabled={!canCall || busy}
                onClick={() => callNext(line.id)}
              >
                {lines.length === 1 ? 'Call next' : `Call next ${line.prefix}`}
              </button>
            ))}
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">This window serves no active line.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {canServe && current ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass('secondary')}
            disabled={!canCall || busy}
            onClick={() => run(() => client.recall(scope, current.id))}
          >
            Recall
          </button>
          <button
            type="button"
            className={buttonClass('secondary')}
            disabled={busy}
            onClick={() => run(() => client.noShow(scope, current.id))}
          >
            No-show
          </button>
          <button
            type="button"
            className={buttonClass('secondary')}
            disabled={busy}
            onClick={() => run(() => client.complete(scope, current.id))}
          >
            Done
          </button>
        </div>
      ) : null}

      {canServe && canCall && lines.length > 0 ? <CallNumber state={state} lines={lines} /> : null}

      {shortcut ? (
        <p className="mt-3 text-xs text-muted-foreground">Press Space to call the next {shortcut.prefix} number.</p>
      ) : null}
    </Section>
  );
}

function CallNumber({ state, lines }: { state: QueueConsoleState; lines: ReturnType<typeof linesServedBy> }) {
  const { busy, run, client, scope } = state;
  const [lineId, setLineId] = useState(lines[0]?.id ?? '');
  const [number, setNumber] = useState('');
  const selected = lines.find((line) => line.id === lineId) ?? lines[0];

  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const value = Number(number);
        if (!selected || !Number.isInteger(value)) return;
        if (await run(() => client.callNumber(scope, selected.id, value))) setNumber('');
      }}
    >
      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
        Call number…
        <span className="flex gap-2">
          {lines.length > 1 ? (
            <select className={inputClass} value={selected?.id} onChange={(event) => setLineId(event.target.value)}>
              {lines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.prefix}
                </option>
              ))}
            </select>
          ) : null}
          <input
            className={`${inputClass} w-28`}
            inputMode="numeric"
            placeholder={selected ? String(selected.startNumber) : ''}
            value={number}
            onChange={(event) => setNumber(event.target.value.replace(/\D/g, ''))}
          />
        </span>
      </label>
      <button type="submit" className={buttonClass('secondary')} disabled={busy || number === ''}>
        Call
      </button>
    </form>
  );
}

/** For a holder of `queue:assign_windows` with no window: pick one for yourself. */
function AssignMyself({ state }: { state: QueueConsoleState }) {
  const { view, busy, run, client, scope } = state;
  const windows = view ? activeWindows(view) : [];
  const [windowId, setWindowId] = useState('');
  const [confirm, setConfirm] = useState<{ windowId: string; occupant: string } | null>(null);
  const me = view?.myUserId ?? null;

  if (windows.length === 0) {
    return <p className="text-sm text-muted-foreground">There are no windows yet. Create one in the queue settings.</p>;
  }

  const assign = (id: string, confirmReplace: boolean) =>
    me ? run(() => client.assignWindow(scope, id, me, confirmReplace)) : Promise.resolve(false);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <select className={inputClass} value={windowId} onChange={(event) => setWindowId(event.target.value)}>
        <option value="">Choose a window…</option>
        {windows.map((window) => {
          const seat = view ? seatAt(view, window.id) : null;
          return (
            <option key={window.id} value={window.id}>
              {window.name}
              {seat ? ` — ${seat.displayName}` : ''}
            </option>
          );
        })}
      </select>
      <button
        type="button"
        className={buttonClass('primary')}
        disabled={busy || !windowId || !me}
        onClick={() => {
          const seat = view ? seatAt(view, windowId) : null;
          if (seat) setConfirm({ windowId, occupant: seat.displayName });
          else void assign(windowId, false);
        }}
      >
        Take this window
      </button>
      {!me ? <p className="text-xs text-muted-foreground">Your account could not be identified on this page.</p> : null}
      <ConfirmDialog
        open={confirm !== null}
        title="Replace them at this window?"
        description={confirm ? `${confirm.occupant} is assigned to this window. Taking it moves them off.` : ''}
        confirmLabel="Take the window"
        pending={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const target = confirm;
          setConfirm(null);
          if (target) await assign(target.windowId, true);
        }}
      />
    </div>
  );
}
