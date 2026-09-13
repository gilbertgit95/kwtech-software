'use client';

import { cn } from '@kwtech/web-ui/react';
import { useEffect, useState } from 'react';
import { DISPLAY_CODE_REFUSAL_MESSAGE } from '../../domain/session.js';
import { type DisplayNotice, type QueueDisplayState, useQueueDisplay } from '../use-queue-display.js';
import { filterBoard, isPulsing, isStale, servingRows } from '../view/board-view.js';
import { clockTime } from '../view/console-view.js';

/**
 * `/queue-display/:organizationKey/:workspaceKey` — the board on a TV.
 *
 * FULLSCREEN chrome: no header, no theme control, no status bar. A control
 * pinned over a TV picture is one nobody can reach with a remote, so this page
 * owns every pixel and reports its own connection state.
 *
 * ⚠ PUBLIC. Nobody signs in; the display code is the authorisation, exchanged
 * over throttled HTTP for a pass the socket presents.
 */
export function QueueDisplayPage({ params, wsUrl }: { params: Record<string, string>; wsUrl: string | null }) {
  const state = useQueueDisplay({
    organizationKey: params.organizationKey ?? '',
    workspaceKey: params.workspaceKey ?? '',
    wsUrl,
  });

  return (
    <main className="flex min-h-screen w-full flex-col bg-background text-foreground">
      {state.phase.kind === 'prompt' ? <CodePrompt state={state} notice={state.phase.notice} /> : null}
      {state.phase.kind === 'start' ? (
        <StartDisplay state={state} workspaceName={state.phase.stored.workspaceName} />
      ) : null}
      {state.phase.kind === 'board' ? (
        wsUrl ? (
          <Board state={state} workspaceName={state.phase.stored.workspaceName} />
        ) : (
          <Centered>
            <p className="text-2xl">Live updates are not configured for this site, so the board cannot run.</p>
          </Centered>
        )
      ) : null}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">{children}</div>;
}

const NOTICE: Record<DisplayNotice, string> = {
  stopped: 'Queuing has stopped. Enter the new code when it starts again.',
  // ⚠ The one message, whatever went wrong — see DISPLAY_CODE_REFUSAL_MESSAGE.
  refused: DISPLAY_CODE_REFUSAL_MESSAGE,
  unreachable: 'Cannot reach the server. Check the connection and try again.',
};

/**
 * ⚠ IDENTICAL for a workspace that exists and one that does not: no name, no
 * hint. The workspace's name appears only after a pass is issued.
 */
function CodePrompt({ state, notice }: { state: QueueDisplayState; notice: DisplayNotice | null }) {
  const [code, setCode] = useState('');
  return (
    <Centered>
      <h1 className="text-4xl font-semibold">Queue display</h1>
      <p className="max-w-xl text-xl text-muted-foreground">
        Enter the display code shown on the queue console. It changes every time queuing starts.
      </p>
      <form
        className="flex flex-wrap items-center justify-center gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.trim()) void state.exchange(code);
        }}
      >
        <input
          aria-label="Display code"
          className="h-20 w-80 rounded-lg border-2 border-border bg-background px-4 text-center font-mono text-4xl uppercase tracking-widest"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          placeholder="XXXX-XXXX"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <button
          type="submit"
          disabled={state.exchanging || !code.trim()}
          className="h-20 rounded-lg bg-primary px-10 text-3xl font-semibold text-primary-foreground disabled:opacity-50"
        >
          Open
        </button>
      </form>
      {notice ? (
        <p role="alert" className="text-2xl font-medium text-destructive">
          {NOTICE[notice]}
        </p>
      ) : null}
    </Centered>
  );
}

/**
 * ⚠ THE UNLOCK SCREEN. Browsers refuse sound, speech and a wake lock without a
 * gesture, and a board that never asked would chime into silence and let the TV
 * sleep at 2pm — both indistinguishable from working until a customer misses
 * their number.
 */
