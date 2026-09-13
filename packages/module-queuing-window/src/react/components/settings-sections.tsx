'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { ConfirmDialog } from '@kwtech/web-ui/react';
import { useEffect, useState } from 'react';
import { QUEUE_FEATURE } from '../../feature-keys.js';
import type { QueueLineView, QueueStaffMemberView, QueueWindowView } from '../queue-client.js';
import type { QueueConsoleState } from '../use-queue-console.js';
import { activeLines, activeWindows, seatAt } from '../view/console-view.js';
import { buttonClass, inputClass, Section } from './ui.js';

/** A whole number typed into a field, or null for empty or nonsense. */
const wholeNumber = (raw: string): number | null =>
  raw.trim() !== '' && /^\d+$/.test(raw.trim()) ? Number(raw) : null;

// ── lines ─────────────────────────────────────────────────────────────────────

/** Lines: numbered sequences with a prefix. `queue:manage_windows`. */
export function LinesSection({ state }: { state: QueueConsoleState }) {
  const { view } = state;
  if (!view) return null;
  return (
    <Section
      title="Lines"
      description="Each line is its own numbered sequence — C for Cashier, E for Enrollment. A prefix cannot be changed once a line exists: it is printed on every slip already handed out."
    >
      <div className="flex flex-col gap-3">
        {view.lines.map((line) => (
          <LineRow key={line.id} state={state} line={line} running={view.session !== null} />
        ))}
        <NewLine state={state} />
      </div>
    </Section>
  );
}

