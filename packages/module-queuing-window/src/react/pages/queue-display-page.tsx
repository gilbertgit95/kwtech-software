'use client';

import { cn, ThemeSwitcher } from '@kwtech/web-ui/react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { DISPLAY_CODE_REFUSAL_MESSAGE } from '../../domain/session.js';
import {
  AlertIcon,
  ArrowRightIcon,
  BellIcon,
  ClockIcon,
  FilterIcon,
  MegaphoneIcon,
  PlayIcon,
  SpeechIcon,
  SpinnerIcon,
  SunIcon,
  TvIcon,
  VolumeIcon,
  VolumeOffIcon,
  WifiOffIcon,
} from '../components/display-icons.js';
import { type DisplayThemeState, useDisplayTheme } from '../use-display-theme.js';
import { type DisplayNotice, type QueueDisplayState, useQueueDisplay } from '../use-queue-display.js';
import { filterBoard, isPulsing, isStale, type QueueBoardCallView, servingRows } from '../view/board-view.js';
import { clockTime } from '../view/console-view.js';

/**
 * `/queue-display/:organizationKey/:workspaceKey` — the board on a TV.
 *
 * FULLSCREEN chrome: no app header, no status bar. The page draws its own top
 * bar — who this screen is for, whether it is live, the time, and a theme
 * control — along the top edge, where a remote can reach it by focus and where
 * it never covers a number.
 *
 * ⚠ The theme is THIS SCREEN'S, kept in this browser under its own key and
 * never sent anywhere — see `useDisplayTheme`.
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
  const theme = useDisplayTheme();
  const now = useNow();
  const { phase } = state;
  // ⚠ Only once a pass exists: the prompt is identical for a workspace that exists and one that does not.
  const workspaceName = phase.kind === 'start' || phase.kind === 'board' ? phase.stored.workspaceName : null;

  return (
    <main className="relative isolate flex min-h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <Backdrop />
      <TopBar
        workspaceName={workspaceName}
        theme={theme}
        clock={now === null ? null : clockTime(new Date(now).toISOString())}
        status={phase.kind === 'board' && wsUrl ? <LivePill state={state} now={now ?? 0} /> : null}
      />

      {phase.kind === 'loading' ? (
        <Stage>
          <SpinnerIcon className="size-12 text-muted-foreground" />
        </Stage>
      ) : null}
      {phase.kind === 'prompt' ? <CodePrompt state={state} notice={phase.notice} /> : null}
      {phase.kind === 'start' ? <StartDisplay state={state} workspaceName={phase.stored.workspaceName} /> : null}
      {phase.kind === 'board' ? (
        wsUrl ? (
          <Board state={state} now={now ?? 0} />
        ) : (
          <Stage>
            <Card className="text-center">
              <p className="text-2xl">Live updates are not configured for this site, so the board cannot run.</p>
            </Card>
          </Stage>
        )
      ) : null}
    </main>
  );
}

/** The time, ticking — null until mounted, so the server and the first client render agree. */
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// ── frame ─────────────────────────────────────────────────────────────────────

/** Soft light in the palette's own primary, so every theme gets its own glow. */
function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute inset-0 bg-linear-to-b from-muted/60 via-background to-background" />
      <div className="absolute -top-48 left-1/2 h-[40rem] w-[70rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <div className="absolute -bottom-56 -right-40 h-[32rem] w-[32rem] rounded-full bg-primary/10 blur-3xl" />
    </div>
  );
}

