'use client';

import { cn } from '@kwtech/web-ui/react';
import { clockTime, groupByDayPart } from '../view/time.js';

/** A chosen time: which resource, and when. */
export interface SlotChoice {
  resourceId: string;
  startsAt: string;
}

/**
 * Free times as buttons: per resource, then by morning, afternoon and evening.
 * Presentation only — whoever uses it has already read the times from the
 * server, for staff or for a customer.
 *
 * ⚠ `timeZone` is the WORKSPACE's. A time is 2:30 PM in the shop on every
 * screen, wherever the person choosing it is.
 */
export function SlotGrid({
  slots,
  timeZone,
  value,
  onChange,
}: {
  slots: readonly { resourceId: string; name: string; starts: readonly string[] }[];
  timeZone: string;
  value: SlotChoice | null;
  onChange: (choice: SlotChoice) => void;
}) {
  return (
    <div className="@container flex max-h-72 flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-muted/30 p-3">
      {slots.map((entry) => (
        <fieldset key={entry.resourceId} className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold">{entry.name}</legend>
          {groupByDayPart(entry.starts, timeZone).map((group) => (
            <div key={group.part} className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{group.part}</span>
              <div className="grid grid-cols-3 gap-1.5 @md:grid-cols-4 @xl:grid-cols-5">
                {group.starts.map((start) => {
                  const chosen = value?.resourceId === entry.resourceId && value.startsAt === start;
                  return (
                    <button
                      key={start}
                      type="button"
                      aria-pressed={chosen}
                      className={cn(
                        'h-10 rounded-lg border text-sm font-medium tabular-nums transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        chosen
                          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                          : 'border-border bg-card hover:border-primary hover:bg-accent',
                      )}
                      onClick={() => onChange({ resourceId: entry.resourceId, startsAt: start })}
                    >
                      {clockTime(start, timeZone)}
                      <span className="sr-only"> with {entry.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
