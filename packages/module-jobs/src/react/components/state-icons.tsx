'use client';

import {
  CalendarClock,
  CircleCheck,
  CirclePause,
  CirclePlay,
  CircleX,
  Clock,
  Hourglass,
  LoaderCircle,
  RotateCcw,
  SkipForward,
  TriangleAlert,
  Unplug,
  Zap,
  ZapOff,
} from 'lucide-react';

/**
 * One picture per state, so a state looks the same in the list, the drawer
 * and the history. Decorative: every one sits beside the word it stands for.
 */

/** How a process stands. A run under way turns. */
export function StandingIcon({ standing }: { standing: string }) {
  switch (standing) {
    case 'idle':
      return <Clock />;
    case 'queued':
      return <Hourglass />;
    case 'running':
      return <LoaderCircle className="animate-spin" />;
    case 'paused':
      return <CirclePause />;
    case 'failing':
      return <TriangleAlert />;
    case 'unsynced':
      return <Unplug />;
    default:
      return <Clock />;
  }
}

/** How a run ended, or where it is. */
export function RunStateIcon({ state }: { state: string }) {
  switch (state) {
    case 'queued':
      return <Hourglass />;
    case 'running':
      return <LoaderCircle className="animate-spin" />;
    case 'succeeded':
      return <CircleCheck />;
    case 'failed':
      return <CircleX />;
    case 'skipped':
      return <SkipForward />;
    case 'interrupted':
      return <ZapOff />;
    default:
      return <Clock />;
  }
}

/** What an admin did. */
export function ControlIcon({ action }: { action: string }) {
  switch (action) {
    case 'paused':
      return <CirclePause />;
    case 'resumed':
      return <CirclePlay />;
    case 'forced':
      return <Zap />;
    case 'rescheduled':
      return <CalendarClock />;
    case 'reset_schedule':
      return <RotateCcw />;
    default:
      return <Clock />;
  }
}