function TopBar({
  workspaceName,
  theme,
  clock,
  status,
}: {
  workspaceName: string | null;
  theme: DisplayThemeState;
  clock: string | null;
  status: React.ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-6 px-6 py-5 sm:px-10">
      <div className="flex min-w-0 items-center gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
          <MegaphoneIcon className="size-6" />
        </span>
        <div className="min-w-0">
          {workspaceName ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">Queue display</p>
              <p className="truncate text-2xl font-semibold tracking-tight">{workspaceName}</p>
            </>
          ) : (
            <p className="text-2xl font-semibold tracking-tight">Queue display</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 sm:gap-5">
        {status}
        {clock ? (
          <p className="hidden font-mono text-3xl font-semibold tabular-nums tracking-tight sm:block">{clock}</p>
        ) : null}
        <ThemeSwitcher
          mode={theme.mode}
          onModeChange={theme.setMode}
          palette={theme.palette}
          onPaletteChange={theme.setPalette}
          className="size-12 border border-border/70 bg-card/70 text-foreground shadow-sm backdrop-blur focus-visible:ring-offset-background [&_svg]:size-5"
        />
      </div>
    </header>
  );
}

function Stage({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center px-6 pb-16 pt-2">{children}</div>;
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'w-full max-w-2xl rounded-[2rem] border border-border/70 bg-card/80 p-8 text-card-foreground shadow-2xl shadow-black/5 backdrop-blur-xl sm:p-12',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── code prompt ───────────────────────────────────────────────────────────────

const NOTICE: Record<DisplayNotice, { text: string; tone: 'warning' | 'error' }> = {
  // Not an error: queuing ended normally, and the screen is waiting for the next code.
  stopped: { text: 'Queuing has stopped. Enter the new code when it starts again.', tone: 'warning' },
  // ⚠ The one message, whatever went wrong — see DISPLAY_CODE_REFUSAL_MESSAGE.
  refused: { text: DISPLAY_CODE_REFUSAL_MESSAGE, tone: 'error' },
  unreachable: { text: 'Cannot reach the server. Check the connection and try again.', tone: 'error' },
};

const STEPS = ['Open the queue console', 'Start queuing to get a code', 'Enter it here, or scan the QR code'];

/**
 * ⚠ IDENTICAL for a workspace that exists and one that does not: no name, no
 * hint. The workspace's name appears only after a pass is issued.
 */
function CodePrompt({ state, notice }: { state: QueueDisplayState; notice: DisplayNotice | null }) {
  const [code, setCode] = useState('');
  const ready = code.trim() !== '';

  return (
    <Stage>
      <Card className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col items-center text-center">
          <span className="grid size-20 place-items-center rounded-3xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <TvIcon className="size-10" />
          </span>
          <h1 className="mt-7 text-4xl font-semibold tracking-tight sm:text-5xl">Connect this display</h1>
          <p className="mt-4 max-w-lg text-xl text-muted-foreground">
            Enter the display code shown on the queue console. It changes every time queuing starts.
          </p>
        </div>

        <form
          className="mt-10 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) void state.exchange(code);
          }}
        >
          <input
            aria-label="Display code"
            className="h-24 w-full rounded-2xl border-2 border-input bg-background/80 px-6 text-center font-mono text-4xl font-semibold uppercase tracking-[0.3em] shadow-inner outline-none transition placeholder:text-muted-foreground/40 focus:border-primary focus:ring-4 focus:ring-primary/20 sm:text-5xl"
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
            disabled={state.exchanging || !ready}
            className="inline-flex h-20 items-center justify-center gap-3 rounded-2xl bg-primary text-3xl font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 disabled:opacity-50 disabled:shadow-none"
          >
            {state.exchanging ? <SpinnerIcon className="size-7" /> : null}
            {state.exchanging ? 'Opening…' : 'Open'}
            {state.exchanging ? null : <ArrowRightIcon className="size-7" />}
          </button>
        </form>

        {notice ? (
          <div
            role="alert"
            className={cn(
              'mt-6 flex items-start gap-3 rounded-2xl px-5 py-4 text-xl font-medium',
              NOTICE[notice].tone === 'warning'
                ? 'bg-status-warning text-status-warning-foreground'
                : 'bg-status-error text-status-error-foreground',
            )}
          >
            <AlertIcon className="mt-0.5 size-6" />
            <span>{NOTICE[notice].text}</span>
          </div>
        ) : null}

        <ol className="mt-10 grid gap-4 border-t border-border/70 pt-8 text-lg text-muted-foreground sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step} className="flex items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-base font-semibold text-foreground">
                {index + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </Card>
    </Stage>
  );
}

// ── start ─────────────────────────────────────────────────────────────────────

const START_FEATURES = [
  { label: 'Plays the call chime', icon: BellIcon },
  { label: 'Reads numbers aloud', icon: SpeechIcon },
  { label: 'Keeps the screen awake', icon: SunIcon },
];

/**
 * ⚠ THE UNLOCK SCREEN. Browsers refuse sound, speech and a wake lock without a
 * gesture, and a board that never asked would chime into silence and let the TV
 * sleep at 2pm — both indistinguishable from working until a customer misses
 * their number.
 */
function StartDisplay({ state, workspaceName }: { state: QueueDisplayState; workspaceName: string }) {
  return (
    <Stage>
      <Card className="max-w-3xl text-center animate-in fade-in zoom-in-95 duration-500">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-muted-foreground">Ready to show</p>
        <h1 className="mt-3 text-5xl font-semibold tracking-tight sm:text-6xl">{workspaceName}</h1>

        <button
          type="button"
          // biome-ignore lint/a11y/noAutofocus: a TV is driven by a remote with no pointer — focus already on the one button is what makes OK start the display.
          autoFocus
          onClick={() => void state.start()}
          className="mt-12 inline-flex items-center gap-5 rounded-full bg-primary py-5 pl-5 pr-12 text-4xl font-semibold text-primary-foreground shadow-2xl shadow-primary/30 transition hover:scale-[1.02] hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-8 focus-visible:ring-primary/30"
        >
          <span className="grid size-16 place-items-center rounded-full bg-primary-foreground/15">
            <PlayIcon className="size-8 translate-x-0.5" />
          </span>
          Start display
        </button>

        <p className="mx-auto mt-8 max-w-xl text-xl text-muted-foreground">
          Press once, so this screen can play the call chime, read numbers aloud and stay awake.
        </p>

        <ul className="mt-10 grid gap-3 sm:grid-cols-3">
          {START_FEATURES.map(({ label, icon: FeatureIcon }) => (
            <li
              key={label}
              className="flex items-center justify-center gap-3 rounded-2xl border border-border/70 bg-background/60 px-4 py-4 text-lg"
            >
              <FeatureIcon className="size-6 text-primary" />
              {label}
            </li>
          ))}
        </ul>
      </Card>
    </Stage>
  );
}

// ── board ─────────────────────────────────────────────────────────────────────

function LivePill({ state, now }: { state: QueueDisplayState; now: number }) {
  const stale = isStale(state.disconnectedSince, now);
  const live = !stale && state.board !== null && state.disconnectedSince === null;
  const label = stale ? 'Reconnecting' : live ? 'Live' : 'Connecting';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2.5 rounded-full px-4 py-2 text-lg font-semibold',
        stale && 'bg-status-error text-status-error-foreground',
        live && 'bg-status-success text-status-success-foreground',
        !stale && !live && 'bg-muted text-muted-foreground',
      )}
    >
      <span className="relative flex size-3">
        {live ? (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-50" />
        ) : null}
        <span className="relative inline-flex size-3 rounded-full bg-current" />
      </span>
      {label}
    </span>
  );
}

