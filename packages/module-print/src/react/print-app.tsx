'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useHoldsFeature, useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { ConfirmDialog, cn } from '@kwtech/web-ui/react';
import { BookOpen, CircleAlert, Monitor, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PRINT_AGENT_HEARTBEAT_SECONDS } from '../domain/agents.js';
import { PRINT_FEATURE } from '../feature-keys.js';
import { ComputerCard } from './components/computer-card.js';
import { PairingDialog } from './components/pairing-dialog.js';
import { SetupGuideDialog } from './components/setup-guide-dialog.js';
import { TestPrintDialog } from './components/test-print-dialog.js';
import { createPrintClient, type PrintAgentView, type PrintClient, type PrintPrinterView } from './print-client.js';
import { buttonClass } from './ui.js';
import { agentServerSettings, cannotPrintReason, fleetSummary, fleetSummaryText } from './view.js';

/** How often the list is read again while a code is waiting to be typed: the new computer should appear by itself. */
const PAIRING_REREAD_MS = 3000;

/**
 * The workspace's printing side as a SUB-APP on the Apps page: the computers
 * paired to print for it, their printers, and pairing or revoking one.
 *
 * - Laid out by the BOX's width, never the viewport's (`@container`), because a
 *   grid cell is narrow on a wide screen.
 * - It never navigates: pairing and a test print each happen in a dialog.
 * - "Setup guide" is how a computer is made ready, for the person standing at
 *   it, with the server's two addresses to copy when the app gave them
 *   (`printWebModule({ wsUrl })`). Everybody sees it: whoever is at the
 *   computer is often not whoever may pair it.
 * - One line at the top says how things stand ("1 computer online · 4 printers
 *   ready"); a person opening this wants that before any list.
 * - "Add a computer" and "Revoke" show only to somebody holding
 *   `print:manage_agents`, and "Test print" to somebody holding `print:send`.
 *   Hiding is cosmetic — the API refuses too.
 * - The test print is the ruler page, which proves a printer prints at exact
 *   size. It is made in the browser and kept nowhere.
 * - ⚠ Every time shown is the WORKSPACE's (`useWorkspaceTimeZone`).
 * - ⚠ NOT LIVE. The list is read again on a timer — every heartbeat, and
 *   faster while a pairing code is waiting — because nothing is published when
 *   a computer connects or reports (PLAN §12). "Online" is at most a heartbeat
 *   or two behind.
 */
