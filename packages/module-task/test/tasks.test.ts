import { prepareTaskLabels, TASK_LABELS_MAX } from '../src/domain/labels.js';
import {
  checkTaskVersion,
  completedAtAfterMove,
  isTaskPriority,
  prepareChecklistText,
  prepareCommentBody,
  prepareTaskDescription,
  prepareTaskTitle,
  TASK_TITLE_MAX,
} from '../src/domain/tasks.js';

describe('task text', () => {
  it('needs a title, one line, within the cap', () => {
    expect(prepareTaskTitle(' Call\nthe plumber ')).toEqual({ title: 'Call the plumber' });
    expect(prepareTaskTitle('')).toEqual({ refused: 'invalid_title' });
    expect(prepareTaskTitle('x'.repeat(TASK_TITLE_MAX + 1))).toEqual({ refused: 'invalid_title' });
  });

  it('keeps a description as typed, allows it empty, and ⚠ refuses NUL', () => {
    expect(prepareTaskDescription('a\n  b ')).toEqual({ description: 'a\n  b ' });
    expect(prepareTaskDescription('')).toEqual({ description: '' });
    expect(prepareTaskDescription('a\u0000b')).toEqual({ refused: 'invalid_description' });
  });

  it('needs something in a checklist item and a comment', () => {
    expect(prepareChecklistText('  ')).toEqual({ refused: 'invalid_checklist_item' });
    expect(prepareCommentBody(' \n ')).toEqual({ refused: 'invalid_comment' });
    expect(prepareCommentBody('Done, see https://example.com')).toEqual({ body: 'Done, see https://example.com' });
  });
});

describe('labels', () => {
  it('normalises like note tags, dropping duplicates', () => {
    expect(prepareTaskLabels(['#Front Desk', 'front-desk', '', 'Urgent'])).toEqual({
      labels: ['front-desk', 'urgent'],
    });
  });

  it('refuses the whole list when one is wrong or there are too many', () => {
    expect(prepareTaskLabels(['ok', 'x'.repeat(40)])).toEqual({ refused: 'invalid_labels' });
    const many = Array.from({ length: TASK_LABELS_MAX + 1 }, (_, i) => `l${i}`);
    expect(prepareTaskLabels(many)).toEqual({ refused: 'invalid_labels' });
  });
});

describe('priority, version, completion', () => {
  it('narrows a priority from the wire', () => {
    expect(isTaskPriority('urgent')).toBe(true);
    expect(isTaskPriority('critical')).toBe(false);
  });

  it('refuses a stale save', () => {
    expect(checkTaskVersion(3, 3)).toBeNull();
    expect(checkTaskVersion(2, 3)).toBe('conflict');
  });

  it('sets completedAt on entering a done column, keeps it between done columns, clears it on leaving', () => {
    const now = new Date('2026-10-05T10:00:00Z');
    const earlier = new Date('2026-10-01T10:00:00Z');
    expect(completedAtAfterMove(null, true, now)).toBe(now);
    expect(completedAtAfterMove(earlier, true, now)).toBe(earlier);
    expect(completedAtAfterMove(earlier, false, now)).toBeNull();
  });
});
