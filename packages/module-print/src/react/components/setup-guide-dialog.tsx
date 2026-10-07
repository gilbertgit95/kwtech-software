'use client';

import type { ReactNode } from 'react';
import { buttonClass } from '../ui.js';
import { AGENT_COMMAND, type AgentServerSettings, agentSettingsFile } from '../view.js';
import { CopyButton } from './copy-button.js';
import { Modal } from './modal.js';

/**
 * How to set a computer up to print for this workspace, start to finish, for
 * the person standing at that computer.
 *
 * It is on the page because that is where the question is asked: somebody
 * presses "Add a computer", is handed a code, and has nothing to type it
 * into. The same steps, at length, are in `apps/print-agent/README.md`.
 *
 * ⚠ THE SERVER'S ADDRESSES ARE THE APP'S TO GIVE (`printWebModule({ wsUrl })`).
 * Shown when known, with a copy button; otherwise the two lines are blank and
 * the guide says to ask. They are never guessed.
 */
export function SetupGuideDialog({
  open,
  server,
  canPair,
  onClose,
  onPair,
}: {
  open: boolean;
  /** Where the agent finds the server, or null when the app did not say. */
  server: AgentServerSettings | null;
  /** Whether this person may make a pairing code. */
  canPair: boolean;
  onClose: () => void;
  /** Go on to "Add a computer". */
  onPair: () => void;
}) {
  const settings = agentSettingsFile(server);
  return (
    <Modal
      open={open}
      title="Set up a computer to print"
      description="Do this once on the computer your printers are connected to. It takes about ten minutes."
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            Close
          </button>
          {canPair ? (
            <button type="button" className={buttonClass('primary')} onClick={onPair}>
              Add a computer
            </button>
          ) : null}
        </>
      }
    >
      <ol className="flex flex-col gap-4">
        <Step number={1} title="Check the computer">
          <p>
            A Windows 10 or 11 computer that stays on while you print, with each printer installed and able to print a
            Windows test page. It needs Node.js 22 or newer.
          </p>
        </Step>

        <Step number={2} title="Put the print agent on it">
          <p>
            The agent is a small folder with one program in it, <Code>print-agent.mjs</Code>. Whoever looks after this
            system gives it to you. Put it somewhere it will stay, such as <Code>C:\kwtech-print-agent</Code>.
          </p>
        </Step>

        <Step number={3} title="Tell it where the server is">
          <p>
            In that folder, make a text file named <Code>.env.local</Code> with these two lines
            {server ? '.' : ', and fill in the two addresses. Ask whoever looks after this system for them.'}
          </p>
          <Block text={settings} label="Copy the settings" />
          <p className="text-xs">
            Both must be the same server. Anywhere but on this same computer they start with <Code>https://</Code> and{' '}
            <Code>wss://</Code>.
          </p>
        </Step>

        <Step number={4} title="Pair it with this workspace">
          <p>
            {canPair
              ? 'Press “Add a computer” here, give it a name, and you get a one-time code. '
              : 'Somebody who manages printing here presses “Add a computer” and gives you a one-time code. '}
            Open PowerShell in the agent’s folder and run:
          </p>
          <Block text={`${AGENT_COMMAND} pair YOUR-CODE`} label="Copy" />
          <p className="text-xs">The code works once, for ten minutes. Pairing is done once per computer.</p>
        </Step>

        <Step number={5} title="Start it, and leave it running">
          <Block text={`${AGENT_COMMAND} start`} label="Copy" />
          <p>
            It says “Connected”, and within a minute its printers appear on this page. Printing works only while it is
            running, so keep that window open, or have Windows start it when the computer is turned on.
          </p>
        </Step>

        <Step number={6} title="Check each printer">
          <p>
            Press “Test print” on a printer here and measure the page. If the lines are not the length it says, open
            that printer’s Printing Preferences in Windows: set its paper to the one that is loaded, and turn off any
            “reduce/enlarge” or “fit to page”.
          </p>
        </Step>
      </ol>

      <div className="rounded-xl border border-border bg-background p-3 text-sm">
        <p className="font-medium">If something does not work</p>
        <ul className="mt-1.5 flex flex-col gap-1.5 text-muted-foreground">
          <li>
            <strong className="font-medium text-foreground">“The server could not be reached”</strong>: an address in{' '}
            <Code>.env.local</Code> is wrong, or the computer has no way to it.
          </li>
          <li>
            <strong className="font-medium text-foreground">“The server did not accept that code”</strong>: it was
            mistyped, used already, or is more than ten minutes old. Make a new one.
          </li>
          <li>
            <strong className="font-medium text-foreground">The computer shows “Offline” here</strong>: the agent is not
            running on it. Run the start command again.
          </li>
          <li>
            <strong className="font-medium text-foreground">A printer is missing</strong>: Windows does not have it
            either. Install it there first; the agent reads the list again every five minutes.
          </li>
        </ul>
      </div>
    </Modal>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
      >
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{title}</p>
        {children}
      </div>
    </li>
  );
}

function Code({ children }: { children: string }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{children}</code>;
}

/** A line or two to type or paste, with a button that copies it. */
function Block({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-background py-1.5 pl-3 pr-1.5">
      {/* Wrapped, not scrolled: an address cut off at the edge of a narrow dialog is one typed wrong. */}
      <pre className="min-w-0 flex-1 select-all whitespace-pre-wrap break-all py-1 font-mono text-xs text-foreground">
        {text}
      </pre>
      <CopyButton text={text} label={label} />
    </div>
  );
}