function LineRow({ state, line, running }: { state: QueueConsoleState; line: QueueLineView; running: boolean }) {
  const { busy, run, client, scope } = state;
  const [name, setName] = useState(line.name);
  const [start, setStart] = useState(String(line.startNumber));
  const [end, setEnd] = useState(String(line.endNumber));
  const [pad, setPad] = useState(String(line.padTo));
  const [next, setNext] = useState('');
  useEffect(() => {
    setName(line.name);
    setStart(String(line.startNumber));
    setEnd(String(line.endNumber));
    setPad(String(line.padTo));
  }, [line]);

  const dirty =
    name !== line.name ||
    start !== String(line.startNumber) ||
    end !== String(line.endNumber) ||
    pad !== String(line.padTo);

  return (
    <div className={`rounded-md border border-border p-3 ${line.archived ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-end gap-2">
        <span className="w-10 font-mono text-lg font-semibold text-foreground">{line.prefix}</span>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Name
          <input className={`${inputClass} w-48`} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <input
            className={`${inputClass} w-20`}
            inputMode="numeric"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <input
            className={`${inputClass} w-20`}
            inputMode="numeric"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Digits
          <input
            className={`${inputClass} w-16`}
            inputMode="numeric"
            value={pad}
            onChange={(event) => setPad(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={buttonClass('secondary')}
          disabled={busy || !dirty}
          onClick={() =>
            run(() =>
              client.updateLine(scope, line.id, {
                name,
                startNumber: wholeNumber(start),
                endNumber: wholeNumber(end),
                padTo: wholeNumber(pad),
              }),
            )
          }
        >
          Save
        </button>
        <button
          type="button"
          className={buttonClass('ghost')}
          disabled={busy}
          onClick={() => run(() => client.setLineArchived(scope, line.id, !line.archived))}
        >
          {line.archived ? 'Unarchive' : 'Archive'}
        </button>
      </div>

      {running && !line.archived ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const value = wholeNumber(next);
            if (value === null) return;
            if (await run(() => client.setLineNextNumber(scope, line.id, value))) setNext('');
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {/*
              The paper and the system drift: a fresh roll at 150, a torn slip.
              Without this, realigning means pressing Call next again and again.
            */}
            Set the next number Call next calls
            <input
              className={`${inputClass} w-28`}
              inputMode="numeric"
              placeholder={String(line.startNumber)}
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </label>
          <button type="submit" className={buttonClass('secondary')} disabled={busy || wholeNumber(next) === null}>
            Set
          </button>
        </form>
      ) : null}
    </div>
  );
}

function NewLine({ state }: { state: QueueConsoleState }) {
  const { busy, run, client, scope } = state;
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await run(() => client.createLine(scope, { name, prefix }))) {
          setName('');
          setPrefix('');
        }
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Prefix
        <input
          className={`${inputClass} w-20 font-mono uppercase`}
          maxLength={3}
          value={prefix}
          onChange={(event) => setPrefix(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        New line
        <input
          className={`${inputClass} w-48`}
          placeholder="Cashier"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <button type="submit" className={buttonClass('primary')} disabled={busy || !name.trim() || !prefix.trim()}>
        Add line
      </button>
    </form>
  );
}

// ── windows ───────────────────────────────────────────────────────────────────

/** Windows, and which lines each calls from. `queue:manage_windows`. */
export function WindowsSection({ state }: { state: QueueConsoleState }) {
  const { view } = state;
  if (!view) return null;
  return (
    <Section
      title="Windows"
      description="The counters, desks and booths staff call numbers to. Archiving a window frees whoever is assigned to it."
    >
      <div className="flex flex-col gap-3">
        {view.windows.map((window) => (
          <WindowRow key={window.id} state={state} window={window} lines={activeLines(view)} />
        ))}
        <NewWindow state={state} />
      </div>
    </Section>
  );
}

function WindowRow({
  state,
  window,
  lines,
}: {
  state: QueueConsoleState;
  window: QueueWindowView;
  lines: QueueLineView[];
}) {
  const { busy, run, client, scope } = state;
  const [name, setName] = useState(window.name);
  const [served, setServed] = useState<string[]>(window.lineIds);
  useEffect(() => {
    setName(window.name);
    setServed(window.lineIds);
  }, [window]);

  const linesChanged = served.length !== window.lineIds.length || served.some((id) => !window.lineIds.includes(id));

  return (
    <div className={`rounded-md border border-border p-3 ${window.archived ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-end gap-2">
        <input
          className={`${inputClass} w-56`}
          value={name}
          aria-label="Window name"
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="button"
          className={buttonClass('secondary')}
          disabled={busy || name === window.name}
          onClick={() => run(() => client.renameWindow(scope, window.id, name))}
        >
          Rename
        </button>
        <button
          type="button"
          className={buttonClass('ghost')}
          disabled={busy}
          onClick={() => run(() => client.setWindowArchived(scope, window.id, !window.archived))}
        >
          {window.archived ? 'Unarchive' : 'Archive'}
        </button>
      </div>
      {lines.length > 1 ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Calls from:</span>
          {lines.map((line) => (
            <label key={line.id} className="flex items-center gap-1 text-foreground">
              <input
                type="checkbox"
                checked={served.includes(line.id)}
                onChange={(event) =>
                  setServed((current) =>
                    event.target.checked ? [...current, line.id] : current.filter((id) => id !== line.id),
                  )
                }
              />
              {line.prefix} {line.name}
            </label>
          ))}
          <span className="text-xs text-muted-foreground">
            {served.length === 0 ? 'None ticked means every line.' : null}
          </span>
          <button
            type="button"
            className={buttonClass('secondary')}
            disabled={busy || !linesChanged}
            onClick={() => run(() => client.setWindowLines(scope, window.id, served))}
          >
            Save lines
          </button>
        </div>
      ) : null}
    </div>
  );
}

function NewWindow({ state }: { state: QueueConsoleState }) {
  const { busy, run, client, scope } = state;
  const [name, setName] = useState('');
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await run(() => client.createWindow(scope, name))) setName('');
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        New window
        <input
          className={`${inputClass} w-56`}
          placeholder="Window 3"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <button type="submit" className={buttonClass('primary')} disabled={busy || !name.trim()}>
        Add window
      </button>
    </form>
  );
}

// ── assignments ───────────────────────────────────────────────────────────────

