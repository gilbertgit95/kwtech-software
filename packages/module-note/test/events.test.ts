import { type NoteEventFacts, noteEventFor } from '../src/domain/events.js';

const SCOPE = { organizationId: 'org-1', workspaceId: 'ws-1' };
const AUTHOR = { ...SCOPE, userId: 'user-author' };
const OTHER = { ...SCOPE, userId: 'user-other' };

function event(overrides: Partial<NoteEventFacts> = {}): NoteEventFacts {
  return { ...SCOPE, authorId: AUTHOR.userId, visibility: 'private', change: 'updated', ...overrides };
}

describe('noteEventFor', () => {
  it('⚠ tells nobody else anything about a private note', () => {
    for (const change of ['created', 'updated', 'trashed', 'restored', 'deleted'] as const) {
      expect(noteEventFor(event({ change }), OTHER)).toBeNull();
    }
  });

  it('tells the author about their own private note', () => {
    expect(noteEventFor(event(), AUTHOR)).toBe('changed');
    expect(noteEventFor(event({ change: 'deleted' }), AUTHOR)).toBe('removed');
  });

  it('tells everyone about a shared note', () => {
    expect(noteEventFor(event({ visibility: 'workspace' }), OTHER)).toBe('changed');
    expect(noteEventFor(event({ visibility: 'workspace', change: 'shared' }), OTHER)).toBe('changed');
    expect(noteEventFor(event({ visibility: 'workspace', change: 'deleted' }), OTHER)).toBe('removed');
  });

  it('⚠ tells the others a note was UNSHARED, so it leaves their index now', () => {
    expect(noteEventFor(event({ change: 'unshared' }), OTHER)).toBe('removed');
    expect(noteEventFor(event({ change: 'unshared' }), AUTHOR)).toBe('changed');
  });

  it('⚠ never crosses a workspace or an organization', () => {
    const shared = event({ visibility: 'workspace' });
    expect(noteEventFor(shared, { ...OTHER, workspaceId: 'ws-2' })).toBeNull();
    expect(noteEventFor(shared, { ...OTHER, organizationId: 'org-2' })).toBeNull();
    expect(noteEventFor(event({ change: 'unshared' }), { ...OTHER, workspaceId: 'ws-2' })).toBeNull();
  });
});
