'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { ConfirmDialog, QrCode } from '@kwtech/web-ui/react';
import { useEffect, useState } from 'react';
import { QUEUE_FEATURE } from '../../feature-keys.js';
import type { QueueConsoleState } from '../use-queue-console.js';
import { clockTime, displayLink, sessionAge } from '../view/console-view.js';
import { buttonClass, Section } from './ui.js';

/**
 * Start and Stop, and — for holders of `queue:start` — the display code.
 *
 * Start and Stop live on the console rather than in settings because they are
 * the first and last acts of the day.
 */
export function SessionPanel({ state }: { state: QueueConsoleState }) {
  const { view, code, busy, run, client, scope } = state;
  const canStart = useHoldsFeature(QUEUE_FEATURE.start);
  const canStop = useHoldsFeature(QUEUE_FEATURE.stop);
  const [continueNumbering, setContinueNumbering] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  if (!view) return null;
  const session = view.session;

  if (!session) {
    return (
      <Section
        title="Queuing has not started"
        description={
          canStart
            ? 'Starting opens the queue for calling and generates the code that admits public displays.'
            : 'Somebody with the right to start queuing has to start it before any number can be called.'
        }
      >
        {canStart ? (
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              className={buttonClass('primary')}
              disabled={busy}
              onClick={() => run(() => client.startQueue(scope, continueNumbering))}
            >
              Start queuing
            </button>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={continueNumbering}
                onChange={(event) => setContinueNumbering(event.target.checked)}
              />
              {/*
                ⚠ Off by default, and worth the words: restarting without it sends
                every line back to its first number while the paper slips in
                people's hands carry on.
              */}
              Continue numbering from the last session
            </label>
          </div>
        ) : null}
      </Section>
    );
  }

  const age = sessionAge(session.startedAt);
  const started =
    age === 'today'
      ? `today at ${clockTime(session.startedAt)}`
      : age === 'yesterday'
        ? 'yesterday'
        : 'more than a day ago';

  return (
    <Section
      title="Queuing is running"
      description={
        <span className={age === 'today' ? undefined : 'font-medium text-destructive'}>
          Running since {started}.
          {age === 'today'
            ? null
            : ' Nothing stops a session at closing time — stop it, and start again when you open.'}
        </span>
      }
      actions={
        canStop ? (
          <button type="button" className={buttonClass('danger')} disabled={busy} onClick={() => setConfirmStop(true)}>
            Stop queuing
          </button>
        ) : null
      }
    >
      {canStart && code ? <DisplayCodePanel code={code} /> : null}
      {canStart && !code ? <p className="text-sm text-muted-foreground">Loading the display code…</p> : null}

      <ConfirmDialog
        open={confirmStop}
        title="Stop queuing?"
        description="Every public display goes dark, and nobody can call a number until queuing starts again. Window assignments are kept. The next start generates a new display code."
        confirmLabel="Stop queuing"
        pending={busy}
        onCancel={() => setConfirmStop(false)}
        onConfirm={async () => {
          setConfirmStop(false);
          await run(() => client.stopQueue(scope));
        }}
      />
    </Section>
  );
}

function DisplayCodePanel({ code }: { code: NonNullable<QueueConsoleState['code']> }) {
  // The origin is only known in the browser; rendered on the server it would be wrong.
  const [origin, setOrigin] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  const link = origin && code.displayPath ? displayLink(origin, code.displayPath, code.code) : null;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-wrap items-start gap-6">
      {link ? <QrCode value={link} label={`QR code that opens the display with code ${code.code}`} /> : null}
      <div className="flex min-w-60 flex-1 flex-col gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Display code</p>
          <p className="font-mono text-4xl font-semibold tracking-widest text-foreground">{code.code}</p>
        </div>

        {code.locked ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            Too many wrong codes. This code no longer opens a display — stop and restart queuing to get a new one.
          </p>
        ) : null}

        <p className="text-sm text-foreground">
          {code.activeDisplays} of {code.maxDisplays} displays connected
        </p>

        {link ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass('secondary')} onClick={copy}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a href={link} target="_blank" rel="noreferrer" className={buttonClass('secondary')}>
              Open display
            </a>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            The display link is not available here; open the display page on the TV and type the code.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Scan the code with a phone or the TV, or type it on the display. It works only until queuing stops, so there
          is no point printing it. Every device that opens the display counts as one of the {code.maxDisplays}.
        </p>
      </div>
    </div>
  );
}