/** Who sits at which window. `queue:assign_windows`; clearing a nickname is `queue:manage_windows`. */
export function AssignmentsSection({ state }: { state: QueueConsoleState }) {
  const { view, client, scope, busy, run } = state;
  const canClearNicknames = useHoldsFeature(QUEUE_FEATURE.manageWindows);
  const [candidates, setCandidates] = useState<QueueStaffMemberView[] | null>(null);
  const [confirm, setConfirm] = useState<{ windowId: string; userId: string; occupant: string } | null>(null);

  useEffect(() => {
    client
      .staffCandidates(scope)
      .then(setCandidates)
      .catch(() => setCandidates([]));
  }, [client, scope]);

  if (!view) return null;
  const windows = activeWindows(view);

  const assign = (windowId: string, userId: string, confirmReplace: boolean) =>
    run(() => client.assignWindow(scope, windowId, userId, confirmReplace));

  return (
    <Section
      title="Assignments"
      description="Assignments are kept when queuing stops, so tomorrow opens with the same people at the same windows. Only people who can serve in this workspace are offered."
    >
      {windows.length === 0 ? <p className="text-sm text-muted-foreground">Add a window first.</p> : null}
      {candidates !== null && candidates.length === 0 && windows.length > 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">
          Nobody in this workspace can serve yet — give somebody a role with “Serve at a window”.
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {windows.map((window) => (
          <AssignmentRow
            key={window.id}
            state={state}
            window={window}
            candidates={candidates ?? []}
            canClearNicknames={canClearNicknames}
            onAssign={(userId) => {
              const seat = seatAt(view, window.id);
              if (seat && seat.userId !== userId)
                setConfirm({ windowId: window.id, userId, occupant: seat.displayName });
              else void assign(window.id, userId, false);
            }}
          />
        ))}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title="Replace them at this window?"
        description={
          confirm ? `${confirm.occupant} is assigned to this window. Assigning somebody else moves them off it.` : ''
        }
        confirmLabel="Replace"
        pending={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const target = confirm;
          setConfirm(null);
          if (target) await assign(target.windowId, target.userId, true);
        }}
      />
    </Section>
  );
}

function AssignmentRow({
  state,
  window,
  candidates,
  canClearNicknames,
  onAssign,
}: {
  state: QueueConsoleState;
  window: QueueWindowView;
  candidates: QueueStaffMemberView[];
  canClearNicknames: boolean;
  onAssign: (userId: string) => void;
}) {
  const { view, busy, run, client, scope } = state;
  const [userId, setUserId] = useState('');
  const seat = view ? seatAt(view, window.id) : null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 text-sm">
      <span className="w-40 font-medium text-foreground">{window.name}</span>
      <span className="min-w-48 flex-1 text-foreground">
        {seat ? seat.displayName : <span className="text-muted-foreground">Nobody</span>}
        {seat?.canServe === false ? (
          <span className="ml-2 text-xs text-destructive">can no longer serve here</span>
        ) : null}
        {seat?.nickname ? (
          <span className="ml-2 text-xs text-muted-foreground">
            shown as “{seat.nickname}”
            {canClearNicknames ? (
              <button
                type="button"
                className="ml-2 underline"
                disabled={busy}
                onClick={() => run(() => client.clearNickname(scope, seat.userId))}
              >
                clear
              </button>
            ) : null}
          </span>
        ) : null}
      </span>
      <select className={inputClass} value={userId} onChange={(event) => setUserId(event.target.value)}>
        <option value="">Assign…</option>
        {candidates.map((person) => (
          <option key={person.userId} value={person.userId}>
            {person.displayName}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={buttonClass('secondary')}
        disabled={busy || !userId}
        onClick={() => {
          onAssign(userId);
          setUserId('');
        }}
      >
        Assign
      </button>
      {seat ? (
        <button
          type="button"
          className={buttonClass('ghost')}
          disabled={busy}
          onClick={() => run(() => client.freeWindow(scope, window.id))}
        >
          Free
        </button>
      ) : null}
    </div>
  );
}

// ── displays ──────────────────────────────────────────────────────────────────

/** Whether TVs show nicknames. `queue:start` — the people who decide what a display publishes. */
export function DisplaySection({ state }: { state: QueueConsoleState }) {
  const { view, busy, run, client, scope } = state;
  if (!view) return null;
  return (
    <Section title="Public displays">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={view.settings.showStaffNames}
          disabled={busy}
          onChange={(event) => run(() => client.setShowStaffNames(scope, event.target.checked))}
        />
        <span>
          <span className="text-sm font-medium text-foreground">Show staff nicknames beside the numbers</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            Only a nickname a person set for themselves is ever shown — somebody without one appears with no name, never
            their account name. Changing this reaches every display at once.
          </span>
        </span>
      </label>
    </Section>
  );
}
