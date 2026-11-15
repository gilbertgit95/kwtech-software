'use client';

import { cn } from '@kwtech/web-ui/react';
import { HardDrive, MoonStar } from 'lucide-react';
import type { FileSettingsView } from '../file-client.js';
import { cleanupTimeLabel, retentionLabel, usageFraction, usageLabel } from '../view/files-view.js';

/**
 * How full the workspace is, and when tonight's clean-up runs: the two things
 * a person needs before uploading. One card on a phone; two side by side in a
 * wide box.
 */
export function StorageSummary({
  settings,
  compact = false,
  className,
}: {
  settings: FileSettingsView;
  /** One card, for a phone: the clean-up as a line under the meter. */
  compact?: boolean;
  className?: string;
}) {
  const fraction = usageFraction(settings.usedBytes, settings.storageBytes);
  const nearlyFull = fraction !== null && fraction >= 0.9;
  if (compact) {
    return (
      <div
        className={cn('flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-3.5 shadow-sm', className)}
      >
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-sm"
        >
          <HardDrive className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{usageLabel(settings.usedBytes, settings.storageBytes)}</p>
          {fraction !== null ? (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className={cn('h-full rounded-full', nearlyFull ? 'bg-status-warning-foreground' : 'bg-primary')}
                style={{ width: `${Math.max(Math.round(fraction * 100), fraction > 0 ? 2 : 0)}%` }}
              />
            </div>
          ) : null}
          <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
            <MoonStar aria-hidden className="size-3.5 shrink-0" />
            Cleared nightly at {cleanupTimeLabel(settings.cleanupTime)} · kept {retentionLabel(settings.retentionHours)}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className={cn('grid gap-3 @xl:grid-cols-2', className)}>
      <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-sm"
        >
          <HardDrive className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Storage</p>
          <p className="truncate text-sm font-semibold">{usageLabel(settings.usedBytes, settings.storageBytes)}</p>
          {fraction !== null ? (
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
              // Decorative: the line above says the same in words.
              aria-hidden
            >
              <div
                className={cn(
                  'h-full rounded-full transition-[width]',
                  nearlyFull ? 'bg-status-warning-foreground' : 'bg-primary',
                )}
                style={{ width: `${Math.max(Math.round(fraction * 100), fraction > 0 ? 2 : 0)}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
          <MoonStar className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Nightly clean-up</p>
          <p className="text-sm font-semibold">Every night at {cleanupTimeLabel(settings.cleanupTime)}</p>
          <p className="text-xs text-muted-foreground">
            Deletes files older than {retentionLabel(settings.retentionHours)}.
          </p>
        </div>
      </div>
    </div>
  );
}
