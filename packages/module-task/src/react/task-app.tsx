'use client';

import type { AppProps } from '@kwtech/module-kit';

/**
 * ⚠ SAMPLE DATA, NOT TASKS. The placeholder screen needs something to lay out so
 * the Apps page's tabs and grid can be tried with a realistic shape. Nothing is
 * read or saved; this board goes when the tasks API lands.
 */
const SAMPLE_BOARD = [
  { status: 'To do', tasks: ['Restock the counter', 'Call the plumber'] },
  { status: 'Doing', tasks: ['Update the price list'] },
  { status: 'Done', tasks: ['Order new receipt paper', 'Clean the display screens'] },
] as const;

/**
 * Tasks as a SUB-APP on the workspace's Apps page — a PLACEHOLDER.
 *
 * It exists so the Apps page and the module wiring can be tested end to end
 * with more than one app. The shape is the real contract all the same:
 * `@container`, and `@…:` variants rather than `sm:` / `lg:`, because a grid
 * cell is narrow on a wide screen. The columns stack when narrow and sit side
 * by side when there is room.
 */
export function TaskApp({ workspaceId }: AppProps) {
  return (
    <div className="@container flex h-full w-full flex-col gap-4 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-xs text-muted-foreground">Coming soon — sample tasks, nothing is saved.</p>
      </header>

      <div className="grid gap-3 @xl:grid-cols-3">
        {SAMPLE_BOARD.map((column) => (
          <section
            key={column.status}
            aria-label={column.status}
            className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
          >
            <h2 className="flex items-center justify-between text-sm font-semibold">
              {column.status}
              <span className="text-xs font-normal text-muted-foreground">{column.tasks.length}</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {column.tasks.map((task) => (
                <li key={task} className="rounded-md border border-border px-3 py-2 text-sm">
                  {task}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">Workspace {workspaceId}</p>
    </div>
  );
}
