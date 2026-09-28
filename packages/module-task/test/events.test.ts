import { type TaskEventFacts, taskEventFor } from '../src/domain/events.js';

const viewer = (userId: string) => ({ userId, organizationId: 'o', workspaceId: 'w' });
const event = (over: Partial<TaskEventFacts>): TaskEventFacts => ({
  organizationId: 'o',
  workspaceId: 'w',
  boardId: 'b',
  ownerId: 'owner',
  visibility: 'workspace',
  change: 'task',
  ...over,
});

describe('taskEventFor', () => {
  it('tells everyone about a shared board, and only the owner about a private one', () => {
    expect(taskEventFor(event({}), viewer('someone'))).toBe('changed');
    expect(taskEventFor(event({ visibility: 'private' }), viewer('owner'))).toBe('changed');
    expect(taskEventFor(event({ visibility: 'private' }), viewer('someone'))).toBeNull();
  });

  it('⚠ tells everyone else to drop a board that just went private', () => {
    expect(taskEventFor(event({ change: 'hidden', visibility: 'private' }), viewer('someone'))).toBe('removed');
    expect(taskEventFor(event({ change: 'hidden', visibility: 'private' }), viewer('owner'))).toBe('changed');
  });

  it('removes a deleted board, and ignores other workspaces', () => {
    expect(taskEventFor(event({ change: 'deleted' }), viewer('someone'))).toBe('removed');
    expect(taskEventFor(event({ workspaceId: 'other' }), viewer('someone'))).toBeNull();
  });
});