function Board({ state, now }: { state: QueueDisplayState; now: number }) {
  const [showFilter, setShowFilter] = useState(false);

  const stale = isStale(state.disconnectedSince, now);
  const board = state.board ? filterBoard(state.board, state.filter) : null;
  const rows = board ? servingRows(board) : [];
  const recent = board?.recent ?? [];

  return (
    <div className="relative flex flex-1 flex-col gap-6 px-6 pb-6 sm:px-10 sm:pb-8">
      {stale ? (
        <div
          role="status"
          className="flex items-center gap-4 rounded-2xl bg-status-error px-6 py-4 text-2xl font-semibold text-status-error-foreground"
        >
          <WifiOffIcon className="size-8" />
          Reconnecting… the numbers below may be out of date.
        </div>
      ) : null}

      <div
        className={cn(
          'grid flex-1 gap-6 transition duration-500 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]',
          stale && 'opacity-40 grayscale',
        )}
      >
        <section className="flex flex-col rounded-[2rem] border border-border/70 bg-card/70 p-6 shadow-xl shadow-black/5 backdrop-blur-xl sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-3xl font-semibold tracking-tight">Now serving</h2>
            {rows.length > 0 ? (
              <span className="rounded-full bg-muted px-4 py-1.5 text-lg font-medium text-muted-foreground">
                {rows.length} {rows.length === 1 ? 'window' : 'windows'}
              </span>
            ) : null}
          </div>

          {board === null ? (
            <EmptyState icon={<SpinnerIcon className="size-10" />} text="Connecting…" />
          ) : rows.length === 0 ? (
            <EmptyState icon={<ClockIcon className="size-10" />} text="Waiting for the first number to be called." />
          ) : (
            /* Stable order, by window name: people find their window in the same place every time, and the newest call is marked by colour. */
            <ul
              className={cn(
                'mt-6 grid flex-1 auto-rows-fr gap-5',
                rows.length === 1
                  ? 'grid-cols-1'
                  : rows.length <= 4
                    ? 'md:grid-cols-2'
                    : 'md:grid-cols-2 2xl:grid-cols-3',
              )}
            >
              {rows.map((call) => (
                <ServingCard
                  key={call.windowId}
                  call={call}
                  calling={isPulsing(state.announced, call.ticketId, now)}
                  size={rows.length === 1 ? 'hero' : rows.length <= 4 ? 'large' : 'regular'}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col rounded-[2rem] border border-border/70 bg-card/70 p-6 shadow-xl shadow-black/5 backdrop-blur-xl sm:p-8">
          <h2 className="text-3xl font-semibold tracking-tight">Recent calls</h2>
          {recent.length === 0 ? (
            <p className="mt-6 text-xl text-muted-foreground">Calls will appear here as they are made.</p>
          ) : (
            <ol className="mt-6 flex flex-col gap-2">
              {recent.map((call, index) => (
                <li
                  key={`${call.ticketId}-${call.calledAt}`}
                  className={cn('flex items-center gap-4 rounded-2xl px-3 py-3', index === 0 && 'bg-muted/70')}
                >
                  <span className="min-w-[6.5rem] rounded-xl bg-background px-3 py-1.5 text-center font-mono text-2xl font-bold tabular-nums ring-1 ring-border">
                    {call.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-2xl">{call.windowName}</span>
                  <span className="text-lg tabular-nums text-muted-foreground">{clockTime(call.calledAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-4">
        {state.soundReady ? (
          <span className="inline-flex items-center gap-2.5 rounded-full bg-card/70 px-5 py-2.5 text-lg text-muted-foreground ring-1 ring-border/70 backdrop-blur">
            <VolumeIcon className="size-5" />
            Sound on
          </span>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-2.5 rounded-full bg-status-warning px-5 py-2.5 text-lg font-semibold text-status-warning-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
            onClick={() => void state.enableSound()}
          >
            <VolumeOffIcon className="size-5" />
            Sound is off — press to turn it on
          </button>
        )}
        <button
          type="button"
          aria-expanded={showFilter}
          className="inline-flex items-center gap-2.5 rounded-full bg-card/70 px-5 py-2.5 text-lg font-medium ring-1 ring-border/70 backdrop-blur transition hover:bg-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
          onClick={() => setShowFilter((open) => !open)}
        >
          <FilterIcon className="size-5" />
          {state.filter.length
            ? `Showing ${state.filter.length} line${state.filter.length === 1 ? '' : 's'}`
            : 'All lines'}
        </button>
      </footer>

      {showFilter && state.board ? (
        <div className="absolute bottom-24 right-6 z-10 w-[min(26rem,calc(100%-3rem))] rounded-3xl border border-border bg-popover p-6 text-popover-foreground shadow-2xl animate-in fade-in slide-in-from-bottom-2 sm:right-10">
          <p className="text-2xl font-semibold">Show on this screen</p>
          <div className="mt-4 flex flex-col gap-2">
            {state.board.lines.map((line) => {
              const checked = state.filter.includes(line.id);
              return (
                <label
                  key={line.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-4 rounded-2xl border px-4 py-3 text-xl transition',
                    checked ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-6 accent-primary"
                    checked={checked}
                    onChange={(event) =>
                      state.setFilter(
                        event.target.checked ? [...state.filter, line.id] : state.filter.filter((id) => id !== line.id),
                      )
                    }
                  />
                  <span className="rounded-lg bg-muted px-2 py-0.5 font-mono font-semibold">{line.prefix}</span>
                  <span className="truncate">{line.name}</span>
                </label>
              );
            })}
          </div>
          <p className="mt-4 text-base text-muted-foreground">Nothing ticked shows every line. Kept on this screen.</p>
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 py-16 text-center text-muted-foreground">
      <span className="grid size-20 place-items-center rounded-full bg-muted">{icon}</span>
      <p className="text-3xl">{text}</p>
    </div>
  );
}

const CARD_SIZES = {
  hero: { label: 'text-[clamp(6rem,16vw,14rem)]', window: 'text-6xl' },
  large: { label: 'text-8xl', window: 'text-4xl' },
  regular: { label: 'text-7xl', window: 'text-3xl' },
} as const;

/** One window's latest call. While `calling`, it lights up in the palette's primary. */
function ServingCard({
  call,
  calling,
  size,
}: {
  call: QueueBoardCallView;
  calling: boolean;
  size: keyof typeof CARD_SIZES;
}) {
  const muted = calling ? 'text-primary-foreground/80' : 'text-muted-foreground';
  return (
    <li
      className={cn(
        'relative flex flex-col justify-between gap-6 overflow-hidden rounded-3xl border-2 p-6 transition-all duration-500 sm:p-8',
        // One window: the whole panel is its stage, so the call sits in the middle of it.
        size === 'hero' && 'items-center text-center',
        calling
          ? 'scale-[1.01] border-primary bg-primary text-primary-foreground shadow-2xl shadow-primary/30'
          : 'border-border/70 bg-background/70',
      )}
    >
      {calling ? <span aria-hidden="true" className="absolute inset-0 animate-pulse bg-primary-foreground/10" /> : null}
      <span className={cn('relative text-lg font-semibold uppercase tracking-[0.25em]', muted)}>
        {calling ? 'Now calling' : 'Serving'}
      </span>
      <span
        className={cn('relative font-mono font-black leading-none tracking-tight tabular-nums', CARD_SIZES[size].label)}
      >
        {call.label}
      </span>
      <div
        className={cn('relative flex flex-wrap items-end justify-between gap-4', size === 'hero' && 'justify-center')}
      >
        <span className="min-w-0">
          <span className={cn('block text-xl', muted)}>Please proceed to</span>
          <span className={cn('block truncate font-semibold tracking-tight', CARD_SIZES[size].window)}>
            {call.windowName}
          </span>
        </span>
        {call.nickname ? (
          <span
            className={cn(
              'rounded-full px-4 py-1.5 text-xl font-medium',
              calling ? 'bg-primary-foreground/15' : 'bg-muted text-muted-foreground',
            )}
          >
            {call.nickname}
          </span>
        ) : null}
      </div>
    </li>
  );
}
