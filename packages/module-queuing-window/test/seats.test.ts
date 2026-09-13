import { type AssignmentInput, canReleaseSeat, planAssignment, seatWindowOf } from '../src/domain/seats.js';

const base: AssignmentInput = {
  actorId: 'boss',
  assigneeId: 'joy',
  window: { id: 'w3', archivedAt: null },
  seats: [],
  assigneeCanServe: true,
  confirmReplace: false,
};

const plan = (over: Partial<AssignmentInput>) => planAssignment({ ...base, ...over });

describe('planAssignment', () => {
  it('assigns a free window', () => {
    expect(plan({})).toEqual({
      kind: 'assign',
      windowId: 'w3',
      userId: 'joy',
      replacedUserId: null,
      movedFromWindowId: null,
    });
  });

  it('refuses an archived window', () => {
    expect(plan({ window: { id: 'w3', archivedAt: new Date() } })).toEqual({
      kind: 'refused',
      reason: 'window_archived',
    });
  });

  describe('⚠ with no QueueStaffCheck bound, the module can vouch only for the actor', () => {
    it('refuses assigning anybody else', () => {
      expect(plan({ assigneeCanServe: null })).toEqual({ kind: 'refused', reason: 'only_yourself' });
    });

    it('lets the actor assign themselves', () => {
      expect(plan({ assigneeCanServe: null, assigneeId: 'boss' })).toMatchObject({ kind: 'assign', userId: 'boss' });
    });
  });

  it('refuses somebody who cannot serve in this workspace — the actor included', () => {
    expect(plan({ assigneeCanServe: false })).toEqual({ kind: 'refused', reason: 'cannot_serve' });
    expect(plan({ assigneeCanServe: false, assigneeId: 'boss' })).toEqual({ kind: 'refused', reason: 'cannot_serve' });
  });

  it('⚠ names the occupant instead of replacing them unconfirmed, so the console can ask', () => {
    expect(plan({ seats: [{ windowId: 'w3', userId: 'ben' }] })).toEqual({
      kind: 'refused',
      reason: 'occupied',
      occupantId: 'ben',
    });
  });

  it('replaces the occupant once confirmed', () => {
    expect(plan({ seats: [{ windowId: 'w3', userId: 'ben' }], confirmReplace: true })).toMatchObject({
      kind: 'assign',
      replacedUserId: 'ben',
    });
  });

  it('⚠ MOVES somebody who already sits elsewhere — one window per person', () => {
    expect(plan({ seats: [{ windowId: 'w1', userId: 'joy' }] })).toMatchObject({
      kind: 'assign',
      movedFromWindowId: 'w1',
    });
  });

  it('does nothing when they already sit there', () => {
    expect(plan({ seats: [{ windowId: 'w3', userId: 'joy' }] })).toEqual({ kind: 'unchanged' });
  });
});

describe('canReleaseSeat', () => {
  it('⚠ lets anybody free their OWN seat with no key — ending a shift is not a permission', () => {
    expect(canReleaseSeat('joy', { windowId: 'w3', userId: 'joy' }, false)).toBe(true);
  });

  it("needs queue:assign_windows to free somebody else's", () => {
    expect(canReleaseSeat('ben', { windowId: 'w3', userId: 'joy' }, false)).toBe(false);
    expect(canReleaseSeat('ben', { windowId: 'w3', userId: 'joy' }, true)).toBe(true);
  });
});

describe('seatWindowOf', () => {
  it('finds the window a person is assigned, or null', () => {
    const seats = [{ windowId: 'w3', userId: 'joy' }];
    expect(seatWindowOf('joy', seats)).toBe('w3');
    expect(seatWindowOf('ben', seats)).toBeNull();
  });
});
