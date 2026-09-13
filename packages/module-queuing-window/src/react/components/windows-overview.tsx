'use client';

import type { QueueConsoleState } from '../use-queue-console.js';
import { activeWindows, clockTime, seatAt, servingAt } from '../view/console-view.js';
import { Section } from './ui.js';

const STATUS_LABEL: Record<string, string> = { called: 'Called', done: 'Done', no_show: 'No-show' };

/** Every window and what it is serving, live — and the calls made this session. */
export function WindowsOverview({ state }: { state: QueueConsoleState }) {
  const { view } = state;
  if (!view) return null;
  const windows = activeWindows(view);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Section title="Windows" className="lg:col-span-2">
        {windows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No windows yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Window</th>
                  <th className="pb-2 font-medium">Assigned</th>
                  <th className="pb-2 font-medium">Now serving</th>
                </tr>
              </thead>
              <tbody>
                {windows.map((window) => {
                  const seat = seatAt(view, window.id);
                  const ticket = servingAt(view, window.id);
                  return (
                    <tr key={window.id} className="border-t border-border">
                      <td className="py-2 font-medium text-foreground">{window.name}</td>
                      <td className="py-2">
                        {seat ? (
                          <span className="text-foreground">
                            {seat.displayName}
                            {seat.userId === view.myUserId ? ' (you)' : ''}
                            {/*
                              ⚠ Seats persist across sessions, so a seat can outlive its
                              holder's right to serve (§12.62). The guard refuses their
                              calls; this is how anybody notices the window only LOOKS
                              staffed.
                            */}
                            {seat.canServe === false ? (
                              <span className="ml-2 text-xs font-medium text-destructive">
                                can no longer serve here
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Nobody</span>
                        )}
                      </td>
                      <td className="py-2 font-mono text-foreground">{ticket?.label ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Recent calls">
        {view.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing called yet this session.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {view.recent.map((ticket) => (
              <li key={ticket.id} className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-foreground">{ticket.label}</span>
                <span className="flex-1 truncate text-muted-foreground">{ticket.windowName}</span>
                <span className="text-xs text-muted-foreground">
                  {STATUS_LABEL[ticket.status] ?? ticket.status} · {clockTime(ticket.calledAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