function StartDisplay({ state, workspaceName }: { state: QueueDisplayState; workspaceName: string }) {
  return (
    <Centered>
      <h1 className="text-5xl font-semibold">{workspaceName}</h1>
      <button
        type="button"
        // biome-ignore lint/a11y/noAutofocus: a TV is driven by a remote with no pointer — focus already on the one button is what makes OK start the display.
        autoFocus
        onClick={() => void state.start()}
        className="rounded-2xl bg-primary px-16 py-10 text-5xl font-semibold text-primary-foreground"
      >
        Start display
      </button>
      <p className="max-w-2xl text-xl text-muted-foreground">
        Press once, so this screen can play the call chime, read numbers aloud and stay awake.
      </p>
    </Centered>
  );
}

function Board({ state, workspaceName }: { state: QueueDisplayState; workspaceName: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [showFilter, setShowFilter] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const stale = isStale(state.disconnectedSince, now);
  const board = state.board ? filterBoard(state.board, state.filter) : null;
  const rows = board ? servingRows(board) : [];

  return (
    <div className="relative flex flex-1 flex-col p-8">
      <header className="flex items-baseline justify-between gap-6">
        <h1 className="text-4xl font-semibold">{workspaceName}</h1>
        <p className="font-mono text-4xl tabular-nums">{clockTime(new Date(now).toISOString())}</p>
      </header>

      {stale ? (
        <div role="status" className="mt-6 rounded-lg bg-destructive px-6 py-4 text-3xl font-semibold text-white">
          Reconnecting… the numbers below may be out of date.
        </div>
      ) : null}

      <div className={cn('mt-8 grid flex-1 gap-8 lg:grid-cols-3', stale && 'opacity-40')}>
        <section className="lg:col-span-2">
          <h2 className="text-3xl font-medium text-muted-foreground">Now serving</h2>
          {board === null ? (
            <p className="mt-8 text-3xl text-muted-foreground">Connecting…</p>
          ) : rows.length === 0 ? (
            <p className="mt-8 text-3xl text-muted-foreground">Waiting for the first number to be called.</p>
          ) : (
            <ul className="mt-6 flex flex-col gap-4">
              {rows.map((call) => (
                <li
                  key={call.windowId}
                  className={cn(
                    'flex flex-wrap items-baseline justify-between gap-6 rounded-xl border-2 border-border px-8 py-6',
                    isPulsing(state.announced, call.ticketId, now) &&
                      'animate-pulse border-primary bg-primary text-primary-foreground',
                  )}
                >
                  <span className="font-mono text-7xl font-bold tracking-wide">{call.label}</span>
                  <span className="text-right">
                    <span className="block text-5xl font-semibold">{call.windowName}</span>
                    {call.nickname ? <span className="block text-2xl opacity-80">{call.nickname}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-3xl font-medium text-muted-foreground">Recent calls</h2>
          <ul className="mt-6 flex flex-col gap-3">
            {(board?.recent ?? []).map((call) => (
              <li
                key={`${call.ticketId}-${call.calledAt}`}
                className="flex items-baseline justify-between gap-4 text-3xl"
              >
                <span className="font-mono font-semibold">{call.label}</span>
                <span className="truncate text-muted-foreground">{call.windowName}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-4 text-lg text-muted-foreground">
        {state.soundReady ? (
          <span />
        ) : (
          <button type="button" className="underline" onClick={() => void state.enableSound()}>
            Sound is off — press to turn it on
          </button>
        )}
        <button type="button" className="underline" onClick={() => setShowFilter((open) => !open)}>
          {state.filter.length
            ? `Showing ${state.filter.length} line${state.filter.length === 1 ? '' : 's'}`
            : 'All lines'}
        </button>
      </footer>

      {showFilter && state.board ? (
        <div className="absolute bottom-20 right-8 rounded-xl border-2 border-border bg-background p-6 text-2xl shadow-lg">
          <p className="mb-3 font-medium">Show on this screen</p>
          {state.board.lines.map((line) => (
            <label key={line.id} className="flex items-center gap-3 py-1">
              <input
                type="checkbox"
                className="h-6 w-6"
                checked={state.filter.includes(line.id)}
                onChange={(event) =>
                  state.setFilter(
                    event.target.checked ? [...state.filter, line.id] : state.filter.filter((id) => id !== line.id),
                  )
                }
              />
              {line.prefix} · {line.name}
            </label>
          ))}
          <p className="mt-3 text-base text-muted-foreground">Nothing ticked shows every line. Kept on this screen.</p>
        </div>
      ) : null}
    </div>
  );
}
