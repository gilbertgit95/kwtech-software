'use client';

import { cn } from '@kwtech/web-ui/react';
import { Check, LoaderCircle } from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { PRINT_AGENT_NAME_MAX } from '../../domain/agents.js';
import type { PrintAgentView, PrintPairingCodeView } from '../print-client.js';
import { buttonClass, INPUT_CLASS } from '../ui.js';
import { newlyPaired, pairCommand } from '../view.js';
import { CopyButton } from './copy-button.js';
import { Modal } from './modal.js';

/**
 * Pairing a computer, as three steps in one dialog: name it, type the code on
 * it, and see it arrive.
 *
 * ⚠ THE CODE IS SHOWN ONCE, HERE. Closing the dialog is the end of it: the
 * server keeps only its hash, and a person who lost it makes another.
 *
 * ⚠ "PAIRED" IS READ FROM THE LIST, NOT ASSUMED. The page reads the computers
 * again every few seconds while this is open, and the step turns when one
 * appears that was not there when the code was made (`newlyPaired`).
 */
export function PairingDialog({
  open,
  agents,
  expiresText,
  onCreate,
  onClose,
  onGuide,
}: {
  open: boolean;
  /** The workspace's computers as last read; the dialog watches for a new one. */
  agents: readonly PrintAgentView[];
  /** When the code stops working, formatted in the workspace's zone by the caller. */
  expiresText: (iso: string) => string | null;
  /** Make a code. Throws with a sentence for the reader when it is refused. */
  onCreate: (name: string) => Promise<PrintPairingCodeView>;
  onClose: () => void;
  /** Open the setup guide instead. Left out: no way there from here. */
  onGuide?: (() => void) | undefined;
}) {
  const nameId = useId();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ code: PrintPairingCodeView; known: ReadonlySet<string> } | null>(null);

  // A dialog opened again starts over: the last code is spent or forgotten.
  useEffect(() => {
    if (open) return;
    setName('');
    setRefusal(null);
    setPairing(null);
  }, [open]);

  const joined = pairing ? newlyPaired(pairing.known, agents) : null;
  const command = pairing ? pairCommand(pairing.code.code) : null;
  const step = joined ? 3 : pairing ? 2 : 1;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const known = new Set(agents.map((agent) => agent.id));
      setPairing({ code: await onCreate(name), known });
    } catch (caught) {
      setRefusal(caught instanceof Error ? caught.message : 'Could not make a code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      busy={busy}
      title="Add a computer"
      description="The computer your printers are connected to. It needs the print agent installed."
      onClose={onClose}
    >
      <ol aria-label="Steps" className="flex items-center gap-2 text-xs font-medium">
        {['Name it', 'Type the code', 'Paired'].map((label, index) => (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              aria-current={step === index + 1 ? 'step' : undefined}
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px]',
                step > index + 1 && 'border-transparent bg-status-success text-status-success-foreground',
                step === index + 1 && 'border-transparent bg-primary text-primary-foreground',
                step < index + 1 && 'border-border text-muted-foreground',
              )}
            >
              {step > index + 1 ? <Check aria-hidden="true" className="size-3.5" /> : index + 1}
            </span>
            <span className={cn('truncate', step === index + 1 ? 'text-foreground' : 'text-muted-foreground')}>
              {label}
            </span>
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor={nameId} className="flex flex-col gap-1.5 text-sm font-medium">
            A name for this computer
            <input
              id={nameId}
              className={INPUT_CLASS}
              value={name}
              maxLength={PRINT_AGENT_NAME_MAX}
              placeholder="Front desk PC"
              // biome-ignore lint/a11y/noAutofocus: the dialog opens because the person asked to type this.
              autoFocus
              aria-describedby={`${nameId}-hint`}
              onChange={(event) => setName(event.target.value)}
            />
            <span id={`${nameId}-hint`} className="text-xs font-normal text-muted-foreground">
              What people will see when they choose a printer, so name it for where it is.
            </span>
          </label>
          {refusal ? (
            <p role="alert" className="rounded-lg bg-status-error px-3 py-2 text-sm text-status-error-foreground">
              {refusal}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass('ghost')} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={buttonClass('primary')} disabled={busy || !name.trim()}>
              {busy ? 'Making a code…' : 'Get a code'}
            </button>
          </div>
        </form>
      ) : null}

      {step === 2 && pairing ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background px-3 py-5">
            <p className="text-xs font-medium text-muted-foreground">One-time code</p>
            <p className="select-all font-mono text-3xl font-semibold tracking-[0.2em]">{pairing.code.code}</p>
            <CopyButton text={pairing.code.code} label="Copy the code" />
          </div>
          {command ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">On that computer, in the print agent’s folder, run</p>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background py-1.5 pl-3 pr-1.5">
                <code className="min-w-0 flex-1 select-all truncate font-mono text-xs">{command}</code>
                <CopyButton text={command} label="Copy the command" />
              </div>
            </div>
          ) : null}
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            Waiting for the computer…
          </p>
          {onGuide ? (
            <p className="text-xs text-muted-foreground">
              Is the agent not on that computer yet?{' '}
              <button
                type="button"
                className="font-medium text-foreground underline underline-offset-2"
                onClick={onGuide}
              >
                Open the setup guide
              </button>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            The code works once
            {expiresText(pairing.code.expiresAt) ? `, until ${expiresText(pairing.code.expiresAt)}` : ''}. This is the
            only time it is shown.
          </p>
          <div className="flex justify-end">
            <button type="button" className={buttonClass('secondary')} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 && joined ? (
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-status-success text-status-success-foreground">
            <Check aria-hidden="true" className="size-6" />
          </span>
          <div>
            <p role="status" className="text-base font-semibold">
              “{joined.name}” is paired
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Start the agent on it (<code className="font-mono text-xs">print-agent start</code>) and its printers
              appear here within a minute.
            </p>
          </div>
          <button type="button" className={buttonClass('primary')} onClick={onClose}>
            Done
          </button>
        </div>
      ) : null}
    </Modal>
  );
}
