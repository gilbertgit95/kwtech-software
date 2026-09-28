import {
  canOpenBoard,
  checkBoardLifecycle,
  checkConfigureBoard,
  checkCreateTask,
  checkEditComment,
  checkWorkWithTask,
  planRemoveComment,
  planSetAssignees,
  planTaskArchiveAct,
  TASK_ASSIGNEES_MAX,
} from '../src/domain/access.js';
import type { TaskBoardFacts, TaskFacts } from '../src/types.js';

const ARCHIVED = new Date('2026-09-28T09:00:00Z');
const shared: TaskBoardFacts = { ownerId: 'owner', visibility: 'workspace', archivedAt: null };
const privateBoard: TaskBoardFacts = { ownerId: 'owner', visibility: 'private', archivedAt: null };
const live: TaskFacts = { creatorId: 'creator', archivedAt: null };
const archivedTask: TaskFacts = { creatorId: 'creator', archivedAt: ARCHIVED };

describe('canOpenBoard', () => {
  it('opens a shared board to anyone, and a private one to its owner alone', () => {
    expect(canOpenBoard(shared, 'someone')).toBe(true);
    expect(canOpenBoard(privateBoard, 'owner')).toBe(true);
    expect(canOpenBoard(privateBoard, 'someone')).toBe(false);
  });
});

describe('⚠ every check answers not_found first for a private board', () => {
  it('whatever the act', () => {
    expect(checkConfigureBoard(privateBoard, 'x')).toBe('not_found');
    expect(checkBoardLifecycle(privateBoard, 'x', 'archive')).toBe('not_found');
    expect(checkWorkWithTask(privateBoard, live, 'x')).toBe('not_found');
    expect(checkCreateTask(privateBoard, 'x')).toBe('not_found');
    expect(checkEditComment(privateBoard, { authorId: 'x' }, 'x')).toBe('not_found');
    expect(planTaskArchiveAct(privateBoard, live, 'x', 'delete_forever')).toEqual({
      kind: 'refused',
      reason: 'not_found',
    });
    expect(planRemoveComment(privateBoard, { authorId: 'x' }, 'x')).toEqual({ kind: 'refused', reason: 'not_found' });
  });
});

describe('configuring a board', () => {
  it('is the owner’s alone, and not while archived', () => {
    expect(checkConfigureBoard(shared, 'owner')).toBeNull();
    expect(checkConfigureBoard(shared, 'someone')).toBe('not_owner');
    expect(checkConfigureBoard({ ...shared, archivedAt: ARCHIVED }, 'owner')).toBe('board_archived');
  });

  it('⚠ deletes forever only from the archive', () => {
    expect(checkBoardLifecycle(shared, 'owner', 'delete_forever')).toBe('board_not_archived');
    expect(checkBoardLifecycle({ ...shared, archivedAt: ARCHIVED }, 'owner', 'delete_forever')).toBeNull();
    expect(checkBoardLifecycle(shared, 'owner', 'archive')).toBeNull();
    expect(checkBoardLifecycle({ ...shared, archivedAt: ARCHIVED }, 'owner', 'archive')).toBe('board_archived');
  });
});

describe('working with tasks', () => {
  it('is open to anyone on a shared board, and read-only when archived', () => {
    expect(checkWorkWithTask(shared, live, 'someone')).toBeNull();
    expect(checkWorkWithTask(shared, archivedTask, 'someone')).toBe('archived');
    expect(checkWorkWithTask({ ...shared, archivedAt: ARCHIVED }, live, 'someone')).toBe('board_archived');
  });

  it('archives and restores for anyone, deletes forever for creator, owner, or with manage_all', () => {
    expect(planTaskArchiveAct(shared, live, 'someone', 'archive')).toEqual({ kind: 'allowed' });
    expect(planTaskArchiveAct(shared, archivedTask, 'someone', 'restore')).toEqual({ kind: 'allowed' });
    expect(planTaskArchiveAct(shared, archivedTask, 'creator', 'delete_forever')).toEqual({ kind: 'allowed' });
    expect(planTaskArchiveAct(shared, archivedTask, 'owner', 'delete_forever')).toEqual({ kind: 'allowed' });
    expect(planTaskArchiveAct(shared, archivedTask, 'someone', 'delete_forever')).toEqual({
      kind: 'needs_manage_all',
    });
  });

  it('⚠ deletes a task forever only from the archive', () => {
    expect(planTaskArchiveAct(shared, live, 'creator', 'delete_forever')).toEqual({
      kind: 'refused',
      reason: 'not_archived',
    });
  });
});

describe('comments', () => {
  it('are edited by their author alone, manage_all included', () => {
    expect(checkEditComment(shared, { authorId: 'me' }, 'me')).toBeNull();
    expect(checkEditComment(shared, { authorId: 'me' }, 'owner')).toBe('not_permitted');
  });

  it('are removed by their author or the board owner, else with manage_all', () => {
    expect(planRemoveComment(shared, { authorId: 'me' }, 'me')).toEqual({ kind: 'allowed' });
    expect(planRemoveComment(shared, { authorId: 'me' }, 'owner')).toEqual({ kind: 'allowed' });
    expect(planRemoveComment(shared, { authorId: 'me' }, 'someone')).toEqual({ kind: 'needs_manage_all' });
  });
});

describe('planSetAssignees', () => {
  it('lets anyone assign themselves without task:assign', () => {
    expect(planSetAssignees(shared, [], ['me'], 'me')).toEqual({ kind: 'allowed', added: ['me'], removed: [] });
  });

  it('needs task:assign to add anybody else', () => {
    expect(planSetAssignees(shared, [], ['me', 'you'], 'me')).toEqual({
      kind: 'needs_assign',
      added: ['me', 'you'],
      removed: [],
    });
  });

  it('removing people needs nothing more, and only NEW people count as added', () => {
    expect(planSetAssignees(shared, ['you', 'them'], ['you'], 'me')).toEqual({
      kind: 'allowed',
      added: [],
      removed: ['them'],
    });
  });

  it('⚠ on a private board, assigns its owner only', () => {
    expect(planSetAssignees(privateBoard, [], ['owner'], 'owner').kind).toBe('allowed');
    expect(planSetAssignees(privateBoard, [], ['owner', 'you'], 'owner')).toEqual({
      kind: 'refused',
      reason: 'not_assignable',
    });
  });

  it('caps the list, counting duplicates once', () => {
    const many = Array.from({ length: TASK_ASSIGNEES_MAX + 1 }, (_, i) => `u${i}`);
    expect(planSetAssignees(shared, [], many, 'me')).toEqual({ kind: 'refused', reason: 'too_many_assignees' });
    expect(planSetAssignees(shared, [], ['me', 'me'], 'me')).toEqual({ kind: 'allowed', added: ['me'], removed: [] });
  });
});