export function PrintApp({
  organizationId,
  workspaceId,
  client,
  wsUrl,
}: AppProps & {
  client?: PrintClient;
  /** The server's socket address as a computer outside reaches it, for the setup guide. Null: not said. */
  wsUrl?: string | null;
}) {
  const scope = useMemo(() => ({ organizationId, workspaceId }), [organizationId, workspaceId]);
  const api = useMemo(() => client ?? createPrintClient(), [client]);
  const timeZone = useWorkspaceTimeZone();
  const canManage = useHoldsFeature(PRINT_FEATURE.manageAgents);
  const canSend = useHoldsFeature(PRINT_FEATURE.send);

  const [agents, setAgents] = useState<PrintAgentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [guide, setGuide] = useState(false);
  const server = useMemo(() => agentServerSettings(wsUrl), [wsUrl]);
  const [revoking, setRevoking] = useState<PrintAgentView | null>(null);
  const [testing, setTesting] = useState<{ agent: PrintAgentView; printer: PrintPrinterView } | null>(null);

  const load = useCallback(async () => {
    try {
      setAgents(await api.agents(scope));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the printers.');
    }
  }, [api, scope]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), pairing ? PAIRING_REREAD_MS : PRINT_AGENT_HEARTBEAT_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [load, pairing]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function revoke() {
    const agent = revoking;
    if (!agent) return;
    setBusy(true);
    try {
      await api.revokeAgent(scope, agent.id);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.');
    } finally {
      setRevoking(null);
      setBusy(false);
    }
    await load();
  }

  const seen = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' }) : null;

  // The dialog's printer as the list has it NOW: its papers and its computer's state can change under it.
  const testAgent = testing ? (agents?.find((agent) => agent.id === testing.agent.id) ?? testing.agent) : null;
  const testPrinter = testing
    ? (testAgent?.printers.find((printer) => printer.id === testing.printer.id) ?? testing.printer)
    : null;

  return (
    <div className="@container flex h-full min-h-0 w-full flex-col gap-4 overflow-y-auto p-4 text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">Printers</h2>
          <p className="text-sm text-muted-foreground">
            {agents ? fleetSummaryText(fleetSummary(agents)) : 'The computers that print for this workspace.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Refresh"
            title="Refresh"
            className={cn(buttonClass('secondary', 'sm'), 'size-8 px-0')}
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw aria-hidden="true" className={cn('size-3.5', refreshing && 'animate-spin')} />
          </button>
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setGuide(true)}>
            <BookOpen aria-hidden="true" className="size-3.5" />
            Setup guide
          </button>
          {canManage ? (
            <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setPairing(true)}>
              <Plus aria-hidden="true" className="size-3.5" />
              Add a computer
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-status-error px-3 py-2.5 text-sm text-status-error-foreground"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {agents === null && !error ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Loading…</span>
          <div className="h-36 animate-pulse rounded-2xl border border-border bg-card" />
          <div className="h-36 animate-pulse rounded-2xl border border-border bg-card" />
        </div>
      ) : null}

      {agents && agents.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border px-4 py-10 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Monitor aria-hidden="true" className="size-7" />
          </span>
          <div>
            <p className="text-base font-semibold">No computer is paired yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {canManage
                ? 'Pair the computer your printers are connected to, and this workspace can print on them from anywhere.'
                : 'Somebody who manages printing for this workspace has to pair a computer first.'}
            </p>
          </div>
          {canManage ? (
            <>
              <ol className="flex flex-col gap-1.5 text-left text-sm text-muted-foreground">
                {[
                  'Install the print agent on that computer.',
                  'Add the computer here to get a one-time code.',
                  'Type the code on it, and start the agent.',
                ].map((step, index) => (
                  <li key={step} className="flex items-center gap-2.5">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
                      {index + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className={buttonClass('secondary')} onClick={() => setGuide(true)}>
                  <BookOpen aria-hidden="true" className="size-4" />
                  Setup guide
                </button>
                <button type="button" className={buttonClass('primary')} onClick={() => setPairing(true)}>
                  <Plus aria-hidden="true" className="size-4" />
                  Add a computer
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <ul className="flex flex-col gap-4">
        {(agents ?? []).map((agent) => (
          <ComputerCard
            key={agent.id}
            agent={agent}
            seenText={seen(agent.lastSeenAt)}
            busy={busy}
            onRevoke={canManage ? () => setRevoking(agent) : undefined}
            onTest={canSend ? (printer) => setTesting({ agent, printer }) : undefined}
          />
        ))}
      </ul>

      <PairingDialog
        open={pairing && canManage}
        agents={agents ?? []}
        expiresText={seen}
        onCreate={(name) => api.createPairingCode(scope, name)}
        onClose={() => {
          setPairing(false);
          void load();
        }}
        onGuide={() => {
          setPairing(false);
          setGuide(true);
        }}
      />

      <SetupGuideDialog
        open={guide}
        server={server}
        canPair={canManage}
        onClose={() => setGuide(false)}
        onPair={() => {
          setGuide(false);
          setPairing(true);
        }}
      />

      <TestPrintDialog
        printer={testPrinter}
        computer={testAgent?.name ?? ''}
        blocked={testAgent && testPrinter ? cannotPrintReason(testAgent, testPrinter) : null}
        api={api}
        scope={scope}
        onClose={() => setTesting(null)}
      />

      <ConfirmDialog
        open={revoking !== null}
        title="Revoke this computer?"
        description={
          <>
            <strong>{revoking?.name}</strong> will stop printing for this workspace. To use it again it has to be paired
            again with a new code.
          </>
        }
        confirmLabel="Revoke"
        pending={busy}
        onCancel={() => setRevoking(null)}
        onConfirm={() => void revoke()}
      />
    </div>
  );
}
