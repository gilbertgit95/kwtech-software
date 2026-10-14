'use client';

import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { DatePicker as CalendarPicker } from '@kwtech/web-ui/react';
import { type TaskDay, workspaceTaskDay } from '../../domain/dates.js';

/**
 * A task's day, picked from `web-ui`'s calendar (moved there when the books
 * became its second user, PLAN §13, 2026-10-15). This wrapper only supplies
 * what `web-ui` cannot know: ⚠ "today" is the WORKSPACE's day
 * (`workspaceTaskDay`), never the browser's, so the ring on today and the
 * *Today* button agree with what the board calls overdue (PLAN §13,
 * 2026-09-29). Either date may be empty (TASK-PLAN decision 11a), so *Clear*
 * stays on.
 */
export function DatePicker(props: {
  /** The trigger's id, for a `<label htmlFor>` outside. */
  id?: string;
  value: TaskDay | null;
  disabled?: boolean;
  placeholder?: string;
  onChange: (day: TaskDay | null) => void;
  'aria-describedby'?: string | undefined;
}) {
  const timeZone = useWorkspaceTimeZone();
  return <CalendarPicker {...props} today={workspaceTaskDay(new Date(), timeZone)} />;
}
